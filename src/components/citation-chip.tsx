import { cn } from "@/lib/utils";

type CitationChipProps = {
  index: number;
  source: string;
  page?: number | null;
  className?: string;
};

export function CitationChip({ index, source, page, className }: CitationChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm bg-highlight px-1.5 py-0.5 font-mono text-xs text-highlight-foreground",
        className,
      )}
    >
      [{index}] {source}
      {page ? ` · p. ${page}` : null}
    </span>
  );
}
