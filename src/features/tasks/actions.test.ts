import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  refresh: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  setTaskDone: vi.fn(),
  deleteTask: vi.fn(),
  restoreTask: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("./mutations", () => ({
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
  setTaskDone: mocks.setTaskDone,
  deleteTask: mocks.deleteTask,
  restoreTask: mocks.restoreTask,
}));

const { createTask, deleteTask, restoreTask, toggleTask, updateTask } = await import("./actions");

const alice = "user_alice";
const taskId = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: alice });
  mocks.createTask.mockResolvedValue({ id: taskId });
  mocks.updateTask.mockResolvedValue(true);
  mocks.setTaskDone.mockResolvedValue(true);
  mocks.restoreTask.mockResolvedValue(true);
});

describe("task actions", () => {
  it("reject signed-out callers without writing", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    expect(await createTask({ title: "Buy curtains", dueDate: null })).toMatchObject({ ok: false });
    expect(await toggleTask({ id: taskId, done: true })).toMatchObject({ ok: false });
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.setTaskDone).not.toHaveBeenCalled();
  });

  it("creates a task for the caller with a trimmed title", async () => {
    expect(await createTask({ title: "  Buy curtains ", dueDate: "2026-11-08" })).toEqual({
      ok: true,
      data: { id: taskId },
    });
    expect(mocks.createTask).toHaveBeenCalledWith(alice, {
      title: "Buy curtains",
      dueDate: "2026-11-08",
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("rejects an empty title and a date that doesn't exist", async () => {
    expect(await createTask({ title: "   ", dueDate: null })).toMatchObject({ ok: false });
    expect(await createTask({ title: "Pay rent", dueDate: "2026-02-30" })).toMatchObject({
      ok: false,
    });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("updates only the caller's task, and says when it isn't theirs", async () => {
    mocks.updateTask.mockResolvedValue(false);

    expect(await updateTask({ id: taskId, dueDate: null })).toEqual({
      ok: false,
      error: "This task doesn't exist any more.",
    });
    expect(mocks.updateTask).toHaveBeenCalledWith(alice, taskId, { dueDate: null });
  });

  it("needs something to change", async () => {
    expect(await updateTask({ id: taskId })).toMatchObject({ ok: false });
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });

  it("toggles done for the caller", async () => {
    expect(await toggleTask({ id: taskId, done: true })).toMatchObject({ ok: true });
    expect(mocks.setTaskDone).toHaveBeenCalledWith(alice, taskId, true);
  });

  it("returns the deleted task so Undo can restore it", async () => {
    const row = {
      id: taskId,
      userId: alice,
      title: "Pay rent",
      dueDate: null,
      dueNote: null,
      done: false,
      completedAt: null,
      createdBy: "user" as const,
      chatId: null,
      sourceDocumentId: null,
      sourceChunkId: null,
      sourceQuote: null,
      sourceStartOffset: null,
      sourceEndOffset: null,
      sourceLabel: null,
      createdAt: new Date("2026-11-01T10:00:00Z"),
    };
    mocks.deleteTask.mockResolvedValue(row);

    const deleted = await deleteTask({ id: taskId });
    expect(deleted).toMatchObject({ ok: true });
    expect(deleted.ok && "userId" in deleted.data).toBe(false);

    expect(await restoreTask(deleted.ok ? deleted.data : ({} as never))).toMatchObject({
      ok: true,
    });
    expect(mocks.restoreTask).toHaveBeenCalledWith(alice, expect.objectContaining({ id: taskId }));
  });
});
