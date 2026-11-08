import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { checkUploadPath } from "@/features/documents/upload-policy";
import { fileKinds, MAX_FILE_BYTES } from "@/features/documents/upload-rules";
import { putLocalFile, storageDriver } from "@/server/blob";
import { consumeRateLimit } from "@/server/rate-limit";

// Uploads for STORAGE_DRIVER=local, the test double CI's end-to-end tests use instead of Blob
// (docs/adr/0009). The browser PUTs the file here instead of straight to Blob, and this runs the
// same checks the Blob token route does before storing it: the caller's own folder, an allowed
// type, the size limit, the document limit and the upload rate limit. Registration is still
// registerDocument's job, which checks the stored file again. 404 with any other driver.

const query = z.object({ pathname: z.string().min(1).max(512) });

export async function PUT(request: Request): Promise<Response> {
  if (storageDriver !== "local") return new Response("Not found", { status: 404 });

  const { userId } = await auth();
  if (!userId) return Response.json({ error: "You need to be signed in." }, { status: 401 });

  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { pathname } = parsed.data;

  const check = await checkUploadPath(userId, pathname);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();
  if (contentType !== fileKinds[check.kind].mimeType) {
    return Response.json({ error: "That file type doesn't match its name." }, { status: 400 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) {
    return Response.json({ error: "That file is too large." }, { status: 413 });
  }

  // One per file, like the Blob token route.
  const limit = await consumeRateLimit(userId, "upload");
  if (!limit.ok) return Response.json({ error: limit.message }, { status: 429 });

  const bytes = await readCapped(request, MAX_FILE_BYTES);
  if (!bytes) return Response.json({ error: "That file is too large." }, { status: 413 });

  try {
    await putLocalFile(pathname, bytes, contentType);
  } catch {
    return Response.json({ error: "That upload already exists." }, { status: 409 });
  }
  return Response.json({ pathname });
}

// The request body, or null once it goes over `max` bytes (a missing Content-Length can't
// sneak a bigger file in).
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
