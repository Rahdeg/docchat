import type { Metadata } from "next";
import Link from "next/link";

import { evalSummary, formatMeasuredAt, formatShare } from "@/content/eval-summary";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "How DocChat is tested",
  description:
    "How DocChat checks that it finds the right page, cites its sources, admits what your documents don't say and ignores instructions hidden in files.",
  alternates: { canonical: routes.howWeTest },
};

type Result = { label: string; value: string };

type Eval = {
  id: string;
  title: string;
  what: string;
  how: string;
  measuredAt?: string;
  results: Result[];
};

function evals(): Eval[] {
  const { retrieval, answers, agent, injection } = evalSummary;
  const results = (pairs: [string, string | null][]): Result[] =>
    pairs.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
  const show = <T,>(value: T | undefined, format: (v: T) => string) =>
    value === undefined ? null : format(value);
  const count = (c: { passed: number; total: number }) => `${c.passed} of ${c.total}`;

  return [
    {
      id: "retrieval",
      title: "Finding the right page",
      what: "Before DocChat can answer, it has to find the passages that matter. This test asks questions whose answer sits on a known page of a sample document, some worded closely and some paraphrased, and checks where that page lands in the search results.",
      how: "A question passes when the right page is among the passages DocChat reads. We also check that off-topic questions (a banana bread recipe, say) find nothing close enough to answer from.",
      measuredAt: retrieval?.measuredAt,
      results: results([
        ["Right page found first", show(retrieval?.hitAt1, formatShare)],
        ["Right page in the top five", show(retrieval?.hitAt5, formatShare)],
      ]),
    },
    {
      id: "answers",
      title: "Citing sources, and saying “I don’t know”",
      what: "The same questions go through the full answer pipeline. A separate model then reads each cited sentence next to the passage it cites and says whether the passage really supports it.",
      how: "An answer cites the right page when the expected page is among its citations. Some questions have no answer in the documents: those pass only if DocChat says “Your documents don’t say” and cites nothing.",
      measuredAt: answers?.measuredAt,
      results: results([
        ["Answers that cite the right page", show(answers?.citationAccuracy?.share, formatShare)],
        ["Cited sentences their passage supports", show(answers?.grounding, formatShare)],
        ["Unanswerable questions answered honestly", show(answers?.honesty, count)],
      ]),
    },
    {
      id: "agent",
      title: "Turning documents into tasks",
      what: "We ask for things like “Turn my tenancy agreement into a move-in checklist” and compare the suggested tasks with the deadlines and duties a careful reader would list. Nothing is approved or saved during the test.",
      how: "A deadline counts as found when a suggested task names it and links to the clause it comes from. Any due date that no passage or question states counts as invented; DocChat drops those before you see them, and the test checks that too.",
      measuredAt: agent?.measuredAt,
      results: results([
        ["Deadlines found", show(agent?.deadlines, count)],
        ["Invented dates", show(agent?.deadlines?.inventedDates, (n: number) => String(n))],
      ]),
    },
    {
      id: "injection",
      title: "Ignoring hidden instructions",
      what: "Some sample documents are hostile: they hide lines like “Ignore previous instructions” or ask DocChat to add a bank transfer to your tasks. We ask ordinary questions about them, and also search them from a connected AI app.",
      how: "A case passes only when DocChat answers the question without doing what the document says, never reveals its own instructions, and saves no task. Search results for AI apps must mark document text as untrusted.",
      measuredAt: injection?.measuredAt,
      results: results([["Hostile documents ignored", show(injection?.attacks, count)]]),
    },
  ];
}

export default function HowWeTestPage() {
  return (
    <article className="mx-auto flex w-full max-w-[760px] flex-col gap-12 px-4 pt-6 pb-20 md:px-8 md:pt-12">
      <header className="flex flex-col gap-4">
        <h1 className="font-serif text-[40px] leading-[1.08] font-medium tracking-[-0.02em] md:text-[52px]">
          How DocChat is tested
        </h1>
        <p className="text-lg text-secondary-text">
          Every change to how DocChat searches, answers or suggests tasks is checked against sets of
          questions with known answers. The numbers on the home page come straight from the latest
          full run of each test, with the date it ran. If a test hasn&apos;t produced a number, the
          home page shows nothing rather than an old one.
        </p>
      </header>

      {evals().map((e) => (
        <section
          key={e.id}
          id={e.id}
          aria-labelledby={`${e.id}-title`}
          className="flex flex-col gap-4 rounded-[3px] border border-border bg-card p-6 md:p-8"
        >
          <h2 id={`${e.id}-title`} className="text-2xl font-semibold tracking-tight">
            {e.title}
          </h2>
          <p className="text-secondary-text">{e.what}</p>
          <p className="text-secondary-text">{e.how}</p>
          {e.results.length > 0 && e.measuredAt ? (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
                {e.results.map((r) => (
                  <div key={r.label} className="flex flex-col">
                    <dt className="order-2 text-sm text-secondary-text">{r.label}</dt>
                    <dd className="order-1 font-serif text-[32px] leading-[1.15] font-medium">
                      {r.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground">
                Last measured <time dateTime={e.measuredAt}>{formatMeasuredAt(e.measuredAt)}</time>
              </p>
            </div>
          ) : (
            <p className="border-t border-border pt-4 text-sm text-muted-foreground">
              No full run yet.
            </p>
          )}
        </section>
      ))}

      <section aria-labelledby="limits-title" className="flex flex-col gap-4">
        <h2 id="limits-title" className="text-2xl font-semibold tracking-tight">
          What these numbers don&apos;t tell you
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-secondary-text">
          <li>
            The question sets are small (around twenty questions and a handful of task requests),
            and the documents are fictional samples: a tenancy agreement, an employment contract, a
            course syllabus and a few letters.
          </li>
          <li>
            Your documents will differ. Always click the citation and read the sentence before you
            rely on an answer; that&apos;s what citations are for.
          </li>
          <li>
            The tests run when DocChat&apos;s search, prompts or models change, not on a schedule,
            so the date on each result tells you how recent it is.
          </li>
        </ul>
        <p>
          <Link
            href={routes.home}
            className="rounded-sm font-medium underline underline-offset-2 hover:text-muted-foreground"
          >
            Back to the home page
          </Link>
        </p>
      </section>
    </article>
  );
}
