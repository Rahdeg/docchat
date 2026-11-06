import { clerkSetup } from "@clerk/testing/playwright";

// Gets a Clerk testing token, so signed-in specs get past bot protection. Only with a test user
// (E2E_CLERK_USER_EMAIL); the signed-out specs don't need it.
export default async function globalSetup() {
  if (!process.env.E2E_CLERK_USER_EMAIL) return;
  await clerkSetup({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: process.env.CLERK_SECRET_KEY,
  });
}
