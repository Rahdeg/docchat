import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";

import { env } from "@/lib/env";
import { clerkUserIdSchema, deleteUserData } from "@/server/account";

// Clerk webhooks (docs/adr/0008). Subscribed to user.deleted only: when someone deletes their
// account, every row and file of theirs goes. No session here: the signature (Standard
// Webhooks, CLERK_WEBHOOK_SIGNING_SECRET) is the only check, and the proxy leaves /api/ alone.
//
// Clerk retries anything but a 2xx, so a failure answers 500 and deleting again is harmless.

export async function POST(request: NextRequest): Promise<Response> {
  let event;
  try {
    event = await verifyWebhook(request, { signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET });
  } catch (error) {
    console.warn("Clerk webhook verification failed", error);
    return new Response("Verification failed", { status: 400 });
  }

  // Other events, if the endpoint is ever subscribed to them, are acknowledged and ignored.
  if (event.type !== "user.deleted") return new Response("Ignored", { status: 200 });

  const userId = clerkUserIdSchema.safeParse(event.data.id);
  if (!userId.success) {
    console.warn("Clerk user.deleted without a valid user id", event.data.id);
    return new Response("No user id", { status: 200 });
  }

  try {
    const { rows, files } = await deleteUserData(userId.data);
    console.info(`Deleted the data of ${userId.data}`, { ...rows, files });
    return new Response("Deleted", { status: 200 });
  } catch (error) {
    console.error(`Couldn't delete the data of ${userId.data}`, error);
    return new Response("Couldn't delete the user's data", { status: 500 });
  }
}
