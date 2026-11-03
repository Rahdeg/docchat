import "server-only";

import { and, eq, inArray, lte } from "drizzle-orm";

import {
  MAX_PROPOSED_TASKS,
  proposeTasksInput,
  type ApprovalRequest,
} from "@/features/chat/agent-parts";
import {
  messageText,
  passagesOf,
  type ChatMessagePart,
  type ProposeTasksPart,
} from "@/features/chat/message";
import { checkProposal } from "@/server/ai/proposal";
import { db } from "@/server/db";
import { chunk, document, message, task, type NewTask } from "@/server/db/schema";

// The user's answer to a proposal (docs/adr/0007): "Add N tasks" saves the ticked ones,
// "Cancel" saves nothing. This is the only place the agent's tasks are written.
//
// Both lock the answer's row and check that its proposeTasks call is still waiting, then record
// the decision on the message in the same transaction. A second request for the same approval
// (a double click, another tab) finds it answered and adds nothing.
//
// Everything is checked again from what the server stored, never from the browser: the tool
// call's input, the run's passages (data-passages) and the user's messages. The browser only
// says which of the checked tasks to add, with the title and date the user left them with.

export type ProposalOutcome =
  | { ok: true; approved: boolean; added: number; toolCallId: string }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function answerProposal(
  userId: string,
  chatId: string,
  request: ApprovalRequest,
): Promise<ProposalOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(message)
      .where(
        and(
          eq(message.userId, userId),
          eq(message.chatId, chatId),
          eq(message.id, request.messageId),
          eq(message.role, "assistant"),
        ),
      )
      .for("update")
      .limit(1);
    if (!row) return { ok: false, status: 404, error: "These tasks don't exist." };

    const index = row.parts.findIndex(
      (part) => part.type === "tool-proposeTasks" && part.approval?.id === request.approvalId,
    );
    const part = row.parts[index] as ProposeTasksPart | undefined;
    if (!part) return { ok: false, status: 404, error: "These tasks don't exist." };
    if (part.state !== "approval-requested") {
      const added = part.state === "output-available";
      return {
        ok: false,
        status: 409,
        error: added ? "These tasks were already added." : "You already cancelled these tasks.",
      };
    }

    const save = (next: ChatMessagePart) =>
      tx
        .update(message)
        .set({ parts: row.parts.map((p, i) => (i === index ? next : p)) })
        .where(and(eq(message.userId, userId), eq(message.id, row.id)));

    if (!request.approved) {
      await save({
        ...part,
        state: "output-denied",
        approval: { ...part.approval, approved: false },
      });
      return { ok: true, approved: false, added: 0, toolCallId: part.toolCallId };
    }

    const chosen = request.tasks ?? [];
    const indices = new Set(chosen.map((t) => t.index));
    if (chosen.length === 0 || indices.size !== chosen.length) {
      return { ok: false, status: 400, error: "Choose at least one task to add." };
    }
    if (chosen.length > MAX_PROPOSED_TASKS) {
      return { ok: false, status: 400, error: `Add at most ${MAX_PROPOSED_TASKS} tasks at once.` };
    }

    const input = proposeTasksInput.safeParse(part.input);
    const passages = passagesOf(row)?.passages ?? [];
    if (!input.success) return { ok: false, status: 400, error: "These tasks can't be added." };

    // Dates the user gave before the proposal count; later messages don't change it.
    const asked = await tx
      .select({ parts: message.parts })
      .from(message)
      .where(
        and(
          eq(message.userId, userId),
          eq(message.chatId, chatId),
          eq(message.role, "user"),
          lte(message.createdAt, row.createdAt),
        ),
      );
    const checked = checkProposal({
      toolCallId: part.toolCallId,
      input: input.data,
      passages,
      userTexts: asked.map(messageText),
      firstCitation: 1,
    }).tasks;
    if (chosen.some((t) => t.index >= checked.length)) {
      return { ok: false, status: 400, error: "These tasks can't be added." };
    }

    // The passages are a copy taken when the answer was written; link only to chunks and
    // documents that still exist and are the user's.
    const sources = chosen.map((t) => passages[checked[t.index]!.source - 1]!);
    const chunkIds = new Set(
      (
        await tx
          .select({ id: chunk.id })
          .from(chunk)
          .where(
            and(
              eq(chunk.userId, userId),
              inArray(
                chunk.id,
                sources.map((p) => p.chunkId),
              ),
            ),
          )
      ).map((r) => r.id),
    );
    const documentIds = new Set(
      (
        await tx
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.userId, userId),
              inArray(
                document.id,
                sources.map((p) => p.documentId),
              ),
            ),
          )
      ).map((r) => r.id),
    );

    const rows: NewTask[] = chosen.map((choice, i) => {
      const found = checked[choice.index]!;
      const passage = sources[i]!;
      const linked = chunkIds.has(passage.chunkId);
      return {
        userId,
        title: choice.title,
        dueDate: choice.dueDate,
        dueNote: found.dueNote,
        createdBy: "agent",
        chatId,
        sourceDocumentId: documentIds.has(passage.documentId) ? passage.documentId : null,
        sourceChunkId: linked ? passage.chunkId : null,
        // The document's own words where the quote was found; the model's otherwise.
        sourceQuote: found.matched ? passage.content.slice(found.start, found.end) : found.quote,
        sourceStartOffset: linked ? found.start : null,
        sourceEndOffset: linked ? found.end : null,
        sourceLabel: found.label,
      };
    });
    await tx.insert(task).values(rows);
    await save({
      ...part,
      state: "output-available",
      output: { added: rows.length },
      approval: { ...part.approval, approved: true },
    });
    return { ok: true, approved: true, added: rows.length, toolCallId: part.toolCallId };
  });
}
