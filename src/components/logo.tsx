import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  // On dark backgrounds the mark gets a faint ring so the square stays visible.
  inverted?: boolean;
  // "lg": the public pages' header (a 30px mark with the bar centred, as in the designs).
  size?: "default" | "lg";
};

export function Logo({ className, inverted = false, size = "default" }: LogoProps) {
  if (size === "lg") {
    return (
      <span
        className={cn("flex items-center gap-2.5 text-lg font-semibold tracking-tight", className)}
      >
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary md:size-[30px]"
        >
          <span className="h-[5px] w-[13px] rounded-[2px] bg-highlight md:w-3.5" />
        </span>
        DocChat
      </span>
    );
  }
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
