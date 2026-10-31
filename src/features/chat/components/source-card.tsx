import { ExternalLinkIcon } from "lucide-react";

import { CitationChip } from "@/components/citation-chip";
import { Badge } from "@/components/ui/badge";
import { displayName } from "@/features/documents/upload-rules";
import { cn } from "@/lib/utils";

import { excerpt, type Span } from "../passage-text";

// Characters kept around the highlight in a clamped card: a word or two before it.
const CLAMPED_CONTEXT_CHARS = 30;

export type SourceCardProps = {
  // Shown in the numbered box: the rank in "Read N passages", the citation number in Sources.
  // None for passages read but not cited.
  number?: number | null;
  // Yellow number box. Defaults to the first card.
  featured?: boolean;
  // The stored file name; shown without its extension, as in the Library.
  documentName: string;
  page: number | null;
  passage: string;
  // Offsets into `passage` to mark with the highlighter.
  highlight?: Span | null;
  // Cosine similarity (0–1). Shown as "N% match" when given.
  similarity?: number | null;
  // Where "Open page N" goes. Seeded sample documents have no file, so no link.
  href?: string | null;
  // The source the reader is looking at (a selected citation in PR 6's Sources panel).
  active?: boolean;
  // Smaller text, for the Sources panel.
  compact?: boolean;
  // Clamp the passage to three lines. Defaults to `compact`; the active card shows it all.
  clamp?: boolean;
  className?: string;
};

// A passage on a sheet of paper: which document and page it's from, the text with its best
// sentence highlighted, and a link to the page.
export function SourceCard({
  number = null,
  featured = number === 1,
  documentName,
  page,
  passage,
  highlight = null,
  similarity,
  href,
  active = false,
  compact = false,
  clamp = compact,
  className,
}: SourceCardProps) {
  // Three clamped lines show the highlight from its start; a full card gives it context.
  const text = excerpt(
    passage,
    highlight,
    clamp && highlight ? highlight.end - highlight.start + CLAMPED_CONTEXT_CHARS : undefined,
  );

  return (
    <article
      data-active={active || undefined}
      className={cn(
        "flex flex-col gap-2.5 rounded-[3px] border bg-card shadow-sheet transition-[translate,box-shadow] motion-reduce:transition-none",
        compact ? "px-[18px] py-4" : "px-5 py-[18px]",
        active && "-translate-y-0.5 border-[1.5px] border-foreground shadow-sheet-raised",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        {number !== null ? <CitationChip index={number} featured={featured} /> : null}
        <h3 className={cn("font-serif font-medium", compact ? "text-[15px]" : "text-[17px]")}>
          {displayName(documentName)}
        </h3>
        {page ? <span className="text-[13px] text-muted-foreground">Page {page}</span> : null}
        {similarity != null ? (
          <Badge variant="secondary" className="ml-auto tabular-nums">
            {Math.round(similarity * 100)}% match
          </Badge>
        ) : null}
      </header>

      <p
        className={cn(
          "font-serif leading-[1.7] text-secondary-text",
          compact ? "text-sm" : "text-[15px]",
          clamp && "line-clamp-3",
        )}
      >
        {text.cutStart ? "…" : null}
        {text.before}
        {text.mark ? (
          <mark className="rounded-[2px] bg-highlight px-0.5 py-px text-highlight-foreground">
            {text.mark}
          </mark>
        ) : null}
        {text.after}
        {text.cutEnd ? "…" : null}
      </p>

      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-[13px] font-medium text-foreground hover:text-muted-foreground"
        >
          {page ? `Open page ${page}` : "Open document"}
          <ExternalLinkIcon aria-hidden className="size-[13px]" />
        </a>
      ) : null}
    </article>
  );
}
