// Writes the README's "Measured, not promised" table from the newest full run of each eval in
// tests/evals/results/ (the same runs as src/content/eval-summary.json). Run after saving new
// eval results, with `pnpm eval:summary`: readme.test.ts fails until the table matches.
import { readResultFiles } from "./eval-summary-lib";
import { evalsSection, writeReadmeSection } from "./readme-lib";

async function main() {
  const changed = await writeReadmeSection("evals", evalsSection(readResultFiles()));
  console.log(`README eval table ${changed ? "written" : "unchanged"}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
