"use client";

import { ChevronDownIcon, FileTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReadyDocument } from "@/features/documents/queries";

type DocumentPickerProps = {
  documents: ReadyDocument[];
  // Chosen document IDs; empty means all.
  value: string[];
  onChange: (value: string[]) => void;
};

// Documents that still exist and are ready, of those chosen.
export function chosenDocuments(documents: ReadyDocument[], value: string[]): string[] {
  return value.filter((id) => documents.some((d) => d.id === id));
}

// "Searching all documents", "Searching Lease.pdf", "Searching 2 documents".
export function scopeLabel(documents: ReadyDocument[], value: string[]): string {
  const chosen = chosenDocuments(documents, value);
  if (chosen.length === 0) return "Searching all documents";
  if (chosen.length === 1) return `Searching ${documents.find((d) => d.id === chosen[0])!.name}`;
  return `Searching ${chosen.length} documents`;
}

export function DocumentPicker({ documents, value, onChange }: DocumentPickerProps) {
  // Forget documents that are no longer ready (deleted, or being re-read).
  const chosen = chosenDocuments(documents, value);
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
