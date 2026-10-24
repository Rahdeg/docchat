import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { type FileKind, fileKinds } from "../upload-rules";

// What the front sheet shows:
// - text: a preview of page 1
// - uploading / waiting / reading: grey placeholder lines (the text isn't stored yet)
// - unreadable: a dim, scanned-looking page (failed or stopped)
export type SheetLook = "text" | "uploading" | "waiting" | "reading" | "unreadable";

type PaperSheetProps = {
  look: SheetLook;
  kind: FileKind;
  // Layers behind the front sheet: none for 1 page, one for 2, two for 3 or more.
  pageCount: number;
  preview?: string | null;
  // Lifts on hover or keyboard focus inside the surrounding `group/card`.
  interactive?: boolean;
  // Overlaid at the bottom of the front sheet (the hover action bar).
  children?: ReactNode;
};

export function PaperSheet({
  look,
  kind,
  pageCount,
  preview,
  interactive = false,
  children,
}: PaperSheetProps) {
  const layers = pageCount >= 3 ? 2 : pageCount === 2 ? 1 : 0;

  return (
    <div className="relative h-[262px]">
      {layers >= 2 ? (
        <div
          aria-hidden
          className="absolute top-2.5 right-0 bottom-0 left-2.5 rounded-[3px] border bg-surface-sunken"
        />
      ) : null}
      {layers >= 1 ? (
        <div aria-hidden className="absolute inset-[5px] rounded-[3px] border bg-card" />
      ) : null}

      <div
        className={cn(
          "absolute top-0 right-2.5 bottom-2.5 left-0 overflow-hidden rounded-[3px] border transition-[translate,box-shadow,border-color] duration-200 paper motion-reduce:transition-none",
          look === "waiting" && "border-dashed border-border-strong bg-card",
          look === "unreadable" && "bg-surface-sunken",
          (look === "text" || look === "uploading" || look === "reading") && "bg-card shadow-sheet",
          interactive &&
            "group-focus-within/card:-translate-y-1 group-focus-within/card:border-border-strong group-focus-within/card:shadow-sheet-raised group-hover/card:-translate-y-1 group-hover/card:border-border-strong group-hover/card:shadow-sheet-raised",
        )}
      >
        {look === "text" && preview ? <SheetPreview text={preview} /> : null}
        {look === "uploading" || look === "waiting" || look === "reading" ? (
          <PlaceholderLines look={look} />
        ) : null}
        {look === "unreadable" ? <UnreadablePage /> : null}

        <span
          aria-hidden
          className="absolute top-3 right-3 rounded-[3px] border bg-card px-[5px] py-px text-[10px] font-semibold text-muted-foreground"
        >
          {fileKinds[kind].label}
        </span>
        {look === "text" ? (
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-12 bg-linear-to-b from-card/0 to-card"
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}

// The start of page 1 set like a printed page. A short first line reads as the title.
// TODO(citations, PR 6): highlight passages that answers have quoted (bg-highlight).
function SheetPreview({ text }: { text: string }) {
  const { title, blocks } = previewParts(text);
  return (
    <div
      aria-hidden
      className="px-[18px] py-5 font-serif text-[10px] leading-[1.6] text-secondary-text"
    >
      {title ? (
        <div className="mb-2 pr-8 text-[11px] font-semibold text-foreground">{title}</div>
      ) : null}
      {blocks.map((block, i) =>
        block.heading ? (
          <div key={i} className="mb-[3px] font-semibold text-foreground">
            {block.text}
          </div>
        ) : (
          <p key={i} className="mb-[7px]">
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}

type PreviewBlock = { heading: boolean; text: string };

// Splits the preview into a title (a short first line), Markdown subheadings and paragraphs.
// Single line breaks inside a paragraph are wrapped lines, so they become spaces.
export function previewParts(text: string): { title: string | null; blocks: PreviewBlock[] } {
  const [first = "", ...rest] = text.split("\n");
  const heading = first.replace(/^#+\s*/, "").trim();
  const hasTitle = rest.length > 0 && heading.length > 0 && heading.length <= 80;

  const blocks: PreviewBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ heading: false, text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const line of (hasTitle ? rest : [first, ...rest]).map((l) => l.trim())) {
    if (!line) flush();
    else if (/^#+\s/.test(line)) {
      flush();
      blocks.push({ heading: true, text: line.replace(/^#+\s*/, "") });
    } else paragraph.push(line);
  }
  flush();

  return { title: hasTitle ? heading : null, blocks };
}

const placeholderWidths = ["w-[92%]", "w-[84%]", "w-[88%]", "w-[70%]"];

function PlaceholderLines({ look }: { look: "uploading" | "waiting" | "reading" }) {
  return (
    <div aria-hidden className="flex flex-col gap-[9px] px-5 py-6">
      <div
        className={cn(
          "h-2 rounded-[2px]",
          look === "uploading" && "w-[64%] bg-highlight",
          look === "reading" && "w-[64%] bg-status-reading",
          look === "waiting" && "w-1/2 bg-muted",
        )}
      />
      {(look === "waiting" ? placeholderWidths.slice(0, 3) : placeholderWidths).map((width) => (
        <div key={width} className={cn("h-1.5 rounded-[2px] bg-muted", width)} />
      ))}
    </div>
  );
}

function UnreadablePage() {
  return (
    <div aria-hidden className="flex flex-col gap-[9px] px-5 py-[22px] opacity-55">
      <div className="h-3.5 w-[55%] rounded-[2px] bg-border-strong" />
      <div className="h-1.5 w-[90%] rounded-[2px] bg-border" />
      <div className="h-1.5 w-[80%] rounded-[2px] bg-border" />
      <div className="h-1.5 w-[86%] rounded-[2px] bg-border" />
      <div className="mt-1.5 h-[54px] w-full rounded-[2px] bg-status-neutral" />
      <div className="h-1.5 w-[40%] self-end rounded-[2px] bg-border" />
    </div>
  );
}
