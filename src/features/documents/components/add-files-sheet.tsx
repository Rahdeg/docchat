"use client";

import { ArrowDownIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type AddFilesSheetProps = {
  onBrowse: () => void;
  // Files are being dragged over the page: this sheet becomes the drop target.
  dragging: boolean;
  // How many files are being dragged, when the browser says (0 when it doesn't).
  dragCount: number;
};

// The first cell of the grid: a dashed sheet that opens the file picker, and turns into the
// drop state while files are dragged anywhere on the page.
export function AddFilesSheet({ onBrowse, dragging, dragCount }: AddFilesSheetProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative h-[262px]">
        {dragging ? (
          <div
            role="region"
            aria-label={`Drop zone, ${dragCount > 0 ? `${dragCount} ${dragCount === 1 ? "file" : "files"}` : "files"} ready to drop`}
            className="absolute top-0 right-2.5 bottom-2.5 left-0 flex flex-col items-center justify-center gap-2.5 rounded-[4px] border-2 border-foreground bg-drop p-5 text-center"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-primary text-highlight">
              <ArrowDownIcon aria-hidden className="size-5" />
            </span>
            <span className="text-base font-semibold">
              {dragCount > 0
                ? `Drop to upload ${dragCount} ${dragCount === 1 ? "file" : "files"}`
                : "Drop to upload"}
            </span>
            <span className="max-w-[180px] text-[13px] text-secondary-text">
              Dropping anywhere on the page works too.
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onBrowse}
            className={cn(
              "absolute top-0 right-2.5 bottom-2.5 left-0 flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[4px] border-[1.5px] border-dashed border-border-dashed bg-card/45 p-5 text-center transition-colors hover:bg-card/70",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-full border bg-card">
              <PlusIcon aria-hidden className="size-[18px]" />
            </span>
            <span className="text-[15px] font-medium">Add files</span>
            <span className="max-w-[170px] text-[13px] text-muted-foreground">
              Drop them here or click to browse. PDF, Markdown or text, up to 10 MB.
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
