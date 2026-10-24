import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { getDocument } from "@/features/documents/queries";
import { fileKindOfMimeType } from "@/features/documents/upload-rules";
import { getBlob } from "@/server/blob";

// Serves an uploaded file to its owner. Raw Blob URLs never reach the browser, and responses
// are `private, no-cache`: the browser may keep a copy but revalidates (ETag) every time, and no
// shared cache ever stores it.
const cacheHeaders = { "Cache-Control": "private, no-cache" };

export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401, headers: cacheHeaders });

  const { id } = await ctx.params;
  const doc = z.uuid().safeParse(id).success ? await getDocument(userId, id) : null;
  if (!doc?.blobPathname) return new Response("Not found", { status: 404, headers: cacheHeaders });

  const result = await getBlob(doc.blobPathname, {
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
  });
  if (!result) return new Response("Not found", { status: 404, headers: cacheHeaders });

  if (result.statusCode === 304) {
    return new Response(null, {
      status: 304,
      headers: { ...cacheHeaders, ETag: result.blob.etag },
    });
  }

  return new Response(result.stream, {
    headers: {
      ...cacheHeaders,
      ETag: result.blob.etag,
      // Markdown and text open as readable text in the tab instead of downloading.
      "Content-Type":
        fileKindOfMimeType(doc.mimeType) === "pdf"
          ? "application/pdf"
          : "text/plain; charset=utf-8",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
