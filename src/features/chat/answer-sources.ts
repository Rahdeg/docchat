// An answer's sources as the UI shows them: the cited passages in chip order, and the passages
// read but not cited.
import { displayName } from "@/features/documents/upload-rules";
import { documentFileUrl } from "@/lib/routes";

import { isAboutAnswer } from "./about";
import {
  citationsOf,
  messageText,
  passagesOf,
  type ChatUIMessage,
  type Citation,
  type PassageData,
} from "./message";

export type CitedSource = { citation: Citation; passage: PassageData };

export type AnswerSources = {
  query: string;
  passages: PassageData[];
  cited: CitedSource[];
  uncited: PassageData[];
  // Quotes are in (false while the answer streams).
  final: boolean;
};

// Null when nothing was searched, and for the canned line about DocChat itself: when the model
// wrote it instead of an answer, the passages it was given aren't its sources.
export function answerSources(message: Pick<ChatUIMessage, "parts">): AnswerSources | null {
  const read = passagesOf(message);
  if (!read || isAboutAnswer(messageText(message))) return null;
  const citations = citationsOf(message);
  const cited = (citations?.citations ?? []).flatMap((citation) => {
    const passage = read.passages[citation.source - 1];
    return passage ? [{ citation, passage }] : [];
  });
  const citedIds = new Set(cited.map((c) => c.passage.chunkId));
  return {
    query: read.query,
    passages: read.passages,
    cited,
    uncited: read.passages.filter((p) => !citedIds.has(p.chunkId)),
    final: citations?.final ?? false,
  };
}

export type PassageRead = { passage: PassageData; cited: boolean };

// "Read N passages": every passage in search order, marked when the answer cites it (only
// those get the yellow chip).
export function passagesRead(sources: AnswerSources): PassageRead[] {
  const citedIds = new Set(sources.cited.map((c) => c.passage.chunkId));
  return sources.passages.map((passage) => ({ passage, cited: citedIds.has(passage.chunkId) }));
}

export function documentCount(passages: readonly PassageData[]): number {
  return new Set(passages.map((p) => p.documentId)).size;
}

// "Open page N" for PDFs, the whole file otherwise. Seeded samples have no file.
export function passageHref(passage: PassageData): string | null {
  if (!passage.hasFile) return null;
  return documentFileUrl(
    passage.documentId,
    passage.mimeType === "application/pdf" ? passage.page : null,
  );
}

// "Tenancy agreement, page 3", for labels.
export function sourceLabel(passage: PassageData): string {
  const name = displayName(passage.name);
  return passage.page ? `${name}, page ${passage.page}` : name;
}
