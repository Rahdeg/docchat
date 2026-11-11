// Writes the README's test counts, dated. Vitest: runs the tests CI runs (everything but the
// *.integration.test.ts files, which need a database) with the JSON reporter and counts the
// ones that passed; `vitest list` misses some, so it isn't used for the count. Integration
// files are only counted. Playwright: `playwright test --list` (nothing runs). Counts change
// with every new test, so there's no drift check; rerun it before a release.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { testsSection, writeReadmeSection } from "./readme-lib";

const env: NodeJS.ProcessEnv = { ...process.env, SKIP_ENV_VALIDATION: "1" };
delete env.LIVE_CHAT_TESTS;

const integrationGlob = "**/*.integration.test.{ts,tsx}";
const isIntegration = (file: string) => /\.integration\.test\.tsx?$/.test(file);

const runSchema = z.object({
  numPassedTests: z.number().int(),
  numFailedTests: z.number().int(),
  testResults: z.array(z.object({ name: z.string() })),
});
const filesSchema = z.array(z.object({ file: z.string() }));

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "readme-tests-"));
  try {
    const runJson = join(dir, "run.json");
    const filesJson = join(dir, "files.json");
    const vitest = (args: string[]) =>
      execFileSync("vitest", args, { env, stdio: ["ignore", "ignore", "inherit"] });
    vitest(["run", `--exclude=${integrationGlob}`, "--reporter=json", `--outputFile=${runJson}`]);
    vitest(["list", "--filesOnly", `--json=${filesJson}`]);

    const run = runSchema.parse(JSON.parse(readFileSync(runJson, "utf8")));
    if (run.numFailedTests > 0) throw new Error(`${run.numFailedTests} Vitest tests failed`);
    const files = filesSchema.parse(JSON.parse(readFileSync(filesJson, "utf8")));

    const e2eList = execFileSync("playwright", ["test", "--list"], { env, encoding: "utf8" });
    const total = /Total: (\d+) tests? in (\d+) files?/.exec(e2eList);
    if (!total) throw new Error("`playwright test --list` printed no total");

    const changed = await writeReadmeSection(
      "tests",
      testsSection({
        unitTests: run.numPassedTests,
        unitFiles: run.testResults.filter((result) => !isIntegration(result.name)).length,
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
