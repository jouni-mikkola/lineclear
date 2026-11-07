import { Database } from "bun:sqlite";
import { readTasksKept } from "./tasks-kept.ts";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
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

/** The tasks a data folder holds. */
export function taskCount(dir: string): number {
  return readTasksKept(dir).tasks.length;
}

export interface StoreCopy {
  name: string;
  /** The one file of the copy. */
  file: string;
  tasks: number;
  source: string;
}

const COPY_EXT = ".sqlite";
const STORE_DB = "store.sqlite";
/** Tables a copy adds to the vacuumed store: the other files of the data folder (gzipped) and a few facts. */
const FILES = "copy_files";
const META = "copy_meta";
/** Never in a copy: secrets and push keys. */
const SECRET_FILES = new Set(["vault.json", "vapid.json", "push.json", "secrets.json"]);
/** Where the last failed copy is written, in the data folder, so doctor can name it when the copies folder is the broken part. */
const ERROR_FILE = "store-copy-error";
/** The folder of the task briefs, which tasks.json points at. */
const BRIEFS = "tasks";

const meta = (db: Database, key: string) => (db.query(`SELECT value FROM ${META} WHERE key = ?`).get(key) as { value: string } | null)?.value ?? "";

/** The facts of one copy file, or null when the file is not a copy. */
function readCopy(file: string): Omit<StoreCopy, "name"> | null {
  let db: Database | undefined;
  try {
    db = new Database(file, { readonly: true });
    return { file, source: meta(db, "source"), tasks: Number(meta(db, "tasks")) };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** The copies, newest first. */
export function listCopies(env: Env = process.env): StoreCopy[] {
  const root = storeCopiesDir(env);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith(COPY_EXT))
    .sort()
    .reverse()
    .flatMap((f) => {
      const c = readCopy(join(root, f));
      return c ? [{ name: f.slice(0, -COPY_EXT.length), ...c }] : [];
    });
}

/** The files a copy keeps, as paths under the data folder: its top files without secrets, and the briefs. Folders (helper, chatlog, browser) are rebuilt and can be large. */
function copiedPaths(from: string): string[] {
  const top = readdirSync(from, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.endsWith(".tmp") && !e.name.endsWith(".sock") && !SECRET_FILES.has(e.name))
    .filter((e) => !e.name.startsWith(STORE_DB) && e.name !== ERROR_FILE)
    .map((e) => e.name);
  if (!existsSync(join(from, BRIEFS))) return top;
  const briefs = readdirSync(join(from, BRIEFS), { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile() && !f.name.endsWith(".tmp"))
    .map((f) => join(BRIEFS, f.parentPath.slice(join(from, BRIEFS).length), f.name));
  return [...top, ...briefs];
}

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
/** When a copy was taken, from its name. */
const takenAt = (name: string) => Date.parse(`${name.replace(/^[a-z]+-/, "").replace(/T(\d\d)-(\d\d)-(\d\d)$/, "T$1:$2:$3")}Z`);

/** The store through VACUUM INTO (one moment), then the other files and the facts into the same file. */
function writeCopy(from: string, file: string): void {
  const hasStore = existsSync(join(from, STORE_DB));
  const src = hasStore ? new Database(join(from, STORE_DB), { readonly: true }) : new Database(":memory:");
  try {
    src.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  } finally {
    src.close();
  }
  const db = new Database(file);
  try {
    db.exec(`CREATE TABLE ${FILES} (path TEXT PRIMARY KEY, body BLOB NOT NULL); CREATE TABLE ${META} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.transaction(() => {
      const put = db.prepare(`INSERT INTO ${FILES} (path, body) VALUES (?, ?)`);
      for (const p of copiedPaths(from)) put.run(p, Bun.gzipSync(readFileSync(join(from, p))));
      const fact = db.prepare(`INSERT INTO ${META} (key, value) VALUES (?, ?)`);
      fact.run("source", from);
      fact.run("tasks", String(taskCount(from)));
      fact.run("store", hasStore ? "1" : "0");
    })();
  } finally {
    db.close();
  }
}

/**
 * Copies the store aside as one file, `<kind>-<time>.sqlite`. An hourly copy of an emptied store is not taken while the
 * newest copy held tasks, so a wiped store cannot push the last good copies out. Returns the copy's name, or "" when none was taken.
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
  const part = join(root, `${name}${COPY_EXT}.part`);
  mkdirSync(root, { recursive: true });
  rmSync(part, { force: true });
  try {
    writeCopy(from, part);
    renameSync(part, join(root, `${name}${COPY_EXT}`));
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
  prune(kind, env);
  dropFolderCopies(root);
  return name;
}

/** Copies from before a copy was one file were folders; they cannot be restored now, so the new copy frees their space. */
function dropFolderCopies(root: string): void {
  for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) rmSync(join(root, e.name), { recursive: true, force: true });
}

function prune(kind: "hourly" | "update", env: Env): void {
  const keep = kind === "hourly" ? HOURLY_KEEP : UPDATE_KEEP;
  for (const c of listCopies(env)
    .filter((x) => x.name.startsWith(`${kind}-`))
    .slice(keep))
    rmSync(c.file, { force: true });
}

/** Puts a copy back into the data folder: the store file whole, and the other files it holds. Nothing else in the folder is touched. */
export function restoreCopy(name: string, env: Env = process.env): number {
  const c = listCopies(env).find((x) => x.name === name);
  if (!c) throw new Error(`no copy named ${name}`);
  const to = dataDir(env);
  mkdirSync(to, { recursive: true });
  const db = new Database(c.file, { readonly: true });
  try {
    for (const row of db.query(`SELECT path, body FROM ${FILES}`).all() as { path: string; body: Uint8Array<ArrayBuffer> }[]) {
      const dest = join(to, row.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeBytes(`${dest}.tmp`, Bun.gunzipSync(row.body));
      renameSync(`${dest}.tmp`, dest);
    }
    if (meta(db, "store") === "1") restoreStoreFile(c.file, to);
  } finally {
    db.close();
  }
  return c.tasks;
}

/** A file's bytes; the caller renames it into place. */
function writeBytes(file: string, bytes: Uint8Array): void {
  const fd = openSync(file, "w");
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** The store file back as it was, without the tables a copy adds. The old file's write-ahead log goes, or it would replay over the copy. */
function restoreStoreFile(copy: string, to: string): void {
  const tmp = join(to, `${STORE_DB}.tmp`);
  rmSync(tmp, { force: true });
  copyFileSync(copy, tmp);
  const db = new Database(tmp);
  try {
    db.exec(`DROP TABLE ${FILES}; DROP TABLE ${META}; VACUUM`);
  } finally {
    db.close();
  }
  rmSync(join(to, `${STORE_DB}-wal`), { force: true });
  rmSync(join(to, `${STORE_DB}-shm`), { force: true });
  renameSync(tmp, join(to, STORE_DB));
}

/** For doctor: what is wrong with the local copies, or "". Fine when a copy is fresh and the last try did not fail. */
export function copiesProblem(env: Env = process.env, now = new Date()): string {
  try {
    const failed = readFileSync(join(dataDir(env), ERROR_FILE), "utf8").trim();
    if (failed) return `the last copy of the store failed: ${failed}`;
  } catch {
    // no failure noted
  }
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

/** The loop's part: an hourly copy. A failed copy does not stop the tick: its error is kept for doctor, and a good copy clears it. */
export function copyStoreQuietly(env: Env = process.env, now = new Date()): void {
  const note = join(dataDir(env), ERROR_FILE);
  try {
    copyStore("hourly", now, env);
    rmSync(note, { force: true });
  } catch (e) {
    try {
      writeAtomic(note, `${(e as Error).message.replace(/\s+/g, " ")}\n`);
    } catch {
      // the data folder itself is unwritable: doctor reports the stale copy
    }
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
