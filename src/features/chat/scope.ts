// Which documents a chat searches. Empty means all ready documents. The scope is saved on the
// chat with each question (POST /api/chat), so follow-ups, reloads and Recent chats keep it.
// "Ask about this" in the Library starts a new chat scoped to one document (askAboutUrl).
import type { ReadyDocument } from "../documents/queries";

export const DOCUMENT_NOT_READY = "That document isn't ready yet";
export const DOCUMENT_NOT_FOUND = "Document not found";

// The requested ids that are the user's ready documents. Anything else (another user's, or one
// still being read or removed) is dropped; nothing left means all documents.
export function readyScope(
  ready: readonly ReadyDocument[],
  requested: readonly string[],
): string[] {
  return [...new Set(requested)].filter((id) => ready.some((d) => d.id === id));
}

export type StartingScope = {
  documentIds: string[];
  // A toast when "Ask about this" named a document that can't be searched.
  notice: string | null;
};

// What the chat page starts with. A saved chat keeps its own scope and ignores a link; a new chat
// opened from "Ask about this" starts on that document if it's ready. `linkedExists` says whether
// the linked document is the user's at all (in any state).
export function startingScope({
  ready,
  saved,
  linkedId,
  linkedExists,
}: {
  ready: readonly ReadyDocument[];
  saved: readonly string[] | null;
  linkedId: string | null;
  linkedExists: boolean;
}): StartingScope {
  if (saved) return { documentIds: readyScope(ready, saved), notice: null };
  if (linkedId === null) return { documentIds: [], notice: null };
  const documentIds = readyScope(ready, [linkedId]);
  if (documentIds.length > 0) return { documentIds, notice: null };
  return { documentIds: [], notice: linkedExists ? DOCUMENT_NOT_READY : DOCUMENT_NOT_FOUND };
}
