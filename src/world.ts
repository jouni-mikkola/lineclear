import { statSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { claimWorld } from "./claims.ts";
import { sessionFolderPath } from "./harness-pi.ts";
import { gitLimited as git } from "./git.ts";
import { mainRefs, revertOnMain } from "./main-branch.ts";
import { lineclearDir } from "./measure.ts";
import { lineclearServer, readSnapshot } from "./lineclear-client.ts";
import { harnesses, readRegistry } from "./models.ts";
import { serverBin } from "./paths.ts";
import type { Settings } from "./project.ts";
import { fitTitle, type Task } from "./roadmap.ts";
import { runAll } from "./run-all.ts";
import { addTasksAt, type NewTask, type Room, readRoom } from "./spread.ts";
import { agentLastError, type ChatCard, realChatCards, realStallCards, type StallCard } from "./stalls.ts";
import { agentStart, nudgePane, type StartState } from "./starts.ts";
import { forgetTaskReads, readers, readTasks } from "./task-read.ts";
import { ownerWrote } from "./owner-wrote.ts";
import { taskWorktree, worktreeClean } from "./worktree.ts";

export type TellKind = "resume" | "answer";

/** Everything a tick needs from outside, so a test can fake each part. A method that can fail returns an error text, or undefined. */
export interface World {
  now(): Date;
  /** A tick starts: what the world read before is read again. */
  newTick?(): void;
  /** Done commits on origin/main, and its head. */
  main(repo: string): { head: string; checkedOut: string; commits: { subject: string; body: string }[] } | string;
  /** How many commits on origin/main are newer than the one that added the roadmap line `line` (a step's `Reopened:` item), or undefined when none did. */
  commitsSince?(repo: string, line: string): number | undefined;
  /** Fetches, then fast-forwards the repo folder when it is clean and on main. */
  fetch(repo: string): void;
  /** The roadmap as origin/main has it, or undefined when it has none. */
  roadmap(repo: string): string | undefined;
  /** The space's tasks; with `archived`, only the archived ones. */
  tasks(space: string, archived?: boolean): Task[] | string;
  maxTasks(space: string): number | undefined;
  /** `provider/model` names pi offers, or undefined when pi cannot say. */
  offered(now: Date): Set<string> | undefined;
  health(repo: string, command: string): { ok: boolean; output: string };
  /** Reverts a commit on origin/main and pushes the revert, as a plain push. Returns an error text, or undefined. */
  revert(repo: string, commit: string): string | undefined;
  /**
   * Makes the project's tasks, here (no host) or on its other machines (cloning the repo there once), all at once.
   * One error text, or undefined, per task.
   */
  addTasks(settings: Settings, tasks: NewTask[], project?: string): (string | undefined)[];
  /**
   * Claims steps on the GitHub repo, once for every machine and space, all at once. Per step: undefined when it is
   * ours now, "held" when another loop has it, or an error text. A world with no claims lets every start through.
   */
  claimSteps?(repo: string, steps: string[]): (string | undefined)[];
  /** The steps claimed on the repo. */
  claimedSteps?(repo: string): string[];
  /** Deletes the steps' claims, all at once. */
  releaseSteps?(repo: string, steps: string[]): void;
  /** What another machine of the project says about its room and its tasks, or why it cannot be reached. */
  room?(host: string, space: string): Room | string;
  /** The machine's one-minute load average. */
  load(): number;
  /** `lineclear task stop`. */
  stopTask(id: string): string | undefined;
  /**
   * `lineclear task tell`, which resumes a stopped agent. `resume` goes on with the step's own work (a wait is over, a
   * stall, a cut-off), `answer` is a rule answering the agent's own question. Both are marked in the agent's log; a
   * call with no kind is counted. Machine news (load, quota, accounts, status changes) is never a reason to call this.
   */
  tellTask(id: string, text: string, kind?: TellKind): string | undefined;
  /** `lineclear task close`, which keeps a branch with unmerged work. */
  closeTask(id: string): string | undefined;
  /** Starts `lineclear merge` for a Ready task without waiting for it (the board runs one merge at a time per task). */
  mergeTask(id: string): string | undefined;
  /** The `work/<n>-...` branch of a task, if the repo still has it. */
  branchOf(repo: string, task: string): string | undefined;
  /** The "may be stuck" cards of a space, oldest first. */
  stallCards(space: string, repo: string): StallCard[];
  /** How far the task's start got: whether its agent answered its brief (see starts.ts). */
  started(id: string): StartState;
  /** Types a line and Enter into the task's pane. */
  nudge(id: string, text: string): string | undefined;
  /** `reviewer.model` from `lineclear show`, or undefined when it names none. */
  reviewerSetting(space: string): string | undefined;
  /** Chat cards of a space with their text, for reading a reported usage limit. */
  chatCards(space: string, repo: string): ChatCard[];
  /** The error of the task's agent when its last model call failed (its text and time in ms), or undefined. */
  lastError(id: string): { text: string; at: number } | undefined;
  /** True when the owner wrote to the task in its chat after `since` (an ISO time). */
  ownerWrote(task: string, since: string): boolean;
  /** True when the task's worktree has no changes and no commits beyond its base. */
  clean(task: string): boolean;
}

/** The mark of Lineclear's lines in an agent's log: `[lineclear]`, or `[lineclear:resume]` and `[lineclear:answer]`. */
export const ownMark = (kind?: TellKind) => (kind === undefined ? "[lineclear]" : `[lineclear:${kind}]`);

const HEALTH_TIMEOUT_MS = 10 * 60_000;
const OFFERED_TTL_MS = 10 * 60_000;
const FETCH_EVERY_MS = 2 * 60_000;

type Run = (cmd: string[], cwd?: string) => { code: number; out: string; err: string };

/** The status a `task show --json` answer gives, or undefined when it gives none. */
export function taskStatus(showJson: string): string | undefined {
  try {
    const status = JSON.parse(showJson)?.status;
    return typeof status === "string" ? status : undefined;
  } catch {
    return undefined;
  }
}

/** The text of a failed command, or undefined when it worked. */
const failure = (r: ReturnType<Run>) => (r.code === 0 ? undefined : (r.err || r.out).trim() || `exit ${r.code}`);

const run: Run = (cmd, cwd) => {
  try {
    const p = Bun.spawnSync(cmd, { cwd, stdin: "ignore", timeout: HEALTH_TIMEOUT_MS });
    return { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
  } catch (e) {
    return { code: 127, out: "", err: String(e) };
  }
};

type Readers = ReturnType<typeof readers<ReturnType<Run>>>;

/** The git side of the world: main, fetch, the roadmap, health, revert, branches. */
function gitWorld(refsOf: (repo: string) => [string, string]): Pick<World, "main" | "fetch" | "commitsSince" | "roadmap" | "health" | "revert" | "branchOf"> {
  return {
    main(repo) {
      const log = git(repo, "log", refsOf(repo)[0], "-z", "--format=%H%x01%s%x01%b");
      if (!log.ok) return `cannot read the main branch in ${repo}: ${log.err}`;
      const rows = log.out
        .split("\0")
        .filter((r) => r.trim() !== "")
        .map((r) => r.split("\x01"));
      return {
        head: (rows[0]?.[0] ?? "").trim(),
        checkedOut: git(repo, "rev-parse", "HEAD").out.trim(),
        commits: rows.map(([, subject = "", body = ""]) => ({ subject: subject.trim(), body })),
      };
    },
    fetch(repo) {
      // A fetch over https costs a git, a remote helper and two credential helpers: once in FETCH_EVERY_MS is enough.
      try {
        if (Date.now() - statSync(join(repo, ".git", "FETCH_HEAD")).mtimeMs < FETCH_EVERY_MS) return;
      } catch {}
      git(repo, "fetch", "origin", "--quiet");
      const [origin, main] = refsOf(repo);
      const onMain = git(repo, "symbolic-ref", "--short", "HEAD").out.trim() === main;
      if (onMain && git(repo, "status", "--porcelain").out.trim() === "") git(repo, "merge", "--ff-only", "--quiet", origin);
    },
    commitsSince(repo, line) {
      const [main] = refsOf(repo);
      const added = git(repo, "log", main, "-n", "1", "--format=%H", "-S", line.trim(), "--", "docs/ROADMAP.md").out.trim();
      if (added === "") return undefined;
      const n = git(repo, "rev-list", "--count", `${added}..${main}`);
      return n.ok ? Number(n.out.trim()) : undefined;
    },
    roadmap(repo) {
      const { ok, out } = git(repo, "show", `${refsOf(repo)[0]}:docs/ROADMAP.md`);
      return ok ? out : undefined;
    },
    health(repo, command) {
      const r = run(["sh", "-c", `${command} 2>&1`], repo);
      return { ok: r.code === 0, output: r.out };
    },
    revert: revertOnMain,
    branchOf(repo, task) {
      const n = /-(\d+)$/.exec(task)?.[1];
      if (n === undefined) return undefined;
      const r = git(repo, "branch", "--list", "--format=%(refname:short)", `work/${n}-*`);
      return r.out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l !== "");
    },
  };
}

/** The `lineclear` side of the world: tasks, slots, and the commands that change a task. */
function taskWorld(
  lineclear: string,
  io: Readers,
  env: NodeJS.ProcessEnv,
): Pick<World, "tasks" | "maxTasks" | "reviewerSetting" | "stopTask" | "tellTask" | "closeTask" | "mergeTask" | "addTasks"> {
  // a done task has no pane: refused here, before the server and herdr are asked
  const doneTask = (id: string) =>
    taskStatus(run([lineclear, "task", "show", id, "--json"]).out) === "done" ? `${id} is Done already: it has no agent, so nothing is sent to it.` : undefined;
  const setting = (space: string, pattern: RegExp) => {
    const r = io.read([lineclear, "show", "--space", space]);
    const m = pattern.exec(r.out);
    return r.code === 0 && m ? m[1] : undefined;
  };
  return {
    tasks(space, archived) {
      const r = readTasks(env, space, archived);
      return "tasks" in r ? r.tasks : `task list failed: ${r.why}`;
    },
    maxTasks(space) {
      const n = setting(space, /^machine\.maxTasks\s+(\d+)/m);
      return n === undefined ? undefined : Number(n);
    },
    reviewerSetting: (space) => setting(space, /^reviewer\.model\s+(\S+\/\S+)/m),
    stopTask: (id) => doneTask(id) ?? failure(io.change([lineclear, "task", "stop", id])),
    // The mark tells the agent's log apart from a message of the owner (see ownerWrote), and a resume from other lines.
    tellTask: (id, text, kind) => doneTask(id) ?? failure(io.change([lineclear, "task", "tell", id, `${ownMark(kind)} ${text}`])),
    closeTask: (id) => failure(io.change([lineclear, "task", "close", id, "--force"])),
    // the merge outlives the tick (it waits in the board's merge line); its outcome shows as the task's merge stopped text
    mergeTask(id) {
      try {
        Bun.spawn([lineclear, "merge", id], { stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: HEALTH_TIMEOUT_MS }).unref();
        forgetTaskReads();
        return undefined;
      } catch (e) {
        return String(e);
      }
    },
    addTasks(settings, tasks, project) {
      const remote = tasks.some((t) => t.host !== undefined);
      const o = remote ? git(settings.repo, "remote", "get-url", "origin") : undefined;
      const origin = o?.ok ? o.out.trim() : undefined;
      const fitted = tasks.map((t) => ({ ...t, title: fitTitle(t.title) }));
      const errors = addTasksAt(settings.space, origin, fitted, env, project);
      forgetTaskReads();
      return errors;
    },
  };
}

/** `provider/model` names pi offers, read at most once in OFFERED_TTL_MS. */
function offeredModels(env: NodeJS.ProcessEnv): World["offered"] {
  let cached: { at: number; set: Set<string> | undefined } | undefined;
  return (now) => {
    const at = now.getTime();
    if (!cached || at - cached.at >= OFFERED_TTL_MS) {
      const set = new Set(readRegistry(harnesses(env)).map((m) => `${m.provider}/${m.name}`));
      if (set.size === 0) return undefined;
      cached = { at, set };
    }
    return cached.set;
  };
}

/**
 * The server's snapshot, read in the background once a tick: a tick is synchronous, so it uses the one the last tick
 * asked for, and a machine's room costs no process and no herdr call.
 */
function snapshotKeeper(env: Record<string, string | undefined>) {
  let latest: unknown;
  return {
    refresh() {
      const base = lineclearServer(env);
      if (base) void readSnapshot(base).then((snap) => (latest = snap ?? latest));
    },
    latest: () => latest,
  };
}

export function realWorld(env = process.env): World {
  const io = readers(run);
  const snapshot = snapshotKeeper(env);
  const refsOf = (repo: string) => io.memo(`main-refs:${repo}`, () => mainRefs(repo)); // up to five gits to find
  const tasksFile = join(lineclearDir(env), "tasks.json");
  const sessionsOf = (worktree: string) => sessionFolderPath(worktree, env);
  return {
    now: () => new Date(),
    newTick() {
      io.newTick();
      snapshot.refresh();
    },
    offered: offeredModels(env),
    load: () => loadavg()[0] ?? 0,
    room: (host, space) => readRoom(host, space, snapshot.latest(), env),
    ...gitWorld(refsOf),
    ...claimWorld(
      run,
      (cmds) => runAll(cmds, env),
      (repo) => refsOf(repo)[0],
    ),
    ...taskWorld(serverBin(env), io, env),
    stallCards: (space, repo) => io.memo(`stall\0${space}\0${repo}`, () => realStallCards(space, repo, env)),
    chatCards: (space, repo) => io.memo(`chat\0${space}\0${repo}`, () => realChatCards(space, repo, env)),
    started: (id) => agentStart(id, run, taskWorktree(id, tasksFile), sessionsOf),
    lastError: (id) => agentLastError(id, run),
    nudge: (id, text) => nudgePane(id, text, run, taskWorktree(id, tasksFile)),
    ownerWrote: (task, since) => ownerWrote(task, since, tasksFile, sessionsOf),
    clean: (task) => worktreeClean(task, run, tasksFile),
  };
}
