import { CheckIcon } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { Step } from "../agent-view";

// What the agent did: "Read 9 passages from Tenancy agreement", "Picked out 6 things to do",
// "Waiting for you to check them".
export function AgentSteps({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label="What DocChat did" className="flex flex-col gap-2.5">
      {steps.map((step) => (
        <li
          key={step.label}
          className={cn(
            "flex items-center gap-2.5 text-secondary-text",
            step.status !== "done" && "font-medium text-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-[22px] shrink-0 items-center justify-center rounded-full",
              step.status === "done" && "bg-status-ready text-status-ready-foreground",
              step.status === "waiting" && "border-[1.5px] border-foreground bg-highlight",
            )}
          >
            {step.status === "done" ? (
              <CheckIcon className="size-3.5" strokeWidth={2.5} />
            ) : step.status === "waiting" ? (
              <span className="size-1.5 rounded-full bg-foreground" />
            ) : (
              <Spinner className="size-3.5" />
            )}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
