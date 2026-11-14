"use client";

import { CircleAlertIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { limitMessage, type LimitFailure } from "@/lib/limit-messages";
import { routes } from "@/lib/routes";

// A free-tier limit, in the problem colours, with a plain message and, where it helps, a way
// forward. Every limit refusal in the browser goes through here (docs/adr/0010). Sonner's
// toaster is a polite live region, so screen readers hear the message.
export function showLimitToast(failure: LimitFailure) {
  const message = limitMessage(failure);
  const action =
    failure.code === "DOCUMENT_LIMIT" || failure.code === "DUPLICATE_DOCUMENT"
      ? { label: "Open library", href: `${routes.library}#documents` }
      : null;

  // One toast per kind of limit: asking again while it's up replaces it with the new wait.
  toast.custom(
    (id) => (
      <div
        data-limit={failure.code}
        className="flex w-full items-start gap-3 rounded-[10px] border border-status-problem-foreground/20 bg-status-problem px-4 py-3 text-sm text-status-problem-foreground shadow-sheet-raised sm:w-[356px]"
      >
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p>{message}</p>
          {action ? (
            <Link
              href={action.href}
              onClick={() => toast.dismiss(id)}
              className="self-start font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-problem-foreground"
            >
              {action.label}
            </Link>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => toast.dismiss(id)}
          className="-m-1 rounded-sm p-1 focus-visible:outline-2 focus-visible:outline-status-problem-foreground"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      </div>
    ),
    { id: `limit-${failure.code}`, duration: 8000 },
  );
}
