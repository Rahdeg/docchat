const units = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

// Fixed locale and UTC so server-rendered dates don't depend on the server's settings.
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// Accepts a timestamp or a calendar day ("YYYY-MM-DD", as stored for due dates).
export function formatDate(value: Date | string): string {
  return dateFormat.format(typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// "Just now", "5 min ago", "Today", "Yesterday", "3 days ago", "Last week", "2 weeks ago",
// then a date. Days are counted in the viewer's local time zone, so call it in the browser.
export function formatRelativeTime(value: Date, now: Date): string {
  const elapsed = now.getTime() - value.getTime();
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} min ago`;

  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(value)) / DAY_MS);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  return localDateFormat.format(value);
}

const localDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

// "1 page", "14 pages".
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
