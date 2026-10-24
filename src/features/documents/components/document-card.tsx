"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { displayState, type LibraryDocument } from "../library-document";
import { displayName, fileKindOf, fileKindOfMimeType, fileKinds } from "../upload-rules";
import { DocumentMenu, useDocumentActions } from "./document-actions";
import { DocumentMeta } from "./document-meta";
import { PaperSheet, type SheetLook } from "./paper-sheet";

const looks: Record<ReturnType<typeof displayState>, SheetLook> = {
  ready: "text",
  queued: "reading",
  reading: "reading",
  failed: "unreadable",
  stopped: "unreadable",
};

// A document on the desktop grid: its sheet (with an action bar on hover or keyboard focus),
// then name and status.
export function DocumentCard({ doc }: { doc: LibraryDocument }) {
  const name = displayName(doc.name);
  const kind = fileKindOfMimeType(doc.mimeType) ?? fileKindOf(doc.name) ?? "pdf";
  const actions = useDocumentActions(doc, name);
  const [menuOpen, setMenuOpen] = useState(false);
  const look = looks[displayState(doc)];
  const nameId = `document-${doc.id}-name`;

  return (
    <article aria-labelledby={nameId} className="group/card flex flex-col gap-3.5">
      <PaperSheet
        look={look === "text" && !doc.preview ? "reading" : look}
        kind={kind}
        pageCount={doc.pageCount ?? 1}
        preview={doc.preview}
        interactive
      >
        <div
          data-open={menuOpen || undefined}
          className={cn(
            "absolute inset-x-0 bottom-0 flex justify-end gap-2 border-t bg-card p-3 transition-opacity duration-150 motion-reduce:transition-none",
            // Hidden until hover or focus; always shown on touch screens, which can't hover.
            "pointer-events-none opacity-0 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 data-open:pointer-events-auto data-open:opacity-100",
          )}
        >
          {doc.status === "ready" ? (
            // TODO(chat): open a chat scoped to this document once chat lands.
            <Button nativeButton={false} render={<Link href={routes.chat} />} className="flex-1">
              Ask about this
            </Button>
          ) : null}
          <DocumentMenu doc={doc} name={name} actions={actions} onOpenChange={setMenuOpen} />
        </div>
      </PaperSheet>

      <div className="flex flex-col gap-1.5">
        <h2 id={nameId} className="font-serif text-lg leading-tight font-medium break-words">
          {name}
          <span className="sr-only">, {fileKinds[kind].noun}</span>
        </h2>
        <DocumentMeta doc={doc} name={name} actions={actions} />
      </div>
      {actions.dialog}
    </article>
  );
}
