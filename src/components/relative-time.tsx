"use client";

import { formatRelativeTime } from "@/lib/format";

// "Today", "3 days ago"… in the viewer's time zone. The server renders it with its own clock
// and zone; the browser's version replaces it on hydration, hence suppressHydrationWarning.
export function RelativeTime({ date }: { date: Date }) {
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {formatRelativeTime(date, new Date())}
    </time>
  );
}
