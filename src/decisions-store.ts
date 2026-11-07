// The decisions log: one table with an index on time. The rule loop, `plan`, every agent's CLI call and the server
// write it; a reader asks for the rows since a time. The check-line module may not import pi, so the folder is named here.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type Env = Record<string, string | undefined>;

/** What a row needs; a kind of line may carry more fields (a stall's class, a failed start's machine), kept whole in `body`. */
export interface StoredDecision {
  time: string;
  project: string;
  step?: string;
  kind: string;
  reason: string;
}

const KEEP_MS = 90 * 86_400_000;

const decisionsDir = (env: Env) => env.LINECLEAR_CONFIG || join(env.HOME ?? homedir(), ".config", "lineclear");

/** The store file that holds the `decisions` table. */
export const storeFile = (env: Env = process.env) => join(decisionsDir(env), "store.sqlite");

const handles = new Map<string, Database>();

const insert = (db: Database, d: StoredDecision, once?: string) =>
  db
    .query("insert or ignore into decisions (ms, project, step, kind, reason, body, once) values (?, ?, ?, ?, ?, ?, ?)")
    .run(Date.parse(d.time), d.project, d.step ?? null, d.kind, d.reason, JSON.stringify(d), once ?? null).changes;

function importJsonl(db: Database, file: string): void {
  if (!existsSync(file)) return;
  const since = Date.now() - KEEP_MS;
  db.transaction(() => {
    for (const l of readFileSync(file, "utf8").split("\n")) {
      try {
        const d = JSON.parse(l) as StoredDecision;
        if (Date.parse(d.time) >= since) insert(db, d);
      } catch {
        // a line that is not a decision is not carried over
      }
    }
  }).immediate();
  renameSync(file, `${file}.imported`);
}

/** The log's table, created on first use. An old decisions.jsonl is read into it once and renamed `.imported`. */
function open(env: Env): Database {
  const file = storeFile(env);
  const known = handles.get(file);
  if (known && existsSync(file)) return known;
  known?.close();
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { create: true });
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
  db.exec(`create table if not exists decisions (
    id integer primary key autoincrement,
    ms integer not null,
    project text not null,
    step text,
    kind text not null,
    reason text not null,
    body text not null,
    once text unique
  );
  create index if not exists decisions_ms on decisions (ms);`);
  handles.set(file, db);
  importJsonl(db, join(decisionsDir(env), "decisions.jsonl"));
  return db;
}

/** Writes the decisions in one transaction. */
export function addDecisions(env: Env, ds: StoredDecision[]): void {
  if (ds.length === 0) return;
  const db = open(env);
  db.transaction(() => {
    for (const d of ds) insert(db, d);
  }).immediate();
}

/** Writes one decision unless a row with the same `once` key is there already: the unique key is the dedupe. Returns whether it was written. */
export function addDecisionOnce(env: Env, d: StoredDecision, once: string): boolean {
  return insert(open(env), d, once) > 0;
}

/** The decisions after `sinceMs`, oldest first. */
export function decisionsSince<T extends StoredDecision = StoredDecision>(env: Env, sinceMs: number): T[] {
  if (!existsSync(storeFile(env))) return [];
  const rows = open(env).query("select body from decisions where ms > ? order by ms, id").all(sinceMs) as { body: string }[];
  return rows.map((r) => JSON.parse(r.body) as T);
}

/** Deletes what is older than 90 days. Returns how many rows went. */
export function pruneDecisions(env: Env, nowMs: number): number {
  return open(env)
    .query("delete from decisions where ms < ?")
    .run(nowMs - KEEP_MS).changes;
}
