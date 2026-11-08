import "server-only";

import { join } from "node:path";

import { del, get, list } from "@vercel/blob";

import { env } from "@/lib/env";

import { createLocalStore, type LocalFile } from "./storage/local";

// STORAGE_DRIVER=local keeps files on disk instead: a test double for CI's end-to-end tests,
// refused outside tests and CI (docs/adr/0009). Every function below dispatches on it, so
// callers don't know which store they use.
const local =
  env.STORAGE_DRIVER === "local"
    ? createLocalStore(env.LOCAL_STORAGE_DIR ?? join(process.cwd(), ".data", "uploads"))
    : null;

export const storageDriver: "blob" | "local" = local ? "local" : "blob";

// What getBlob returns, from either store: Blob's GetBlobResult has these fields and more.
export type StoredFile = LocalFile;

// Every call passes the read-write token explicitly. Without it the SDK prefers OIDC whenever
// VERCEL_OIDC_TOKEN and BLOB_STORE_ID are set, and the OIDC token that `vercel env pull` writes
// to .env.local expires after a few hours, so local reads would start failing with 403.
const options = { access: "private", token: env.BLOB_READ_WRITE_TOKEN } as const;

// Streams a stored file. Returns null when it doesn't exist. Pass the browser's If-None-Match
// to get a 304 (stream: null) when the file hasn't changed.
export async function getBlob(
  pathname: string,
  init: { ifNoneMatch?: string } = {},
): Promise<StoredFile | null> {
  if (local) return local.get(pathname, init);
  return get(pathname, { ...options, ifNoneMatch: init.ifNoneMatch });
}

// Downloads a whole stored file. Returns null when it doesn't exist.
export async function downloadBlob(pathname: string): Promise<Uint8Array | null> {
  if (local) return local.download(pathname);
  const result = await get(pathname, options);
  if (!result?.stream) return null;
  return new Uint8Array(await new Response(result.stream).arrayBuffer());
}

// Reads the first `length` bytes and the real size, without downloading the rest.
export async function readBlobHead(
  pathname: string,
  length: number,
): Promise<{ head: Uint8Array; size: number } | null> {
  if (local) return local.head(pathname, length);
  const result = await get(pathname, options);
  if (!result?.stream) return null;

  const reader = result.stream.getReader();
  const parts: Uint8Array[] = [];
  let read = 0;
  try {
    while (read < length) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      read += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const head = new Uint8Array(Math.min(read, length));
  let offset = 0;
  for (const part of parts) {
    const slice = part.subarray(0, head.length - offset);
    head.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= head.length) break;
  }
  return { head, size: result.blob.size ?? read };
}

// Doesn't throw when the file is already gone.
export async function deleteBlob(pathname: string): Promise<void> {
  if (local) return local.delete(pathname);
  await del(pathname, { token: env.BLOB_READ_WRITE_TOKEN });
}

// Deletes every stored file whose path starts with `prefix`, a page of up to 1,000 at a time.
// Returns how many it deleted. Safe to run again: files already gone aren't listed.
export async function deleteBlobsWithPrefix(prefix: string): Promise<number> {
  if (!prefix.endsWith("/")) throw new Error("A Blob prefix must be a folder (end with /)");
  if (local) return local.deletePrefix(prefix);
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000, token: env.BLOB_READ_WRITE_TOKEN });
    if (page.blobs.length > 0) {
      await del(
        page.blobs.map((blob) => blob.pathname),
        { token: env.BLOB_READ_WRITE_TOKEN },
      );
      deleted += page.blobs.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

// Stores a file the browser sent to PUT /api/documents/upload/local. Only for the local store:
// with Blob, browsers upload straight to Blob with a token.
export async function putLocalFile(
  pathname: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  if (!local) throw new Error("putLocalFile needs STORAGE_DRIVER=local");
  await local.put(pathname, bytes, contentType);
}
