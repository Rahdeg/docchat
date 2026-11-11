// Writes the README's test counts, dated, from the test runners' own list modes (nothing runs):
// `vitest list` for unit and component tests and `playwright test --list` for e2e. Counts
// change with every new test, so there's no drift check; rerun it before a release.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { testsSection, writeReadmeSection } from "./readme-lib";

// No database or model keys: count what CI collects. Env validation would fail without them.
const env: NodeJS.ProcessEnv = { ...process.env, SKIP_ENV_VALIDATION: "1" };
delete env.DATABASE_URL;
delete env.LIVE_CHAT_TESTS;

const listSchema = z.array(z.object({ file: z.string() }));
const isIntegration = (file: string) => /\.integration\.test\.tsx?$/.test(file);

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "readme-tests-"));
  try {
    const testsJson = join(dir, "tests.json");
    const filesJson = join(dir, "files.json");
    const run = (args: string[]) =>
      execFileSync("vitest", args, { env, stdio: ["ignore", "ignore", "inherit"] });
    run(["list", `--json=${testsJson}`]);
    run(["list", "--filesOnly", `--json=${filesJson}`]);

    const tests = listSchema
      .parse(JSON.parse(readFileSync(testsJson, "utf8")))
      .filter((test) => !isIntegration(test.file));
    const files = listSchema.parse(JSON.parse(readFileSync(filesJson, "utf8")));

    const e2eList = execFileSync("playwright", ["test", "--list"], { env, encoding: "utf8" });
    const total = /Total: (\d+) tests? in (\d+) files?/.exec(e2eList);
    if (!total) throw new Error("`playwright test --list` printed no total");

    const changed = await writeReadmeSection(
      "tests",
      testsSection({
        unitTests: tests.length,
        unitFiles: new Set(tests.map((test) => test.file)).size,
        integrationFiles: files.filter((file) => isIntegration(file.file)).length,
        e2eTests: Number(total[1]),
        e2eFiles: Number(total[2]),
        countedAt: new Date().toISOString().slice(0, 10),
      }),
    );
    console.log(`README test counts ${changed ? "written" : "unchanged"}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
