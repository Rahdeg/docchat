import { evalSummarySchema, type EvalSummary } from "./eval-summary-schema";
import summaryJson from "./eval-summary.json";

// The numbers on the landing page's "Measured, not promised" cards and on /how-we-test. They
// come from the latest full run of each eval in tests/evals/results/, written to
// eval-summary.json by scripts/eval-summary.ts before every build (and committed). A metric
// the latest run doesn't have is left out, never taken from an older run.
export type { EvalSummary };

export const evalSummary: EvalSummary = evalSummarySchema.parse(summaryJson);

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// "2026-11-01" → "1 Nov 2026".
export function formatMeasuredAt(isoDate: string): string {
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

// 0.9286 → "93%".
export function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`;
}
