import { mkdtempSync, rmSync, statSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { serverBin } from "./paths.ts";
import { forgetTaskReads, readTasks } from "./task-read.ts";
import { briefOf } from "./held.ts";
import { piHarness } from "./harness-pi.ts";
import { lineclearDir } from "./measure.ts";
import { mainRefs } from "./main-branch.ts";
import { readProofs } from "./doneproof.ts";
import { proveStep } from "./doneproof-run.ts";
import { fitTitle } from "./roadmap.ts";
import { readRoom, startOn } from "./spread.ts";
import { agentLastError, realChatCards, realStallCards } from "./stalls.ts";
import { agentStart, nudgePane } from "./starts.ts";
import { commitsAhead, ownerWrote, pushBranch, taskWorktree, worktreeClean } from "./worktree.ts";
import { ownMark, type World } from "./world.ts";

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

/** What a tick reads once: `lineclear` reads until a command changes a task, and the memos until the next tick. */
function readers() {
  // `lineclear task list` and `show` each start a process of their own: read each once, until a command changes a task.
  let reads = new Map<string, ReturnType<Run>>();
  // chat files and main's refs are read once a tick: the ladder and the stall detectors both look at them
  let memos = new Map<string, unknown>();
  return {
    read(cmd: string[]) {
      const key = cmd.join("\0");
      const r = reads.get(key) ?? run(cmd);
      reads.set(key, r);
      return r;
    },
    change(cmd: string[]) {
      reads = new Map();
      forgetTaskReads();
      return run(cmd);
    },
    memo<T>(key: string, f: () => T): T {
      return (memos.has(key) ? memos.get(key) : memos.set(key, f()).get(key)) as T;
    },
    newTick() {
      reads = new Map();
      forgetTaskReads();
      memos = new Map();
    },
  };
}
type Readers = ReturnType<typeof readers>;

/** The git side of the world: main, fetch, the roadmap, health, revert, branches. */
function gitWorld(
  refsOf: (repo: string) => [string, string],
): Pick<World, "main" | "fetch" | "commitsSince" | "roadmap" | "health" | "revert" | "branchOf" | "pushBranch" | "commitsAhead"> {
  return {
    main(repo) {
      const log = run(["git", "-C", repo, "log", refsOf(repo)[0], "-z", "--format=%H%x01%s%x01%b"]);
      if (log.code !== 0) return `cannot read the main branch in ${repo}: ${log.err.trim()}`;
      const rows = log.out
        .split("\0")
        .filter((r) => r.trim() !== "")
        .map((r) => r.split("\x01"));
      return {
        head: (rows[0]?.[0] ?? "").trim(),
        checkedOut: run(["git", "-C", repo, "rev-parse", "HEAD"]).out.trim(),
        commits: rows.map(([, subject = "", body = ""]) => ({ subject: subject.trim(), body })),
      };
    },
    fetch(repo) {
      // A fetch over https costs a git, a remote helper and two credential helpers: once in FETCH_EVERY_MS is enough.
      try {
        if (Date.now() - statSync(join(repo, ".git", "FETCH_HEAD")).mtimeMs < FETCH_EVERY_MS) return;
      } catch {}
      run(["git", "-C", repo, "fetch", "origin", "--quiet"]);
      const [origin, main] = refsOf(repo);
      const onMain = run(["git", "-C", repo, "symbolic-ref", "--short", "HEAD"]).out.trim() === main;
      if (onMain && run(["git", "-C", repo, "status", "--porcelain"]).out.trim() === "") run(["git", "-C", repo, "merge", "--ff-only", "--quiet", origin]);
    },
    commitsSince(repo, line) {
      const [main] = refsOf(repo);
      const added = run(["git", "-C", repo, "log", main, "-n", "1", "--format=%H", "-S", line.trim(), "--", "docs/ROADMAP.md"]).out.trim();
      if (added === "") return undefined;
      const n = run(["git", "-C", repo, "rev-list", "--count", `${added}..${main}`]);
      return n.code === 0 ? Number(n.out.trim()) : undefined;
    },
    roadmap(repo) {
      const { code, out } = run(["git", "-C", repo, "show", `${refsOf(repo)[0]}:docs/ROADMAP.md`]);
      return code === 0 ? out : undefined;
    },
    health(repo, command) {
      const r = run(["sh", "-c", `${command} 2>&1`], repo);
      return { ok: r.code === 0, output: r.out };
    },
    revert(repo, commit) {
      // In a folder of its own, from exactly this commit: a main that moved meanwhile makes the push fail, never overwrites.
      const dir = mkdtempSync(join(tmpdir(), "lineclear-revert-"));
      try {
        const added = run(["git", "-C", repo, "worktree", "add", "--detach", dir, commit]);
        if (added.code !== 0) return failure(added);
        const parents = run(["git", "-C", dir, "rev-list", "--parents", "-n", "1", commit]).out.trim().split(/\s+/).length - 1;
        const reverted = run(["git", "-C", dir, "revert", "--no-edit", ...(parents > 1 ? ["-m", "1"] : []), commit]);
        if (reverted.code !== 0) {
          run(["git", "-C", dir, "revert", "--abort"]);
          return failure(reverted);
        }
        return failure(run(["git", "-C", dir, "push", "origin", "HEAD:main"]));
      } finally {
        run(["git", "-C", repo, "worktree", "remove", "--force", dir]);
        rmSync(dir, { recursive: true, force: true });
      }
    },
    branchOf(repo, task) {
      const n = /-(\d+)$/.exec(task)?.[1];
      if (n === undefined) return undefined;
      const r = run(["git", "-C", repo, "branch", "--list", "--format=%(refname:short)", `work/${n}-*`]);
      return r.out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l !== "");
    },
    pushBranch: (repo, branch) => pushBranch(run, repo, branch),
    commitsAhead: (repo, branch) => commitsAhead(run, repo, branch),
  };
}

/** The `lineclear` side of the world: tasks, slots, and the commands that change a task. */
function taskWorld(
  lineclear: string,
  io: Readers,
  env: NodeJS.ProcessEnv,
): Pick<World, "tasks" | "maxTasks" | "reviewerSetting" | "briefOf" | "stopTask" | "tellTask" | "closeTask" | "addTask" | "addTaskOn"> {
  // a done task has no pane: refused here, before the server and herdr are asked
  const doneTask = (id: string) =>
    taskStatus(run([lineclear, "task", "show", id, "--json"]).out) === "done" ? `${id} is Done already: it has no agent, so nothing is sent to it.` : undefined;
  return {
    tasks(space, archived) {
      const r = readTasks(env, space, archived);
      return "tasks" in r ? r.tasks : `task list failed: ${r.why}`;
    },
    maxTasks(space) {
      const r = io.read([lineclear, "show", "--space", space]);
      const m = /^machine\.maxTasks\s+(\d+)/m.exec(r.out);
      return r.code === 0 && m ? Number(m[1]) : undefined;
    },
    reviewerSetting(space) {
      const r = io.read([lineclear, "show", "--space", space]);
      const m = /^reviewer\.model\s+(\S+\/\S+)/m.exec(r.out);
      return r.code === 0 && m ? m[1] : undefined;
    },
    briefOf: (id) => briefOf(run([lineclear, "task", "show", id, "--json"]).out),
    stopTask: (id) => doneTask(id) ?? failure(io.change([lineclear, "task", "stop", id])),
    // The mark tells the agent's log apart from a message of the owner (see ownerWrote), and a resume from other lines.
    tellTask: (id, text, kind) => doneTask(id) ?? failure(io.change([lineclear, "task", "tell", id, `${ownMark(kind)} ${text}`])),
    closeTask: (id) => failure(io.change([lineclear, "task", "close", id, "--force"])),
    addTask: (space, title, brief, extra) => failure(io.change([lineclear, "task", "add", fitTitle(title), "--brief", brief, "--space", space, ...extra])),
    addTaskOn(host, settings, title, brief, extra, project) {
      const o = run(["git", "-C", settings.repo, "remote", "get-url", "origin"]);
      if (o.code !== 0) return `${settings.repo} has no origin to clone on ${host}`;
      return startOn(host, settings.space, o.out.trim(), fitTitle(title), brief, extra, env, project ? { name: project } : undefined);
    },
  };
}

/** The agents' side of the world: their sessions, panes, stall cards and chat. */
function agentWorld(io: Readers, env: NodeJS.ProcessEnv): Pick<World, "stallCards" | "chatCards" | "started" | "lastError" | "nudge" | "ownerWrote" | "clean"> {
  const tasksFile = join(lineclearDir(env), "tasks.json");
  const sessionsOf = (worktree: string) => piHarness.sessionFolderPath(worktree, env);
  return {
    stallCards: (space, repo) => io.memo(`stall\0${space}\0${repo}`, () => realStallCards(space, repo, env)),
    chatCards: (space, repo) => io.memo(`chat\0${space}\0${repo}`, () => realChatCards(space, repo, env)),
    started: (id) => agentStart(id, run, taskWorktree(id, tasksFile), sessionsOf),
    lastError: (id) => agentLastError(id, run),
    nudge: (id, text) => nudgePane(id, text, run, taskWorktree(id, tasksFile)),
    ownerWrote: (task, since) => ownerWrote(task, since, tasksFile, sessionsOf),
    clean: (task) => worktreeClean(task, run, tasksFile),
  };
}

/** `provider/model` names pi offers, read at most once in OFFERED_TTL_MS. */
function offeredModels(env: NodeJS.ProcessEnv): World["offered"] {
  let cached: { at: number; set: Set<string> | undefined } | undefined;
  return (now) => {
    const at = now.getTime();
    if (cached && at - cached.at < OFFERED_TTL_MS) return cached.set;
    const r = run([env.PI_BIN ?? "pi", "--list-models"]);
    if (r.code !== 0) return undefined;
    const set = new Set<string>();
    for (const line of r.out.split("\n").slice(1)) {
      const [provider, model] = line.trim().split(/\s+/);
      if (provider && model) set.add(`${provider}/${model}`);
    }
    cached = { at, set: set.size > 0 ? set : undefined };
    return cached.set;
  };
}

export function realWorld(env = process.env): World {
  const io = readers();
  const refsOf = (repo: string) => io.memo(`main-refs:${repo}`, () => mainRefs(repo)); // up to five gits to find
  return {
    now: () => new Date(),
    newTick: io.newTick,
    offered: offeredModels(env),
    load: () => loadavg()[0] ?? 0,
    room: (host, space) => readRoom(host, space, env),
    proofs: (repo) => readProofs(repo, env),
    proveStep: (settings, step, head, tools) =>
      proveStep({ repo: settings.repo, step, ref: refsOf(settings.repo)[0], head, reviewers: settings.models.reviewer, env, now: new Date(), tools }),
    ...gitWorld(refsOf),
    ...taskWorld(serverBin(env), io, env),
    ...agentWorld(io, env),
  };
}
