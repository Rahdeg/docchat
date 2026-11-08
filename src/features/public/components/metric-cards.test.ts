import { describe, expect, it } from "vitest";

import { landingMetrics } from "./metric-cards";

describe("landingMetrics", () => {
  it("makes a card per metric, dated by its own run", () => {
    const metrics = landingMetrics({
      answers: {
        measuredAt: "2026-11-01",
        citationAccuracy: { share: 0.9286, total: 14 },
        honesty: { passed: 6, total: 6 },
      },
      agent: { measuredAt: "2026-11-03", deadlines: { passed: 15, total: 15, inventedDates: 0 } },
      injection: { measuredAt: "2026-11-06", attacks: { passed: 10, total: 10 } },
    });
    expect(metrics.map((m) => [m.id, m.value, m.measuredAt])).toEqual([
      ["citations", "93%", "2026-11-01"],
      ["honesty", "6 of 6", "2026-11-01"],
      ["deadlines", "15 of 15", "2026-11-03"],
      ["injection", "10 of 10", "2026-11-06"],
    ]);
    expect(metrics[2]?.label).toContain("with no invented dates");
  });

  it("has no card for a missing metric", () => {
    const metrics = landingMetrics({
      answers: { measuredAt: "2026-11-01", honesty: { passed: 5, total: 6 } },
      agent: { measuredAt: "2026-11-03" },
    });
    expect(metrics.map((m) => m.id)).toEqual(["honesty"]);
    expect(landingMetrics({})).toEqual([]);
  });

  it("doesn't claim 'no invented dates' when there were some", () => {
    const [card] = landingMetrics({
      agent: { measuredAt: "2026-11-03", deadlines: { passed: 14, total: 15, inventedDates: 2 } },
    });
    expect(card?.label).toBe(
      "deadlines found when turning documents into tasks (2 invented dates)",
    );
  });
});
