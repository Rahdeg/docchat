import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Load .env.local so integration tests can find DATABASE_URL locally. CI has no such file,
// so tests that need a database skip themselves there.
const localEnv = existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {};

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // "server-only" throws outside React Server Components; tests run server code directly.
      "server-only": new URL("./tests/stubs/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    environment: "node",
    env: localEnv,
  },
});
