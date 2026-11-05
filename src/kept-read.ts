import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Reads that Home repeats every second, kept until a file they come from changes (its inode, size or time), so 1000
// tasks and their chats cost a stat each instead of a parse each. A kept value is shared: callers do not change it.

const kept = new Map<string, { key: string; value: unknown }>();
const MAX = 20_000;

/** What a file is now: changes when it is written or replaced. "-" when it is missing. */
function fileKey(file: string): string {
  try {
    const s = statSync(file);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch {
    return "-";
  }
}

/** The value `read` gives, read again only when `key` is new. */
export function keptBy<T>(id: string, key: string, read: () => T): T {
  const k = kept.get(id);
  if (k && k.key === key) return k.value as T;
  const value = read();
  if (kept.size >= MAX) kept.clear();
  kept.set(id, { key, value });
  return value;
}

/** A JSON file, parsed again only when it changed. Undefined when it is missing or not JSON. */
export function readJsonKept<T>(file: string): T | undefined {
  return keptBy(`json:${file}`, fileKey(file), () => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch {
      return undefined;
    }
  });
}

/**
 * The state of a repo's main and origin/main as its ref files show it, plus its roadmap file: what git would read.
 * Undefined when the repo has no `.git` folder of its own (a worktree, or no repo): such a read is not kept.
 */
export function refsKey(repo: string): string | undefined {
  const git = join(repo, ".git");
  try {
    if (!statSync(git).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const files = ["HEAD", "packed-refs", "refs/heads/main", "refs/remotes/origin/main"].map((f) => join(git, f));
  return [...files, join(repo, "docs", "ROADMAP.md")].map(fileKey).join("|");
}

/** A task as Shepherdr's files keep it: its id, and what else the reader looks at. */
export type TaskLine = { id: string } & Record<string, unknown>;

/**
 * Shepherdr's tasks in `dir`: tasks.json, with the tasks that ended over a day ago from its append log
 * tasks-cold.jsonl (the last line of an id wins, `{"gone": id}` drops it, tasks.json wins over both).
 */
export function readTasksKept(dir: string): { next?: Record<string, number>; tasks: TaskLine[]; red?: Record<string, string> } {
  const hotFile = join(dir, "tasks.json");
  const coldFile = join(dir, "tasks-cold.jsonl");
  return keptBy(`tasks:${dir}`, `${fileKey(hotFile)}|${fileKey(coldFile)}`, () => {
    const file = readJsonKept<{ next?: Record<string, number>; tasks?: TaskLine[]; red?: Record<string, string> }>(hotFile) ?? {};
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
