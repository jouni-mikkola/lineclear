import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { readJson } from "../pi/config.ts";

// Records written under Shepherdr 2.0 hold its paths. The checks and the fix are here, with the other code that names the old folder.

type Rec = Record<string, unknown>;
/** Where a profile must have been left alone for before it is copied: a browser in use writes into it. */
const QUIET_MS = 10 * 60_000;
/** The herdr plugin's checkout, where Shepherdr 2.0's own command and skills were: `<home>/.config/herdr/plugins/github-installations/herdr-projects-<id>/<n>/checkout`. */
const PLUGIN_CHECKOUT = /\/[^\s:"]*\/herdr-projects-[0-9a-f]+\/[^\s:"/]+\/checkout/g;

export interface Roots {
  /** Shepherdr 2.0's folder. */
  old: string;
  /** Lineclear's data folder. */
  now: string;
  /** Lineclear's app folder, where `server/skill` is. */
  app: string;
}

/** A record's text with the old folder and the old plugin's checkout named by their Lineclear places. */
function moved(text: string, r: Roots): string {
  const bin = join(r.now, "helper", "bin");
  if (text === r.old) return r.now;
  return text
    .replaceAll(`${r.old}/`, `${r.now}/`)
    .replace(new RegExp(`${PLUGIN_CHECKOUT.source}/bin(?![\\w.-])`, "g"), bin)
    .replace(PLUGIN_CHECKOUT, join(r.app, "server"));
}

/** A file's path under the old folder, moved only when the file is there: a path to a file that was never copied stays, so nothing points at nothing. */
const movedFile = (path: string, r: Roots) => (path.startsWith(`${r.old}/`) && existsSync(moved(path, r)) ? moved(path, r) : path);

const rewriteValue = (v: unknown, r: Roots): unknown => {
  if (typeof v === "string") return moved(v, r);
  if (Array.isArray(v)) return v.map((x) => rewriteValue(x, r));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewriteValue(x, r)]));
  return v;
};

const AGENT_FIELDS = ["env", "system", "cwd", "logs"];

const rewriteField = (field: string, v: unknown, r: Roots): unknown =>
  field === "logs" && Array.isArray(v) ? v.map((x) => (typeof x === "string" ? movedFile(x, r) : x)) : rewriteValue(v, r);

/** Whether the files hold an old path in an agent's environment, system text, folder or logs, or a task's own folders (never its prose). */
function changes(dir: string, r: Roots): { agents?: Record<string, Rec>; tasks?: { tasks: Rec[] } } {
  const out: ReturnType<typeof changes> = {};
  const agents: Record<string, Rec> | null = readJson(join(dir, "agents.json"));
  if (agents) {
    const next = Object.fromEntries(
      Object.entries(agents).map(([k, rec]) => [
        k,
        { ...rec, ...Object.fromEntries(AGENT_FIELDS.filter((f) => f in rec).map((f) => [f, rewriteField(f, rec[f], r)])) },
      ]),
    );
    if (JSON.stringify(next) !== JSON.stringify(agents)) out.agents = next;
  }
  const tasks: { tasks: Rec[] } | null = readJson(join(dir, "tasks.json"));
  if (tasks && Array.isArray(tasks.tasks)) {
    const pathy = (v: unknown) => typeof v === "string" && v.startsWith(`${r.old}/`);
    const next = {
      ...tasks,
      tasks: tasks.tasks.map((t) => ({
        ...t,
        ...Object.fromEntries(
          Object.entries(t)
            .filter(([, v]) => pathy(v))
            .map(([f, v]) => [f, movedFile(v as string, r)]),
        ),
      })),
    };
    if (JSON.stringify(next) !== JSON.stringify(tasks)) out.tasks = next;
  }
  return out;
}

/** What `agents.json` and `tasks.json` still hold of the old folder, as a sentence ("" when nothing). */
export function oldPathRecords(r: Roots): string {
  const c = changes(r.now, r);
  const parts = [c.agents ? "agents.json" : "", c.tasks ? "tasks.json" : ""].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} in ${r.now} hold paths of the old folder` : "";
}

/** Rewrites the records. Returns the files written. */
export function rewriteOldPaths(r: Roots): string[] {
  const c = changes(r.now, r);
  const written: string[] = [];
  for (const [file, body] of [
    ["agents.json", c.agents],
    ["tasks.json", c.tasks],
  ] as const) {
    if (!body) continue;
    writeAtomic(join(r.now, file), JSON.stringify(body, null, 2));
    written.push(file);
  }
  return written;
}

/** The tasks whose browser profile the old folder has and Lineclear's lacks. */
export function uncopiedBrowsers(r: Roots): string[] {
  const from = join(r.old, "browser");
  if (!existsSync(from)) return [];
  return readdirSync(from).filter(
    (t) => !t.endsWith(".used") && !t.endsWith(".partial") && !existsSync(join(r.now, "browser", t)) && statSync(join(from, t)).isDirectory(),
  );
}

/**
 * Copies each task's browser profile the old folder has and Lineclear's lacks. A running browser keeps the old
 * profile (it is copied, not moved) and a profile used lately is left for the next run, so no agent stops.
 * Returns the tasks copied.
 */
export function copyBrowsers(r: Roots, now = Date.now()): string[] {
  const from = join(r.old, "browser");
  if (!existsSync(from)) return [];
  const copied: string[] = [];
  for (const task of readdirSync(from)) {
    const src = join(from, task);
    const to = join(r.now, "browser", task);
    if (task.endsWith(".used") || task.endsWith(".partial") || existsSync(to) || !statSync(src).isDirectory()) continue;
    const mark = join(from, `${task}.used`);
    if (existsSync(mark) && now - statSync(mark).mtimeMs < QUIET_MS) continue;
    // into a temporary name first, so a cut copy is never taken for a whole profile
    const part = `${to}.partial`;
    rmSync(part, { recursive: true, force: true });
    mkdirSync(dirname(to), { recursive: true });
    cpSync(src, part, { recursive: true });
    renameSync(part, to);
    copied.push(task);
  }
  return copied;
}
