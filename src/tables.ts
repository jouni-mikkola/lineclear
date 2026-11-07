import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../pi/config.ts";
import { openStore } from "../server/server/store.ts";

// The Inbox, the waits and the plan requests are tables of one `store.sqlite` in the config folder. A row holds the
// record as JSON, plus the few columns a query needs. A folder of JSON files from an older version is imported when it is found, then renamed `*.imported-*`.

const schema = `
create table if not exists inbox (n integer primary key autoincrement, open integer not null, shelved integer not null, rev integer not null default 0, item text not null);
create table if not exists waits (task text primary key, wait text not null);
create table if not exists requests (task text primary key, since text not null, request text not null);
create table if not exists setup (role text primary key, model text not null);
create table if not exists setup_files (name text primary key);
`;

const stores = new Map<string, Database>();

/** The store of this config folder, opened once per process and again if its file was removed. */
export function tables(env: Record<string, string | undefined> = process.env): Database {
  const config = configDir(env);
  const file = join(config, "store.sqlite");
  let store = stores.get(file);
  if (store !== undefined && !existsSync(file)) {
    store.close();
    store = undefined;
  }
  if (store === undefined) {
    store = openStore(file);
    store.exec(schema);
    stores.set(file, store);
  }
  importFolders(store, config);
  return store;
}

/**
 * Moves each old folder of JSON files into its table, then renames the folder. The rows go in first and a row that is
 * there wins, so a crash between the two steps loses nothing and an import run twice changes nothing.
 */
function importFolders(store: Database, config: string): void {
  for (const [name, load] of Object.entries(loaders)) {
    const dir = join(config, name);
    if (!existsSync(dir)) continue;
    store.transaction(() => load(store, dir)).immediate();
    try {
      renameSync(dir, `${dir}.imported-${Date.now()}-${process.pid}`);
    } catch {
      // another process renamed it first
    }
  }
}

const setupChecked = new WeakSet<Database>();

/**
 * The store with the role models in it. The files from before the table, `settings.json` (`setup` in it) and `setup.json`,
 * are read once per store and stay where they are, so an update that rolls back still finds them. A role the table has wins.
 */
export function setupTable(env: Record<string, string | undefined> = process.env): Database {
  const store = tables(env);
  if (setupChecked.has(store)) return store;
  const config = configDir(env);
  for (const name of ["settings.json", "setup.json"]) {
    const file = join(config, name);
    if (!existsSync(file) || store.query("select 1 from setup_files where name = ?").get(name)) continue;
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`${file} cannot be read as JSON (${(e as Error).message}); fix or remove the file, it is left unchanged`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error(`${file} is not a JSON object; fix or remove the file, it is left unchanged`);
    const roles = (name === "settings.json" ? (value as { setup?: unknown }).setup : value) ?? {};
    store
      .transaction(() => {
        const put = store.query("insert or ignore into setup (role, model) values (?, ?)");
        for (const [role, model] of Object.entries(roles as Record<string, unknown>)) if (typeof model === "string") put.run(role, model);
        store.query("insert or ignore into setup_files (name) values (?)").run(name);
      })
      .immediate();
  }
  setupChecked.add(store);
  return store;
}

/** Whether any role model was ever chosen here, or an older file named some: a fresh install has none to lose. */
export function setupChosen(env: Record<string, string | undefined> = process.env): boolean {
  const store = setupTable(env);
  return store.query("select 1 from setup union select 1 from setup_files").get() !== null;
}

/** The parsed JSON files of a folder, a file that does not parse reported and skipped. */
function jsonFiles(dir: string): unknown[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    if (!f.endsWith(".json")) return [];
    try {
      return [JSON.parse(readFileSync(join(dir, f), "utf8"))];
    } catch (e) {
      console.error(`lineclear: ${join(dir, f)} cannot be imported: ${(e as Error).message}`);
      return [];
    }
  });
}

/** What the inbox table holds for an item: whether it waits for the owner, and whether it left the list (closed, or applied by itself). */
export const inboxFlags = (i: { answer?: unknown; closed?: unknown; auto?: unknown; commit?: unknown }) => ({
  open: i.answer === undefined && i.closed === undefined ? 1 : 0,
  shelved: i.closed !== undefined || (i.auto === true && i.commit !== undefined) ? 1 : 0,
});

const loaders: Record<string, (store: Database, dir: string) => void> = {
  inbox(store, dir) {
    const put = store.query("insert or ignore into inbox (n, open, shelved, item) values (?, ?, ?, ?)");
    for (const item of [...jsonFiles(dir), ...jsonFiles(join(dir, "closed"))] as { n: number; kind: string; closed?: unknown }[]) {
      const { open, shelved } = inboxFlags(item);
      const onShelf = existsSync(join(dir, "closed", `${item.n}.json`)) ? 1 : shelved;
      put.run(item.n, open, onShelf, JSON.stringify(item));
    }
  },
  waits(store, dir) {
    const put = store.query("insert or ignore into waits (task, wait) values (?, ?)");
    for (const w of jsonFiles(dir) as { task: string }[]) put.run(w.task, JSON.stringify(w));
  },
  requests(store, dir) {
    const put = store.query("insert or ignore into requests (task, since, request) values (?, ?, ?)");
    for (const r of jsonFiles(dir) as { task: string; since: string }[]) put.run(r.task, r.since, JSON.stringify(r));
  },
};
