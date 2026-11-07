import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withHotLog } from "./hot-log.ts";
import { fileKey, keptBy, readJsonKept } from "./kept-read.ts";

/** A task as Lineclear keeps it: its id, and what else the reader looks at. */
export type TaskLine = { id: string } & Record<string, unknown>;

type Kept = { next?: Record<string, number>; tasks: TaskLine[]; red?: Record<string, string> };

/** What store.sqlite and its log are now: changes when a row is written. */
const storeKey = (dir: string) => `${fileKey(join(dir, "store.sqlite"))}|${fileKey(join(dir, "store.sqlite-wal"))}`;

/** Runs `read` on the store's tasks table, read-only; undefined when the store has no such table yet (older files still hold the tasks). */
function fromRows<T>(dir: string, read: (db: Database) => T): T | undefined {
  const file = join(dir, "store.sqlite");
  if (!existsSync(file)) return undefined;
  let db: Database | undefined;
  try {
    db = new Database(file, { readonly: true });
    if (!db.query("select 1 from sqlite_master where name = 'tasks'").get()) return undefined;
    return read(db);
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

/** The records of a table `tasks` with this retired mark, in the order they were first written. */
function rowTasks(db: Database, retired: number): TaskLine[] {
  const rows = db.query("select t.json, b.brief from tasks t left join task_briefs b on b.id = t.id where t.retired = ? order by t.rowid").all(retired) as {
    json: string;
    brief: string | null;
  }[];
  return rows.map((r) => ({ ...JSON.parse(r.json), ...(r.brief === null ? {} : { desc: r.brief }) }) as TaskLine);
}

/**
 * Lineclear's tasks in `dir`: the rows of store.sqlite. A folder no server has imported yet holds them in tasks.json,
 * with the tasks that ended over a day ago in its append log tasks-cold.jsonl (the last line of an id wins,
 * `{"gone": id}` drops it, tasks.json wins over both).
 */
export function readTasksKept(dir: string): Kept {
  const hotFile = join(dir, "tasks.json");
  const coldFile = join(dir, "tasks-cold.jsonl");
  const logFile = join(dir, "tasks-hot.jsonl");
  return keptBy(`tasks:${dir}`, `${storeKey(dir)}|${fileKey(hotFile)}|${fileKey(coldFile)}|${fileKey(logFile)}`, () => {
    const rows = fromRows(dir, (db) => {
      const meta = db.query("select value from task_meta where key = 'meta'").get() as { value: string } | null;
      return { ...(meta ? (JSON.parse(meta.value) as { next?: Record<string, number>; red?: Record<string, string> }) : {}), tasks: rowTasks(db, 0) };
    });
    if (rows) return rows;
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

/** The tasks the server retired: rows marked retired, or in a folder not imported yet the lines of archive/tasks-<month>.jsonl. */
export function readRetiredKept(dir: string): TaskLine[] {
  return keptBy(`retired:${dir}`, storeKey(dir), () => {
    const rows = fromRows(dir, (db) => rowTasks(db, 1));
    if (rows) return rows;
    const archive = join(dir, "archive");
    if (!existsSync(archive)) return [];
    return readdirSync(archive)
      .filter((f) => f.startsWith("tasks-") && f.endsWith(".jsonl"))
      .flatMap((f) => readFileSync(join(archive, f), "utf8").split("\n"))
      .flatMap((l) => {
        try {
          return l ? [JSON.parse(l)] : [];
        } catch {
          return [];
        }
      });
  });
}

/** How many retired tasks were merged and how many closed, by space key (the id without its number). */
export function retiredCounts(dir: string): Record<string, { merged: number; closed: number }> {
  return keptBy(`retired-counts:${dir}`, storeKey(dir), () => {
    const rows = fromRows(
      dir,
      (db) => db.query("select id, json_extract(json, '$.merged') as merged from tasks where retired = 1").all() as { id: string; merged: unknown }[],
    );
    if (!rows) return readJsonKept<Record<string, { merged: number; closed: number }>>(join(dir, "archive", "counts.json")) ?? {};
    const counts: Record<string, { merged: number; closed: number }> = {};
    for (const r of rows) {
      const c = (counts[r.id.replace(/-\d+$/, "")] ??= { merged: 0, closed: 0 });
      if (r.merged) c.merged++;
      else c.closed++;
    }
    return counts;
  });
}
