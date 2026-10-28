const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Compact age for lists: "now", "5m", "3h", "Yesterday", "Mon", "Mar 4". */
export function relativeTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  const ms = now.getTime() - date.getTime();
  if (ms < 60_000) return "now";
  if (ms < 60 * 60_000) return `${Math.floor(ms / 60_000)}m`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) return `${Math.floor(ms / (60 * 60_000))}h`;
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Divider label for a day in a thread: "Today", "Yesterday" or the date. */
export function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export const sameDay = (a: string, b: string) => startOfDay(new Date(a)) === startOfDay(new Date(b));

/** The user's local time in their time zone, e.g. "9:41 PM", or null for an unknown zone. */
export function localTimeIn(timezone: string | null) {
  if (!timezone) return null;
  try {
    return new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: timezone });
  } catch {
    return null;
  }
}
