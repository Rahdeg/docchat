"use server";

import { after } from "next/server";
import { z } from "zod";

import { ActionError, authedAction } from "@/lib/action";
import { deleteBlob, readBlobHead } from "@/server/blob";
import { indexDocument } from "@/server/ingest/index-document";

import { createDocument, deleteDocument as deleteDocumentRow, resetForRetry } from "./mutations";
import { getDocumentByBlobPathname } from "./queries";
import { checkUploadPath, notYourUploadMessage } from "./upload-policy";
import {
  contentMatchesKind,
  contentMismatchMessage,
  fileKindOf,
  fileKinds,
  MAX_FILE_BYTES,
  SNIFF_BYTES,
} from "./upload-rules";

// Indexing runs in after() inside the Library page's function, so it gets that page's
// maxDuration (src/app/(app)/library/page.tsx).

const registerInput = z.object({
  blobPathname: z.string().min(1).max(512),
  name: z.string().trim().min(1).max(255),
  // What the browser reported. The server trusts neither: it uses the stored file's real size
  // and checks its leading bytes against the type its extension claims.
  mimeType: z.string().max(255),
  sizeBytes: z.number().int().nonnegative(),
});

// Called by the browser once its upload to Blob has finished. Creates the document row and
// starts indexing in the background.
export const registerDocument = authedAction(registerInput, async (input, { userId }) => {
  const already = await getDocumentByBlobPathname(userId, input.blobPathname);
  if (already) return { id: already.id, name: already.name };

  const check = await checkUploadPath(userId, input.blobPathname);
  if (!check.ok) {
    // Never touch files outside the caller's own folder.
    if (check.error !== notYourUploadMessage) await deleteQuietly(input.blobPathname);
    throw new ActionError(check.error);
  }

  if (fileKindOf(input.name) !== check.kind) {
    await deleteQuietly(input.blobPathname);
    throw new ActionError(`${input.name} isn't a PDF, Markdown or text file.`);
  }

  const stored = await readBlobHead(input.blobPathname, SNIFF_BYTES);
  if (!stored) throw new ActionError("We couldn't find the uploaded file. Try uploading it again.");

  if (stored.size > MAX_FILE_BYTES) {
    await deleteQuietly(input.blobPathname);
    throw new ActionError(`${input.name} is larger than 10 MB.`);
  }
  if (!contentMatchesKind(check.kind, stored.head)) {
    await deleteQuietly(input.blobPathname);
    throw new ActionError(contentMismatchMessage(input.name, check.kind));
  }

  const created = await createDocument(userId, {
    name: input.name,
    mimeType: fileKinds[check.kind].mimeType,
    sizeBytes: stored.size,
    blobPathname: input.blobPathname,
  });

  after(() => indexDocument(userId, created.id));
  return { id: created.id, name: created.name };
});

const documentIdInput = z.object({ id: z.uuid() });

// Reads a failed or stuck document again from scratch.
export const retryDocument = authedAction(documentIdInput, async ({ id }, { userId }) => {
  const reset = await resetForRetry(userId, id);
  if (!reset) throw new ActionError("This document is already being read.");

  after(() => indexDocument(userId, id));
  return { id, name: reset.name };
});

// Removes the document, its pages and chunks (cascade), and its stored file.
export const deleteDocument = authedAction(documentIdInput, async ({ id }, { userId }) => {
  const deleted = await deleteDocumentRow(userId, id);
  if (!deleted) throw new ActionError("That document was already removed.");

  if (deleted.blobPathname) await deleteQuietly(deleted.blobPathname);
  return { name: deleted.name };
});

// The row is the source of truth; a leftover file is only wasted storage, so log and move on.
async function deleteQuietly(pathname: string) {
  await deleteBlob(pathname).catch((error: unknown) => {
    console.error(`Couldn't delete blob ${pathname}`, error);
  });
}
