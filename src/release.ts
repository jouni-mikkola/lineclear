// Stable and next: the service runs stable, the last build that proved itself. Next is main. The rule
// loop runs `lineclear release run` every few minutes: it builds next in a folder of its own, runs its smoke check and
// canary on spare ports, reads next's files with stable's code, and installs next as stable when all pass (install.sh,
// which restarts, checks and rolls back, then updates the other machines). Else stable stays and one fix task is filed.
import { KEPT_ENV } from "./herdr.ts";
import { rollbackMain } from "./rollback.ts";
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, readJson } from "../pi/config.ts";
import { dataDir, lockFile, pathsFor, serverBin } from "./paths.ts";
import { forgetTaskReads, readTasks } from "./task-read.ts";
import { listProjectNames, readSettings } from "./project.ts";
import { cacheDir, diskTmpRoot } from "./tmpdirs.ts";
import { tryLines, tryMain } from "./try-instance.ts";

type Env = Record<string, string | undefined>;

interface Build {
  commit: string;
  at: string;
}

/** `<config>/release.json`. */
export interface ReleaseState {
  /** The build the service runs, and since when. */
  stable?: Build;
  /** Main's last commit and how its test went. */
  next?: Build & { result: "waiting" | "testing" | "green" | "red"; why?: string };
  /** The last promotion: from which build to which. */
  promoted?: Build & { from: string };
  /** Why next is not stable, when it is not. */
  held?: string;
  /** The red commit a fix task was filed for, so it is filed once. */
  filed?: string;
  /** When main was last looked at. */
  checked?: string;
  /** The last candidate checked on its own (`lineclear release check <version>`). */
  candidate?: CandidateResult;
  /** The candidate version the rule loop started a promotion of, so it starts one once. */
  promoteTried?: string;
}

/** The state file as the release run writes it: the last test runs of main, newest last, beside the state. */
type Stored = ReleaseState & { runs?: Run[] };

/** One test run: of which commit, when it started, how long to its verdict, and the verdict ("held" names why). */
interface Run {
  commit: string;
  at: string;
  minutes: number;
  verdict: "green" | "held";
  why?: string;
}

export interface CandidateCheck {
  name: string;
  outcome: "passed" | "failed" | "skipped";
  why?: string;
}

/** A candidate release and how each of its checks went; ready only when all passed. */
export interface CandidateResult {
  version: string;
  commit: string;
  at: string;
  result: "checking" | "ready" | "failed";
  checks: CandidateCheck[];
  /** The commit a fix task was filed for, so it is filed once. */
  filed?: string;
}

/** What a run needs from the world; the tests give their own. */
export interface ReleaseDeps {
  stable(): string;
  /** Main's newest commit, fetched. */
  head(): string;
  /** Builds and tests `commit`; returns why it failed, or "". GitHub's check unfinished is `CHECK_PENDING`, not a failure. */
  test(commit: string): string;
  /** Installs `commit` as stable; returns why that failed (and was rolled back), or "". */
  promote(commit: string): string;
  /** Files a fix task; returns why it could not, or "". */
  fileTask(title: string, brief: string): string;
  /** The id of a "Fix next" task of the project that is not done, if any. */
  openFix(): string | undefined;
  /** Tells a task something; returns why it could not, or "". */
  tell(task: string, message: string): string;
}

export const PROMOTE_EVERY_MS = 30 * 60_000;
const CHECK_EVERY_MS = 2 * 60_000;
// longer than the longest run: five builds, the canary, the format checks and install.sh, each under its own timeout
const STALE_LOCK_MS = 4 * 60 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

const stateFile = (env: Env) => join(configDir(env), "release.json");
const startedFile = (env: Env) => join(configDir(env), "release-started.json");
const nextDir = (env: Env) => join(cacheDir(env), "next");
/** Written by install.sh on a machine another one installs: it takes that machine's stable build and promotes none. */
const followsFile = (env: Env) => join(configDir(env), "release-follows");

export function follows(env: Env = process.env): string | undefined {
  try {
    return readFileSync(followsFile(env), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
const short = (c?: string) => (c ?? "").slice(0, 7);
const clock = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export function readRelease(env: Env = process.env): ReleaseState {
  return (readJson(stateFile(env)) as ReleaseState | undefined) ?? {};
}

export function saveRelease(s: ReleaseState, env: Env) {
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(stateFile(env), `${JSON.stringify(s, null, 2)}\n`);
}

/** One pass: look at main, and test and promote it when it is due. Saves the state as it goes. */
export function releaseStep(deps: ReleaseDeps, env: Env = process.env, now = new Date(), again = false): Stored {
  const s: Stored = readRelease(env);
  const at = now.toISOString();
  const stable = deps.stable();
  if (s.stable?.commit !== stable) s.stable = { commit: stable, at };
  s.checked = at;
  let head: string;
  try {
    head = deps.head();
  } catch (e) {
    s.held = `cannot read main: ${(e as Error).message}`;
    if (again) noteRun(s, { commit: "", at, verdict: "held", why: s.held }, now);
    saveRelease(s, env);
    return s;
  }
  if (again) {
    // a second test of the same commit: nothing reused, nothing promoted, no fix task
    s.next = { commit: head, at, result: "testing" };
    s.held = `testing ${short(head)}`;
    saveRelease(s, env);
    const why = deps.test(head);
    s.next = { commit: head, at, result: why ? "red" : "green", ...(why ? { why } : {}) };
    s.held = why ? `next ${short(head)} failed: ${why}` : undefined;
    noteRun(s, { commit: head, at, verdict: why ? "held" : "green", why: why || undefined }, now);
  } else if (head === stable) {
    s.next = { commit: head, at: s.next?.commit === head ? s.next.at : at, result: "green" };
    s.held = undefined;
  } else if (s.next?.commit === head && s.next.result === "red") {
    // tested and held already: main must move on first
  } else if (s.promoted && now.getTime() - Date.parse(s.promoted.at) < PROMOTE_EVERY_MS) {
    s.next = { commit: head, at: s.next?.commit === head ? s.next.at : at, result: "waiting" };
    s.held = `one promotion per 30 min: the next at ${clock(new Date(Date.parse(s.promoted.at) + PROMOTE_EVERY_MS).toISOString())} UTC`;
  } else {
    s.next = { commit: head, at, result: "testing" };
    s.held = `testing ${short(head)}`;
    saveRelease(s, env);
    const tested = deps.test(head);
    if (tested.startsWith(CHECK_PENDING)) {
      s.next = { commit: head, at, result: "waiting" };
      s.held = tested;
      saveRelease(s, env);
      return s;
    }
    const failed = tested || promoteOrWhy(deps, head);
    noteRun(s, { commit: head, at, verdict: failed ? "held" : "green", why: failed || undefined }, now);
    if (failed) red(s, deps, head, stable, failed);
    else {
      s.promoted = { commit: head, at, from: stable };
      s.stable = { commit: head, at: s.promoted.at };
      s.next = { commit: head, at, result: "green" };
      s.held = undefined;
    }
  }
  saveRelease(s, env);
  return s;
}

/** Adds a run to the history (the last 20), with the minutes from its start `started` to the verdict. */
function noteRun(s: Stored, r: Omit<Run, "minutes">, started: Date) {
  const minutes = Math.max(0, Math.round((Date.now() - started.getTime()) / 60_000));
  s.runs = [...(s.runs ?? []), { ...r, minutes }].slice(-20);
}

function promoteOrWhy(deps: ReleaseDeps, head: string): string {
  const why = deps.promote(head);
  return why ? `the promotion was rolled back: ${why}` : "";
}

function red(s: ReleaseState, deps: ReleaseDeps, head: string, stable: string, why: string) {
  s.next = { ...(s.next as Build), result: "red", why };
  s.held = `next ${short(head)} failed: ${why}`;
  if (s.filed === head) return;
  // one fix task at a time: a newer red main goes to the open one as a message
  const open = deps.openFix();
  if (open) {
    const err = deps.tell(open, `Main moved on and is red at ${head}, stable is ${short(stable)}. Fix this one too:\n\n${why.slice(0, 5000)}`);
    if (err) s.held += ` (could not tell ${open}: ${err})`;
    else s.filed = head;
    return;
  }
  const brief = [
    `Main at ${head} did not pass the release test, so the service stays on stable ${short(stable)}:`,
    "",
    why.slice(0, 5000),
    "",
    "Fix main so it passes: `bun scripts/canary.ts` (smoke and canary on next) and `bun scripts/formats.ts` run by stable.",
    "`lineclear release` shows the state. Once main is fixed, the next run promotes it.",
  ].join("\n");
  const err = deps.fileTask(`Fix next ${short(head)}`, brief);
  if (err) s.held += ` (no fix task: ${err})`;
  else s.filed = head;
}

export function run(cmd: string[], cwd: string, env: Env, timeoutMs = 20 * 60_000): { ok: boolean; out: string } {
  const r = spawnSync(cmd[0] as string, cmd.slice(1), {
    cwd,
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Checks `commit` out in `dir` and installs its packages. */
export const checkoutSteps = (dir: string, commit: string): [string, string[], string][] => [
  ["checkout", ["git", "checkout", "-q", "-f", "--detach", commit], dir],
  ["install", ["bun", "install", "--frozen-lockfile", "--silent"], dir],
  ["server install", ["bun", "install", "--frozen-lockfile", "--silent"], join(dir, "server")],
];

/** Runs the named commands in order; returns the first that failed with its output, or "". */
export function runSteps(steps: [string, string[], string][], env: Env): string {
  for (const [name, cmd, cwd] of steps) {
    const r = run(cmd, cwd, env);
    if (!r.ok) return `${name}: ${tail(r.out)}`;
  }
  return "";
}

export const tail = (out: string) => out.split("\n").slice(-6).join("; ").slice(-600);

/** Sets the clone's origin to the app's when they differ (and says so on stderr), so a renamed repository is not fetched under its old name. */
export function pointOriginAt(dir: string, url: string, env: Env): void {
  if (!url || /\s/.test(url)) throw new Error(`the app has no origin: ${tail(url)}`);
  if (run(["git", "-C", dir, "config", "remote.origin.url"], dir, env).out === url) return;
  run(["git", "-C", dir, "config", "remote.origin.url", url], dir, env);
  process.stderr.write(`lineclear release: the clone's origin is now ${url}\n`);
}

/** The real world: the installed app is stable, a clone in the cache is next. */
function realDeps(env: Env = process.env): ReleaseDeps {
  const app = pathsFor(env).app;
  const dir = nextDir(env);
  const origin = () => run(["git", "-C", app, "remote", "get-url", "origin"], app, env).out;
  return {
    stable: () => run(["git", "-C", app, "rev-parse", "HEAD"], app, env).out,
    head() {
      run(["git", "init", "-q", dir], app, env);
      pointOriginAt(dir, origin(), env);
      const f = run(["git", "fetch", "-q", "origin", "main"], dir, env, 120_000);
      if (!f.ok) throw new Error(tail(f.out));
      return run(["git", "rev-parse", "FETCH_HEAD"], dir, env).out;
    },
    test: (commit) => testNext(app, dir, commit, env),
    promote(commit) {
      const r = run(["sh", join(dir, "install.sh")], dir, { ...env, LINECLEAR_REF: commit, LINECLEAR_REPO: origin() }, 30 * 60_000);
      const now = run(["git", "-C", app, "rev-parse", "HEAD"], app, env).out;
      return r.ok && now === commit ? "" : tail(r.out) || "install.sh failed";
    },
    ...fixTaskTools(origin, dir, "Fix next", env),
  };
}

/** Files, finds and tells the "Fix ..." tasks of the project whose repository is Lineclear's own. */
export function fixTaskTools(origin: () => string, dir: string, prefix: string, env: Env): Pick<ReleaseDeps, "openFix" | "tell" | "fileTask"> {
  return {
    openFix() {
      const space = ownSpace(origin(), env);
      if (!space) return undefined;
      const r = readTasks(env, space);
      return "tasks" in r ? r.tasks.find((x) => x.title.startsWith(prefix) && x.status !== "done" && x.status !== "closed")?.id : undefined;
    },
    tell(task, message) {
      forgetTaskReads();
      const r = run([serverBin(env), "task", "tell", task, message], dir, env, 60_000);
      return r.ok ? "" : tail(r.out);
    },
    fileTask(title, brief) {
      const space = ownSpace(origin(), env);
      if (!space) return "no project on this machine has Lineclear's repository";
      forgetTaskReads();
      const r = run([serverBin(env), "task", "add", title, "--brief", brief, "--space", space], dir, env, 60_000);
      return r.ok ? "" : tail(r.out);
    },
  };
}

/**
 * What a red full check names: each failing test as `<file> > <test>: <first error line>` (scripts/check.ts prints up to
 * 20 under `check: failing tests:`, then how many more), and each failed step with its last error line. Never an empty list.
 */
export function fullCheckWhy(out: string): string {
  const lines = out.split("\n");
  // each test shard prints its own block
  const tests: string[] = [];
  let more = 0;
  lines.forEach((l, i) => {
    if (l !== "check: failing tests:") return;
    for (const t of lines.slice(i + 1)) {
      if (!t.startsWith("  ")) break;
      const rest = /^\s+and (\d+) more$/.exec(t);
      if (rest) more += Number(rest[1]);
      else tests.push(t.trim());
    }
  });
  const parts: string[] = [];
  if (tests.length > 0) {
    const left = Math.max(0, tests.length - 20) + more;
    parts.push(`failing tests: ${tests.slice(0, 20).join("; ")}${left > 0 ? `; and ${left} more` : ""}`);
  }
  for (const l of lines) if (/^check: .+ failed: /.test(l) || l.startsWith("check: too slow")) parts.push(l.slice(7));
  return parts.join("; ") || lines.filter((l) => l.startsWith("check:")).join("; ") || tail(out);
}

const CHECK_PENDING = "GitHub check: not finished";

/** What GitHub's "check" says of `commit` (`gh api`, from the clone's origin): "" when it passed, else why not. */
export function githubCheck(commit: string, dir: string, env: Env): string {
  const r = run(
    [
      "gh",
      "api",
      `repos/{owner}/{repo}/commits/${commit}/check-runs`,
      "--jq",
      '[.check_runs[] | select(.name == "check") | (.conclusion // "pending")] | join(",")',
    ],
    dir,
    env,
    60_000,
  );
  if (!r.ok) return `GitHub check: cannot read it: ${tail(r.out)}`;
  const states = r.out.split(",").filter(Boolean);
  if (states.length === 0 || states.includes("pending")) return `${CHECK_PENDING} at ${commit.slice(0, 7)}`;
  if (states.every((c) => c === "success")) return "";
  const named = fullCheckWhy(bareLog(failedLog(commit, dir, env)));
  return `GitHub check: ${states.join(",")} at ${commit.slice(0, 7)}${named ? `: ${named}` : ""}`;
}

/** A GitHub log line without the job, step and time GitHub puts before it. */
const bareLog = (log: string) => log.replace(/^[^\t\n]*\t[^\t\n]*\t\S+ /gm, "").replace(/^\d{4}-\S+Z /gm, "");

/** The failed steps' log of the newest failed run on `commit`; "" when GitHub does not give it. */
function failedLog(commit: string, dir: string, env: Env): string {
  const list = run(
    ["gh", "run", "list", "--commit", commit, "--status", "failure", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"],
    dir,
    env,
    60_000,
  );
  if (!list.ok || !/^\d+$/.test(list.out)) return "";
  const log = run(["gh", "run", "view", list.out, "--log-failed"], dir, env, 60_000);
  return log.ok ? log.out : "";
}

/** Builds next at `commit` and runs its smoke check and canary, then stable's format check on what next wrote. */
function testNext(app: string, dir: string, commit: string, env: Env): string {
  const steps: [string, string[], string][] = [
    ...checkoutSteps(dir, commit),
    ["web build", ["bun", "run", "web:build"], dir],
    ["server build", ["bun", "run", "build"], join(dir, "server")],
  ];
  // install.sh copies next's build only when this marker names its commit, so a failed build is never reused
  const built = join(dir, ".lineclear-built");
  rmSync(built, { force: true });
  const broke = runSteps(steps, env);
  if (broke) return broke;
  writeAtomic(built, `${commit}\n`);
  // Checks are light and run on GitHub, never here: next goes out when the merged commit's GitHub check is green.
  const github = githubCheck(commit, dir, env);
  if (github) return github;
  const store = mkdtempSync(join(diskTmpRoot(env), "release-store-"));
  try {
    const canary = run(["bun", join(dir, "scripts", "canary.ts"), "--keep", store], dir, env);
    if (!canary.ok) return canary.out.split("\n").find((l) => l.startsWith("fail ")) ?? `canary: ${tail(canary.out)}`;
    return formatsOf(app, dir, store, env) || nextReadsStable(dir, env);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
}

/** Next reads the store stable wrote on this machine, the one it takes over (its format check reads a copy). */
export function nextReadsStable(nextTree: string, env: Env): string {
  const r = run(["bun", join(nextTree, "scripts", "formats.ts"), nextTree, dataDir(env), "--older"], nextTree, env, 120_000);
  return r.ok ? "" : `next cannot read this machine's store: ${tail(r.out)}`;
}

/** Stable reads next's roadmap and store files: with its own format check, or before it had one, its roadmap check. */
export function formatsOf(stableApp: string, nextTree: string, store: string, env: Env): string {
  const own = join(stableApp, "scripts", "formats.ts");
  if (existsSync(own)) {
    const r = run(["bun", own, nextTree, store], stableApp, env, 120_000);
    return r.ok ? "" : `stable cannot read next's files: ${tail(r.out)}`;
  }
  const road = join(nextTree, "docs", "ROADMAP.md");
  if (!existsSync(road)) return "";
  const copy = mkdtempSync(join(diskTmpRoot(env), "release-roadmap-"));
  try {
    mkdirSync(join(copy, "docs"));
    copyFileSync(road, join(copy, "docs", "ROADMAP.md"));
    const r = run(["bun", join(stableApp, "bin", "lineclear"), "roadmap", "check", copy], copy, env, 120_000);
    return r.ok ? "" : `stable cannot read next's roadmap: ${tail(r.out)}`;
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

const sameRepo = (a: string, b: string) =>
  a.replace(/(\.git)?\/?$/, "").replace(/^git@github\.com:/, "https://github.com/") ===
  b.replace(/(\.git)?\/?$/, "").replace(/^git@github\.com:/, "https://github.com/");

/** The Lineclear space of the project whose repository is Lineclear's own. */
function ownSpace(origin: string, env: Env): string | undefined {
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s === "string") continue;
    const o = run(["git", "-C", s.repo, "remote", "get-url", "origin"], s.repo, env).out;
    if (sameRepo(o, origin)) return s.space;
  }
  return undefined;
}

/** The last start of a run and how many in a row left main unlooked at, so a run that keeps failing is started less often. */
interface Started {
  at: number;
  tries: number;
}

/**
 * Whether a run may start now. A run that looked at main and left nothing held resets the wait; one that did not (it
 * failed, main is held red, or a promotion waits its 30 minutes) doubles it, up to a quarter of an hour.
 */
export function releaseStartDue(env: Env, now: number): { due: boolean; tries: number } {
  const last = readJson(startedFile(env)) as Started | undefined;
  if (!last) return { due: true, tries: 0 };
  const state = readRelease(env);
  const tries = Date.parse(state.checked ?? "") >= last.at && !state.held ? 0 : last.tries;
  const wait = Math.min(CHECK_EVERY_MS * 2 ** Math.max(tries - 1, 0), MAX_BACKOFF_MS);
  return { due: now - last.at >= wait, tries };
}

/**
 * From the rule loop: starts `lineclear release run` when main was not looked at for a while and no run is going. Only
 * the installed app does, never a checkout someone runs, a test or a canary. It runs as a unit of its own, so the
 * restart of a promotion does not stop it.
 */
export function startReleaseIfDue(env: Env = process.env, now = new Date()): void {
  const app = pathsFor(env).app;
  if (env.LINECLEAR_CANARY || env.LINECLEAR_RELEASE === "off" || follows(env) || resolve(import.meta.dir, "..") !== app) return;
  try {
    if (now.getTime() - statSync(lockFile(env, "release")).mtimeMs > STALE_LOCK_MS) rmSync(lockFile(env, "release"), { force: true });
    else return;
  } catch {
    // no lock: no run is going
  }
  if (now.getTime() - Date.parse(readRelease(env).checked ?? "") < CHECK_EVERY_MS) return;
  const { due, tries } = releaseStartDue(env, now.getTime());
  if (!due) return;
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(startedFile(env), `${JSON.stringify({ at: now.getTime(), tries: tries + 1 } satisfies Started)}\n`);
  const cmd = [process.execPath, join(app, "bin", "lineclear"), "release", "run"];
  const keep = Object.entries(env).filter(([k, v]) => v !== undefined && KEPT_ENV.test(k));
  const unit = [
    "systemd-run",
    "--user",
    "--collect",
    "--quiet",
    `--unit=lineclear-release-${now.getTime()}`,
    ...keep.map(([k, v]) => `--setenv=${k}=${v}`),
    ...cmd,
  ];
  const r = spawnSync(unit[0] as string, unit.slice(1), { stdio: "ignore" });
  if (r.status !== 0) Bun.spawn(cmd, { env: env as Record<string, string>, stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
}

/** `lineclear release try`: the test instance of a version, or of a candidate from main's newest green commit. */
export function releaseTry(args: string[], out: (l: string) => void, env: Env = process.env): Promise<number> {
  const next = readRelease(env).next;
  return tryMain(args, out, env, next?.result === "green" ? next.commit : undefined);
}

/** The lines of `lineclear release` and of doctor and Home. */
export function releaseLines(s: Stored): string[] {
  const next = s.next ? `${short(s.next.commit)} ${s.next.result}${s.next.commit === s.stable?.commit ? " (same as stable)" : ""}` : "not looked at yet";
  return [
    `stable  ${s.stable ? `${short(s.stable.commit)} since ${s.stable.at.slice(0, 16).replace("T", " ")} UTC` : "unknown"}`,
    `next    ${next}`,
    `last promotion  ${s.promoted ? `${short(s.promoted.from)} to ${short(s.promoted.commit)} at ${s.promoted.at.slice(0, 16).replace("T", " ")} UTC` : "none yet"}`,
    ...(s.held ? [`held    ${s.held}`] : []),
    ...(s.runs ?? []).map(
      (r) =>
        `run  ${short(r.commit) || "main"} at ${r.at.slice(0, 16).replace("T", " ")} UTC, ${r.minutes} min, ${r.verdict}${r.why ? `: ${r.why.slice(0, 200)}` : ""}`,
    ),
    ...candidateLines(s.candidate),
  ];
}

function candidateLines(c?: CandidateResult): string[] {
  if (!c) return [];
  const checks = c.checks.map((k) => `${k.name} ${k.outcome}${k.why ? ` (${k.why.slice(0, 120)})` : ""}`).join(", ");
  return [`candidate  ${c.version} (${short(c.commit)}) ${c.result}${checks ? `: ${checks}` : ""}`];
}

export function releaseMain(args: string[], out: (l: string) => void, env: Env = process.env): number {
  const [verb = "status"] = args;
  const leader = follows(env);
  if (verb === "status") {
    if (leader) out(`follows ${leader}: this machine gets the stable build ${leader} promotes`);
    else for (const l of [...releaseLines(readRelease(env)), ...tryLines(env)]) out(l);
    return 0;
  }
  if (verb === "run" && leader) {
    out(`lineclear release: this machine follows ${leader}, which promotes for it`);
    return 0;
  }
  if (verb === "rollback") return rollbackMain(out, env, args[1] === "--from" ? args[2] : undefined);
  if (verb !== "run" || args.slice(1).some((a) => a !== "--again")) {
    out("usage: lineclear release [status|run [--again]|check|promote|rollback|try]");
    return 2;
  }
  mkdirSync(configDir(env), { recursive: true });
  let lock: number;
  try {
    lock = openSync(lockFile(env, "release"), "wx");
  } catch {
    out("lineclear release: another run is going");
    return 0;
  }
  try {
    const s = releaseStep(realDeps(env), env, new Date(), args[1] === "--again");
    for (const l of releaseLines(s)) out(l);
    return s.next?.result === "red" ? 1 : 0;
  } finally {
    closeSync(lock);
    rmSync(lockFile(env, "release"), { force: true });
  }
}
