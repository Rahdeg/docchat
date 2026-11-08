import "server-only";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

import { identifyUser } from "./monitoring";

// Deleting a user in Clerk deletes their rows and files: POST /api/webhooks/clerk
// (src/server/account.ts).

// For Server Components. Call it inside a <Suspense> boundary: auth() reads the request.
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect(routes.signIn);
  identifyUser(userId);
  return userId;
}
