"use client";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { plural } from "@/lib/format";

import { passageHref, type AnswerSources } from "../answer-sources";
import { SourceCard } from "./source-card";

type SourcesPanelProps = {
  // The answer whose sources are shown, or null before the first answer.
  sources: AnswerSources | null;
  // The active citation number: its card is lifted and scrolled into view.
  active: number | null;
  onSelect: (number: number) => void;
};

// The Sources panel beside the conversation (desktop): the cited passages in chip order, the
// active one lifted with an ink border, and the passages read but not cited below.
export function SourcesPanel({ sources, active, onSelect }: SourcesPanelProps) {
  const cards = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    if (active === null) return;
    cards.current.get(active)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, sources]);

  const cited = sources?.cited ?? [];
  const uncited = sources?.uncited ?? [];

  return (
    <aside
      aria-label="Sources"
      className="sticky top-0 hidden h-svh w-[380px] shrink-0 flex-col gap-3.5 overflow-y-auto border-l bg-panel p-5 lg:flex"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Sources</h2>
        {sources ? (
          <span className="text-xs text-muted-foreground">{cited.length} cited</span>
        ) : null}
      </div>

      {!sources ? (
        <p className="text-[13px] text-muted-foreground">
          The passages an answer is written from appear here.
        </p>
      ) : cited.length === 0 && sources.final ? (
        <p className="text-[13px] text-muted-foreground">This answer doesn&apos;t cite anything.</p>
      ) : null}

      {cited.map(({ citation, passage }) => {
        const isActive = citation.number === active;
        const card = (
          <SourceCard
            number={citation.number}
            featured={isActive}
            active={isActive}
            compact
            clamp={!isActive}
            documentName={passage.name}
            page={passage.page}
            passage={passage.content}
            highlight={{ start: citation.start, end: citation.end }}
            href={isActive ? passageHref(passage) : null}
          />
        );
        const ref = (node: HTMLElement | null) => {
          if (node) cards.current.set(citation.number, node);
          else cards.current.delete(citation.number);
        };
        return isActive ? (
          <div key={passage.chunkId} ref={ref} aria-current="true" className="scroll-my-5">
            {card}
          </div>
        ) : (
          <button
            key={passage.chunkId}
            ref={ref}
            type="button"
            onClick={() => onSelect(citation.number)}
            className="scroll-my-5 rounded-[3px] text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring [&_article]:transition-shadow [&:hover_article]:shadow-sheet-raised"
          >
            {card}
          </button>
        );
      })}

      {uncited.length > 0 ? (
        <Collapsible className="flex flex-col gap-3">
          <CollapsibleTrigger className="group inline-flex items-center gap-1.5 self-start py-1 text-[13px] text-secondary-text hover:text-foreground">
            {plural(uncited.length, cited.length > 0 ? "more passage" : "passage")} read but not
            cited
            <ChevronDownIcon
              aria-hidden
              className="size-3 transition-transform group-data-panel-open:rotate-180"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3">
            {uncited.map((passage) => (
              <SourceCard
                key={passage.chunkId}
                compact
                documentName={passage.name}
                page={passage.page}
                passage={passage.content}
                href={passageHref(passage)}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </aside>
  );
}
