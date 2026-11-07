import { tables } from "./tables.ts";
import { readTasks } from "./task-read.ts";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { guardGroup, killGroup } from "./process-group.ts";
import * as Q from "../server/server/live/engine/machine.ts";
import { storedLoginAdvice } from "../server/server/live/secrets.ts";
import { listProjectNames, readSettings } from "./project.ts";
import { day } from "./progress.ts";
import { gitText } from "./git.ts";
import { spawnSync } from "node:child_process";
import { serverBin } from "./paths.ts";
import { askProjectChat, type CardPoster } from "./project-chat.ts";

const waitKinds = ["owner", "login", "checks", "browser"] as const;
/** The only things an owner wait may be for: a login code, money beyond the budget, or something that leaves the machine. */
const ownerKinds = ["login", "money", "outward"] as const;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface Wait {
  task: string;
  project?: string;
  /** `start`: the rule loop gave up on a start whose agent never answered its brief ("start failed"). */
  kind: (typeof waitKinds)[number] | "until" | "task" | "start";
  reason: string;
  since: string;
  /** For an `owner` wait: what it is for. */
  ownerKind?: (typeof ownerKinds)[number];
  /** For a `fault` wait: its `task` is a step, and `for` names the system fault it waits out. */
  /** For an `until` wait: when the task wakes. */
  until?: string;
  /** For a `task` wait: the id of the task it waits for. */
  for?: string;
  /** For an `until` wait: the rule loop has stopped the task. */
  stopped?: boolean;
}

/** A machine's load limit: its machine.json's load per core (1 if unset) times its cores. */
export const loadLimit = (env = process.env) => Q.machineLimits(env).loadLimit;

/** A wait the owner answers; every other wait (a task, a time, a failed start) pauses the agent alone. */
export const waitsForOwner = (w: Wait) => w.kind === "owner" || w.kind === "login" || w.kind === "browser";

export function readWaits(env = process.env): Wait[] {
  const rows = tables(env).query("select wait from waits order by task").all() as { wait: string }[];
  return rows.map((r) => JSON.parse(r.wait) as Wait);
}

export function writeWait(w: Wait, env = process.env): void {
  tables(env).query("insert or replace into waits (task, wait) values (?, ?)").run(w.task, JSON.stringify(w));
}

export const clearWait = (task: string, env = process.env) => void tables(env).query("delete from waits where task = ?").run(task);

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** The task an agent's environment names, if it is an agent's. */
const agentTask = (env: typeof process.env): string | undefined => {
  const id = (env.LINECLEAR_TASK ?? env.LINECLEAR_CHAT?.split("/")[0]) || undefined;
  return id !== undefined && TASK_ID.test(id) ? id : undefined;
};

/** The task a worktree belongs to: from the environment, else from its branch `work/<n>-...` and the task list. */
export function findTask(cwd: string, env = process.env): string | undefined {
  const fromEnv = env.LINECLEAR_TASK ?? env.LINECLEAR_CHAT?.split("/")[0];
  if (fromEnv && TASK_ID.test(fromEnv)) return fromEnv;
  const n = /^work\/(\d+)-/.exec(gitText(cwd, "rev-parse", "--abbrev-ref", "HEAD") ?? "")?.[1];
  if (n === undefined) return undefined;
  const r = readTasks(env);
  return "tasks" in r ? r.tasks.find((t) => t.id?.endsWith(`-${n}`))?.id : undefined;
}

/** The ids of the tasks in a space, as the rule loop sees them, or undefined when `lineclear task list` cannot say. */
function taskIds(space: string, env = process.env): string[] | undefined {
  const r = readTasks(env, space);
  return "tasks" in r ? r.tasks.flatMap((t) => (t.id ? [t.id] : [])) : undefined;
}

/** The project whose repo holds this folder or worktree. */
export function findProject(cwd: string, env = process.env): string | undefined {
  const common = gitText(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const roots = [common === undefined ? undefined : dirname(common), gitText(cwd, "rev-parse", "--show-toplevel")]
    .filter((r): r is string => r !== undefined)
    .map(real);
  return listProjectNames(env).find((name) => {
    const s = readSettings(name, env);
    return typeof s !== "string" && roots.includes(real(s.repo));
  });
}

/** `+30m`, `+2h`, `+1d`, `14:30` (the next one), or a date and time such as `2026-11-01T09:00`. */
export function parseUntil(text: string, now: Date): Date | undefined {
  const rel = /^\+(\d+)([mhd])$/.exec(text);
  if (rel) return new Date(now.getTime() + Number(rel[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as "m" | "h" | "d"]);
  const clock = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (clock) {
    const d = new Date(now);
    d.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    if (Number(clock[1]) > 23 || Number(clock[2]) > 59) return undefined;
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return undefined;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Runs the command in a process group of its own (the check's), its output on ours. */
async function runChild(command: string, cwd: string): Promise<number> {
  const child = Bun.spawn(["sh", "-c", command], { cwd, stdin: "ignore", stdout: "inherit", stderr: "inherit", detached: true });
  const watcher = guardGroup(child.pid, process.pid);
  try {
    return await child.exited;
  } finally {
    // nothing a check started outlives it
    killGroup(child.pid);
    killGroup(watcher);
  }
}

/** Runs the server's command for this agent; its words, and whether it passed. */
function serverCall(args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const r = spawnSync(serverBin(env), args, { env, cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 11 * 60_000 });
  return { ok: r.status === 0, text: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/**
 * The full check of an agent: the task's branch goes to GitHub as a pull request and
 * the result of GitHub's check run comes back with the failed tests, so no check script runs on this machine.
 * Undefined when this is not an agent's check.
 */
function checkOnGitHub(out: (l: string) => void, env: NodeJS.ProcessEnv, cwd: string): number | undefined {
  const task = agentTask(env);
  if (task === undefined) return undefined;
  const pushed = serverCall(["pr", task], env, cwd);
  out(pushed.text);
  if (!pushed.ok) return 1;
  // one call waits 9 minutes, under an agent's 10-minute command limit; a run still going is asked again by running this again
  const r = serverCall(["checks", task], env, cwd);
  out(r.text);
  // no remote or no checks is no result: never a pass for a check Settings say GitHub runs
  if (/^No GitHub checks:|has no checks on GitHub/.test(r.text)) return 1;
  return r.ok ? 0 : 1;
}

/**
 * `lineclear check [command]`: an agent's full check goes to GitHub; any other folder runs the project's check, or the
 * command given, here. `lineclear check --changed` is the worker's loop: the project's check told to look only at
 * what the branch changed, since it is short.
 */
async function check(out: (l: string) => void, env = process.env, o: { cwd?: string } = {}, args: string[] = []): Promise<number> {
  const cwd = o.cwd ?? process.cwd();
  const name = findProject(cwd, env);
  const settings = name === undefined ? undefined : readSettings(name, env);
  if (name === undefined || typeof settings === "string" || settings === undefined) {
    out("lineclear check: this folder is not in a project, see 'lineclear project list'");
    return 1;
  }
  const changed = args.includes("--changed");
  const rest = args.filter((a) => a !== "--changed");
  if (rest.length > 1 || rest.some((a) => a.startsWith("--"))) return (out(usage("check")), 2);
  const command = rest[0];
  if (changed) {
    // only a check that is Lineclear's own script is known to take the flag; any other project's runs in full
    const script = join(cwd, "scripts/check.ts");
    if (!command && /\bbun run check\b/.test(settings.check) && existsSync(script) && readFileSync(script, "utf8").includes("--changed")) {
      return runChild(`${settings.check} --changed`, cwd);
    }
    out("lineclear check --changed: this project's check does not take --changed, so the full check runs");
    return runChild(command ?? settings.check, cwd);
  }
  // an agent's full check goes to GitHub; a named command runs as asked
  if (args.length === 0) {
    const github = checkOnGitHub(out, env, cwd);
    if (github !== undefined) return github;
  }
  return runChild(command ?? settings.check, cwd);
}

function usage(name: string): string {
  return {
    wait: 'usage: lineclear wait <login|checks|browser> "<reason>" | lineclear wait owner --kind <login|money|outward> "<reason>" | lineclear wait until <time> "<reason>" | lineclear wait task <id> "<reason>"',
    resume: "usage: lineclear resume",
    check: "usage: lineclear check [--changed] [command]",
  }[name]!;
}

/** Why a wait for a login may not be declared: its TOTP is loadable, or it does not say which NAME_TOTP is missing. */
function loginWaitProblem(why: string, project: string | undefined, env: typeof process.env): { message: string; code: number } | undefined {
  const named = /\b([A-Z][A-Z0-9_]*)_TOTP\b/.exec(why)?.[1];
  const stored = storedLoginAdvice(why, project, env, named);
  if (stored !== undefined) return { message: stored, code: 1 };
  if (/\bcaptcha\b/i.test(why) || named !== undefined) return undefined;
  return { message: 'a login wait names the login whose NAME_TOTP is missing, for example "M365_GA_TOTP is not stored"', code: 2 };
}

export async function waitsMain(
  name: string,
  args: string[],
  out: (l: string) => void,
  env = process.env,
  cwd = process.cwd(),
  now: () => Date = () => new Date(),
  post?: CardPoster,
): Promise<number> {
  const fail = (message: string, code = 1) => {
    out(`lineclear ${name}: ${message}`);
    return code;
  };
  if (name === "check") return check(out, env, { cwd }, args);
  const task = findTask(cwd, env);
  if (task === undefined) return fail("cannot tell which task this is, run it inside a task's worktree");
  const c: WaitCall = { name, task, project: findProject(cwd, env), since: now().toISOString(), out, env, now, fail, post };

  if (name === "resume") {
    if (args.length > 0) return (out(usage(name)), 2);
    if (!readWaits(env).some((w) => w.task === task)) return fail(`${task} has no wait`);
    clearWait(task, env);
    out(`${task} runs again`);
    return 0;
  }
  if (name !== "wait") return (out(usage(name)), 2);
  const [kind, ...rest] = args;
  if (kind === "until") return waitUntil(c, rest);
  if (kind === "task") return waitTask(c, rest);
  if (kind === "owner") return waitOwner(c, rest);
  return waitPlain(c, kind, rest);
}

/** What the `wait` commands share. */
interface WaitCall {
  name: string;
  task: string;
  project: string | undefined;
  since: string;
  out: (l: string) => void;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  fail: (message: string, code?: number) => number;
  post?: CardPoster;
}

function waitUntil(c: WaitCall, rest: string[]): number {
  const [time, reason, ...extra] = rest;
  if (time === undefined || !reason?.trim() || extra.length > 0) return (c.out(usage(c.name)), 2);
  const at = parseUntil(time, c.now());
  if (at === undefined) return c.fail(`'${time}' is not a time, use +30m, +2h, +1d, 14:30 or 2026-11-01T09:00`, 2);
  if (at <= c.now()) return c.fail(`${time} is already past`, 2);
  if (c.project === undefined) return c.fail("this folder is not in a project, so the loop could not wake the task");
  writeWait({ task: c.task, project: c.project, kind: "until", reason: reason.trim(), since: c.since, until: at.toISOString() }, c.env);
  c.out(`${c.task} waits until ${at.toISOString()}: ${reason.trim()}`);
  return 0;
}

function waitTask(c: WaitCall, rest: string[]): number {
  const [other, reason, ...extra] = rest;
  if (other === undefined || !reason?.trim() || extra.length > 0) return (c.out(usage(c.name)), 2);
  if (other === c.task) return c.fail("a task cannot wait for itself", 2);
  if (c.project === undefined) return c.fail("this folder is not in a project, so the loop could not wake the task");
  const settings = readSettings(c.project, c.env);
  const ids = typeof settings === "string" ? undefined : taskIds(settings.space, c.env);
  if (ids === undefined) return c.fail("cannot read 'lineclear task list --json', so cannot check the task");
  if (!ids.includes(other)) return c.fail(`there is no task ${other}`, 2);
  writeWait({ task: c.task, project: c.project, kind: "task", reason: reason.trim(), since: c.since, for: other }, c.env);
  c.out(`${c.task} waits for task ${other}: ${reason.trim()}`);
  return 0;
}

function waitOwner(c: WaitCall, rest: string[]): number {
  const at = rest.indexOf("--kind");
  const given = at < 0 ? undefined : rest[at + 1];
  const own = at < 0 ? rest : [...rest.slice(0, at), ...rest.slice(at + 2)];
  if (!(ownerKinds as readonly string[]).includes(given ?? "")) {
    return c.fail(`a wait for the owner needs a kind: --kind ${ownerKinds.join("|")}. Anything else you decide yourself by the brief.`, 2);
  }
  const [why, ...more] = own;
  if (!why?.trim() || more.length > 0) return (c.out(usage(c.name)), 2);
  if (given === "login") {
    const refused = loginWaitProblem(why, c.project, c.env);
    if (refused) return c.fail(refused.message, refused.code);
  }
  writeWait({ task: c.task, project: c.project, kind: "owner", reason: why.trim(), since: c.since, ownerKind: given as Wait["ownerKind"] }, c.env);
  askProjectChat(c.project, c.task, why.trim(), ["Done", "Cannot"], c.env, c.post);
  c.out(`${c.task} waits for owner (${given}): ${why.trim()}`);
  return 0;
}

function waitPlain(c: WaitCall, kind: string | undefined, rest: string[]): number {
  const [reason, ...extra] = rest;
  if (kind === "login" && reason?.trim() && extra.length === 0) {
    const refused = loginWaitProblem(reason, c.project, c.env);
    if (refused) return c.fail(refused.message, refused.code);
  }
  if (!(waitKinds as readonly string[]).includes(kind ?? "") || !reason?.trim() || extra.length > 0) return (c.out(usage(c.name)), 2);
  writeWait({ task: c.task, project: c.project, kind: kind as Wait["kind"], reason: reason.trim(), since: c.since }, c.env);
  c.out(`${c.task} waits for ${kind}: ${reason.trim()}`);
  return 0;
}

/** Paused tasks in words: tasks that wait for the same task count together, any other wait stands alone. */
export interface WaitGroup {
  text: string;
  count: number;
}

const OTHER_WAIT: Partial<Record<Wait["kind"], string>> = {
  owner: "waits for your answer",
  login: "waits for a login",
  browser: "waits for a browser",
  checks: "waits for a check slot",
  start: "did not start",
};

const TASK_IN_TEXT = /\b[A-Za-z0-9]+-\d+\b/g;

/**
 * What each paused task waits for, as `titles` (task id to title) knows it. A task wait and a timed wait whose reason
 * names another task both count under that task's title. A task id in a reason is shown as its task's title.
 */
export function waitGroups(waits: Wait[], titles: Map<string, string>): WaitGroup[] {
  const byTarget = new Map<string, string[]>();
  const alone: WaitGroup[] = [];
  for (const w of waits) {
    const own = titles.get(w.task);
    if (own === undefined) continue;
    const target = w.kind === "task" ? w.for : w.kind === "until" ? w.reason.match(TASK_IN_TEXT)?.find((id) => id !== w.task && titles.has(id)) : undefined;
    if (target !== undefined) byTarget.set(target, [...(byTarget.get(target) ?? []), own]);
    else if (w.kind === "until") {
      const reason = w.reason.replace(TASK_IN_TEXT, (id) => titles.get(id) ?? "another task");
      alone.push({ text: `${own} waits: ${reason}${w.until ? `, wakes ${day(Date.parse(w.until))}` : ""}`, count: 1 });
    } else alone.push({ text: `${own} ${w.kind === "task" ? "waits for another task" : (OTHER_WAIT[w.kind] ?? "waits")}`, count: 1 });
  }
  const grouped = [...byTarget].map(([id, owns]) => {
    const on = titles.get(id) ?? "another task";
    return { text: owns.length === 1 ? `${owns[0]} waits for ${on}` : `${owns.length} tasks wait for ${on}`, count: owns.length };
  });
  return [...grouped, ...alone];
}
