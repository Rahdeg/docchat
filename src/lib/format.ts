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
