import type { Wait } from "@hshelby/contracts";

/*
 * Waits in the person's own time zone ("tomorrow at 10:00"), computed with Intl only. A wall-clock time is turned
 * into an instant by guessing it as UTC and correcting by the zone's offset at that instant (twice, so a DST
 * change between the guess and the answer is accounted for).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The zone, if the runtime knows it; UTC otherwise (missing or garbled device time zones). */
export function validTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) return "UTC";
  try {
    formatter(timeZone);
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** The wall-clock reading in `timeZone` at `date`. */
export function wallClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute!, second: +parts.second! };
}

/** How far `timeZone` is ahead of UTC at `date`, in milliseconds. */
function offsetAt(date: Date, timeZone: string) {
  const w = wallClock(date, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The instant at which `timeZone`'s clocks read the given local time. A time that doesn't exist (skipped by a
 * spring-forward) comes out an hour later, as the clocks would show it; an ambiguous one takes the first.
 */
export function zonedTime(local: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string) {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let instant = asUtc - offsetAt(new Date(asUtc), timeZone);
  instant = asUtc - offsetAt(new Date(instant), timeZone);
  return new Date(instant);
}

/**
 * When a wait ends. `local_time` is `days` calendar days after today in the person's zone, at `time`; with
 * `days: 0` it's today if that time is still ahead, else tomorrow.
 */
export function waitUntil(wait: Wait, timeZone: string | null | undefined, now = new Date()): Date {
  if (wait.type === "immediate") return now;
  if (wait.type === "delay") return new Date(now.getTime() + wait.minutes * 60_000);
  const zone = validTimeZone(timeZone);
  const today = wallClock(now, zone);
  const [hour, minute] = wait.time.split(":").map(Number) as [number, number];
  // calendar arithmetic on the local date (Date.UTC normalizes month and year rollovers)
  const day = (offset: number) => {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    return zonedTime({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour, minute }, zone);
  };
  const at = day(wait.days);
  return wait.days === 0 && at <= now ? day(1) : at;
}
