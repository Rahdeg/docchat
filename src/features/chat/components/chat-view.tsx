"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { ArrowUpIcon, MessageSquareIcon, SquareIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageContent } from "@/components/ui/message";
import type { ReadyDocument } from "@/features/documents/queries";
import { useIsMobile } from "@/hooks/use-mobile";
import { plural } from "@/lib/format";
import { routes } from "@/lib/routes";

import type { ApprovedTask } from "../agent-parts";
import { proposalState } from "../agent-view";
import { answerSources } from "../answer-sources";
import type { ApprovalRequestBody, QuestionRequestBody } from "../chat-request";
import { QUERY_MAX_CHARS, QUERY_MIN_CHARS } from "../find-rules";
import {
  chatTitle,
  FREE_LIMIT_MESSAGE,
  messageText,
  proposalOf,
  type ChatUIMessage,
} from "../message";
import { TURN_INTO_TASKS } from "../task-request";
import { AnswerMessage } from "./answer-message";
import { chosenDocuments, DocumentPicker, scopeLabel } from "./document-picker";
import { SourceSheet } from "./source-sheet";
import { SourcesPanel } from "./sources-panel";

type ChatViewProps = {
  chatId: string;
  // Null until the chat's first question is saved.
  title: string | null;
  initialMessages: ChatUIMessage[];
  documents: ReadyDocument[];
};

// The citation the reader is looking at: which answer, which chip.
type Active = { messageId: string; number: number };

export function ChatView({ chatId, title, initialMessages, documents }: ChatViewProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  // Answers the user stopped in this session (saved ones carry their status).
  const [stoppedIds, setStoppedIds] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Approvals already sent: each goes up once, even if a reply leaves it unsettled. One the
  // server refused is taken off, so the card can be answered again.
  const sentApprovals = useRef(new Set<string>());

  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        // Only the new question goes up; the server loads the rest of the chat itself. The
        // chosen documents come with each send (`body`), so they're never stale.
        prepareSendMessagesRequest: ({ id, messages, trigger, body: options }) => {
          // "Add N tasks" or "Cancel": only the decision and the ticked tasks go up.
          const answered = answeredApproval(messages);
          if (answered && trigger === "submit-message") {
            const body: ApprovalRequestBody = {
              chatId: id,
              trigger: "submit-message",
              approval: {
                ...answered,
                tasks: answered.approved
                  ? (options as { approvedTasks?: ApprovedTask[] } | undefined)?.approvedTasks
                  : undefined,
              },
            };
            return { body };
          }
          const chosen = (options as { documentIds?: string[] } | undefined)?.documentIds ?? [];
          const body: QuestionRequestBody = {
            chatId: id,
            trigger: trigger === "regenerate-message" ? "regenerate-message" : "submit-message",
            message: lastUserMessage(messages),
            documentIds: chosen.length > 0 ? chosen : undefined,
          };
          return { body };
        },
      }),
  );
  const requestBody = () => ({ documentIds: chosenDocuments(documents, documentIds) });

  const isNew = initialMessages.length === 0;
  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    clearError,
    addToolApprovalResponse,
  } = useChat<ChatUIMessage>({
    id: chatId,
    messages: initialMessages,
    transport,
    generateId: () => crypto.randomUUID(),
    // "Add N tasks" or "Cancel" sends the decision as soon as it's made.
    sendAutomaticallyWhen: ({ messages: all }) => {
      const answered = answeredApproval(all);
      if (!answered || sentApprovals.current.has(answered.approvalId)) return false;
      if (!lastAssistantMessageIsCompleteWithApprovalResponses({ messages: all })) return false;
      sentApprovals.current.add(answered.approvalId);
      return true;
    },
    onFinish: ({ isAbort, message }) => {
      if (isAbort) setStoppedIds((ids) => [...ids, message.id]);
      // The first answer stores the chat: show it in the sidebar. Added tasks change the
      // sidebar's count of open tasks.
      const found = proposalOf(message);
      if (isNew || proposalState(found?.part ?? null, found?.proposal ?? null) === "added") {
        router.refresh();
      }
    },
    onError: (failure) => {
      // An approval the server refused (out of date, already answered): the card asks again.
      setMessages((all) => {
        const answered = answeredApproval(all);
        if (answered) sentApprovals.current.delete(answered.approvalId);
        return reopenApproval(all);
      });
      // The provider refused for quota and the server didn't save this answer: drop what had
      // streamed of it (the passages), leaving the question and the message.
      if (failure.message !== FREE_LIMIT_MESSAGE) return;
      setMessages((all) => (all.at(-1)?.role === "assistant" ? all.slice(0, -1) : all));
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const question = input.trim();
  const canSend = documents.length > 0 && question.length >= QUERY_MIN_CHARS && !busy;

  // Follow the conversation as it grows.
  const count = messages.length;
  useEffect(() => {
    if (count > initialMessages.length) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [count, initialMessages.length]);

  const answers = messages.filter((m) => m.role === "assistant");
  const lastAnswer = answers.at(-1) ?? null;
  // The Sources panel follows the chip the reader picked, or else the latest answer.
  const shown = (active && answers.find((m) => m.id === active.messageId)) ?? lastAnswer;
  const shownSources = shown ? answerSources(shown) : null;
  const activeNumber =
    active && shown?.id === active.messageId
      ? active.number
      : (shownSources?.cited[0]?.citation.number ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    clearError();
    setActive(null);
    void sendMessage({ text: question }, { body: requestBody() });
    setInput("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line. Not while an IME is composing a character.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function answerApproval(approvalId: string, tasks: ApprovedTask[] | null) {
    clearError();
    // The ticked tasks ride along with the request this sends (prepareSendMessagesRequest).
    void addToolApprovalResponse({
      id: approvalId,
      approved: tasks !== null,
      options: { body: { approvedTasks: tasks ?? undefined } },
    });
  }

  // An explicit request: the tools are only offered on the user's own words or this click.
  function turnIntoTasks() {
    clearError();
    setActive(null);
    void sendMessage({ text: TURN_INTO_TASKS }, { body: requestBody() });
  }

  // Phones show the card's own bar for "Add" and "Cancel" while it waits, not the composer.
  const lastFound = lastAnswer ? proposalOf(lastAnswer) : null;
  const waitingOnPhone =
    isMobile &&
    proposalState(lastFound?.part ?? null, lastFound?.proposal ?? null) === "waiting" &&
    messages.at(-1)?.id === lastAnswer?.id;

  function cite(messageId: string, number: number) {
    setActive({ messageId, number });
    if (isMobile) setSheetOpen(true);
  }

  const firstQuestion = messages.find((m) => m.role === "user");
  const heading = title ?? (firstQuestion ? chatTitle(messageText(firstQuestion)) : "New chat");

  return (
    <div className="flex flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b px-4 py-3 md:px-8 md:py-4">
          <h1 className="truncate text-base font-semibold">{heading}</h1>
          <span className="text-[13px] text-muted-foreground">
            {documents.length === 0 ? "No ready documents" : scopeLabel(documents, documentIds)}
          </span>
        </header>

        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-6 px-4 pt-6 pb-6 md:px-8 md:pt-8">
          {messages.length === 0 ? (
            <Intro readyCount={documents.length} />
          ) : (
            messages.map((message, index) =>
              message.role === "user" ? (
                <Message key={message.id} align="end">
                  <MessageContent>
                    <Bubble align="end" className="max-w-[85%] md:max-w-[80%]">
                      <BubbleContent className="rounded-[14px_14px_4px_14px] px-4 py-3 text-[15px]">
                        {messageText(message)}
                      </BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              ) : (
                <AnswerMessage
                  key={message.id}
                  message={message}
                  streaming={busy && index === messages.length - 1}
                  last={message.id === lastAnswer?.id && !busy}
                  stopped={stoppedIds.includes(message.id)}
                  active={shown?.id === message.id ? activeNumber : null}
                  onCite={(number) => cite(message.id, number)}
                  preview={!isMobile}
                  canAnswer={!busy && index === messages.length - 1}
                  mobile={isMobile}
                  onApprove={(approvalId, tasks) => answerApproval(approvalId, tasks)}
                  onCancel={(approvalId) => answerApproval(approvalId, null)}
                  onTurnIntoTasks={documents.length > 0 ? turnIntoTasks : undefined}
                  onRetry={() => {
                    clearError();
                    setActive(null);
                    void regenerate({ messageId: message.id, body: requestBody() });
                  }}
                />
              ),
            )
          )}
          {status === "submitted" && messages.at(-1)?.role === "user" ? (
            <p className="text-[13px] text-muted-foreground">Searching your documents…</p>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={submit}
          hidden={waitingOnPhone}
          className="sticky bottom-0 mx-auto w-full max-w-[720px] bg-linear-to-b from-background/0 to-background to-30% px-4 pt-4 pb-4 md:px-8 md:pb-6"
        >
          {error ? (
            <p role="alert" className="mb-2 text-[13px] text-destructive">
              {error.message}
            </p>
          ) : null}
          <InputGroup className="h-auto gap-2.5 rounded-[14px] border-border-strong bg-card p-3 shadow-composer paper">
            <InputGroupTextarea
              aria-label={messages.length > 0 ? "Ask a follow-up" : "Ask about your documents"}
              placeholder={messages.length > 0 ? "Ask a follow-up" : "Ask about your documents"}
              rows={2}
              maxLength={QUERY_MAX_CHARS}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={documents.length === 0}
              className="min-h-0 px-0 pt-0 text-[15px] md:text-[15px]"
            />
            <InputGroupAddon align="block-end" className="gap-2 px-0 pb-0">
              <DocumentPicker documents={documents} value={documentIds} onChange={setDocumentIds} />
              {busy ? (
                <InputGroupButton
                  type="button"
                  variant="default"
                  size="icon-sm"
                  className="ml-auto size-[38px] rounded-[10px]"
                  aria-label="Stop"
                  onClick={() => void stop()}
                >
                  <SquareIcon className="fill-current" />
                </InputGroupButton>
              ) : (
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  // aria-disabled, not disabled: InputGroup dims itself when any child is
                  // disabled, which should only happen when the whole composer is.
                  className="ml-auto size-[38px] rounded-[10px] aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  aria-disabled={!canSend}
                  aria-label="Send"
                >
                  <ArrowUpIcon />
                </InputGroupButton>
              )}
            </InputGroupAddon>
          </InputGroup>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Answers come only from your documents. Check the passages before relying on them.
          </p>
        </form>
      </div>

      <SourcesPanel
        sources={shownSources}
        active={activeNumber}
        onSelect={(number) => shown && setActive({ messageId: shown.id, number })}
      />

      {isMobile ? (
        <SourceSheet
          sources={shownSources?.cited ?? []}
          active={sheetOpen ? activeNumber : null}
          onActiveChange={(number) => {
            if (number === null) setSheetOpen(false);
            else if (shown) setActive({ messageId: shown.id, number });
          }}
        />
      ) : null}
    </div>
  );
}

// The last answer's proposal, once the user clicked "Add" or "Cancel" on it.
function answeredApproval(
  messages: ChatUIMessage[],
): { messageId: string; approvalId: string; approved: boolean } | null {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return null;
  for (const part of last.parts) {
    if (part.type === "tool-proposeTasks" && part.state === "approval-responded") {
      return { messageId: last.id, approvalId: part.approval.id, approved: part.approval.approved };
    }
  }
  return null;
}

// Puts an approval the server refused back to waiting, so the card can be answered again.
function reopenApproval(messages: ChatUIMessage[]): ChatUIMessage[] {
  const last = messages.at(-1);
  if (!answeredApproval(messages) || !last) return messages;
  const parts = last.parts.map((part) =>
    part.type === "tool-proposeTasks" && part.state === "approval-responded"
      ? { ...part, state: "approval-requested" as const, approval: { id: part.approval.id } }
      : part,
  );
  return [...messages.slice(0, -1), { ...last, parts }];
}

function lastUserMessage(messages: ChatUIMessage[]): QuestionRequestBody["message"] {
  const message = messages.findLast((m) => m.role === "user");
  return {
    id: message?.id ?? "",
    role: "user",
    parts: [{ type: "text", text: message ? messageText(message) : "" }],
  };
}

function Intro({ readyCount }: { readyCount: number }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquareIcon />
        </EmptyMedia>
        <EmptyTitle>Ask anything about your documents</EmptyTitle>
        <EmptyDescription>
          {readyCount === 0 ? (
            <>
              Add documents to your <Link href={routes.library}>library</Link> first. DocChat
              answers from them, citing the passage behind every claim.
            </>
          ) : (
            `DocChat answers from your ${plural(readyCount, "ready document")}, citing the passage behind every claim.`
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
