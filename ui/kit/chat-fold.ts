import type { ThreadItem } from "./chat.tsx";

/** The most rows the thread draws at once, the button for the earlier ones included. */
export const DRAWN = 40;

const plainNotice = (it: ThreadItem) => it.who === "dispatcher" && !!it.text && !it.file && !it.card && !it.question && !it.above && !it.status;

/** Equal notices in a row become one row with a count. The row keeps the key of the first, so it does not slide in again. */
export function foldRepeats(items: ThreadItem[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  for (const it of items) {
    const prev = out.at(-1);
    if (prev && plainNotice(prev) && plainNotice(it) && prev.text === it.text) out[out.length - 1] = { ...prev, count: (prev.count ?? 1) + 1 };
    else out.push(it);
  }
  return out;
}

/** The newest rows that fit in `DRAWN` nodes, with how many older ones are left out. `shown` is how many extra the reader asked for. */
export function newest(items: ThreadItem[], shown = 0): { items: ThreadItem[]; hidden: number } {
  if (items.length <= DRAWN + shown) return { items, hidden: 0 };
  const keep = DRAWN - 1 + shown;
  return { items: items.slice(-keep), hidden: items.length - keep };
}
