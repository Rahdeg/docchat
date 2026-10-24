import { cn } from "@/lib/utils";

type MeterBarProps = {
  value: number;
  max: number;
  // Accessible name, e.g. "Reading Tenancy agreement".
  label: string;
  // Spoken instead of the raw numbers, e.g. "Page 6 of 9".
  valueText?: string;
  tone?: "ink" | "reading";
  className?: string;
};

// A thin progress bar (3px by default). Fills with ink, or blue while a document is read.
export function MeterBar({ value, max, label, valueText, tone = "ink", className }: MeterBarProps) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={cn("h-[3px] overflow-hidden rounded-full bg-border", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
          tone === "reading" ? "bg-status-reading-bar" : "bg-primary",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
