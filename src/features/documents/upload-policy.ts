import "server-only";

import { limitMessage, type LimitFailure } from "@/lib/limit-messages";
import { documentLimitFor } from "@/lib/limits";

import { countDocuments } from "./queries";
import { type FileKind, fileKindOf, parseBlobPathname } from "./upload-rules";

export type UploadPathCheck =
  | { ok: true; kind: FileKind; fileName: string }
  | { ok: false; error: string; limit?: LimitFailure };

export const notYourUploadMessage = "That upload doesn't belong to your library.";

// The user's document limit, if they've reached it: every document counts, in any state.
// Null: under it, or unlimited.
export async function documentLimitReached(userId: string): Promise<LimitFailure | null> {
  const max = documentLimitFor(userId);
  if (max === null || (await countDocuments(userId)) < max) return null;
  return { code: "DOCUMENT_LIMIT", max };
}

// The server-side checks for a new upload, before a token is issued and again when it's
// registered: the path is in the caller's own folder, the extension is allowed, and they're
// under the document limit. createDocument checks the limit once more, under a lock, so two
// uploads at once can't both take the last slot.
export async function checkUploadPath(userId: string, pathname: string): Promise<UploadPathCheck> {
  const parsed = parseBlobPathname(pathname);
  if (!parsed || parsed.userId !== userId) return { ok: false, error: notYourUploadMessage };

  const kind = fileKindOf(parsed.fileName);
  if (!kind) {
    return { ok: false, error: `${parsed.fileName} isn't a PDF, Markdown or text file.` };
  }

  const limit = await documentLimitReached(userId);
  if (limit) return { ok: false, error: limitMessage(limit), limit };

  return { ok: true, kind, fileName: parsed.fileName };
}
