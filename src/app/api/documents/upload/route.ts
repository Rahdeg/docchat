import { auth } from "@clerk/nextjs/server";
import { handleUpload } from "@vercel/blob/client";
import { z } from "zod";

import { checkUploadPath } from "@/features/documents/upload-policy";
import { fileKinds } from "@/features/documents/upload-rules";
import { env } from "@/lib/env";
import { limitMessage, type LimitFailure } from "@/lib/limit-messages";
import { LIMITS } from "@/lib/limits";
import { consumeRateLimit } from "@/server/rate-limit";

// Issues short-lived tokens so the browser can upload straight to the private Blob store
// (Vercel functions cap request bodies at 4.5 MB). Registration happens afterwards in the
// registerDocument action, not in an upload-completed webhook, which can't reach localhost.

const tokenRequest = z.object({
  type: z.literal("blob.generate-client-token"),
  payload: z.object({
    pathname: z.string().min(1).max(512),
    clientPayload: z.string().nullish(),
    multipart: z.boolean(),
  }),
});

class UploadRejected extends Error {}
class UploadLimited extends Error {
  constructor(readonly failure: LimitFailure) {
    super(limitMessage(failure));
  }
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "You need to be signed in." }, { status: 401 });

  const parsed = tokenRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { pathname, clientPayload, multipart } = parsed.data.payload;

  try {
    const result = await handleUpload({
      token: env.BLOB_READ_WRITE_TOKEN,
      request,
      body: {
        type: parsed.data.type,
        payload: { pathname, clientPayload: clientPayload ?? null, multipart },
      },
      onBeforeGenerateToken: async (tokenPathname) => {
        // The document limit is checked here, before any upload or cost, and again (under a
        // lock) when registerDocument creates the row.
        const check = await checkUploadPath(userId, tokenPathname);
        if (!check.ok) {
          if (check.limit) throw new UploadLimited(check.limit);
          throw new UploadRejected(check.error);
        }
        // One token per file (uploadsPerHour, src/lib/limits.ts).
        const limit = await consumeRateLimit(userId, "upload");
        if (!limit.ok) throw new UploadLimited(limit.failure);
        return {
          allowedContentTypes: [fileKinds[check.kind].mimeType],
          maximumSizeInBytes: LIMITS.maxFileBytes,
          // The path already has a random uuid (users/<userId>/<uuid>-<name>).
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof UploadRejected) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof UploadLimited) {
      return Response.json({ error: error.message, limit: error.failure }, { status: 429 });
    }
    console.error(error);
    return Response.json({ error: "Couldn't start the upload." }, { status: 500 });
  }
}
