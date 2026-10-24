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
        "inline-flex items-center rounded-sm bg-highlight px-1.5 py-0.5 text-xs font-medium text-highlight-foreground tabular-nums",
        className,
      )}
    >
      [{index}] {source}
      {page ? ` · p. ${page}` : null}
    </span>
  );
}
