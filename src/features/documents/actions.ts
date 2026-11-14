"use server";

import { after } from "next/server";
import { z } from "zod";

import { ActionError, authedAction, LimitError } from "@/lib/action";
import type { LimitFailure } from "@/lib/limit-messages";
import { documentLimitFor, LIMITS } from "@/lib/limits";
import { deleteBlob, readBlobHead } from "@/server/blob";
import { indexDocument } from "@/server/ingest/index-document";
import { consumeRateLimit, peekRateLimit } from "@/server/rate-limit";

import { createDocument, deleteDocument as deleteDocumentRow, resetForRetry } from "./mutations";
import { findByContentHash, getDocumentByBlobPathname } from "./queries";
import { checkUploadPath, documentLimitReached, notYourUploadMessage } from "./upload-policy";
import {
  contentMatchesKind,
  contentMismatchMessage,
  fileKindOf,
  fileKinds,
  fileTooLarge,
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
    if (check.limit) throw new LimitError(check.limit);
    throw new ActionError(check.error);
  }

  if (fileKindOf(input.name) !== check.kind) {
    await deleteQuietly(input.blobPathname);
    throw new ActionError(`${input.name} isn't a PDF, Markdown or text file.`);
  }

  const stored = await readBlobHead(input.blobPathname, SNIFF_BYTES);
  if (!stored) throw new ActionError("We couldn't find the uploaded file. Try uploading it again.");

  if (stored.size > LIMITS.maxFileBytes) {
    await deleteQuietly(input.blobPathname);
    throw new LimitError(fileTooLarge(input.name, stored.size, LIMITS.maxFileBytes));
  }
  if (!contentMatchesKind(check.kind, stored.head)) {
    await deleteQuietly(input.blobPathname);
    throw new ActionError(contentMismatchMessage(input.name, check.kind));
  }

  // The binding check of the document limit: counted and inserted under a lock.
  const created = await createDocument(
    userId,
    {
      name: input.name,
      mimeType: fileKinds[check.kind].mimeType,
      sizeBytes: stored.size,
      blobPathname: input.blobPathname,
    },
    documentLimitFor(userId),
  );
  if (!created.ok) {
    await deleteQuietly(input.blobPathname);
    throw new LimitError({ code: "DOCUMENT_LIMIT", max: created.max });
  }

  after(() => indexDocument(userId, created.document.id));
  return { id: created.document.id, name: created.document.name };
});

// Before uploading: whether the user already has this file (its SHA-256, hashed in the
// browser). Saves the upload; indexDocument checks the real file's hash again.
export const findDuplicate = authedAction(
  z.object({ contentHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  async ({ contentHash }, { userId }) => {
    const copy = await findByContentHash(userId, contentHash);
    return copy ? { name: copy.name } : null;
  },
);

const documentIdInput = z.object({ id: z.uuid() });

// Reads a failed or stuck document again from scratch.
// Each one embeds the document again, so it counts against REINDEX_PER_HOUR.
export const retryDocument = authedAction(documentIdInput, async ({ id }, { userId }) => {
  const limit = await consumeRateLimit(userId, "reindex");
  if (!limit.ok) throw new LimitError(limit.failure);
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

// Why an upload failed, when it's a limit (the document limit or the upload rate): the token
// route's refusal doesn't survive the Blob client, so the browser asks afterwards. Counts
// nothing. Null when uploads are allowed (the failure was something else).
export const uploadLimitReason = authedAction(
  z.object({}),
  async (_input, { userId }): Promise<LimitFailure | null> => {
    const documents = await documentLimitReached(userId);
    if (documents) return documents;
    const check = await peekRateLimit(userId, "upload");
    return check.ok ? null : check.failure;
  },
);

// The row is the source of truth; a leftover file is only wasted storage, so log and move on.
async function deleteQuietly(pathname: string) {
  await deleteBlob(pathname).catch((error: unknown) => {
    console.error(`Couldn't delete blob ${pathname}`, error);
  });
}
