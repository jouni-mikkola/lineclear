import type { Check, Probe } from "./doctor.ts";
import { readTasksKept } from "./tasks-kept.ts";

/** The ids and aliases of the tasks the store holds; empty when there is no store yet. */
export function storedTaskIds(dir: string): string[] {
  return readTasksKept(dir).tasks.flatMap((t) => [t.id, ...((t.aliases as string[] | undefined) ?? [])]);
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
