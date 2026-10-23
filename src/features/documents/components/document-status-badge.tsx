import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import type { DocumentStatus } from "@/server/db/schema";

const statuses: Record<
  DocumentStatus,
  { label: string; variant: ComponentProps<typeof Badge>["variant"]; className?: string }
> = {
  ready: { label: "Ready", variant: "secondary", className: "bg-success/10 text-success" },
  indexing: { label: "Indexing", variant: "secondary", className: "bg-info/10 text-info" },
  uploaded: { label: "Queued", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const { label, variant, className } = statuses[status];
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
