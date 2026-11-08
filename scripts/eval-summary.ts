// Writes src/content/eval-summary.json from the latest full eval runs in tests/evals/results/
// (rules in eval-summary-lib.ts). Runs before every build (`pnpm build`), and on its own with
// `pnpm eval:summary`. Commit the JSON with the results files: a unit test fails if they
// disagree.
import { readFileSync, writeFileSync } from "node:fs";

import { readResultFiles, serialize, summarize, summaryFile } from "./eval-summary-lib";

const text = serialize(summarize(readResultFiles(), (message) => console.warn(`⚠ ${message}`)));
let previous: string | null = null;
try {
  previous = readFileSync(summaryFile, "utf8");
} catch {
  // First run: no file yet.
}
if (previous !== text) writeFileSync(summaryFile, text);
console.log(
  `eval summary ${previous === text ? "unchanged" : "written"}: src/content/eval-summary.json`,
);
