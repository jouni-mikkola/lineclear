import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { hostname } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { allNeedCards } from "./asks.ts";
import { askKind } from "./cards.ts";
import { readJson } from "../pi/config.ts";
import { readTasksKept } from "./kept-read.ts";
import { dataDir } from "./paths.ts";
import { type Busy, oldDir, realBusy } from "./old-install.ts";
import { stallCards } from "./stalls.ts";
import { installMachine } from "./machines.ts";
import { readMachines } from "./machine-list.ts";
import { remoteLineclear } from "./ssh.ts";
import { linkHelper } from "./helper.ts";

type Env = Record<string, string | undefined>;
type Out = (line: string) => void;

/** Files of herdr-projects 2.0 that hold the spaces and their settings, copied whole. */
const SPACE_FILES = [
  "spaces.json",
  "settings.json",
  "order.json",
  "sections.json",
  "names.json",
  "modes.json",
  "agents.json",
  "repo-spaces.json",
  "automations.json",
  "cli-models.json",
  "retries.json",
  "vault.json",
];
const SPACE_DIRS = ["machines", "prompts", "hooks", "tasks"];
const MARK = "migrated.json";
/** What `--back` leaves in Lineclear's folder, so moving forward again merges instead of refusing. */
const BACK_MARK = "migrated.back.json";

/** Whether this folder already holds a copy of the old install. */
export const migrated = (to: string) => existsSync(join(to, MARK));

/** Brings the old install's settings files that Lineclear's folder lacks, such as the secrets of a copy made before they moved. */
export function fillMissingFiles(from: string, to: string): void {
  for (const f of SPACE_FILES) if (existsSync(join(from, f)) && !existsSync(join(to, f))) cpSync(join(from, f), join(to, f));
}

/** Everything a copy writes in Lineclear's folder, so a caller can put it back as it was. */
export const MIGRATE_WRITES = [
  ...SPACE_FILES,
  ...SPACE_DIRS,
  "tasks.json",
  "tasks-cold.jsonl",
  "artifacts.json",
  "artifacts",
  "chatlog",
  "heartbeat",
  "helper",
  MARK,
  BACK_MARK,
];

/** What a migration copies, read from the old folder only. */
interface Plan {
  files: string[];
  tasks: any[];
  next: Record<string, number>;
  red: Record<string, string>;
  /** Every file in chatlog/: task chats (`DEM-2_Agent.json`) and space chats (`p_host_demo.json`). */
  chats: string[];
  artifacts: string[];
  /** Every file in heartbeat/: each space's HEARTBEAT.md, kept as text beside the space. */
  heartbeats: string[];
}

/** Every file under `dir`, as paths relative to it. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true, withFileTypes: true }) as any[])
    .filter((e) => !e.isDirectory())
    .map((e) => relative(dir, join(e.parentPath ?? e.path, e.name)))
    .sort();
}

const TASK_CHAT = /^([A-Za-z0-9]+)-\d+_/;

function planMigration(from: string): Plan {
  const file = readTasksKept(from);
  const tasks: any[] = Array.isArray(file.tasks) ? file.tasks : [];
  const artifactList: Record<string, any> = readJson(join(from, "artifacts.json")) ?? {};
  return {
    files: SPACE_FILES.filter((f) => existsSync(join(from, f))),
    tasks,
    next: file.next ?? {},
    red: file.red ?? {},
    chats: filesUnder(join(from, "chatlog")),
    artifacts: Object.keys(artifactList),
    heartbeats: filesUnder(join(from, "heartbeat")),
  };
}

/** The counts a move reports, per kind and per space, from the old folder. */
function countPlan(plan: Plan, from: string) {
  const spaces: any[] = readJson(join(from, "spaces.json")) ?? [];
  const byKey = new Map<string, string>(spaces.map((s) => [String(s.key), String(s.name)]));
  const list: Record<string, any> = readJson(join(from, "artifacts.json")) ?? {};
  const per = new Map<string, { tasks: number; taskChats: number; spaceChats: number; artifacts: number; heartbeats: number }>();
  const of = (name: string) => {
    if (!per.has(name)) per.set(name, { tasks: 0, taskChats: 0, spaceChats: 0, artifacts: 0, heartbeats: 0 });
    return per.get(name)!;
  };
  for (const s of spaces) of(String(s.name));
  // `p:host:space`, as `p_host_space` in chat files and `p-host-space` in heartbeat files; empty space for the machine's home.
  // The hosts are known from the artifacts' places, the machines folder and this machine, so a dash in a host name is no trouble.
  const hosts = new Set<string>([
    hostname(),
    ...(existsSync(join(from, "machines")) ? readdirSync(join(from, "machines"), { withFileTypes: true }) : [])
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  ]);
  for (const id of plan.artifacts) {
    const host = String(list[id]?.place ?? "").split(":")[1];
    if (host) hosts.add(host);
  }
  const sorted = [...hosts].sort((a, b) => b.length - a.length);
  const spaceOf = (stem: string) => {
    const bare = stem.replace(/\.[^.]+$/, "");
    for (const h of sorted) {
      const m = new RegExp(`^p[_-]${h.replace(/[^A-Za-z0-9]/g, "[^A-Za-z0-9]")}[_-]`).exec(bare);
      if (m) return bare.slice(m[0].length) || "(home)";
    }
    return bare.replace(/^p[:_-][^:_-]*[:_-]/, "") || "(home)";
  };
  for (const t of plan.tasks) of(byKey.get(String(t.id).replace(/-\d+$/, "")) ?? "(other)").tasks++;
  let taskChats = 0;
  let spaceChats = 0;
  for (const c of plan.chats) {
    const m = TASK_CHAT.exec(basename(c));
    if (m) taskChats++, of(byKey.get(m[1]!) ?? "(other)").taskChats++;
    else spaceChats++, of(spaceOf(basename(c))).spaceChats++;
  }
  let versions = 0;
  for (const id of plan.artifacts) {
    versions += (list[id]?.versions ?? []).length;
    of(
      String(list[id]?.place ?? "")
        .split(":")
        .slice(2)
        .join(":") || "(home)",
    ).artifacts++;
  }
  for (const h of plan.heartbeats) of(spaceOf(basename(h))).heartbeats++;
  const artifactFiles = filesUnder(join(from, "artifacts")).length;
  const machineFiles = filesUnder(join(from, "machines")).length;
  return { taskChats, spaceChats, versions, artifactFiles, machineFiles, per };
}

function describe(plan: Plan, from: string, to: string, out: Out): void {
  const spaces: any[] = readJson(join(from, "spaces.json")) ?? [];
  const c = countPlan(plan, from);
  const open = plan.tasks.filter((t) => t?.told !== "done");
  out(`From ${from} to ${to}`);
  out(`${spaces.length} spaces, with their settings: ${spaces.map((s) => s.name).join(", ") || "none"}`);
  out(`${plan.tasks.length} tasks, ${open.length} open: ${open.map((t) => t.id).join(", ") || "none"}`);
  out(`${c.taskChats} task chats, ${c.spaceChats} space chats`);
  out(`${plan.artifacts.length} artifacts, ${c.versions} versions, ${c.artifactFiles} files`);
  out(`${plan.heartbeats.length} HEARTBEAT.md files (kept as text; no coordinator timer), ${c.machineFiles} machine files`);
  for (const [name, n] of c.per)
    out(`  ${name}: ${n.tasks} tasks, ${n.taskChats} task chats, ${n.spaceChats} space chats, ${n.artifacts} artifacts, ${n.heartbeats} heartbeats`);
  out(`Files: ${[...plan.files, "tasks.json"].join(", ")}`);
  out(`Folders: ${SPACE_DIRS.filter((d) => existsSync(join(from, d))).join(", ") || "none"}`);
}

/**
 * Copies the plan into `to`. Reads `from`; only a move back also changes its marks. What `to` already holds stays: tasks and artifacts join by
 * id (`from` wins on the same id), chat files and settings files are replaced by `from`'s. Moving to Lineclear turns
 * every space on a coordinator timer to regular: nothing wakes a coordinator on a timer.
 */
function migrate(from: string, to: string, plan: Plan, now = Date.now(), forward = true): void {
  mkdirSync(to, { recursive: true });
  for (const f of plan.files) cpSync(join(from, f), join(to, f));
  for (const d of SPACE_DIRS) if (existsSync(join(from, d))) cpSync(join(from, d), join(to, d), { recursive: true });
  if (forward && existsSync(join(to, "modes.json"))) {
    const modes: Record<string, string> = readJson(join(to, "modes.json")) ?? {};
    for (const id of Object.keys(modes)) if (modes[id] === "autopilot") modes[id] = "regular";
    writeAtomic(join(to, "modes.json"), JSON.stringify(modes, null, 2));
  }
  mkdirSync(join(to, "chatlog"), { recursive: true });
  for (const f of plan.chats) mkdirSync(dirname(join(to, "chatlog", f)), { recursive: true }), cpSync(join(from, "chatlog", f), join(to, "chatlog", f));
  if (plan.heartbeats.length) mkdirSync(join(to, "heartbeat"), { recursive: true });
  for (const f of plan.heartbeats) cpSync(join(from, "heartbeat", f), join(to, "heartbeat", f));
  joinArtifacts(from, to, plan);
  joinTasks(to, plan);
  const mark = (dir: string, name: string, other: object) =>
    writeAtomic(join(dir, name), JSON.stringify({ at: now, ...other, tasks: plan.tasks.length }, null, 2));
  if (forward) {
    rmSync(join(to, BACK_MARK), { force: true });
    mark(to, MARK, { from });
  } else {
    rmSync(join(from, MARK), { force: true });
    mark(from, BACK_MARK, { to });
  }
}

/** Artifacts join by id, with every file under artifacts/ (versions, html, thumbnails, folders artifacts.json does not list). */
function joinArtifacts(from: string, to: string, plan: Plan): void {
  const all: Record<string, any> = readJson(join(from, "artifacts.json")) ?? {};
  const kept: Record<string, any> = readJson(join(to, "artifacts.json")) ?? {};
  for (const id of plan.artifacts) {
    kept[id] = all[id];
  }
  if (existsSync(join(from, "artifacts"))) cpSync(join(from, "artifacts"), join(to, "artifacts"), { recursive: true });
  writeAtomic(join(to, "artifacts.json"), JSON.stringify(kept, null, 2));
}

/** Tasks join by id (the plan wins), counters keep the larger number. */
function joinTasks(to: string, plan: Plan): void {
  const there = readTasksKept(to);
  const joined = new Map<string, any>((Array.isArray(there.tasks) ? there.tasks : []).map((t: any) => [String(t.id), t]));
  for (const t of plan.tasks) joined.set(String(t.id), t);
  const next: Record<string, number> = { ...(there.next ?? {}) };
  for (const [k, n] of Object.entries(plan.next)) next[k] = Math.max(next[k] ?? 0, n);
  writeAtomic(join(to, "tasks.json"), JSON.stringify({ next, tasks: [...joined.values()], red: { ...(there.red ?? {}), ...plan.red } }, null, 2));
  // every task is in tasks.json now: the server moves the old ones to its append log again
  rmSync(join(to, "tasks-cold.jsonl"), { force: true });
}

/** The cards in a window, over every chat in a folder: needs-you asks, stall cards and main-red cards. */
function cardCounts(dir: string, from: number, to: number): { needsYou: number; stalls: number; mainRed: number } {
  const log = join(dir, "chatlog");
  const files = existsSync(log)
    ? readdirSync(log)
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJson(join(log, f)))
        .filter(Boolean)
    : [];
  const inside = (at: number) => at >= from && at < to;
  const red = new Set<string>();
  for (const f of files) for (const p of f.posted ?? []) if (p?.card?.red !== undefined && inside(p.at)) red.add(String(p.card.id ?? p.id));
  return {
    needsYou: allNeedCards(files).filter((c) => inside(c.at) && askKind(c.card) !== "report").length,
    stalls: stallCards(files).filter((c) => inside(c.at)).length,
    mainRed: red.size,
  };
}

/** The fork's run since the move against herdr-projects 2.0's span of the same length before it. Returns the exit code. */
function check(from: string, to: string, out: Out, now: number): number {
  const mark = readJson(join(to, MARK));
  if (!mark) return (out(`lineclear migrate: nothing migrated yet, no ${join(to, MARK)}`), 1);
  const at: number = mark.at;
  const span = Math.max(now - at, 1);
  const before = cardCounts(from, at - span, at);
  const after = cardCounts(to, at, now + 1);
  let worse = 0;
  for (const k of ["mainRed", "needsYou", "stalls"] as const) {
    const bad = after[k] > before[k];
    if (bad) worse++;
    out(`${bad ? "MORE  " : "ok    "} ${k}: ${before[k]} before on the old install, ${after[k]} on Lineclear`);
  }
  out(
    worse === 0
      ? "Lineclear added no card beyond the old install. Stop the old install: herdr plugin disable herdr-projects"
      : "Lineclear had more cards than the old install. Do not retire the old install yet.",
  );
  return worse === 0 ? 0 : 1;
}

/** `lineclear migrate --back`: every task, chat, artifact and setting of Lineclear's folder joins herdr-projects 2.0's. */
function back(from: string, to: string, out: Out, now: number): number {
  if (!existsSync(join(to, "spaces.json")) && !existsSync(join(to, "tasks.json")))
    return (out(`lineclear migrate: nothing to move back, ${to} holds no spaces or tasks`), 1);
  const plan = planMigration(to);
  describe(plan, to, from, out);
  // the settings files it replaces are kept in one folder first
  const kept = join(from, `before-back-${now}`);
  for (const f of plan.files) if (existsSync(join(from, f))) mkdirSync(kept, { recursive: true }), cpSync(join(from, f), join(kept, f));
  migrate(to, from, plan, now, false);
  if (existsSync(kept)) out(`The settings it replaced are kept in ${kept}`);
  out(`Copied back. Your work in ${to} stays there too, so 'lineclear migrate' moves forward again without losing what was done in either place.`);
  out("Before moving forward again, stop Lineclear's server: it saves from memory.");
  out(
    "Then start the old install: herdr plugin enable herdr-projects, or if 'lineclear doctor --fix' removed it, herdr plugin install github:eliasstravik/herdr-projects --yes.",
  );
  return 0;
}

function backMain(from: string, to: string, out: Out, env: Env, now: number, busy: Busy): number {
  if (!existsSync(join(to, MARK)))
    return (out(`lineclear migrate: this machine has not moved to Lineclear (no ${join(to, MARK)}), so there is nothing to move back`), 1);
  if (busy("old", env))
    return (
      out("lineclear migrate: the old install is running, and would save over what is copied back. Stop it first: herdr plugin disable herdr-projects"), 1
    );
  if (busy("lineclear", env))
    return (
      out(
        "lineclear migrate: Lineclear is running, and work done in it after the copy would be missed. Stop its server (the lineclear serve process in server.json) first",
      ),
      1
    );
  return back(from, to, out, now);
}

export function migrateMain(args: string[], out: Out, env: Env = process.env, now = Date.now(), busy: Busy = realBusy): number {
  const flags = args.filter((a) => a.startsWith("--"));
  if (args.length !== flags.length || flags.length > 1 || (flags[0] !== undefined && !["--dry-run", "--check", "--back", "--link-helper"].includes(flags[0]))) {
    out("usage: lineclear migrate [--dry-run | --check | --back | --link-helper]");
    return 2;
  }
  const from = oldDir(env);
  const to = dataDir(env);
  if (flags[0] === "--check") return check(from, to, out, now);
  if (flags[0] === "--link-helper")
    return (out(linkHelper(env) ? "Linked the old helper socket to the new one." : "The helper sockets already agree, or this machine has not moved."), 0);
  if (flags[0] === "--back") return backMain(from, to, out, env, now, busy);
  if (!existsSync(join(from, "spaces.json"))) {
    // a machine that holds only the helper: nothing to copy, and its agents still need the socket link (migrate --all makes it)
    if (existsSync(join(from, "helper"))) return (out(`Nothing to copy: ${from} holds only the helper.`), 0);
    return (out(`lineclear migrate: no old install data in ${from}`), 1);
  }
  const plan = planMigration(from);
  describe(plan, from, to, out);
  if (flags[0] === "--dry-run") return (out("Dry run: nothing copied."), 0);
  if (existsSync(join(to, MARK)) || (!existsSync(join(to, BACK_MARK)) && (existsSync(join(to, "tasks.json")) || existsSync(join(to, "spaces.json"))))) {
    out(`lineclear migrate: ${to} already has spaces or tasks, so nothing was copied. Move it away to migrate again.`);
    return 1;
  }
  if (busy("old", env)) {
    out(
      "lineclear migrate: the old install is running, and what its tasks and agents save after the copy would be missed. Stop its server first (herdr plugin disable herdr-projects); agents keep running, and a command of theirs that fails meanwhile works once 'lineclear serve' is up on the same port.",
    );
    return 1;
  }
  if (existsSync(join(to, BACK_MARK)) && busy("lineclear", env)) {
    out("lineclear migrate: Lineclear is running, and would save over what is copied. Stop its server (the lineclear serve process in server.json) first");
    return 1;
  }
  migrate(from, to, plan, now);
  // agents started under herdr-projects 2.0 keep the old socket path in their command
  linkHelper(env);
  sayCopied(from, out);
  return 0;
}

function sayCopied(from: string, out: Out): void {
  out(`Copied. ${from} is unchanged, so the old install can start again.`);
  const port = readJson(join(from, "server.json"))?.port;
  const on = typeof port === "number" ? ` --port ${port}` : "";
  out("Stop the old install first: two servers cannot share a port, and both save from memory.");
  out(
    `Then start Lineclear with 'lineclear serve${on}'.${on ? " A task that was running keeps its agent's command pointed at that port, so its ready and merge reach Lineclear." : ""}`,
  );
  out("After a run on Lineclear, 'lineclear migrate --check' says whether to retire the old install.");
}

/**
 * `lineclear migrate --all [--dry-run]`: the move on this machine, then on each machine added in Settings, over SSH.
 * A machine that has no Lineclear gets it first. Returns 0 only when every machine moved (or, dry, was listed).
 */
export async function migrateAll(args: string[], out: Out, env: Env = process.env): Promise<number> {
  const rest = args.filter((a) => a !== "--all");
  if (rest.length > 1 || (rest[0] !== undefined && rest[0] !== "--dry-run" && rest[0] !== "--back"))
    return (out("usage: lineclear migrate --all [--dry-run | --back]"), 2);
  const dry = rest[0] === "--dry-run";
  const hosts = readMachines(env).map((m) => m.host);
  let bad = 0;
  out(`This machine${dry ? " (dry run)" : ""}`);
  if (migrateMain(rest, (l) => out(`  ${l}`), env) !== 0) bad++;
  for (const host of hosts) {
    out(`${host}${dry ? " (dry run)" : ""}`);
    if (!(await migrateHost(host, rest, dry, out, env))) bad++;
  }
  out(
    bad === 0
      ? `${dry ? "Listed" : "Moved"}: ${1 + hosts.length} ${1 + hosts.length === 1 ? "machine" : "machines"}.`
      : `${bad} of ${1 + hosts.length} machines did not move.`,
  );
  return bad === 0 ? 0 : 1;
}

/** One added machine: install Lineclear if it has none, then migrate there. False when it did not move. */
async function migrateHost(host: string, rest: string[], dry: boolean, out: Out, env: Env): Promise<boolean> {
  const has = await remoteLineclear(host, ["export"], env, 30_000);
  if (has.code === 255) {
    out("  SSH could not reach it.");
    return false;
  }
  if (has.code !== 0) {
    if (dry) {
      out("  Lineclear is not installed there, or does not answer: a real run installs it first.");
      return true;
    }
    out("  Installing Lineclear first");
    const m = await installMachine(host, env, (l) => out(`  ${l}`));
    if (m.state !== "ready") {
      out(`  ${host} is not ready: ${m.doctor?.[0] ?? "doctor failed"}`);
      return false;
    }
  }
  const r = await remoteLineclear(host, ["migrate", ...rest], env, 10 * 60_000);
  for (const l of r.lines) out(`  ${l}`);
  // a machine that holds only the helper (its data lives elsewhere) has nothing to migrate but its agents still need the socket
  if (!dry && rest[0] !== "--back") for (const l of (await remoteLineclear(host, ["migrate", "--link-helper"], env)).lines) out(`  ${l}`);
  return r.code === 0;
}
