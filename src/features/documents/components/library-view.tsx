"use client";

import { SearchIcon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { plural } from "@/lib/format";

import {
  displayState,
  type DisplayState,
  isInProgress,
  type LibraryDocument,
  needsAttention,
} from "../library-document";
import { ACCEPTED_FILE_TYPES, displayName } from "../upload-rules";
import { AddFilesSheet } from "./add-files-sheet";
import { DocumentCard } from "./document-card";
import { stoppedMessage } from "./document-meta";
import { DocumentRow } from "./document-row";
import { LibraryEmpty } from "./library-empty";
import { showReadyToast } from "./ready-toast";
import { UploadCard, UploadRow } from "./upload-item";
import { useUploads } from "./use-uploads";

// How often to refresh the list while a document is being read.
const POLL_MS = 3000;

type Filter = "all" | "ready" | "reading" | "attention";

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "reading", label: "Reading" },
  { value: "attention", label: "Needs attention" },
];

function matchesFilter(doc: LibraryDocument, filter: Filter): boolean {
  if (filter === "ready") return doc.status === "ready";
  if (filter === "reading") return isInProgress(doc);
  if (filter === "attention") return needsAttention(doc);
  return true;
}

type LibraryViewProps = { userId: string; documents: LibraryDocument[] };

export function LibraryView({ userId, documents }: LibraryViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listedIds = useMemo(() => new Set(documents.map((doc) => doc.id)), [documents]);
  const uploads = useUploads({ userId, documentCount: documents.length, listedIds });
  const drag = usePageFileDrop((files) => void uploads.addFiles(files));
  const announcement = useStatusChanges(documents);
  usePolling(documents.some(isInProgress));

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const counts: Record<Filter, number> = {
    all: documents.length,
    ready: documents.filter((doc) => matchesFilter(doc, "ready")).length,
    reading: documents.filter((doc) => matchesFilter(doc, "reading")).length,
    attention: documents.filter((doc) => matchesFilter(doc, "attention")).length,
  };
  const activeUploads = uploads.items.filter((item) => item.state !== "failed").length;
  const isEmpty = documents.length === 0 && uploads.items.length === 0;

  const search = query.trim().toLowerCase();
  const visible = documents.filter(
    (doc) =>
      matchesFilter(doc, filter) &&
      (!search || displayName(doc.name).toLowerCase().includes(search)),
  );
  const visibleUploads = filter === "all" || filter === "reading" ? uploads.items : [];
  const nothingMatches = visible.length === 0 && visibleUploads.length === 0;

  const browse = () => inputRef.current?.click();

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-7 px-4 pt-5 pb-28 md:px-12 md:pt-10 md:pb-14">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex max-w-[620px] flex-col gap-1 md:gap-1.5">
          <h1 className="text-2xl font-semibold tracking-[-0.02em] md:text-[28px]">Library</h1>
          <p className="text-[13px] text-muted-foreground md:text-sm">
            {summary({ isEmpty, activeUploads, ready: counts.ready, reading: counts.reading })}
          </p>
        </div>
        {isEmpty ? null : (
          <Button className="ml-auto hidden h-10 px-4 md:inline-flex" onClick={browse}>
            <UploadIcon data-icon="inline-start" />
            Upload files
          </Button>
        )}
      </header>

      {isEmpty ? (
        <LibraryEmpty onBrowse={browse} dragging={drag.dragging} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as Filter)}
              className="hidden md:flex"
            >
              <TabsList aria-label="Show documents" className="paper">
                {filters.map(({ value, label }) => (
                  <TabsTrigger key={value} value={value} className="px-3">
                    {label} <span className="text-muted-foreground">{counts[value]}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <InputGroup className="ml-auto hidden w-[260px] bg-card md:flex">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label="Search by name"
                placeholder="Search by name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>

            {/* Phones: pill filters that scroll sideways. */}
            <div
              role="group"
              aria-label="Show documents"
              className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 paper md:hidden"
            >
              {filters.map(({ value, label }) => (
                <Button
                  key={value}
                  variant={filter === value ? "default" : "outline"}
                  aria-pressed={filter === value}
                  className="h-11 shrink-0 rounded-full px-4"
                  onClick={() => setFilter(value)}
                >
                  {label} {counts[value]}
                </Button>
              ))}
            </div>
          </div>

          <section
            aria-label="Documents"
            className="hidden grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-7 gap-y-9 md:grid"
          >
            <AddFilesSheet onBrowse={browse} dragging={drag.dragging} dragCount={drag.count} />
            {visibleUploads.map((item) => (
              <UploadCard
                key={item.key}
                item={item}
                onCancel={() => uploads.cancel(item.key)}
                onDismiss={() => uploads.dismiss(item.key)}
              />
            ))}
            {visible.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} />
            ))}
          </section>

          {/* Only reachable with a filter or search: an empty library shows LibraryEmpty. */}
          {nothingMatches ? (
            <p className="text-muted-foreground">
              {search ? `No documents match “${query.trim()}”.` : "No documents here."}
            </p>
          ) : (
            <ul
              aria-label="Documents"
              className="flex flex-col overflow-hidden rounded-xl border bg-card md:hidden"
            >
              {visibleUploads.map((item) => (
                <UploadRow
                  key={item.key}
                  item={item}
                  onCancel={() => uploads.cancel(item.key)}
                  onDismiss={() => uploads.dismiss(item.key)}
                />
              ))}
              {visible.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} />
              ))}
            </ul>
          )}

          {/* Phones: a full-width upload button fixed to the bottom. */}
          <div className="fixed inset-x-0 bottom-0 z-10 bg-linear-to-b from-background/0 via-background via-30% to-background px-4 pt-3 pb-7 md:hidden">
            <Button className="h-12 w-full text-[15px]" onClick={browse}>
              <UploadIcon data-icon="inline-start" />
              Upload files
            </Button>
          </div>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) void uploads.addFiles(files);
        }}
      />
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function summary({
  isEmpty,
  activeUploads,
  ready,
  reading,
}: {
  isEmpty: boolean;
  activeUploads: number;
  ready: number;
  reading: number;
}): string {
  if (isEmpty) return "Add a document, then ask questions about it in Chat.";
  if (activeUploads > 0) {
    return `Uploading ${plural(activeUploads, "file")}. You can keep working while they're read.`;
  }
  if (ready > 0) {
    return `${plural(ready, "document")} ${ready === 1 ? "is" : "are"} ready to ask about.`;
  }
  if (reading > 0) return "Reading your documents. You can keep working while they're read.";
  return "None of your documents are ready to ask about yet.";
}

// Refreshes the server-rendered list every few seconds while `active`.
function usePolling(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [active, router]);
}

// Files dragged anywhere on the page. `count` is 0 when the browser doesn't say.
function usePageFileDrop(onDrop: (files: File[]) => void) {
  const [state, setState] = useState({ dragging: false, count: 0 });
  const handleDrop = useEffectEvent(onDrop);

  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      const count = [...(event.dataTransfer?.items ?? [])].filter((i) => i.kind === "file").length;
      setState({ dragging: true, count });
    };
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setState({ dragging: false, count: 0 });
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setState({ dragging: false, count: 0 });
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) handleDrop(files);
    };

    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return state;
}

// Compares each refresh with the last one. A document that finishes reading gets the "ready"
// toast (which screen readers announce); one that fails or stops is announced politely here.
function useStatusChanges(documents: LibraryDocument[]): string {
  const previous = useRef<Map<string, DisplayState> | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const onChanges = useEffectEvent((messages: string[]) => {
    if (messages.length > 0) setAnnouncement(messages.join(" "));
  });

  useEffect(() => {
    const before = previous.current;
    previous.current = new Map(documents.map((doc) => [doc.id, displayState(doc)]));
    if (!before) return;

    const messages: string[] = [];
    for (const doc of documents) {
      const was = before.get(doc.id);
      if (was !== "queued" && was !== "reading") continue;
      const name = displayName(doc.name);
      const now = displayState(doc);
      if (now === "ready") showReadyToast(name);
      if (now === "failed") messages.push(`${name}: can't read this file. ${doc.error ?? ""}`);
      if (now === "stopped") messages.push(`${name}: reading stopped. ${stoppedMessage}`);
    }
    onChanges(messages);
  }, [documents]);

  return announcement;
}
