import { configDir } from "../pi/config.ts";
import { serverBin } from "./paths.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { dirname, join } from "node:path";
import { guardGroup, killGroup } from "./process-group.ts";
import * as Q from "../server/server/live/engine/check-queue.ts";
import { storedLoginAdvice } from "./secrets.ts";
import { detectHeavy, listProjectNames, readSettings, type Settings } from "./project.ts";
import { checkTier } from "./check-tier.ts";
import type { Tier } from "./check-runs.ts";
import { day } from "./progress.ts";

const waitKinds = ["owner", "login", "checks", "browser"] as const;
/** The only things an owner wait may be for: a login code, money beyond the budget, or something that leaves the machine. */
const ownerKinds = ["login", "money", "outward"] as const;
const CHECK_POLL_MS = 1000;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface Wait {
  task: string;
  project?: string;
  /** `start`: the rule loop gave up on a start whose agent never answered its brief ("start failed"). */
  kind: (typeof waitKinds)[number] | "until" | "task" | "start" | "fault";
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

const waitsDir = (env = process.env) => join(configDir(env), "waits");
export const waitPath = (task: string, env = process.env) => join(waitsDir(env), `${task}.json`);

export const limitOf = Q.limitOf;
export const slotsOf = Q.slotsOf;
export const lineOf = Q.lineOf;
export const machineOf = Q.machineOf;

/** One line for each check line of a repo that has a check in it, named with its machine: what it holds, or that it is stuck. */
export const checkLines = (repo: string, env = process.env): string[] =>
  Q.linesOf(repo, env).flatMap((line) => {
    const stuck = Q.stuckHeads(line, env).map((h) => Q.stuckLine(h, line));
    return stuck.length ? stuck : [Q.lineState(line, env)].filter(Boolean);
  });

/** The same for a project's repo. */
export function projectCheckLines(project: string, env = process.env): string[] {
  const s = readSettings(project, env);
  return typeof s === "string" ? [] : checkLines(s.repo, env);
}

/** A machine's load limit: its machine.json's load per core (1 if unset) times its cores. */
export const loadLimit = (env = process.env) => Q.machineLimits(env).loadLimit;

/** A wait the owner answers; every other wait (a task, a time, a check slot, a failed start) pauses the agent alone. */
export const waitsForOwner = (w: Wait) => w.kind === "owner" || w.kind === "login" || w.kind === "browser";

export function readWaits(env = process.env): Wait[] {
  if (!existsSync(waitsDir(env))) return [];
  const waits: Wait[] = [];
  for (const f of readdirSync(waitsDir(env)).sort()) {
    if (!f.endsWith(".json")) continue;
    try {
      waits.push(JSON.parse(readFileSync(join(waitsDir(env), f), "utf8")) as Wait);
    } catch {
      // a half-written file is read again next time
    }
  }
  return waits;
}

export function writeWait(w: Wait, env = process.env): void {
  mkdirSync(waitsDir(env), { recursive: true });
  writeAtomic(waitPath(w.task, env), `${JSON.stringify(w, null, 2)}\n`);
}

export const clearWait = (task: string, env = process.env) => rmSync(waitPath(task, env), { force: true });

const git = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], { stdin: "ignore", stderr: "ignore" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : undefined;
};

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** The task an agent's environment names, if it is an agent's. */
const agentTask = (env: typeof process.env): string | undefined => {
  const id = (env.LINECLEAR_TASK ?? (env.LINECLEAR_CHAT ?? env.SHEPHERDR_CHAT)?.split("/")[0]) || undefined;
  return id !== undefined && TASK_ID.test(id) ? id : undefined;
};

/** The task a worktree belongs to: from the environment, else from its branch `work/<n>-...` and the task list. */
export function findTask(cwd: string, env = process.env): string | undefined {
  const fromEnv = env.LINECLEAR_TASK ?? env.SHEPHERDR_CHAT?.split("/")[0];
  if (fromEnv && TASK_ID.test(fromEnv)) return fromEnv;
  const n = /^work\/(\d+)-/.exec(git(cwd, "rev-parse", "--abbrev-ref", "HEAD") ?? "")?.[1];
  if (n === undefined) return undefined;
  try {
    const p = Bun.spawnSync([serverBin(env), "task", "list", "--json"], { stdin: "ignore", stderr: "ignore", env });
    const tasks = JSON.parse(p.stdout.toString()) as { id?: string }[];
    return tasks.find((t) => t.id?.endsWith(`-${n}`))?.id;
  } catch {
    return undefined;
  }
}

/** The ids of the tasks in a space, as the rule loop sees them, or undefined when `shepherdr task list` cannot say. */
function taskIds(space: string, env = process.env): string[] | undefined {
  try {
    const p = Bun.spawnSync([serverBin(env), "task", "list", "--space", space, "--json"], { stdin: "ignore", stderr: "ignore" });
    if (p.exitCode !== 0) return undefined;
    return (JSON.parse(p.stdout.toString()) as { id?: string }[]).flatMap((t) => (t.id ? [t.id] : []));
  } catch {
    return undefined;
  }
}

/** The project whose repo holds this folder or worktree. */
export function findProject(cwd: string, env = process.env): string | undefined {
  const common = git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const roots = [common === undefined ? undefined : dirname(common), git(cwd, "rev-parse", "--show-toplevel")]
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

/**
 * What a command costs, in slots. A browser suite starts a browser per worker and loads the machine like several
 * suites, so it takes two slots; any other command takes one. A cost above the machine's slots takes them all.
 */
export function slotCost(command: string): number {
  return /playwright|ui:test|ui:record|test:e2e|\be2e\b|chromium|cypress|puppeteer/i.test(command) ? 2 : 1;
}

/** A command named on the command line that is quick: the types, or a few test files. It takes no turn and no slot. */
export function isCheap(command: string): boolean {
  return /^\s*(bun run types|bunx? tsc( --noEmit)?|bun test( [\w./-]+\.(ts|tsx|js|jsx)){1,5})\s*$/.test(command);
}

export interface CheckOptions {
  cwd?: string;
  pollMs?: number;
  /** A full check: one at a time in its repo's line, which merges wait in too, and holding a check slot while it runs. */
  full?: boolean;
  /** `lineclear check`, not `lineclear slot`: an agent's own check is refused while the merge lane is in the line. */
  checking?: boolean;
  /** A light run (the inner tier) waits for no turn and holds no slot. */
  noTurn?: boolean;
  /** Hears the command's output as it comes, which still goes to this process's own output too. */
  hear?: (text: string) => void;
  /** Hears how long the run waited for its turn and a slot, in ms, when it starts. */
  waited?: (ms: number) => void;
}

/** Copies a child's output to this process's own, and hands each piece to `hear` as text. */
async function tee(from: unknown, to: NodeJS.WriteStream, hear: (text: string) => void) {
  const text = new TextDecoder();
  for await (const chunk of from as AsyncIterable<Uint8Array>) {
    to.write(chunk);
    hear(text.decode(chunk, { stream: true }));
  }
}

/** An agent's own check meets the merge lane in the line: it is refused. */
function refuseForLane(): number {
  console.error("lineclear check: the merge lane runs the check; run the tests you changed");
  return 1;
}

/** What a run waiting for its turn says on its task's line. */
function waitReason(w: { full: boolean; noSlot: boolean; behindCheck: boolean; ahead: number; cost: number; slots: number; machine: string }): string {
  if (w.full && w.noSlot) return `waiting for a check slot on ${w.machine} (${w.slots} at once, shared by every repo on ${w.machine})`;
  if (w.full) return `waiting for the check slot on ${w.machine} (${w.ahead} ahead, one full check at a time)`;
  if (w.behindCheck) return `waiting for the full check in line on ${w.machine} to end (it goes first)`;
  return `waiting for ${w.cost > 1 ? `${Math.min(w.cost, w.slots)} check slots` : "a check slot"} on ${w.machine} (${w.slots} at once)`;
}

/** Runs the command in a process group of its own (the check's), its output on ours (and heard, when asked); `started` gets the process. */
async function runChild(command: string, cwd: string, hear: CheckOptions["hear"], started: (c: ReturnType<typeof Bun.spawn>) => void): Promise<number> {
  const io = hear ? "pipe" : "inherit";
  const child = Bun.spawn(["sh", "-c", command], { cwd, stdin: "ignore", stdout: io, stderr: io, detached: true });
  started(child);
  const watcher = guardGroup(child.pid, process.pid);
  try {
    if (!hear) return await child.exited;
    const [code] = await Promise.all([child.exited, tee(child.stdout, process.stdout, hear), tee(child.stderr, process.stderr, hear)]);
    return code;
  } finally {
    // nothing a check started outlives it
    killGroup(child.pid);
    killGroup(watcher);
  }
}

/**
 * Runs a shell command once its turn comes: a full check when the ones before it in its repo's line are done and a
 * check slot is free, any other heavy command when its repo has no check in line and a check slot is free. Two repos
 * never wait for each other's line. Waiting is a `checks` wait. The turn and slot are freed when the command ends or is
 * killed.
 */
async function runInSlot(command: string, name: string, env = process.env, o: CheckOptions = {}): Promise<number> {
  const cwd = o.cwd ?? process.cwd();
  const task = findTask(cwd, env);
  const slots = Q.machineLimits(env).slots;
  const cost = slotCost(command);
  const settings = readSettings(name, env);
  const line = Q.lineOf(typeof settings === "object" ? settings.repo : name, env);
  const turn = o.full ? Q.joinLine(task ?? name, line, env) : undefined;
  const watch = turn === undefined ? undefined : Q.watchProgress(turn, env);
  let slot: string[] | undefined;
  let noSlot = false; // a full check whose turn has come and no slot is free
  let releaseHeld = false; // a release check holds the machine's slots
  let behindCheck = false; // another heavy run waits for the full checks in line before it, even with a slot free
  // a full check: the checks before it in line, or 1 with no slot free; any other heavy command: 1 behind a full check or with no slot
  const arrived = Date.now();
  const checksBefore = () => Q.checkLine(line, env).filter((t) => t.since <= arrived).length;
  const before = () => {
    if ((releaseHeld = Q.releaseHolder(env) !== undefined)) return 1;
    if (turn !== undefined) {
      const n = Q.ahead(turn, env);
      if (n) return n;
      slot = Q.takeSlots(1, env, { yieldToLane: task !== undefined });
      noSlot = slot === undefined;
      if (!noSlot) Q.startTurn(turn, env);
      return noSlot ? 1 : 0;
    }
    behindCheck = checksBefore() > 0;
    if (behindCheck) return 1;
    slot = Q.takeSlots(cost, env, { yieldToLane: task !== undefined });
    if (slot === undefined) return 1;
    // a check from before this run joined the line meanwhile: it counted this slot as held, or this run lets go
    if (checksBefore() > 0) {
      for (const f of slot) rmSync(f, { force: true });
      slot = undefined;
      behindCheck = true;
      return 1;
    }
    return 0;
  };
  let mine = false;
  let said = "";
  const since = new Date().toISOString();
  // an agent's own wait (for the owner, say) is never written over
  const own = task !== undefined && existsSync(waitPath(task, env));
  const say = (n: number) => {
    if (task === undefined || own) return;
    const machine = Q.machineOf(env);
    const reason = releaseHeld
      ? `waiting for the release check on ${machine}`
      : waitReason({ full: turn !== undefined, noSlot, behindCheck, ahead: n, cost, slots, machine });
    if (mine && reason === said) return;
    writeWait({ task, project: name, kind: "checks", reason, since }, env);
    mine = true;
    said = reason;
  };
  let n = o.noTurn ? 0 : before();
  if (n > 0) say(n);
  const dropWait = () => {
    if (mine && task !== undefined) clearWait(task, env);
    mine = false;
  };
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const release = () => {
    for (const f of slot ?? []) rmSync(f, { force: true });
    watch?.stop();
    if (turn !== undefined) Q.leaveLine(turn, env);
    dropWait();
  };
  const onExit = () => {
    if (child !== undefined) killGroup(child.pid);
    release();
  };
  const killed = (code: number) => () => {
    onExit();
    process.exit(code);
  };
  const onInt = killed(130);
  const onTerm = killed(143);
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  process.once("exit", onExit);
  // an agent's own check never goes ahead of the merge lane
  const gives = () => o.checking === true && !o.noTurn && agentTask(env) !== undefined && Q.laneInLine(line, env);
  try {
    if (gives()) return refuseForLane();
    while (n > 0) {
      await Bun.sleep(o.pollMs ?? CHECK_POLL_MS);
      if (gives()) return refuseForLane();
      n = before();
      if (n > 0) say(n);
    }
    dropWait();
    o.waited?.(Date.now() - arrived);
    return await runChild(command, cwd, o.hear, (c) => {
      child = c;
      watch?.track(c.pid);
    });
  } finally {
    release();
    process.removeListener("exit", onExit);
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
  }
}

/** One `--changed` run, in the check log like every other. */
function changedRun(
  command: string,
  tier: Tier,
  settings: Settings,
  name: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  out: (l: string) => void,
  o: CheckOptions,
) {
  return checkTier(["--tier", tier, command], settings, out, env, cwd, (c, _t, hear, waited) =>
    runInSlot(c, name, env, { ...o, checking: true, hear, waited }),
  );
}

/**
 * `lineclear check [--tier inner|merge|nightly] [command]`: a tier's commands (the merge tier, the full check, when no
 * tier is named), or the command given, in its turn: one full check at a time. The inner tier waits for no turn.
 * `lineclear check --changed` is the worker's loop: the project's check told to look only at what the branch changed,
 * in an ordinary check slot, since it is short. The full check runs once, in the merge lane.
 */
export async function check(out: (l: string) => void, env = process.env, o: CheckOptions = {}, args: string[] = []): Promise<number> {
  const cwd = o.cwd ?? process.cwd();
  const name = findProject(cwd, env);
  const settings = name === undefined ? undefined : readSettings(name, env);
  if (name === undefined || typeof settings === "string" || settings === undefined) {
    out("lineclear check: this folder is not in a project, see 'lineclear project list'");
    return 1;
  }
  if (args.includes("--changed")) {
    const rest = args.filter((a) => a !== "--changed");
    if (rest.length > 1) return (out(usage("check")), 2);
    const command = rest[0];
    // only a check that is Lineclear's own script is known to take the flag; any other project's runs in full
    const script = join(cwd, "scripts/check.ts");
    if (!command && /\bbun run check\b/.test(settings.check) && existsSync(script) && readFileSync(script, "utf8").includes("--changed")) {
      return changedRun(`${settings.check} --changed`, "inner", settings, name, env, cwd, out, o);
    }
    out("lineclear check --changed: this project's check does not take --changed, so the full check runs");
    return changedRun(command ?? settings.check, "inner", settings, name, env, cwd, out, { ...o, full: true });
  }
  // only a command the caller named: the project's own tier commands keep their turn
  const cheap = (command: string) => args.includes(command) && isCheap(command);
  return checkTier(args, settings, out, env, cwd, (command, tier, hear, waited) =>
    runInSlot(command, name, env, {
      ...o,
      checking: true,
      full: tier !== "inner" && !cheap(command),
      noTurn: tier === "inner" || cheap(command),
      hear,
      waited,
    }),
  );
}

/** `lineclear slot <command>`: any heavy command, run in a check slot. */
async function slot(command: string, out: (l: string) => void, env = process.env, o: CheckOptions = {}): Promise<number> {
  const name = findProject(o.cwd ?? process.cwd(), env);
  if (name === undefined) {
    out("lineclear slot: this folder is not in a project, see 'lineclear project list'");
    return 1;
  }
  return runInSlot(command, name, env, o);
}

/** The heavy commands of the project that holds this folder, for the pi extension. */
function heavyCommands(cwd: string, env = process.env): string[] {
  const name = findProject(cwd, env);
  const s = name === undefined ? undefined : readSettings(name, env);
  // a project added before the list existed has none: what it would get today
  return typeof s === "object" ? (s.heavy ?? (s.repo ? detectHeavy(s.repo, s.check?.trim() ?? "") : [])).filter(Boolean) : [];
}

/** The check command of the project that holds this folder, for the pi extension. */
function projectCheck(cwd: string, env = process.env): string | undefined {
  const name = findProject(cwd, env);
  const s = name === undefined ? undefined : readSettings(name, env);
  return typeof s === "object" && s.check?.trim() ? s.check.trim() : undefined;
}

function usage(name: string): string {
  return {
    wait: 'usage: lineclear wait <login|checks|browser> "<reason>" | lineclear wait owner --kind <login|money|outward> "<reason>" | lineclear wait until <time> "<reason>" | lineclear wait task <id> "<reason>"',
    resume: "usage: lineclear resume",
    check: "usage: lineclear check [--changed] [--tier inner|merge|nightly] [command] | lineclear check --release <test> | lineclear check --log",
    slot: "usage: lineclear slot <command> | lineclear slot --list",
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
): Promise<number> {
  const fail = (message: string, code = 1) => {
    out(`lineclear ${name}: ${message}`);
    return code;
  };
  if (name === "slot") {
    if (args.length === 1 && args[0] === "--list") {
      out(JSON.stringify({ heavy: heavyCommands(cwd, env), check: projectCheck(cwd, env) }));
      return 0;
    }
    return args.length === 1 ? slot(args[0]!, out, env, { cwd }) : (out(usage(name)), 2);
  }
  if (name === "check") return check(out, env, { cwd }, args);
  const task = findTask(cwd, env);
  if (task === undefined) return fail("cannot tell which task this is, run it inside a task's worktree");
  const c: WaitCall = { name, task, project: findProject(cwd, env), since: now().toISOString(), out, env, now, fail };

  if (name === "resume") {
    if (args.length > 0) return (out(usage(name)), 2);
    if (!existsSync(waitPath(task, env))) return fail(`${task} has no wait`);
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
