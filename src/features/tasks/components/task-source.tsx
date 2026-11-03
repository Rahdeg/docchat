"use client";

import { FileTextIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SourceCard } from "@/features/chat/components/source-card";
import { displayName } from "@/features/documents/upload-rules";
import { useIsMobile } from "@/hooks/use-mobile";
import { documentFileUrl } from "@/lib/routes";

import type { TaskSource } from "../task-rules";

// Shown when the document was deleted.
const DELETED_DOCUMENT = "Deleted document";

// The line under an agent task's title: document icon, the document's name and where in it
// ("clause 4.2"). Opens the passage it came from, with the quote highlighted: a popover on
// desktop, a bottom sheet on phones.
export function TaskSourceLink({ source, title }: { source: TaskSource; title: string }) {
  const isMobile = useIsMobile();
  const name = source.documentName ? displayName(source.documentName) : DELETED_DOCUMENT;

  const trigger = (
    <button
      type="button"
      aria-label={`Show where "${title}" came from: ${name}${source.label ? `, ${source.label}` : ""}`}
      className="inline-flex max-w-full items-center gap-1.5 self-start rounded-sm text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <FileTextIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate font-serif text-sm text-secondary-text">{name}</span>
      {source.label ? <span className="shrink-0">{source.label}</span> : null}
    </button>
  );

  const card = <TaskSourceCard source={source} />;

  if (isMobile) {
    return (
      <Sheet>
        <SheetTrigger render={trigger} />
        <SheetContent
          side="bottom"
          className="gap-3.5 rounded-t-[18px] border-t-0 bg-surface-sunken px-4 pt-6 pb-7"
        >
          <SheetTitle className="text-sm font-semibold">Where this task came from</SheetTitle>
          {card}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        className="w-[min(440px,calc(100vw-32px))] bg-transparent p-0 shadow-none ring-0"
      >
        {card}
      </PopoverContent>
    </Popover>
  );
}

function TaskSourceCard({ source }: { source: TaskSource }) {
  const href =
    source.hasFile && source.documentId
      ? documentFileUrl(
          source.documentId,
          source.mimeType === "application/pdf" ? source.page : null,
        )
      : null;

  // The passage, with the quote highlighted. Once the passage is gone (the document was read
  // again or deleted), the saved quote on its own.
  // TODO(tasks): after a document is read again, re-link its tasks' sources by fuzzy-matching
  // the saved quote in the new chunks (docs/adr/0007).
  const passage = source.passage ?? source.quote ?? "";
  const highlight =
    source.passage && source.start !== null && source.end !== null
      ? { start: source.start, end: source.end }
      : null;

  return (
    <SourceCard
      documentName={source.documentName ?? DELETED_DOCUMENT}
      page={source.page}
      passage={passage}
      highlight={highlight}
      href={href}
      className="max-h-[60svh] overflow-y-auto"
    />
  );
}
