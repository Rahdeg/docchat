"use client";

import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { passageHref, type CitedSource } from "../answer-sources";
import { SourceCard } from "./source-card";

type SourceSheetProps = {
  sources: CitedSource[];
  // The citation number shown, or null when closed.
  active: number | null;
  onActiveChange: (number: number | null) => void;
};

// Phones: tapping a chip opens its source in a bottom sheet, with previous and next to step
// through the answer's other sources.
export function SourceSheet({ sources, active, onActiveChange }: SourceSheetProps) {
  const index = sources.findIndex((s) => s.citation.number === active);
  const source = index === -1 ? null : sources[index]!;
  const href = source ? passageHref(source.passage) : null;

  return (
    <Sheet open={source !== null} onOpenChange={(open) => !open && onActiveChange(null)}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="gap-3.5 rounded-t-[18px] border-t-0 bg-surface-sunken px-4 pt-2.5 pb-7 shadow-[0_-16px_40px_-20px_rgb(29_36_51/0.5)]"
      >
        <div aria-hidden className="h-1 w-10 self-center rounded-full bg-border-strong" />
        {source ? (
          <>
            <div className="flex items-center gap-2">
              <SheetTitle className="text-sm font-semibold">
                Source {index + 1} of {sources.length}
              </SheetTitle>
              <Button
                variant="outline"
                size="icon-lg"
                className="ml-auto size-11 rounded-[10px] paper"
                aria-label="Previous source"
                disabled={index === 0}
                onClick={() => onActiveChange(sources[index - 1]!.citation.number)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                size="icon-lg"
                className="size-11 rounded-[10px] paper"
                aria-label="Next source"
                disabled={index === sources.length - 1}
                onClick={() => onActiveChange(sources[index + 1]!.citation.number)}
              >
                <ChevronRightIcon />
              </Button>
              <SheetClose
                render={
                  <Button variant="ghost" size="icon-lg" className="size-11 rounded-[10px]" />
                }
                aria-label="Close"
              >
                <XIcon />
              </SheetClose>
            </div>

            <SourceCard
              number={source.citation.number}
              featured
              active
              documentName={source.passage.name}
              page={source.passage.page}
              passage={source.passage.content}
              highlight={{ start: source.citation.start, end: source.citation.end }}
              className="max-h-[50svh] translate-y-0 overflow-y-auto px-4 py-4 shadow-none"
            />

            {href ? (
              <Button
                size="lg"
                className="h-12 rounded-[10px] text-[15px]"
                nativeButton={false}
                render={<a href={href} target="_blank" rel="noopener noreferrer" />}
              >
                {source.passage.page ? `Open page ${source.passage.page}` : "Open document"}
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
