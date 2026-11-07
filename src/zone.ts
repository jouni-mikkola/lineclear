/** The offset in ms of a time zone from UTC at an instant. */
export function zoneOffset(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant at which a wall clock in `zone` shows this date and time (`month` counts from 0). Right across a change of offset. */
export function zonedInstant(zone: string, year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month, day, hour, minute);
  return new Date(guess - zoneOffset(zone, new Date(guess - zoneOffset(zone, new Date(guess)))));
}

/**
 * When an allowance runs out: the first "8pm", "8:30 PM" or "8:00:00 PM" after `now`, in the zone the text names
 * in brackets, else this machine's. Undefined when the text names no time.
 */
export function allowanceReset(text: string, now: Date): Date | undefined {
  const m = /(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)(?:\s*\(([A-Za-z_]+\/[A-Za-z_/+-]+)\))?/i.exec(text);
  if (m === null) return undefined;
  const hour = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0);
  const minute = Number(m[2] ?? 0);
  if (Number(m[1]) > 12 || Number(m[1]) < 1 || minute > 59) return undefined;
  const zone = m[4] ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const onDay = (plus: number) => {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(
        new Date(now.getTime() + plus * 86_400_000),
      );
      const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
      return zonedInstant(zone, n("year"), n("month") - 1, n("day"), hour, minute);
    };
    const today = onDay(0);
    return today > now ? today : onDay(1);
  } catch {
    return undefined;
  }
}
