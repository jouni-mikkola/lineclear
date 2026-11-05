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
