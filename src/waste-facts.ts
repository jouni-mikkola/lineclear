import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, decisionsPath, readJson } from "../pi/config.ts";
import { apiP95 } from "./api-latency.ts";
import { readRuns } from "./check-runs.ts";
import { readTasksKept } from "./kept-read.ts";
import { dataDir } from "./paths.ts";
import { listProjectNames, readSettings } from "./project.ts";
import type { World } from "./rules.ts";
import { readDecisionsSince } from "./stall-class.ts";
import type { Facts } from "./waste.ts";
import { DAY, HOUR_MS } from "./time.ts";

type Env = Record<string, string | undefined>;
const MAX_DIFFS = 10;
const LOCK_SKIP = /^lock '(.+)' is held by/;

/** The kernel's count of processes forked since boot, or undefined where there is no /proc/stat. */
export function forkCount(read: () => string = () => readFileSync("/proc/stat", "utf8")): number | undefined {
  try {
    const n = /^processes (\d+)$/m.exec(read())?.[1];
    return n === undefined ? undefined : Number(n);
  } catch {
    return undefined;
  }
}

/** Forks per second since the last look, which this notes for the next one. Undefined at the first look. */
function forksPerSecond(env: Env, now: number, count: number | undefined = forkCount()): number | undefined {
  if (count === undefined) return undefined;
  const file = join(configDir(env), "waste-forks.json");
  const prev = readJson(file) as { at: number; count: number } | undefined;
  writeAtomic(file, JSON.stringify({ at: now, count }));
  if (!prev || now - prev.at < 60_000 || count < prev.count) return undefined;
  return (count - prev.count) / ((now - prev.at) / 1000);
}

/** Whether a change touched docs only: markdown files and the docs folder. */
export const docsOnly = (files: string[]) => files.length > 0 && files.every((f) => f.startsWith("docs/") || f.endsWith(".md"));

function changedFiles(repo: string, commit: string): string[] | undefined {
  try {
    const base = execFileSync("git", ["-C", repo, "merge-base", "origin/main", commit], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return execFileSync("git", ["-C", repo, "diff", "--name-only", base, commit], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .filter(Boolean);
  } catch {
    return undefined;
  }
}

/** Tokens per merged step as the board last showed them: reading pi's sessions is the board's job, not the watch's. */
function tokensPerStep(env: Env): number | null {
  const v = readJson(join(configDir(env), "waste-tokens.json")) as { tokensPerTask?: number | null } | undefined;
  return v?.tokensPerTask ?? null;
}

/** Starts in a day and lock skips in the last hour, counted from the decisions. */
function decisionFacts(env: Env, now: number): Pick<Facts, "starts" | "lockSkips" | "stepSkips"> {
  const starts: Facts["starts"] = {};
  const lockSkips: Facts["lockSkips"] = {};
  const stepSkips: Facts["stepSkips"] = {};
  const count = (by: Record<string, number>, key: string) => {
    by[key] = (by[key] ?? 0) + 1;
  };
  for (const d of readDecisionsSince(decisionsPath(env), now - DAY)) {
    if (d.kind === "start" && d.step) count(starts, `${d.project} ${d.step}`);
    const lock = d.kind === "skip" ? LOCK_SKIP.exec(d.reason)?.[1] : undefined;
    if (lock === undefined || new Date(d.time).getTime() < now - HOUR_MS) continue;
    count(lockSkips, `${d.project} ${lock}`);
    if (d.step) count(stepSkips, `${d.project} ${d.step}`);
  }
  return { starts, lockSkips, stepSkips };
}

/** The merge-tier runs of a repo in the last day: how many, how many red, and the docs-only changes among the last few. */
function repoChecks(repo: string, env: Env, now: number): { merge: Facts["merge"]; docsOnlyRuns: Facts["docsOnlyRuns"] } {
  const runs = readRuns(repo, now - DAY, env).filter((r) => r.tier === "merge");
  const red = runs.filter((r) => !r.ok);
  const docsOnlyRuns = runs.slice(-MAX_DIFFS).flatMap((r) => {
    const files = changedFiles(repo, r.commit);
    return files && docsOnly(files) ? [{ branch: r.branch, seconds: r.seconds }] : [];
  });
  return { merge: { runs: runs.length, red: red.length, redNoTest: red.filter((r) => r.failed.length === 0).length }, docsOnlyRuns };
}

/** Everything the limits are held against, from the data the rule loop and the board already keep. */
export function readFacts(world: World, env: Env = process.env, now = world.now().getTime()): Facts {
  const ended = readTasksKept(dataDir(env)).tasks.filter((t) => typeof t.doneAt === "number" && t.doneAt > now - DAY);
  const merge: Facts["merge"] = { runs: 0, red: 0, redNoTest: 0 };
  const docsOnlyRuns: Facts["docsOnlyRuns"] = [];
  const seenRepo = new Set<string>();
  let freeSlots = 0;
  for (const name of listProjectNames(env)) {
    const s = readSettings(name, env);
    if (typeof s === "string") continue;
    const tasks = world.tasks(s.space);
    const cap = world.maxTasks(s.space);
    if (typeof tasks !== "string" && cap !== undefined)
      freeSlots += Math.max(0, cap - tasks.filter((t) => t.status !== "done" && t.status !== "closed").length);
    if (seenRepo.has(s.repo) || !existsSync(s.repo)) continue;
    seenRepo.add(s.repo);
    const c = repoChecks(s.repo, env, now);
    merge.runs += c.merge.runs;
    merge.red += c.merge.red;
    merge.redNoTest += c.merge.redNoTest;
    docsOnlyRuns.push(...c.docsOnlyRuns);
  }
  return {
    ...decisionFacts(env, now),
    ended: { total: ended.length, unmerged: ended.filter((t) => t.merged !== true).length },
    freeSlots,
    merge,
    forksPerSecond: forksPerSecond(env, now),
    apiP95Ms: apiP95(env, now),
    tokensPerStep: tokensPerStep(env),
    docsOnlyRuns,
  };
}
