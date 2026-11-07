import { readFileSync } from "node:fs";
import { join } from "node:path";

type Rec = { id?: unknown; gone?: unknown; meta?: { next?: Record<string, number>; red?: Record<string, string> } };

/**
 * `file` (tasks.json) with the lines of tasks-hot.jsonl next to it replayed over it: a task whole, `{"gone": id}`, or
 * `{"meta": {next, red}}`. The log counts only when its first line names the snapshot's `gen`; a line cut short is skipped.
 */
export function withHotLog<F extends { tasks?: { id?: string }[]; next?: Record<string, number>; red?: Record<string, string>; gen?: number }>(
  dir: string,
  file: F,
): F {
  let text = "";
  try {
    text = readFileSync(join(dir, "tasks-hot.jsonl"), "utf8");
  } catch {
    return file;
  }
  const [head = "", ...lines] = text.split("\n");
  try {
    if ((JSON.parse(head) as { gen?: number }).gen !== (file.gen ?? 0)) return file;
  } catch {
    return file;
  }
  const by = new Map((file.tasks ?? []).map((t) => [t.id, t]));
  const out = { ...file };
  for (const line of lines) {
    if (!line) continue;
    try {
      const r = JSON.parse(line) as Rec;
      if (typeof r.gone === "string") by.delete(r.gone);
      else if (r.meta) {
        out.next = r.meta.next ?? {};
        out.red = r.meta.red;
      } else if (typeof r.id === "string") by.set(r.id, r as { id: string });
    } catch {
      // a line cut short by a stop mid-write
    }
  }
  out.tasks = [...by.values()] as F["tasks"];
  return out;
}
