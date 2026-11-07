import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withHotLog } from "./hot-log.ts";
import { fileKey, keptBy, readJsonKept } from "./kept-read.ts";

/** A task as Lineclear's files keep it: its id, and what else the reader looks at. */
export type TaskLine = { id: string } & Record<string, unknown>;

/**
 * Lineclear's tasks in `dir`: tasks.json, with the tasks that ended over a day ago from its append log
 * tasks-cold.jsonl (the last line of an id wins, `{"gone": id}` drops it, tasks.json wins over both).
 */
export function readTasksKept(dir: string): { next?: Record<string, number>; tasks: TaskLine[]; red?: Record<string, string> } {
  const hotFile = join(dir, "tasks.json");
  const coldFile = join(dir, "tasks-cold.jsonl");
  const logFile = join(dir, "tasks-hot.jsonl");
  return keptBy(`tasks:${dir}`, `${fileKey(hotFile)}|${fileKey(coldFile)}|${fileKey(logFile)}`, () => {
    const file = withHotLog(dir, readJsonKept<{ next?: Record<string, number>; tasks?: TaskLine[]; red?: Record<string, string> }>(hotFile) ?? {});
    const hot = Array.isArray(file.tasks) ? file.tasks : [];
    const by = new Map<string, TaskLine>();
    let text = "";
    try {
      text = readFileSync(coldFile, "utf8");
    } catch {
      // no cold tasks yet
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (typeof r?.gone === "string") by.delete(r.gone);
        else if (typeof r?.id === "string") by.set(r.id, r);
      } catch {
        // a line cut short by a stop mid-write
      }
    }
    for (const t of hot) by.delete(t.id);
    return { ...file, tasks: [...by.values(), ...hot] };
  });
}
