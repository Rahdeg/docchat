import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  // On dark backgrounds the mark gets a faint ring so the square stays visible.
  inverted?: boolean;
};

export function Logo({ className, inverted = false }: LogoProps) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span
        aria-hidden
        className={cn(
          "flex size-6 shrink-0 items-end rounded-md bg-primary p-1",
          inverted && "ring-1 ring-primary-foreground/25",
        )}
      >
        <span className="h-1 w-full rounded-full bg-highlight" />
      </span>
      DocChat
    </span>
  );
}
