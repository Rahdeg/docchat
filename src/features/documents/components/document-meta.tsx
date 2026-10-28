"use client";

import { MeterBar } from "@/components/meter-bar";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  displayState,
  readingLabel,
  STUCK_AFTER_MINUTES,
  type LibraryDocument,
} from "../library-document";
import type { useDocumentActions } from "./document-actions";
import { StatusMark } from "./status-mark";

export const stoppedMessage = `This took longer than ${STUCK_AFTER_MINUTES} minutes, so it was stopped.`;

type DocumentMetaProps = {
  doc: LibraryDocument;
  name: string;
  actions: ReturnType<typeof useDocumentActions>;
  // Phone rows are denser: no passage count, no reading date, and actions live in the menu.
  compact?: boolean;
};

// The status mark, then pages, passages and date as separate muted items, and for problems
// the reason plus what to do about it.
export function DocumentMeta({ doc, name, actions, compact = false }: DocumentMetaProps) {
  const state = displayState(doc);

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center text-muted-foreground",
          compact ? "gap-x-2.5 gap-y-1 text-xs" : "gap-x-3 gap-y-1.5 text-[13px]",
        )}
      >
        {state === "ready" ? (
          <>
            <StatusMark tone="ready">Ready</StatusMark>
            {doc.pageCount ? <span>{plural(doc.pageCount, "page")}</span> : null}
            {compact ? null : <span>{plural(doc.passageCount, "passage")}</span>}
            <RelativeTime date={doc.createdAt} />
          </>
        ) : null}
        {state === "queued" || state === "reading" ? (
          <>
            <StatusMark tone="reading">{readingLabel(doc)}</StatusMark>
            {compact ? null : <RelativeTime date={doc.createdAt} />}
          </>
        ) : null}
        {state === "failed" ? (
          <StatusMark tone="problem">Can&apos;t read this file</StatusMark>
        ) : null}
        {state === "stopped" ? <StatusMark tone="problem">Reading stopped</StatusMark> : null}
      </div>

      {(state === "queued" || state === "reading") && doc.pageCount ? (
        <MeterBar
          tone="reading"
          value={doc.pagesRead}
          max={doc.pageCount}
          label={`Reading ${name}`}
          valueText={`Page ${doc.pagesRead} of ${doc.pageCount}`}
          className={compact ? undefined : "mt-0.5"}
        />
      ) : null}

      {state === "failed" ? (
        <>
          <p className={cn("text-secondary-text", compact ? "text-xs" : "text-[13px]")}>
            {doc.error ?? "Something went wrong while reading this file."}
          </p>
          {compact ? null : (
            <Button
              variant="link"
              className="h-auto self-start p-0 text-[13px] underline"
              onClick={actions.requestRemove}
            >
              Remove
            </Button>
          )}
        </>
      ) : null}

      {state === "stopped" ? (
        <>
          <p className={cn("text-secondary-text", compact ? "text-xs" : "text-[13px]")}>
            {stoppedMessage}
          </p>
          {compact || !actions.canRetry ? null : (
            <Button
              variant="outline"
              className="self-start paper"
              onClick={actions.retry}
              disabled={actions.retrying}
            >
              {actions.retrying ? "Starting…" : "Try again"}
            </Button>
          )}
        </>
      ) : null}
    </>
  );
}
