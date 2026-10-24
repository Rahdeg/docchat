"use client";

import { XIcon } from "lucide-react";

import { MeterBar } from "@/components/meter-bar";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";

import { displayName, fileKinds } from "../upload-rules";
import { SheetIcon } from "./document-row";
import { PaperSheet } from "./paper-sheet";
import { StatusMark } from "./status-mark";
import type { UploadItem } from "./use-uploads";

type UploadProps = { item: UploadItem; onCancel: () => void; onDismiss: () => void };

function statusLabel(item: UploadItem): string {
  if (item.state === "waiting") return "Waiting to upload";
  if (item.state === "failed") return "Couldn't upload";
  return `Uploading ${item.progress}%`;
}

// A file on its way up, on the desktop grid.
export function UploadCard({ item, onCancel, onDismiss }: UploadProps) {
  const name = displayName(item.file.name);
  const nameId = `upload-${item.key}-name`;

  return (
    <article aria-labelledby={nameId} className="flex flex-col gap-3.5">
      <PaperSheet
        look={
          item.state === "waiting"
            ? "waiting"
            : item.state === "failed"
              ? "unreadable"
              : "uploading"
        }
        kind={item.kind}
        pageCount={1}
      />
      <div className="flex flex-col gap-1.5">
        <h2 id={nameId} className="font-serif text-lg leading-tight font-medium break-words">
          {name}
          <span className="sr-only">, {fileKinds[item.kind].noun}</span>
        </h2>
        <UploadDetails item={item} name={name} />
        {item.state === "failed" ? (
          <Button
            variant="link"
            className="h-auto self-start p-0 text-[13px] underline"
            onClick={onDismiss}
          >
            Remove
          </Button>
        ) : item.state !== "registering" ? (
          <Button
            variant="link"
            className="h-auto self-start p-0 text-[13px] underline"
            onClick={onCancel}
          >
            Cancel upload
          </Button>
        ) : null}
      </div>
    </article>
  );
}

// A file on its way up, in the phone list.
export function UploadRow({ item, onCancel, onDismiss }: UploadProps) {
  const name = displayName(item.file.name);
  const failed = item.state === "failed";

  return (
    <li className="flex items-center gap-3.5 border-b border-muted p-3.5 last:border-b-0">
      <SheetIcon tone={failed ? "dim" : "neutral"} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-serif text-[17px] leading-tight font-medium break-words">{name}</span>
        <UploadDetails item={item} name={name} compact />
      </div>
      {item.state !== "registering" ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={failed ? `Remove ${name}` : `Cancel upload of ${name}`}
          onClick={failed ? onDismiss : onCancel}
        >
          <XIcon />
        </Button>
      ) : null}
    </li>
  );
}

function UploadDetails({
  item,
  name,
  compact = false,
}: {
  item: UploadItem;
  name: string;
  compact?: boolean;
}) {
  return (
    <>
      <div
        className={
          compact
            ? "flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground"
            : "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground"
        }
      >
        <StatusMark tone={item.state === "failed" ? "problem" : "neutral"}>
          {statusLabel(item)}
        </StatusMark>
        <span>{formatBytes(item.file.size)}</span>
      </div>
      {item.state === "uploading" || item.state === "registering" ? (
        <MeterBar
          value={item.progress}
          max={100}
          label={`Uploading ${name}`}
          valueText={`${item.progress}%`}
          className={compact ? undefined : "mt-0.5"}
        />
      ) : null}
      {item.state === "failed" && item.error ? (
        <p className={compact ? "text-xs text-secondary-text" : "text-[13px] text-secondary-text"}>
          {item.error}
        </p>
      ) : null}
    </>
  );
}
