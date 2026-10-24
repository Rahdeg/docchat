import { auth } from "@clerk/nextjs/server";
import { handleUpload } from "@vercel/blob/client";
import { z } from "zod";

import { checkUploadPath } from "@/features/documents/upload-policy";
import { fileKinds, MAX_FILE_BYTES } from "@/features/documents/upload-rules";
import { env } from "@/lib/env";

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
        const check = await checkUploadPath(userId, tokenPathname);
        if (!check.ok) throw new UploadRejected(check.error);
        return {
          allowedContentTypes: [fileKinds[check.kind].mimeType],
          maximumSizeInBytes: MAX_FILE_BYTES,
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
    console.error(error);
    return Response.json({ error: "Couldn't start the upload." }, { status: 500 });
  }
}
