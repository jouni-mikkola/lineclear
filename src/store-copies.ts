import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { dataDir } from "./paths.ts";
import { HOUR_MS } from "./time.ts";

type Env = Record<string, string | undefined>;

const HOURLY_KEEP = 48;
const UPDATE_KEEP = 10;
/** How old the newest copy may be before doctor calls the copies stale: the rule loop takes one an hour. */
const FRESH_MS = 3 * HOUR_MS;

/** Where the copies of the store live, on every machine: beside the app, outside the data folder they protect. */
const storeCopiesDir = (env: Env = process.env) =>
  env.LINECLEAR_STORE_COPIES ?? join(env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share"), "lineclear", "store-copies");

/** The tasks a data folder holds: the hot ones in tasks.json and one per id in the cold log. */
export function taskCount(dir: string): number {
  let n = 0;
  try {
    const hot = JSON.parse(readFileSync(join(dir, "tasks.json"), "utf8")) as { tasks?: unknown[] };
    n += Array.isArray(hot.tasks) ? hot.tasks.length : 0;
  } catch {
    // no file, or one that is not JSON: no hot tasks
  }
  try {
    // an append log: the last line of an id wins and {"gone": id} drops it
    const ids = new Set<string>();
    for (const line of readFileSync(join(dir, "tasks-cold.jsonl"), "utf8").split("\n")) {
      try {
        const r = JSON.parse(line) as { id?: unknown; gone?: unknown };
        if (typeof r.gone === "string") ids.delete(r.gone);
        else if (typeof r.id === "string") ids.add(r.id);
      } catch {
        // a blank or torn line
      }
    }
    n += ids.size;
  } catch {
    // no cold log
  }
  return n;
}

export interface StoreCopy {
  name: string;
  dir: string;
  tasks: number;
  source: string;
}

/** The copies, newest first. */
export function listCopies(env: Env = process.env): StoreCopy[] {
  const root = storeCopiesDir(env);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => !name.endsWith(".part") && statSync(join(root, name)).isDirectory())
    .sort()
    .reverse()
    .map((name) => {
      const dir = join(root, name);
      let source = "";
      try {
        source = readFileSync(join(dir, "source"), "utf8").trim();
      } catch {
        // a copy from before the source was named
      }
      return { name, dir, tasks: taskCount(dir), source };
    });
}

/** The folder of the task briefs, which tasks.json points at. */
const BRIEFS = "tasks";

/** Each brief file of one data folder into another, each put in place whole. */
function copyBriefs(from: string, to: string): void {
  if (!existsSync(join(from, BRIEFS))) return;
  for (const f of readdirSync(join(from, BRIEFS), { recursive: true, withFileTypes: true })) {
    if (!f.isFile()) continue;
    const rel = join(f.parentPath.slice(join(from, BRIEFS).length), f.name);
    const dest = join(to, BRIEFS, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(f.parentPath, f.name), `${dest}.tmp`);
    renameSync(`${dest}.tmp`, dest);
  }
}

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
/** When a copy was taken, from its name. */
const takenAt = (name: string) => Date.parse(`${name.replace(/^[a-z]+-/, "").replace(/T(\d\d)-(\d\d)-(\d\d)$/, "T$1:$2:$3")}Z`);

/** The files at the top of the data folder: the store. Folders (helper, chatlog, browser) are rebuilt and can be large. */
const storeFiles = (from: string) =>
  readdirSync(from, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.endsWith(".tmp") && !e.name.endsWith(".sock"))
    .map((e) => e.name);

/**
 * Copies the store aside as `<kind>-<time>`. An hourly copy of an emptied store is not taken while the newest copy
 * held tasks, so a wiped store cannot push the last good copies out. Returns the copy's name, or "" when none was taken.
 */
export function copyStore(kind: "hourly" | "update", now = new Date(), env: Env = process.env): string {
  const from = dataDir(env);
  if (!existsSync(from)) return "";
  const copies = listCopies(env).filter((c) => c.source === from);
  if (kind === "hourly") {
    const newest = copies.find((c) => c.name.startsWith("hourly-"));
    if (newest && now.getTime() - takenAt(newest.name) < HOUR_MS) return "";
    if (taskCount(from) === 0 && copies.some((c) => c.tasks > 0)) return "";
  }
  const name = `${kind}-${stamp(now)}`;
  const root = storeCopiesDir(env);
  const part = join(root, `${name}.part`);
  rmSync(part, { recursive: true, force: true });
  mkdirSync(part, { recursive: true });
  for (const f of storeFiles(from)) copyFileSync(join(from, f), join(part, f));
  // the briefs, which tasks.json points at
  copyBriefs(from, part);
  writeAtomic(join(part, "source"), `${from}\n`);
  renameSync(part, join(root, name));
  prune(kind, env);
  return name;
}

function prune(kind: "hourly" | "update", env: Env): void {
  const keep = kind === "hourly" ? HOURLY_KEEP : UPDATE_KEEP;
  for (const c of listCopies(env)
    .filter((x) => x.name.startsWith(`${kind}-`))
    .slice(keep))
    rmSync(c.dir, { recursive: true, force: true });
}

/** Puts a copy's files back into the data folder. Nothing else in the folder is touched. */
export function restoreCopy(name: string, env: Env = process.env): number {
  const c = listCopies(env).find((x) => x.name === name);
  if (!c) throw new Error(`no copy named ${name}`);
  const to = dataDir(env);
  mkdirSync(to, { recursive: true });
  for (const f of storeFiles(c.dir)) if (f !== "source") copyFileSync(join(c.dir, f), join(to, f));
  copyBriefs(c.dir, to);
  return c.tasks;
}

/** For doctor: what is wrong with the local copies, or "". Fine when a copy is fresh. */
export function copiesProblem(env: Env = process.env, now = new Date()): string {
  const newest = listCopies(env).find((c) => c.name.startsWith("hourly-"));
  if (!newest) return `no copy of the store in ${storeCopiesDir(env)}`;
  return now.getTime() - takenAt(newest.name) > FRESH_MS ? `the newest copy of the store (${newest.name}) is over 3 hours old` : "";
}

/** `lineclear store [copy | list | restore <name>]` */
export function storeMain(args: string[], out: (l: string) => void, env: Env = process.env, now = new Date()): number {
  const [sub, name] = args;
  if (sub === undefined || sub === "list") {
    const all = listCopies(env);
    if (all.length === 0) out(`no copies in ${storeCopiesDir(env)}`);
    for (const c of all) out(`${c.name}  ${c.tasks} tasks`);
    return 0;
  }
  if (sub === "copy" && name === undefined) {
    out(copyStore("hourly", now, env) || "no copy taken: the newest is under an hour old, or the store is empty and the newest copy is not");
    return 0;
  }
  if (sub === "restore" && name !== undefined) {
    try {
      out(`restored ${restoreCopy(name, env)} tasks from ${name}; restart the board (systemctl --user restart lineclear.service)`);
      return 0;
    } catch (e) {
      out(`lineclear store: ${(e as Error).message}`);
      return 1;
    }
  }
  out("usage: lineclear store [list | copy | restore <name>]");
  return 2;
}

/** The loop's part: an hourly copy. A failed copy must not stop the tick; doctor names a stale one. */
export function copyStoreQuietly(env: Env = process.env, now = new Date()): void {
  try {
    copyStore("hourly", now, env);
  } catch {
    // doctor reports copies that stop coming
  }
}

/** The machine whose board runs this machine's tasks, as that board wrote it into the data folder; "" when none does. */
export function runByNote(env: Env = process.env): string {
  try {
    return String(JSON.parse(readFileSync(join(dataDir(env), "run-by"), "utf8")));
  } catch {
    return "";
  }
}
