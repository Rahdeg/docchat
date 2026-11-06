"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { ActionError, authedAction } from "@/lib/action";

import {
  createTask as createTaskRow,
  deleteTask as deleteTaskRow,
  restoreTask as restoreTaskRow,
  setTaskDone,
  updateTask as updateTaskRow,
} from "./mutations";
import {
  calendarDaySchema,
  DUE_NOTE_MAX_CHARS,
  SOURCE_LABEL_MAX_CHARS,
  taskCreators,
  taskTitleSchema,
} from "./task-rules";

// The Tasks page's writes. Each refreshes the page, so the list and the sidebar's count of
// open tasks follow.

const notFound = "This task doesn't exist any more.";

export const createTask = authedAction(
  z.object({ title: taskTitleSchema, dueDate: calendarDaySchema.nullable() }),
  async (input, { userId }) => {
    const created = await createTaskRow(userId, input);
    refresh();
    return { id: created.id };
  },
);

export const updateTask = authedAction(
  z
    .object({
      id: z.uuid(),
      title: taskTitleSchema.optional(),
      // null clears the date.
      dueDate: calendarDaySchema.nullable().optional(),
    })
    .refine((input) => input.title !== undefined || input.dueDate !== undefined, {
      message: "Nothing to change.",
    }),
  async ({ id, ...changes }, { userId }) => {
    if (!(await updateTaskRow(userId, id, changes))) throw new ActionError(notFound);
    refresh();
    return { id };
  },
);

export const toggleTask = authedAction(
  z.object({ id: z.uuid(), done: z.boolean() }),
  async ({ id, done }, { userId }) => {
    if (!(await setTaskDone(userId, id, done))) throw new ActionError(notFound);
    refresh();
    return { id, done };
  },
);

// What "Undo" sends back to restore a deleted task: the row as deleteTask returned it.
const snapshotSchema = z.object({
  id: z.uuid(),
  title: taskTitleSchema,
  dueDate: calendarDaySchema.nullable(),
  dueNote: z.string().max(DUE_NOTE_MAX_CHARS).nullable(),
  done: z.boolean(),
  completedAt: z.coerce.date().nullable(),
  createdBy: z.enum(taskCreators),
  chatId: z.uuid().nullable(),
  sourceDocumentId: z.uuid().nullable(),
  sourceChunkId: z.uuid().nullable(),
  sourceQuote: z.string().max(2_000).nullable(),
  sourceStartOffset: z.number().int().nonnegative().nullable(),
  sourceEndOffset: z.number().int().nonnegative().nullable(),
  sourceLabel: z.string().max(SOURCE_LABEL_MAX_CHARS).nullable(),
  createdAt: z.coerce.date(),
});

export type TaskSnapshot = z.input<typeof snapshotSchema>;

export const deleteTask = authedAction(z.object({ id: z.uuid() }), async ({ id }, { userId }) => {
  const deleted = await deleteTaskRow(userId, id);
  if (!deleted) throw new ActionError(notFound);
  refresh();
  const { userId: _owner, ...snapshot } = deleted;
  return snapshot satisfies TaskSnapshot;
});

export const restoreTask = authedAction(snapshotSchema, async (snapshot, { userId }) => {
  await restoreTaskRow(userId, snapshot);
  refresh();
  return { id: snapshot.id };
});
