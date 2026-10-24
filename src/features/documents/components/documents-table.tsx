import { FileTextIcon } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatDate } from "@/lib/format";
import type { LibraryDocument } from "../library-document";

import { DocumentStatusBadge } from "./document-status-badge";

export function DocumentsTable({ documents }: { documents: LibraryDocument[] }) {
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Pages</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Size</TableHead>
            <TableHead className="hidden pr-4 md:table-cell">Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={doc.id}>
              <TableCell className="pl-4">
                <div className="flex items-start gap-2">
                  <FileTextIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{doc.name}</span>
                    {doc.status === "failed" && doc.error ? (
                      <span className="truncate text-xs text-muted-foreground">{doc.error}</span>
                    ) : null}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <DocumentStatusBadge status={doc.status} />
              </TableCell>
              <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                {doc.pageCount ?? "—"}
              </TableCell>
              <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                {formatBytes(doc.sizeBytes)}
              </TableCell>
              <TableCell className="hidden pr-4 text-muted-foreground md:table-cell">
                {formatDate(doc.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DocumentsTableSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
