"use client";

import { ArrowUpIcon, ChevronDownIcon, FileTextIcon, MessageSquareIcon } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
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
import { Label } from "@/components/ui/label";
import { Message, MessageContent } from "@/components/ui/message";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { ReadyDocument } from "@/features/documents/queries";
import { plural } from "@/lib/format";
import { documentFileUrl, routes } from "@/lib/routes";
import type { Passage } from "@/server/ai/retrieve";

import { findPassages } from "../actions";
import { QUERY_MAX_CHARS, QUERY_MIN_CHARS } from "../find-rules";
import { bestSentence } from "../passage-text";
import { SourceCard } from "./source-card";

type Search = { question: string; passages: Passage[] | null };

// "Find passages" mode for /chat until answers land (PR 6): ask a question, see the passages
// DocChat would answer from.
export function FindPassages({ documents }: { documents: ReadyDocument[] }) {
  const [query, setQuery] = useState("");
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [showScores, setShowScores] = useState(false);
  // The last question asked; passages is null while it's being searched.
  const [search, setSearch] = useState<Search | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const resultsRef = useRef<HTMLDivElement>(null);

  const question = query.trim();
  const canSend = documents.length > 0 && question.length >= QUERY_MIN_CHARS && !pending;

  useEffect(() => {
    if (search) resultsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [search]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    setError(null);
    setSearch({ question, passages: null });
    startTransition(async () => {
      const result = await findPassages({
        query: question,
        // None chosen means every ready document.
        documentIds: documentIds.length > 0 ? documentIds : undefined,
      });
      if (result.ok) {
        setSearch({ question, passages: result.data });
        setQuery("");
      } else {
        setSearch(null);
        setError(result.fieldErrors?.query?.[0] ?? result.error);
      }
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line. Not while an IME is composing a character.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <>
      <div
        ref={resultsRef}
        className="mx-auto flex w-full max-w-[800px] flex-1 scroll-mt-4 flex-col gap-[22px] px-4 pt-6 pb-6 md:px-8 md:pt-10"
      >
        {search ? (
          <Results search={search} showScores={showScores} onShowScoresChange={setShowScores} />
        ) : (
          <Intro readyCount={documents.length} />
        )}
      </div>

      <form
        onSubmit={submit}
        className="sticky bottom-0 mx-auto w-full max-w-[800px] bg-linear-to-b from-background/0 to-background to-40% px-4 pt-4 pb-4 md:px-8 md:pb-6"
      >
        <InputGroup className="h-auto gap-2.5 rounded-[14px] border-border-strong bg-card p-3 shadow-composer paper">
          <InputGroupTextarea
            aria-label="Ask about your documents"
            placeholder="Ask about your documents"
            rows={2}
            maxLength={QUERY_MAX_CHARS}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={documents.length === 0}
            className="min-h-0 px-0 pt-0 text-[15px] md:text-[15px]"
          />
          <InputGroupAddon align="block-end" className="gap-2 px-0 pb-0">
            <DocumentPicker documents={documents} value={documentIds} onChange={setDocumentIds} />
            <InputGroupButton
              type="submit"
              variant="default"
              size="icon-sm"
              // aria-disabled, not disabled: InputGroup dims itself when any child is disabled,
              // which should only happen when the whole composer is (no ready documents).
              className="ml-auto size-[38px] rounded-[10px] aria-disabled:pointer-events-none aria-disabled:opacity-50"
              aria-disabled={!canSend}
              aria-label="Find passages"
            >
              {pending ? <Spinner /> : <ArrowUpIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {error ? (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </>
  );
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
              Add documents to your <Link href={routes.library}>library</Link> first. DocChat finds
              the passages that answer your question.
            </>
          ) : (
            `DocChat finds the passages in your ${plural(readyCount, "ready document")} that answer your question.`
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

type ResultsProps = {
  search: Search;
  showScores: boolean;
  onShowScoresChange: (value: boolean) => void;
};

function Results({ search, showScores, onShowScoresChange }: ResultsProps) {
  const { question, passages } = search;
  const documentCount = new Set(passages?.map((p) => p.documentId)).size;

  return (
    <>
      <Message align="end">
        <MessageContent>
          <Bubble align="end" className="max-w-[78%]">
            <BubbleContent className="rounded-[14px_14px_4px_14px] px-4 py-3 text-[15px]">
              {question}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>

      {passages === null ? (
        <PassagesSkeleton />
      ) : passages.length === 0 ? (
        <Empty className="rounded-[3px] border border-dashed border-border-strong">
          <EmptyHeader>
            <EmptyTitle>Nothing in your documents matches that.</EmptyTitle>
            <EmptyDescription>Try different words, or add a document.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              className="paper"
              nativeButton={false}
              render={<Link href={routes.library} />}
            >
              Go to Library
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-[15px] font-semibold">
                {plural(passages.length, "passage")} from {plural(documentCount, "document")}
              </h2>
              <Label className="ml-auto gap-2.5 text-[13px] font-normal text-secondary-text">
                Show match scores
                <Switch checked={showScores} onCheckedChange={onShowScoresChange} />
              </Label>
            </div>
            <p className="text-muted-foreground">
              Answers are coming soon. For now, these are the passages DocChat would use, best match
              first.
            </p>
          </div>

          <ol className="flex flex-col gap-[22px]">
            {passages.map((passage, index) => (
              <li key={passage.chunkId}>
                <SourceCard
                  number={index + 1}
                  documentName={passage.name}
                  page={passage.page}
                  passage={passage.content}
                  highlight={bestSentence(passage.content, question)}
                  similarity={showScores ? passage.similarity : null}
                  href={
                    passage.hasFile
                      ? documentFileUrl(
                          passage.documentId,
                          passage.mimeType === "application/pdf" ? passage.page : null,
                        )
                      : null
                  }
                />
              </li>
            ))}
          </ol>

          <p className="text-[13px] text-muted-foreground">
            Weaker matches are hidden. Try more specific words if the right passage isn&apos;t here.
          </p>
        </>
      )}
    </>
  );
}

type DocumentPickerProps = {
  documents: ReadyDocument[];
  // Chosen document IDs; empty means all.
  value: string[];
  onChange: (value: string[]) => void;
};

function DocumentPicker({ documents, value, onChange }: DocumentPickerProps) {
  // Forget documents that are no longer ready (deleted, or being re-read).
  const chosen = value.filter((id) => documents.some((d) => d.id === id));
  const label =
    chosen.length === 0
      ? `All documents (${documents.length})`
      : chosen.length === 1
        ? documents.find((d) => d.id === chosen[0])!.name
        : `${chosen.length} documents`;

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...chosen, id] : chosen.filter((other) => other !== id));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-[34px] max-w-64 rounded-lg text-[13px] font-normal paper"
            disabled={documents.length === 0}
          />
        }
      >
        <FileTextIcon data-icon="inline-start" />
        <span className="truncate">{label}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={chosen.length === 0}
            onCheckedChange={() => onChange([])}
          >
            All documents
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {documents.map((doc) => (
            <DropdownMenuCheckboxItem
              key={doc.id}
              checked={chosen.includes(doc.id)}
              onCheckedChange={(checked) => toggle(doc.id, checked)}
              className="font-serif"
            >
              <span className="truncate">{doc.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Fixed widths: no random sizes in a skeleton.
function PassagesSkeleton() {
  return (
    <div aria-busy className="flex flex-col gap-[22px]">
      <span className="sr-only">Finding passages…</span>
      {["w-11/12", "w-4/5", "w-3/4"].map((width) => (
        <div
          key={width}
          className="flex flex-col gap-3 rounded-[3px] border bg-card px-5 py-[18px] shadow-sheet"
        >
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className={`h-4 ${width}`} />
        </div>
      ))}
    </div>
  );
}
