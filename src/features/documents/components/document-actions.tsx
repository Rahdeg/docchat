"use client";

import { MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { deleteDocument, retryDocument } from "../actions";
import { displayState, type LibraryDocument } from "../library-document";

export function fileUrl(documentId: string) {
  return `/api/documents/${documentId}/file`;
}

// Retry and remove for one document, shared by the desktop sheet and the phone row. Render
// `dialog` once next to whatever calls `requestRemove`.
export function useDocumentActions(doc: LibraryDocument, name: string) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const [removing, startRemove] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const state = displayState(doc);
  const canRetry = doc.hasFile && (state === "failed" || state === "stopped");

  function retry() {
    startRetry(async () => {
      const result = await retryDocument({ id: doc.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    startRemove(async () => {
      const result = await deleteDocument({ id: doc.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      toast.success(`${name} was removed.`);
      router.refresh();
    });
  }

  const dialog = (
    <AlertDialog open={confirmOpen} onOpenChange={(open) => !removing && setConfirmOpen(open)}>
      <AlertDialogContent className="paper">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the file and everything DocChat read from it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={remove} disabled={removing}>
            {removing ? "Removing…" : "Remove"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    canRetry,
    canOpen: doc.hasFile,
    retry,
    retrying,
    requestRemove: () => setConfirmOpen(true),
    dialog,
  };
}

type DocumentMenuProps = {
  doc: LibraryDocument;
  name: string;
  actions: ReturnType<typeof useDocumentActions>;
  // On phones the menu also carries "Ask about this", which desktop shows on the sheet.
  includeAsk?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Outlined on the sheet's action bar, borderless in phone rows (with a 44px touch target).
  triggerVariant?: "outline" | "ghost";
  triggerClassName?: string;
};

// The "…" menu: Open, Try again (when it can help) and Remove.
export function DocumentMenu({
  doc,
  name,
  actions,
  includeAsk = false,
  onOpenChange,
  triggerVariant = "outline",
  triggerClassName,
}: DocumentMenuProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant={triggerVariant}
            size="icon"
            aria-label={`More actions for ${name}`}
            className={cn("shrink-0", triggerClassName)}
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          {includeAsk && doc.status === "ready" ? (
            // TODO(chat): open a chat scoped to this document once chat lands.
            <DropdownMenuItem render={<Link href={routes.chat} />}>Ask about this</DropdownMenuItem>
          ) : null}
          {actions.canOpen ? (
            <DropdownMenuItem
              render={<a href={fileUrl(doc.id)} target="_blank" rel="noopener noreferrer" />}
            >
              Open
            </DropdownMenuItem>
          ) : null}
          {actions.canRetry ? (
            <DropdownMenuItem onClick={actions.retry} disabled={actions.retrying}>
              Try again
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem variant="destructive" onClick={actions.requestRemove}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
