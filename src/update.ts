import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { readJson } from "../pi/config.ts";
import { MIGRATE_WRITES, fillMissingFiles, migrated, migrateMain } from "./migrate.ts";
import { type Busy, oldDir, oldFolders, oldFolderUsers, realBusy } from "./old-install.ts";
import { dataDir } from "./paths.ts";

type Env = Record<string, string | undefined>;
type Out = (line: string) => void;

/** Where the old folders wait for one command back, inside Lineclear's own folder. */
const KEPT = "before-update";
const MANIFEST = "folders.json";
/** What the copy would change in Lineclear's folder, as it was, for a rollback. */
const AS_WAS = "lineclear-as-was";

/** Seams for the tests: a planted failure after the copy, and the processes that use an old folder. */
export interface UpdateHooks {
  afterCopy?: () => void;
  users?: (env: Env) => string[];
}

function moveFolder(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
}

/** Saves what a copy may change in `to`, so a failed move can put it back. */
function saveAsWas(to: string, kept: string): void {
  for (const n of MIGRATE_WRITES) if (existsSync(join(to, n))) cpSync(join(to, n), join(kept, AS_WAS, n), { recursive: true });
}

/** Puts the old folders back where they were, and Lineclear's folder as it was before the copy. */
function rollBack(kept: string, folders: Record<string, string>, to: string, copied: boolean, out: Out): void {
  for (const [name, path] of Object.entries(folders)) if (existsSync(join(kept, name))) moveFolder(join(kept, name), path);
  // only a copy changed Lineclear's folder: a rollback must not overwrite what a running server saved since
  if (copied)
    for (const n of MIGRATE_WRITES) {
      rmSync(join(to, n), { recursive: true, force: true });
      if (existsSync(join(kept, AS_WAS, n))) cpSync(join(kept, AS_WAS, n), join(to, n), { recursive: true });
    }
  rmSync(kept, { recursive: true, force: true });
  out("lineclear update: rolled back, the old folders and Lineclear's folder are as they were");
}

function forward(env: Env, out: Out, busy: Busy, hooks: UpdateHooks): number {
  const folders = oldFolders(env);
  const to = dataDir(env);
  if (!folders.length) return (out("lineclear update: no old folders to move, nothing changed"), 0);
  if (busy("old", env)) return (out("lineclear update: the old install is running and would save over the move. Stop it first."), 1);
  // a self-update never ends running work: the folders move on a later update, once nothing uses them
  const users = (hooks.users ?? oldFolderUsers)(env);
  if (users.length) {
    out(`lineclear update: ${users.length} running process${users.length === 1 ? "" : "es"} still use the old folders, so they stay until a later update:`);
    for (const u of users) out(`  ${u}`);
    return 0;
  }
  const kept = join(to, KEPT);
  if (existsSync(kept)) return (out(`lineclear update: ${kept} is still there from an earlier move. Remove it or run 'lineclear update --back' first.`), 1);
  const map = Object.fromEntries(folders.map((f) => [basename(f), f]));
  // a machine that already copied the old install has its work in Lineclear's folder; one with only the helper or the projects folder has nothing to copy
  const copy = !migrated(to) && existsSync(join(oldDir(env), "spaces.json"));
  if (copy && busy("lineclear", env)) return (out("lineclear update: Lineclear is running, and would save over the copy. Stop its server first."), 1);
  mkdirSync(kept, { recursive: true });
  try {
    if (copy) {
      saveAsWas(to, kept);
      const lines: string[] = [];
      if (migrateMain([], (l) => lines.push(l), env, Date.now(), busy) !== 0) throw new Error(`the copy was refused: ${lines.at(-1) ?? "no reason given"}`);
    } else if (migrated(to)) fillMissingFiles(oldDir(env), to);
    hooks.afterCopy?.();
    writeAtomic(join(kept, MANIFEST), JSON.stringify(map, null, 2));
    for (const f of folders) moveFolder(f, join(kept, basename(f)));
    rmSync(join(kept, AS_WAS), { recursive: true, force: true });
  } catch (e) {
    out(`lineclear update: the move failed: ${e instanceof Error ? e.message : e}`);
    rollBack(kept, map, to, copy, out);
    return 1;
  }
  out(`Moved ${folders.length} old folder${folders.length === 1 ? "" : "s"} into ${to}. A copy waits in ${kept}; 'lineclear update --back' returns it.`);
  return 0;
}

function back(env: Env, out: Out, busy: Busy): number {
  const to = dataDir(env);
  const kept = join(to, KEPT);
  const map: Record<string, string> | undefined = readJson(join(kept, MANIFEST));
  if (!map) return (out(`lineclear update: no copy to go back to (no ${join(kept, MANIFEST)})`), 1);
  const there = Object.values(map).filter((p) => existsSync(p));
  if (there.length) return (out(`lineclear update: ${there.join(", ")} exists again, so nothing was put back over it`), 1);
  if (busy("lineclear", env)) return (out("lineclear update: Lineclear is running, and work done in it would be missed. Stop its server first."), 1);
  for (const [name, path] of Object.entries(map)) if (existsSync(join(kept, name))) cpSync(join(kept, name), path, { recursive: true });
  // the work done since the move joins the restored folder
  const joined = migrated(to) ? migrateMain(["--back"], out, env, Date.now(), busy) : 0;
  if (joined !== 0) {
    for (const path of Object.values(map)) rmSync(path, { recursive: true, force: true });
    return joined;
  }
  rmSync(kept, { recursive: true, force: true });
  out("Back on the old folders. Your work since the move is in them too.");
  return 0;
}

/** `lineclear update`: the old folders move into Lineclear's own folder; `--back` returns them. */
export function updateMain(args: string[], out: Out, env: Env = process.env, busy: Busy = realBusy, hooks: UpdateHooks = {}): number {
  if (args.length > 1 || (args[0] !== undefined && args[0] !== "--back")) return (out("usage: lineclear update [--back]"), 2);
  return args[0] === "--back" ? back(env, out, busy) : forward(env, out, busy, hooks);
}
