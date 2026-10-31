"use client";

import { MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { chatUrl, routes } from "@/lib/routes";

import { deleteChat, renameChat } from "../actions";
import type { RecentChat } from "../queries";

// A chat in the sidebar: its link, and a "…" menu to rename or delete it.
export function RecentChatItem({ chat }: { chat: RecentChat }) {
  const pathname = usePathname();
  const router = useRouter();
  const href = chatUrl(chat.id);
  const current = pathname === href;
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [title, setTitle] = useState(chat.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function rename(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await renameChat({ id: chat.id, title });
      if (!result.ok) {
        setError(result.fieldErrors?.title?.[0] ?? result.error);
        return;
      }
      setDialog(null);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteChat({ id: chat.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDialog(null);
      toast.success("Chat deleted.");
      if (current) router.replace(routes.chat);
    });
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton render={<Link href={href} />} isActive={current} tooltip={chat.title}>
        <span>{chat.title}</span>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuAction showOnHover aria-label={`More actions for ${chat.title}`} />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="min-w-36">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                setTitle(chat.title);
                setError(null);
                setDialog("rename");
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialog === "rename"}
        onOpenChange={(open) => !pending && setDialog(open ? "rename" : null)}
      >
        <DialogContent className="paper sm:max-w-md">
          <form onSubmit={rename} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Rename chat</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`chat-title-${chat.id}`}>Name</Label>
              <Input
                id={`chat-title-${chat.id}`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-invalid={!!error}
                autoFocus
              />
              {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={dialog === "delete"}
        onOpenChange={(open) => !pending && setDialog(open ? "delete" : null)}
      >
        <AlertDialogContent className="paper">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{chat.title}&rdquo; and its answers are deleted. Your documents stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarMenuItem>
  );
}
