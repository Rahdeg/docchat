import { createClerkClient } from "@clerk/backend";
import { clerkSetup } from "@clerk/testing/playwright";

// Before any spec: a Clerk testing token, so signed-in specs get past bot protection, and the
// e2e user, created through the Backend API if it doesn't exist yet. Only with a test user
// (E2E_CLERK_USER_EMAIL); the signed-out specs need neither.
//
// The user lives on the Clerk DEVELOPMENT instance. Its address contains "+clerk_test", so
// Clerk treats it as a test address: no email is sent and the verification code is 424242. It
// signs in with a server-side sign-in token (clerk.signIn), so the password
// (E2E_CLERK_USER_PASSWORD, a random secret) is only needed to create it.
export default async function globalSetup() {
  const email = process.env.E2E_CLERK_USER_EMAIL;
  if (!email) return;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey?.startsWith("sk_test_")) {
    throw new Error(
      "The e2e tests need a Clerk development instance (CLERK_SECRET_KEY=sk_test_…).",
    );
  }
  if (!email.includes("+clerk_test")) {
    throw new Error("E2E_CLERK_USER_EMAIL must be a Clerk test address (…+clerk_test@…).");
  }

  await ensureUser(secretKey, email);
  await clerkSetup({
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey,
  });
}

async function ensureUser(secretKey: string, email: string) {
  const clerk = createClerkClient({ secretKey });
  const existing = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
  if (existing.totalCount > 0) return;

  const password = process.env.E2E_CLERK_USER_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error(
      `No Clerk user ${email} yet, and no E2E_CLERK_USER_PASSWORD (16+ characters) to create it.`,
    );
  }
  // Backend API users skip the sign-up allowlist; the address is created verified.
  await clerk.users.createUser({ emailAddress: [email], password, skipLegalChecks: true });
  console.log(`Created the e2e user ${email}`);
}
