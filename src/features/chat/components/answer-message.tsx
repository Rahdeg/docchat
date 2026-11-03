"use client";

import {
  ChevronDownIcon,
  CopyIcon,
  ListTodoIcon,
  RotateCcwIcon,
  SearchIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { plural } from "@/lib/format";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { rateAnswer } from "../actions";
import type { ApprovedTask } from "../agent-parts";
import {
  agentSteps,
  isAgentAnswer,
  proposalState,
  TASKS_PAGE_LINK_TEXT,
  textAround,
} from "../agent-view";
import { parseAnswer, plainAnswer, type Inline } from "../answer-markup";
import {
  answerSources,
  documentCount,
  passageHref,
  passagesRead,
  sourceLabel,
  type AnswerSources,
} from "../answer-sources";
import { isNoAnswer, proposalOf, type ChatUIMessage, type Feedback } from "../message";
import { bestSentence } from "../passage-text";
import { mentionsDuties } from "../task-request";
import { AgentSteps } from "./agent-steps";
import { ApprovalCard } from "./approval-card";
import { CitationButton } from "./citation-button";
import { SourceCard } from "./source-card";

type AnswerMessageProps = {
  message: ChatUIMessage;
  // Still being written.
  streaming: boolean;
  // The last answer in the chat: it gets "Try again".
  last: boolean;
  // Stopped by the user in this session (the saved status comes with the message).
  stopped: boolean;
  // The chip the Sources panel or sheet is showing, if it's one of this answer's.
  active: number | null;
  onCite: (number: number) => void;
  // Chips preview their source on hover (not on phones).
  preview: boolean;
  onRetry: () => void;
  // The approval card can be answered: the last answer, with nothing streaming.
  canAnswer: boolean;
  mobile: boolean;
  onApprove: (approvalId: string, tasks: ApprovedTask[]) => void;
  onCancel: (approvalId: string) => void;
  // "Turn this into tasks" under an answer that mentions duties or dates (the last one only).
  onTurnIntoTasks?: () => void;
};

export function AnswerMessage({
  message,
  streaming,
  last,
  stopped,
  active,
  onCite,
  preview,
  onRetry,
  canAnswer,
  mobile,
  onApprove,
  onCancel,
  onTurnIntoTasks,
}: AnswerMessageProps) {
  const sources = answerSources(message);
  const agent = isAgentAnswer(message);
  // An agent's answer: the model's text, then the card, then the line saying what was added.
  const { before: text, after } = textAround(message);
  const found = proposalOf(message);
  const state = proposalState(found?.part ?? null, found?.proposal ?? null);
  const approvalId = found?.part?.approval?.id;
  const status = message.metadata?.status ?? (stopped ? "stopped" : undefined);
  const byNumber = new Map(sources?.cited.map((s) => [s.citation.number, s]));

  function renderInline(items: Inline[]): ReactNode {
    return items.map((item, index) => {
      if (item.type === "text") return <Fragment key={index}>{item.text}</Fragment>;
      if (item.type === "bold") {
        return (
          <strong key={index} className="font-semibold">
            {item.text}
          </strong>
        );
      }
      // Chips appear once their source is known; a marker without one isn't shown.
      const source = byNumber.get(item.number);
      return source ? (
        <CitationButton
          key={index}
          source={source}
          active={active === item.number}
          onSelect={() => onCite(item.number)}
          preview={preview}
        />
      ) : null;
    });
  }

  return (
    <article aria-busy={streaming} className="flex flex-col gap-3.5">
      {agent ? (
        <AgentSteps steps={agentSteps(message, streaming)} />
      ) : sources ? (
        <PassagesRead sources={sources} />
      ) : streaming ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-3.5" />
          Searching your documents…
        </p>
      ) : null}

      {text ? (
        <div className="flex flex-col gap-3.5 text-base leading-[1.75]">
          {parseAnswer(text).map((block, index) =>
            block.type === "paragraph" ? (
              <p key={index}>{renderInline(block.content)}</p>
            ) : (
              <ul key={index} className="flex list-disc flex-col gap-1.5 pl-5">
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item)}</li>
                ))}
              </ul>
            ),
          )}
        </div>
      ) : streaming && sources && !agent ? (
        <AnswerSkeleton />
      ) : null}

      {found && approvalId && (state === "waiting" || state === "sending") ? (
        <ApprovalCard
          proposal={found.proposal}
          sending={state === "sending"}
          canAnswer={canAnswer}
          active={active}
          onCite={onCite}
          onApprove={(tasks) => onApprove(approvalId, tasks)}
          onCancel={() => onCancel(approvalId)}
          mobile={mobile}
        />
      ) : null}

      {after ? <ConfirmationLine text={after} /> : null}

      {status === "stopped" ? (
        <p className="text-[13px] text-muted-foreground">You stopped this answer.</p>
      ) : status === "failed" ? (
        <p className="text-[13px] text-destructive">
          This answer didn&apos;t finish. Try again in a moment.
        </p>
      ) : null}

      {!streaming ? (
        <AnswerActions
          message={message}
          text={plainAnswer(text + (after ? `\n\n${after}` : ""), (n) => {
            const source = byNumber.get(n);
            return source ? sourceLabel(source.passage) : null;
          })}
          sources={sources}
          canRetry={last && !found}
          onRetry={onRetry}
          isNoAnswer={isNoAnswer(text)}
          onTurnIntoTasks={
            onTurnIntoTasks &&
            last &&
            !agent &&
            status !== "failed" &&
            status !== "stopped" &&
            !isNoAnswer(text) &&
            mentionsDuties(text)
              ? onTurnIntoTasks
              : undefined
          }
        />
      ) : null}
    </article>
  );
}

// The fixed line after "Add N tasks" or "Cancel", with "Tasks page" as a link.
function ConfirmationLine({ text }: { text: string }) {
  const at = text.lastIndexOf(TASKS_PAGE_LINK_TEXT);
  if (at === -1) return <p className="text-base leading-[1.75]">{text}</p>;
  return (
    <p className="text-base leading-[1.75]">
      {text.slice(0, at)}
      <Link href={routes.tasks} className="font-medium underline underline-offset-4">
        {TASKS_PAGE_LINK_TEXT}
      </Link>
      {text.slice(at + TASKS_PAGE_LINK_TEXT.length)}
    </p>
  );
}

// "Read 5 passages from 2 documents": opens the passages the answer was written from, best
// match first, with the sentence closest to the question marked. Only cited passages get the
// yellow number.
function PassagesRead({ sources }: { sources: AnswerSources }) {
  const { passages, query } = sources;
  if (passages.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <SearchIcon aria-hidden className="size-[13px]" />
        No passages matched closely enough to answer from
      </p>
    );
  }
  return (
    <Collapsible className="flex flex-col gap-3">
      <CollapsibleTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="group h-[30px] gap-2 self-start rounded-lg px-2.5 text-xs font-normal text-secondary-text paper"
          />
        }
      >
        <SearchIcon data-icon="inline-start" className="size-[13px]" />
        Read {plural(passages.length, "passage")} from {plural(documentCount(passages), "document")}
        <ChevronDownIcon
          data-icon="inline-end"
          className="size-3 transition-transform group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="flex flex-col gap-3 pb-1">
          {passagesRead(sources).map(({ passage, cited }, index) => (
            <li key={passage.chunkId}>
              <SourceCard
                number={index + 1}
                featured={cited}
                compact
                documentName={passage.name}
                page={passage.page}
                passage={passage.content}
                highlight={bestSentence(passage.content, query)}
                similarity={passage.similarity}
                href={passageHref(passage)}
              />
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="sr-only">Writing the answer…</span>
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

type AnswerActionsProps = {
  message: ChatUIMessage;
  // Plain text for copying.
  text: string;
  sources: AnswerSources | null;
  canRetry: boolean;
  onRetry: () => void;
  isNoAnswer: boolean;
  // Shown only when given.
  onTurnIntoTasks?: () => void;
};

function AnswerActions({
  message,
  text,
  sources,
  canRetry,
  onRetry,
  isNoAnswer,
  onTurnIntoTasks,
}: AnswerActionsProps) {
  const [feedback, setFeedback] = useState<Feedback | null>(message.metadata?.feedback ?? null);
  const [, startTransition] = useTransition();

  async function copy() {
    const cited = sources?.cited ?? [];
    const footer =
      cited.length > 0 && !isNoAnswer
        ? `\n\nSources:\n${cited.map((s) => `[${s.citation.number}] ${sourceLabel(s.passage)}`).join("\n")}`
        : "";
    try {
      await navigator.clipboard.writeText(text + footer);
      toast.success("Answer copied");
    } catch {
      toast.error("Couldn't copy the answer.");
    }
  }

  function rate(value: Feedback) {
    const next = feedback === value ? null : value;
    const previous = feedback;
    setFeedback(next);
    startTransition(async () => {
      const result = await rateAnswer({ messageId: message.id, feedback: next });
      if (!result.ok) {
        setFeedback(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="-ml-2 flex items-center gap-0.5 text-muted-foreground">
      <ActionButton label="Copy answer" onClick={copy} disabled={!text}>
        <CopyIcon />
      </ActionButton>
      <ActionButton label="Good answer" onClick={() => rate("up")} pressed={feedback === "up"}>
        <ThumbsUpIcon />
      </ActionButton>
      <ActionButton label="Bad answer" onClick={() => rate("down")} pressed={feedback === "down"}>
        <ThumbsDownIcon />
      </ActionButton>
      {canRetry ? (
        <Button
          variant="ghost"
          size="sm"
          className="ml-1 h-[34px] gap-1.5 px-2.5"
          onClick={onRetry}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Try again
        </Button>
      ) : null}
      {onTurnIntoTasks ? (
        <Button
          variant="outline"
          size="sm"
          className="ml-1 h-[34px] gap-1.5 px-2.5 paper"
          onClick={onTurnIntoTasks}
        >
          <ListTodoIcon data-icon="inline-start" />
          Turn this into tasks
        </Button>
      ) : null}
    </div>
  );
}

type ActionButtonProps = {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
};

function ActionButton({ label, onClick, pressed, disabled, children }: ActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-[34px] rounded-[7px]", pressed && "bg-accent text-foreground")}
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            disabled={disabled}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
