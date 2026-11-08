import {
  evalSummary,
  formatMeasuredAt,
  formatShare,
  type EvalSummary,
} from "@/content/eval-summary";

type Metric = { id: string; value: string; label: string; measuredAt: string };

// The landing page's "Measured, not promised" cards, from the latest full eval runs
// (src/content/eval-summary.json). A metric the latest run lacks has no card.
export function landingMetrics(summary: EvalSummary): Metric[] {
  const metrics: Metric[] = [];
  const { answers, agent, injection } = summary;
  if (answers?.citationAccuracy) {
    metrics.push({
      id: "citations",
      value: formatShare(answers.citationAccuracy.share),
      label: "answers cite the right page",
      measuredAt: answers.measuredAt,
    });
  }
  if (answers?.honesty) {
    metrics.push({
      id: "honesty",
      value: `${answers.honesty.passed} of ${answers.honesty.total}`,
      label: "unanswerable questions answered honestly with “your documents don’t say”",
      measuredAt: answers.measuredAt,
    });
  }
  if (agent?.deadlines) {
    const { passed, total, inventedDates } = agent.deadlines;
    metrics.push({
      id: "deadlines",
      value: `${passed} of ${total}`,
      label:
        inventedDates === 0
          ? "deadlines found when turning documents into tasks, with no invented dates"
          : `deadlines found when turning documents into tasks (${inventedDates} invented ${inventedDates === 1 ? "date" : "dates"})`,
      measuredAt: agent.measuredAt,
    });
  }
  if (injection?.attacks) {
    metrics.push({
      id: "injection",
      value: `${injection.attacks.passed} of ${injection.attacks.total}`,
      label: "hidden instructions in hostile documents ignored",
      measuredAt: injection.measuredAt,
    });
  }
  return metrics;
}

export function MetricCards({ summary = evalSummary }: { summary?: EvalSummary }) {
  const metrics = landingMetrics(summary);
  if (metrics.length === 0) {
    return (
      <p className="flex-[2_1_520px] text-secondary-text">
        New results appear here after the next full run of the tests.
      </p>
    );
  }
  return (
    <dl className="grid flex-[2_1_520px] grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-5">
      {metrics.map((metric) => (
        <div
          key={metric.id}
          data-metric={metric.id}
          className="flex flex-col justify-end gap-1 rounded-[3px] border border-border bg-card p-[22px]"
        >
          <dt className="order-2 text-[15px] text-secondary-text">{metric.label}</dt>
          <dd className="order-1 font-serif text-[44px] leading-[1.1] font-medium">
            {metric.value}
          </dd>
          <dd className="order-3 mt-2 text-xs text-muted-foreground">
            Last measured{" "}
            <time dateTime={metric.measuredAt}>{formatMeasuredAt(metric.measuredAt)}</time>
          </dd>
        </div>
      ))}
    </dl>
  );
}
