import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Check, Probe } from "./doctor.ts";
import { readTasksKept } from "./tasks-kept.ts";

/** What exists on the machine: a worktree path, a `work/` branch, a pi session folder and a pane's folder each. */
interface Found {
  worktrees: string[];
  branches: string[];
  sessions: string[];
  panes: string[];
}

export interface Leftovers {
  /** The worktree paths of tasks that have not ended. */
  live: string[];
  found: Found;
}

const KINDS = ["worktrees", "branches", "sessions", "panes"] as const;
/** Pi names a session folder after the working folder, every `/` and `.` turned into `-`. */
const sessionName = (path: string) => `--${path.replace(/^\//, "").replace(/[/.]/g, "-")}--`;
const folderName = (path: string) => path.split("/").pop() ?? "";

/** What belongs to no live task, by kind. */
function leftoverCounts({ live, found }: Leftovers): Record<(typeof KINDS)[number], number> {
  const paths = new Set(live);
  const names = new Set(live.map(folderName));
  const sessions = new Set(live.map(sessionName));
  return {
    worktrees: found.worktrees.filter((w) => !paths.has(w)).length,
    branches: found.branches.filter((b) => !names.has(b.replaceAll("/", "-"))).length,
    sessions: found.sessions.filter((s) => !sessions.has(s)).length,
    panes: found.panes.filter((p) => !paths.has(p)).length,
  };
}

/** One check per kind: each fails while one is left. */
export function leftoverChecks(p: Pick<Probe, "leftovers">): Check[] {
  const data = p.leftovers?.();
  if (!data) return [];
  const counts = leftoverCounts(data);
  return KINDS.map((k) => ({
    name: `leftover ${k}`,
    problem: counts[k] ? `${counts[k]} ${k} belong to no live task` : "",
    fix: "remove what no live task owns: stop its pane, then delete its worktree, branch and session folder",
    info: "0",
  }));
}

function lines(cmd: string[], cwd: string): string[] {
  try {
    const r = Bun.spawnSync(cmd, { cwd, stdin: "ignore" });
    return r.exitCode === 0 ? r.stdout.toString().split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Reads the machine: the checkout's worktrees and `work/` branches, pi's session folders and herdr's panes. */
export function realLeftovers(repo: string, dir: string, env: Record<string, string | undefined> = process.env): Leftovers {
  const tasks = readTasksKept(dir).tasks.filter((t) => !t.merged && !t.closed);
  const live = tasks.map((t) => (typeof t.worktree === "string" ? t.worktree : "")).filter(Boolean);
  const worktrees = lines(["git", "worktree", "list", "--porcelain"], repo)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9))
    .filter((w) => w !== repo && w.includes("/worktrees/"));
  const branches = lines(["git", "branch", "--format=%(refname:short)", "--list", "work/*"], repo);
  const root = join(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "sessions");
  const sessions = existsSync(root) ? readdirSync(root).filter((s) => s.includes("-worktrees-")) : [];
  let panes: string[] = [];
  try {
    const out = JSON.parse(lines(["herdr", "pane", "list"], repo).join("\n") || "{}");
    const all = (out.result?.panes ?? []) as { agent?: string; cwd?: string }[];
    panes = all.filter((x) => x.agent && x.cwd?.includes("/worktrees/")).map((x) => x.cwd as string);
  } catch {}
  return { live, found: { worktrees, branches, sessions, panes } };
}
