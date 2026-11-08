// Runs once when a server starts (Next.js instrumentation).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Validates the env now rather than on the first request, and refuses to start with a test
    // double (fake AI providers, local file storage) outside tests and CI, even if validation
    // was skipped (docs/adr/0009).
    const [{ env }, { assertTestDoublesAllowed }] = await Promise.all([
      import("@/lib/env"),
      import("@/lib/test-doubles"),
    ]);
    assertTestDoublesAllowed(env);
  }
}
