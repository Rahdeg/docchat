import { ArrowUpIcon, MessageSquareIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

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
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { countDocuments } from "@/features/documents/queries";
import { requireUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Chat · DocChat" };

export default function ChatPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 md:px-8 md:py-10">
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareIcon />
          </EmptyMedia>
          <EmptyTitle>Ask anything about your documents</EmptyTitle>
          <Suspense fallback={<Skeleton className="h-5 w-64" />}>
            <ReadyDocuments />
          </Suspense>
        </EmptyHeader>
      </Empty>

      {/* TODO(ai): enable the composer when streaming chat lands. */}
      <InputGroup data-disabled>
        <InputGroupTextarea
          disabled
          aria-label="Message"
          placeholder="Ask a question about your documents…"
        />
        <InputGroupAddon align="block-end">
          <InputGroupText className="text-xs">Chat is coming soon</InputGroupText>
          <InputGroupButton
            variant="default"
            size="icon-sm"
            className="ml-auto"
            disabled
            aria-label="Send"
          >
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

async function ReadyDocuments() {
  const userId = await requireUserId();
  const ready = await countDocuments(userId, "ready");

  return (
    <EmptyDescription>
      {ready === 0
        ? "Add documents to your library first. Answers cite the passages they come from."
        : `Answers come from your ${ready} ready ${ready === 1 ? "document" : "documents"}, with a citation for every claim.`}
    </EmptyDescription>
  );
}
