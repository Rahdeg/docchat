import { parseArgs } from "node:util";

import { z } from "zod";

// Not a real Clerk user. Used when no user is given.
export const DEFAULT_SEED_USER_ID = "user_seed_dev";

const clerkUserId = z
  .string()
  .regex(/^user_\w+$/, 'Expected a Clerk user ID like "user_2abc…" (Clerk dashboard -> Users).');

// `--user <id>` wins over SEED_USER_ID, which wins over the default.
export function resolveSeedUserId(argv: string[], envValue: string | undefined): string {
  const { values } = parseArgs({
    // `pnpm db:seed -- --user x` forwards the bare "--"; drop it so the flag still parses.
    args: argv.filter((arg) => arg !== "--"),
    options: { user: { type: "string" } },
  });
  const candidate = values.user ?? (envValue || undefined) ?? DEFAULT_SEED_USER_ID;

  const parsed = clerkUserId.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`Invalid seed user "${candidate}": ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}
