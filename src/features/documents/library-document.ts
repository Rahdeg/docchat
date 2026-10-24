// What the Library shows for each document. Shared by the server query and client components,
// so no server-only imports here.

import type { DocumentStatus } from "@/server/db/schema";

// After this long without progress, an `uploaded` or `indexing` document counts as stuck.
// The background function has a lower maxDuration (see the Library page), so by then it has
// certainly stopped.
export const STUCK_AFTER_MINUTES = 10;

// Characters of page 1 shown on a document's sheet.
export const PREVIEW_CHARS = 600;

export type LibraryDocument = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  pageCount: number | null;
  pagesRead: number;
  passageCount: number;
  // The start of page 1, once it has been read.
  preview: string | null;
  // False for seeded sample rows, which have no stored file.
  hasFile: boolean;
  // Status is uploaded or indexing, but nothing has happened for STUCK_AFTER_MINUTES.
  stuck: boolean;
  createdAt: Date;
};

// The state a sheet shows. "stopped" is a stuck document.
export type DisplayState = "queued" | "reading" | "ready" | "failed" | "stopped";

export function displayState(doc: Pick<LibraryDocument, "status" | "stuck">): DisplayState {
  if (doc.stuck) return "stopped";
  if (doc.status === "uploaded") return "queued";
  if (doc.status === "indexing") return "reading";
  return doc.status;
}

// Still moving: the Library polls while any document is in one of these states.
export function isInProgress(doc: Pick<LibraryDocument, "status" | "stuck">): boolean {
  const state = displayState(doc);
  return state === "queued" || state === "reading";
}

export function needsAttention(doc: Pick<LibraryDocument, "status" | "stuck">): boolean {
  const state = displayState(doc);
  return state === "failed" || state === "stopped";
}
