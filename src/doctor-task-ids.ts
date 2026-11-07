import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Check, Probe } from "./doctor.ts";
import { withHotLog } from "./hot-log.ts";

/** The ids and aliases of the tasks in tasks.json; empty when there is no store yet. */
export function storedTaskIds(dir: string): string[] {
  type Rec = { id?: string; gone?: string; aliases?: string[] };
  const lines = (name: string): Rec[] => {
    try {
      return readFileSync(join(dir, name), "utf8")
        .split("\n")
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as Rec];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  };
  let hot: Rec[] = [];
  try {
    hot = (withHotLog(dir, JSON.parse(readFileSync(join(dir, "tasks.json"), "utf8"))).tasks ?? []) as Rec[];
  } catch {}
  // the cold file is an append log: the last line of an id wins, and a "gone" line drops it
  const cold = new Map<string, Rec>();
  for (const r of lines("tasks-cold.jsonl")) {
    if (r.gone) cold.delete(r.gone);
    else if (r.id) cold.set(r.id, r);
  }
  return [...hot, ...cold.values()].flatMap((t) => (t.id ? [t.id, ...(t.aliases ?? [])] : []));
}

export function taskIdsUnique(p: Pick<Probe, "taskIds">): Check {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of p.taskIds?.() ?? []) (seen.has(id.toUpperCase()) ? twice : seen).add(id.toUpperCase());
  return {
    name: "task ids",
    problem: twice.size ? `Two tasks share an id: ${[...twice].join(", ")}` : "",
    fix: "start the server: it renames the later task of each pair once it is not at work, and keeps the old id as an alias",
  };
}
