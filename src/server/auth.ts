import "server-only";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

// TODO(webhooks): handle Clerk's user.deleted event and delete that user's rows (documents,
// chunks, chats, messages, tasks). Until then, deleting a user in Clerk leaves their data behind.

// For Server Components. Call it inside a <Suspense> boundary: auth() reads the request.
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect(routes.signIn);
  return userId;
}
