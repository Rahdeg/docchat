"use client";

import { UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { MAX_DOCUMENTS } from "../upload-rules";

const examples = [
  { title: "A tenancy agreement", question: "When can my landlord raise the rent?" },
  { title: "An employment contract", question: "How much notice do I have to give?" },
  { title: "A course syllabus", question: "What's due before the end of November?" },
];

// First visit: a stack of paper inviting the first upload, and examples of what works well.
export function LibraryEmpty({ onBrowse, dragging }: { onBrowse: () => void; dragging: boolean }) {
  return (
    <div className="flex flex-1 flex-wrap items-center justify-center gap-14">
      <div className="relative h-[500px] w-[400px] max-w-full">
        <div
          aria-hidden
          className="absolute inset-[14px_6px_0_14px] rotate-3 rounded-[4px] border bg-surface-sunken"
        />
        <div
          aria-hidden
          className="absolute inset-[8px_10px_6px_8px] -rotate-2 rounded-[4px] border bg-card"
        />
        <div className="absolute inset-[0_14px_14px_0] rounded-[4px] border border-border-strong bg-card p-[18px] shadow-sheet-raised">
          <div
            className={cn(
              "flex h-full flex-col justify-center gap-[18px] rounded-[3px] border-[1.5px] border-dashed px-6 py-9 transition-colors sm:px-8",
              dragging ? "border-foreground bg-drop" : "border-border-dashed",
            )}
          >
            <h2 className="font-serif text-[30px] leading-[1.15] font-medium tracking-[-0.01em]">
              {dragging ? "Drop to upload" : "Add your first document"}
            </h2>
            <p className="font-serif text-base leading-[1.6] text-secondary-text">
              Drop a PDF, Markdown or text file on this page. DocChat reads it page by page, so
              every answer can point to the exact passage it came from.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button className="h-10 px-4" onClick={onBrowse}>
                <UploadIcon data-icon="inline-start" />
                Browse files
              </Button>
            </div>
            <p className="text-[13px] text-muted-foreground">
              Up to 10 MB each, {MAX_DOCUMENTS} documents in total. Scanned PDFs aren&apos;t
              supported yet.
            </p>
          </div>
        </div>
      </div>

      <div className="flex w-[300px] max-w-full flex-col gap-3.5">
        <h3 className="text-[15px] font-semibold">What works well</h3>
        <p className="text-secondary-text">
          Documents with rules, dates and obligations you&apos;d otherwise have to search through
          yourself.
        </p>
        <ul className="flex flex-col gap-2.5">
          {examples.map((example) => (
            <li
              key={example.title}
              className="flex flex-col gap-1 rounded-lg border bg-card px-3.5 py-3"
            >
              <span className="font-serif text-base font-medium">{example.title}</span>
              <span className="text-[13px] text-muted-foreground">
                &ldquo;{example.question}&rdquo;
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
