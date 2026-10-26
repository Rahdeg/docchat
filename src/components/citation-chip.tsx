import { cn } from "@/lib/utils";

type CitationChipProps = {
  index: number;
  // With a source, an inline citation: "[1] handbook.pdf · p. 2". Without one, the number on
  // its own in a small box, as on source cards.
  source?: string;
  page?: number | null;
  // The boxed number in highlighter yellow with an ink border (the best match), instead of
  // white with a grey border.
  featured?: boolean;
  className?: string;
};

export function CitationChip({ index, source, page, featured, className }: CitationChipProps) {
  if (source === undefined) {
    return (
      <span
        className={cn(
          "inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border px-1.5 text-xs font-semibold tabular-nums",
          featured
            ? "border-foreground bg-highlight text-highlight-foreground"
            : "border-border-strong bg-card text-foreground",
          className,
        )}
      >
        {index}
      </span>
    );
  }

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
