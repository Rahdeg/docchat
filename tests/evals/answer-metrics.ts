// The answer eval's scoring, without any model calls: which claims an answer cites, whether
// it cites the right page, and the summary numbers. Shared by the runner (answers.ts) and its
// tests (answer-metrics.test.ts).
import { NO_ANSWER_PREFIX } from "@/features/chat/message";

type CitedPassage = { name: string; page: number | null; content: string };
type AnswerCitation = { number: number; source: number; matched: boolean; quote?: string | null };

export type EvalAnswer = {
  text: string;
  noAnswer: boolean;
  // Data-passages: source n is passages[n - 1].
  passages: CitedPassage[];
  citations: AnswerCitation[];
};

export type Claim = {
  // The sentence, without its markers or bold.
  claim: string;
  number: number;
  passage: CitedPassage;
};

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

// One claim per (sentence, chip): every sentence with a citation marker, paired with each
// passage it cites. A sentence citing two sources is two claims.
export function citedClaims(answer: EvalAnswer): Claim[] {
  const byNumber = new Map(answer.citations.map((c) => [c.number, c]));
  const claims: Claim[] = [];
  for (const line of answer.text.split("\n")) {
    for (const { segment } of segmenter.segment(line)) {
      const numbers = [...segment.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      if (numbers.length === 0) continue;
      const claim = segment
        .replace(/ ?\[\d+\]/g, "")
        .replace(/\*\*/g, "")
        .replace(/^\s*[-*•]\s+/, "")
        .trim();
      for (const number of new Set(numbers)) {
        const citation = byNumber.get(number);
        const passage = citation && answer.passages[citation.source - 1];
        if (passage) claims.push({ claim, number, passage });
      }
    }
  }
  return claims;
}

// The right page is among the cited sources.
export function citesPage(answer: EvalAnswer, document: string, page: number): boolean {
  return answer.citations.some((c) => {
    const passage = answer.passages[c.source - 1];
    return passage?.name === document && passage.page === page;
  });
}

// A "don't say" answer, with no citations.
export function isHonestNoAnswer(answer: EvalAnswer): boolean {
  return (
    answer.noAnswer &&
    answer.text.trimStart().replace(/’/g, "'").startsWith(NO_ANSWER_PREFIX) &&
    answer.citations.length === 0
  );
}

export function share(hits: number, total: number): number | null {
  return total === 0 ? null : Math.round((hits / total) * 10_000) / 10_000;
}
