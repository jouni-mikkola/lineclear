// One format for counts, money and time in every view: thousands separated by commas, a dot for decimals.

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A count or a token total: 1,234,567. */
export const count = (n: number) => WHOLE.format(n);

/** Money: cents under $100, whole dollars from there, always with separators: $0.42, $1,234. */
export const dollars = (n: number) => (n >= 100 ? `$${WHOLE.format(n)}` : `$${CENTS.format(n)}`);

/** How long ago, in words: "12 min", "3 h", "2 days". */
export function ago(since: number, now = Date.now()) {
  const min = Math.max(0, Math.round((now - since) / 60_000));
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** The time of day: "14:05". */
export const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The exact time of an instant, for a title that backs a relative time. */
export const exact = (at: number | string) => new Date(at).toLocaleString();

const STAMP = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** A moment as a short date and time: "Oct 31, 11:42". */
export const when = (ms: number) => STAMP.format(ms);

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A count with its noun: "1 task", "3 tasks". */
export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
