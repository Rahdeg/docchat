import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// The authorization audit, as a test (docs/security.md). It reads the source, so a new Server
// Action file or route handler that skips the user check fails CI.

const root = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(root).map((path) => ({
  path: relative(process.cwd(), path),
  source: readFileSync(path, "utf8"),
}));

// A "use server" directive as the file's first statement (after comments).
const isServerActionFile = (source: string) =>
  /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*["']use server["'];?/.test(source);

describe("Server Actions", () => {
  const actionFiles = files.filter((f) => isServerActionFile(f.source));

  it("finds the action files", () => {
    expect(actionFiles.map((f) => f.path).sort()).toEqual(
      expect.arrayContaining([
        "src/features/documents/actions.ts",
        "src/features/tasks/actions.ts",
      ]),
    );
  });

  it.each(actionFiles.map((f) => [f.path, f.source]))(
    "%s exports only authedAction(...) actions",
    (_path, source) => {
      const exports = [...source.matchAll(/^export\s+(?!type\b|interface\b)([^\n]*)$/gm)].map(
        (m) => m[1]!,
      );
      expect(exports.length).toBeGreaterThan(0);
      for (const line of exports) {
        // `export const name = authedAction(` is the only shape allowed: a function export
        // would be callable from the browser without the check.
        expect(line).toMatch(/^const \w+\s*=\s*authedAction\b/);
      }
    },
  );

  it("has no inline 'use server' functions outside action files", () => {
    const inline = files.filter(
      // A directive is a statement on its own line; comments that mention it don't count.
      (f) => !isServerActionFile(f.source) && /^\s*["']use server["'];?\s*$/m.test(f.source),
    );
    expect(inline.map((f) => f.path)).toEqual([]);
  });
});

describe("route handlers", () => {
  // Each route and how it checks who's calling. A new route must be added here, with a check.
  const checks: Record<string, RegExp | "public" | "health"> = {
    "src/app/api/chat/route.ts": /await auth\(\)/,
    "src/app/api/documents/upload/route.ts": /await auth\(\)/,
    // STORAGE_DRIVER=local only (CI's end-to-end tests); a 404 otherwise.
    "src/app/api/documents/upload/local/route.ts": /await auth\(\)[\s\S]*checkUploadPath\(userId/,
    "src/app/api/documents/[id]/file/route.ts": /await auth\(\)/,
    "src/app/api/webhooks/clerk/route.ts": /verifyWebhook\(/,
    "src/app/mcp/route.ts": /createAuthedMcpHandler\(/,
    // OAuth metadata: public by design, no user data (RFC 9728, RFC 8414).
    "src/app/.well-known/oauth-protected-resource/mcp/route.ts": "public",
    "src/app/.well-known/oauth-authorization-server/route.ts": "public",
    // Liveness: public, pings the database and reads no user data.
    "src/app/api/health/route.ts": "health",
  };
  const routes = files.filter((f) => /\/route\.tsx?$/.test(f.path));

  it("lists every route", () => {
    expect(routes.map((r) => r.path).sort()).toEqual(Object.keys(checks).sort());
  });

  it.each(routes.map((r) => [r.path, r.source]))("%s checks the caller", (path, source) => {
    const check = checks[path];
    if (check === "public") {
      expect(source).not.toMatch(/@\/server\/db|@\/features\//);
      return;
    }
    if (check === "health") {
      expect(source).not.toMatch(/@\/features\/|auth\(|schema/);
      expect(source).toMatch(/select 1/);
      return;
    }
    expect(source).toMatch(check!);
  });

  it("the MCP handler requires a verified token for every request", () => {
    const server = files.find((f) => f.path === "src/server/mcp/server.ts")!.source;
    expect(server).toMatch(/withMcpAuth\([\s\S]*required: true/);
    // Tools get the user from the verified token only.
    expect(server).toMatch(/userIdFrom\(authInfo\)/);
  });
});
