// Test doubles (docs/adr/0009): the fake AI providers (EMBEDDING_PROVIDER=fake,
// CHAT_PROVIDER=fake) and the local file store (STORAGE_DRIVER=local). They exist so CI can run
// the signed-in end-to-end flows without AI quota or a Blob store, and they must never serve real
// users: fake answers aren't answers, and local files vanish with the container.
//
// Allowed only when NODE_ENV is "test" (Vitest) or CI is set (GitHub Actions), and never on
// Vercel, whose builds set CI=1 too. Reads process.env directly: CI and VERCEL are set by the
// platform, not by us, and this runs inside env validation itself.

export type PlatformEnv = { NODE_ENV?: string; CI?: string; VERCEL?: string };

function isSet(value: string | undefined): boolean {
  return !!value && value !== "0" && value.toLowerCase() !== "false";
}

export function testDoublesAllowed(platform: PlatformEnv = process.env): boolean {
  if (isSet(platform.VERCEL)) return false;
  return platform.NODE_ENV === "test" || isSet(platform.CI);
}

export const TEST_DOUBLE_RULE =
  "Only allowed when NODE_ENV is test or CI is set, and never on Vercel (docs/adr/0009).";

type DoubleConfig = {
  EMBEDDING_PROVIDER?: string;
  CHAT_PROVIDER?: string;
  STORAGE_DRIVER?: string;
};

// The test doubles a configuration turns on.
export function testDoublesIn(config: DoubleConfig): string[] {
  return [
    config.EMBEDDING_PROVIDER === "fake" && "EMBEDDING_PROVIDER=fake",
    config.CHAT_PROVIDER === "fake" && "CHAT_PROVIDER=fake",
    config.STORAGE_DRIVER === "local" && "STORAGE_DRIVER=local",
  ].filter((name): name is string => !!name);
}

// Throws when the configuration uses a test double where it isn't allowed. Called when the
// server starts (src/instrumentation.ts), so a misconfigured production server refuses to boot
// even if env validation was skipped.
export function assertTestDoublesAllowed(
  config: DoubleConfig,
  platform: PlatformEnv = process.env,
): void {
  const used = testDoublesIn(config);
  if (used.length > 0 && !testDoublesAllowed(platform)) {
    throw new Error(`Refusing to start with ${used.join(", ")}. ${TEST_DOUBLE_RULE}`);
  }
}
