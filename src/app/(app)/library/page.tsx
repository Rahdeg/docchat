import { FileTextIcon, UploadIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DocumentsTable,
  DocumentsTableSkeleton,
} from "@/features/documents/components/documents-table";
import { listDocuments } from "@/features/documents/queries";
import { requireUserId } from "@/server/auth";

export const metadata: Metadata = { title: "Library · DocChat" };

export default function LibraryPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Library"
        description="The documents DocChat answers from. Each one is indexed after upload."
        actions={<UploadButton />}
      />
      <Suspense fallback={<DocumentsTableSkeleton />}>
        <Documents />
      </Suspense>
    </PageContainer>
  );
}

async function Documents() {
  const userId = await requireUserId();
  const documents = await listDocuments(userId);

  if (documents.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileTextIcon />
          </EmptyMedia>
          <EmptyTitle>No documents yet</EmptyTitle>
          <EmptyDescription>
            Upload a PDF or Markdown file and DocChat will answer questions about it, citing the
            passages it used.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <DocumentsTable documents={documents} />;
}

// TODO(upload): enable once document upload lands.
function UploadButton() {
  return (
    <Tooltip>
      {/* Disabled buttons ignore pointer events, so the wrapper carries the tooltip. */}
      <TooltipTrigger render={<span tabIndex={0} className="w-fit" />}>
        <Button disabled>
          <UploadIcon data-icon="inline-start" />
          Upload
        </Button>
      </TooltipTrigger>
      <TooltipContent>Coming soon</TooltipContent>
    </Tooltip>
  );
}
