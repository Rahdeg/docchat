"use client";

import { CheckIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { routes } from "@/lib/routes";

// "<name> is ready to ask about · Ask", in ink, when a document finishes indexing.
export function showReadyToast(name: string) {
  toast.custom((id) => (
    <div className="flex items-center gap-3 rounded-[10px] bg-primary px-4 py-3 text-sm text-primary-foreground shadow-sheet-raised">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-status-ready text-status-ready-foreground">
        <CheckIcon aria-hidden className="size-3" strokeWidth={3} />
      </span>
      <span>{name} is ready to ask about</span>
      {/* TODO(chat): open a chat scoped to this document once chat lands. */}
      <Link
        href={routes.chat}
        onClick={() => toast.dismiss(id)}
        className="font-medium text-highlight underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight"
      >
        Ask
      </Link>
    </div>
  ));
}
