import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusTone = "ready" | "reading" | "problem" | "neutral";

const tones: Record<StatusTone, string> = {
  ready: "bg-status-ready text-status-ready-foreground",
  reading: "bg-status-reading text-status-reading-foreground",
  problem: "bg-status-problem text-status-problem-foreground",
  neutral: "bg-status-neutral text-status-neutral-foreground",
};

// A highlighter-style status label ("Ready", "Reading page 6 of 9"). The uneven corners are
// deliberate: it should look marked by hand, not like a pill.
export function StatusMark({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={cn("rounded-[3px_6px_4px_7px] px-[7px] py-px font-medium", tones[tone])}>
      {children}
    </span>
  );
}
