import "server-only";

import { del, get, type GetBlobResult } from "@vercel/blob";

import { env } from "@/lib/env";

// Every call passes the read-write token explicitly. Without it the SDK prefers OIDC whenever
// VERCEL_OIDC_TOKEN and BLOB_STORE_ID are set, and the OIDC token that `vercel env pull` writes
// to .env.local expires after a few hours, so local reads would start failing with 403.
const options = { access: "private", token: env.BLOB_READ_WRITE_TOKEN } as const;

// Streams a stored file. Returns null when it doesn't exist. Pass the browser's If-None-Match
// to get a 304 (stream: null) when the file hasn't changed.
export async function getBlob(
  pathname: string,
  init: { ifNoneMatch?: string } = {},
): Promise<GetBlobResult | null> {
  return get(pathname, { ...options, ifNoneMatch: init.ifNoneMatch });
}

// Downloads a whole stored file. Returns null when it doesn't exist.
export async function downloadBlob(pathname: string): Promise<Uint8Array | null> {
  const result = await get(pathname, options);
  if (!result?.stream) return null;
  return new Uint8Array(await new Response(result.stream).arrayBuffer());
}

// Reads the first `length` bytes and the real size, without downloading the rest.
export async function readBlobHead(
  pathname: string,
  length: number,
): Promise<{ head: Uint8Array; size: number } | null> {
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
  await del(pathname, { token: env.BLOB_READ_WRITE_TOKEN });
}
