import "server-only";

import { countDocuments } from "./queries";
import {
  type FileKind,
  fileKindOf,
  limitReachedMessage,
  MAX_DOCUMENTS,
  parseBlobPathname,
} from "./upload-rules";

export type UploadPathCheck =
  { ok: true; kind: FileKind; fileName: string } | { ok: false; error: string };

export const notYourUploadMessage = "That upload doesn't belong to your library.";

// The server-side checks for a new upload, before a token is issued and again when it's
// registered: the path is in the caller's own folder, the extension is allowed, and they're
// under the document limit.
export async function checkUploadPath(userId: string, pathname: string): Promise<UploadPathCheck> {
  const parsed = parseBlobPathname(pathname);
  if (!parsed || parsed.userId !== userId) return { ok: false, error: notYourUploadMessage };

  const kind = fileKindOf(parsed.fileName);
  if (!kind) {
    return { ok: false, error: `${parsed.fileName} isn't a PDF, Markdown or text file.` };
  }

  if ((await countDocuments(userId)) >= MAX_DOCUMENTS) {
    return { ok: false, error: limitReachedMessage };
  }

  return { ok: true, kind, fileName: parsed.fileName };
}
