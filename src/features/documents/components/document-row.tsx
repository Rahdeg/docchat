"use client";

import { cn } from "@/lib/utils";

import { displayState, type LibraryDocument } from "../library-document";
import { displayName, fileKindOf, fileKindOfMimeType, fileKinds } from "../upload-rules";
import { DocumentMenu, useDocumentActions } from "./document-actions";
import { DocumentMeta } from "./document-meta";

// A document in the phone list: a small sheet icon, name and status, and the "…" menu.
export function DocumentRow({ doc }: { doc: LibraryDocument }) {
  const name = displayName(doc.name);
  const kind = fileKindOfMimeType(doc.mimeType) ?? fileKindOf(doc.name) ?? "pdf";
  const actions = useDocumentActions(doc, name);
  const state = displayState(doc);

  return (
    <li className="flex items-center gap-3.5 border-b border-muted p-3.5 last:border-b-0">
      <SheetIcon
        layered={(doc.pageCount ?? 1) > 1}
        tone={
          state === "ready"
            ? "ready"
            : state === "failed" || state === "stopped"
              ? "dim"
              : "reading"
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-serif text-[17px] leading-tight font-medium break-words">
          {name}
          <span className="sr-only">, {fileKinds[kind].noun}</span>
        </span>
        <DocumentMeta doc={doc} name={name} actions={actions} compact />
      </div>
      <DocumentMenu
        doc={doc}
        name={name}
        actions={actions}
        includeAsk
        triggerVariant="ghost"
        triggerClassName="size-11"
      />
      {actions.dialog}
    </li>
  );
}

// 40×52 page with a few lines; a second layer when the document has more than one page.
export function SheetIcon({
  layered = false,
  tone,
}: {
  layered?: boolean;
  tone: "ready" | "reading" | "dim" | "neutral";
}) {
  return (
    <div aria-hidden className="relative h-[52px] w-10 flex-none">
      {layered ? (
        <div className="absolute top-[5px] right-0 bottom-0 left-[5px] rounded-[2px] border bg-surface-sunken" />
      ) : null}
      <div
        className={cn(
          "absolute top-0 right-[5px] bottom-[5px] left-0 flex flex-col gap-[3px] rounded-[2px] border border-border-strong px-[5px] py-1.5",
          tone === "dim" ? "bg-surface-sunken opacity-60" : "bg-card",
        )}
      >
        <div
          className={cn(
            "h-[3px] w-[80%]",
            tone === "ready" && "bg-foreground",
            tone === "reading" && "bg-status-reading",
            tone === "neutral" && "bg-highlight",
            tone === "dim" && "bg-border-strong",
          )}
        />
        <div className="h-0.5 w-[90%] bg-border" />
        <div className="h-0.5 w-[70%] bg-border" />
        <div className="h-0.5 w-[85%] bg-border" />
      </div>
    </div>
  );
}
