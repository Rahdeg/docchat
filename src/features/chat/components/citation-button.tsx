"use client";

import { CitationChip } from "@/components/citation-chip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

import { sourceLabel, type CitedSource } from "../answer-sources";
import { SourceCard } from "./source-card";

type CitationButtonProps = {
  source: CitedSource;
  // The source the Sources panel (or sheet) is showing: highlighter yellow.
  active: boolean;
  onSelect: () => void;
  // Hovering shows the passage (pointer devices). Off on phones, where a tap opens the sheet.
  preview: boolean;
};

// A citation chip in an answer: its number, a button that shows the source.
export function CitationButton({ source, active, onSelect, preview }: CitationButtonProps) {
  const { citation, passage } = source;
  const label = `Source ${citation.number}: ${sourceLabel(passage)}`;
  const button = (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "mx-0.5 inline-flex rounded-[5px] align-[2px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring",
      )}
    >
      <CitationChip
        index={citation.number}
        featured={active}
        className={cn(
          "h-5 min-w-5 px-[5px] text-[11px] transition-colors",
          !active && "hover:border-foreground",
        )}
      />
    </button>
  );

  if (!preview) return button;

  return (
    <HoverCard>
      <HoverCardTrigger delay={300} render={button} />
      <HoverCardContent side="top" className="w-[340px] bg-transparent p-0 shadow-none ring-0">
        <SourceCard
          number={citation.number}
          featured
          compact
          documentName={passage.name}
          page={passage.page}
          passage={passage.content}
          highlight={{ start: citation.start, end: citation.end }}
          className="shadow-sheet-raised"
        />
      </HoverCardContent>
    </HoverCard>
  );
}
