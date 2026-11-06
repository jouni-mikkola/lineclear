import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir } from "../pi/config.ts";
import type { Decision } from "./rules.ts";
import type { Settings } from "./project.ts";
import type { World } from "./world.ts";

// herdr runs every agent's terminal, so a herdr that spins or runs outside herdr.service takes the whole line with it.
// The tick reads what herdr and its service are, restarts a bad one under the service, and closes the workspaces of
// tasks that ended. What it saw is kept in herdr-health.json for Home.

/** A `herdr server` process: the CPU seconds it has used in all, and whether the herdr.service cgroup holds it. */
export interface HerdrServer {
  pid: number;
  cpuSeconds: number;
  inService: boolean;
  /** Resident memory in MB, when known. */
  rssMb?: number;
}

/** One herdr workspace and the repo whose worktree it shows (undefined for a plain workspace). */
export interface HerdrWorkspace {
  id: string;
  repo?: string;
  checkout?: string;
}

export interface HerdrFacts {
  servers: HerdrServer[];
  /** The systemd unit herdr runs under. */
  unit: string;
  /** Its state, and how many times systemd restarted it. */
  service: { state: string; restarts: number };
  workspaces: HerdrWorkspace[];
}

/** CPU share of one core, above which a server counts as spinning, and the ticks in a row it takes. */
const CPU_LIMIT = 0.9;
const HOT_TICKS = 6;
/** Resident memory in MB above which a server counts as bloated: a leak that spinning does not show. */
const RSS_LIMIT_MB = 1500;

interface Kept {
  /** Per server pid: its CPU seconds and time at the last tick, and the ticks in a row above the limit. */
  seen: Record<string, { cpu: number; at: number; hot: number; fat?: number }>;
  /** Home's line, or undefined while the service is healthy. */
  line?: string;
}

const keptPath = (env: NodeJS.ProcessEnv) => join(configDir(env), "herdr-health.json");

function readKept(env: NodeJS.ProcessEnv): Kept {
  try {
    return { seen: {}, ...JSON.parse(readFileSync(keptPath(env), "utf8")) };
  } catch {
    return { seen: {} };
  }
}

/** Home's line about a failing herdr.service, with its failure count, or undefined. */
export const herdrLines = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const line = readKept(env).line;
  return line ? [line] : [];
};

/** The service is failing when it is not running; systemd's restart count is the failure count. */
const serviceLine = (unit: string, s: HerdrFacts["service"]) =>
  s.state === "active" ? undefined : `${unit} is ${s.state}, failed ${s.restarts} ${s.restarts === 1 ? "time" : "times"}`;

/** The `task number` a herdr worktree folder `work-<n>-...` belongs to. */
const numberOf = (checkout: string) => /(?:^|\/)work-(\d+)-[^/]*$/.exec(checkout)?.[1];

function judgeServers(f: HerdrFacts, kept: Kept, now: number): string | undefined {
  const seen: Kept["seen"] = {};
  let why: string | undefined;
  for (const s of f.servers) {
    const before = kept.seen[s.pid];
    const share = before && now > before.at ? (s.cpuSeconds - before.cpu) / ((now - before.at) / 1000) : 0;
    const hot = share > CPU_LIMIT ? (before?.hot ?? 0) + 1 : 0;
    const fat = (s.rssMb ?? 0) > RSS_LIMIT_MB ? (before?.fat ?? 0) + 1 : 0;
    seen[s.pid] = { cpu: s.cpuSeconds, at: now, hot, fat };
    if (!s.inService) why ??= `herdr server ${s.pid} runs outside ${f.unit}`;
    else if (fat >= HOT_TICKS / 2) why ??= `herdr server ${s.pid} holds ${s.rssMb} MB of memory`;
    else if (hot >= HOT_TICKS) why ??= `herdr server ${s.pid} used over ${Math.round(CPU_LIMIT * 100)} % of a core for ${hot} ticks`;
  }
  kept.seen = seen;
  return why;
}

/** One tick: restarts a spinning herdr or one outside its service, and closes the workspaces of ended tasks. Returns the decision lines. */
export function herdrHealth(world: World, projects: { name: string; settings: Settings }[], dryRun: boolean, env = process.env): Decision[] {
  const facts = world.herdr?.();
  if (!facts) return [];
  const now = world.now();
  const at = now.toISOString();
  const kept = readKept(env);
  const out: Decision[] = [];
  kept.line = serviceLine(facts.unit, facts.service);
  const why = judgeServers(facts, kept, now.getTime());
  if (why) {
    const err = dryRun ? undefined : world.restartHerdr?.();
    out.push({
      time: at,
      project: "-",
      kind: "wake",
      reason: err ? `could not restart herdr (${why}): ${err}` : `${dryRun ? "would restart" : "restarted"} herdr under ${facts.unit}: ${why}`,
    });
    if (!err) kept.seen = {};
  }
  for (const { name, settings } of projects) {
    const live = world.tasks(settings.space);
    const archived = world.tasks(settings.space, true); // the board archives done tasks, their workspaces stay
    if (typeof live === "string" || typeof archived === "string") continue;
    const tasks = [...live, ...archived];
    const ended = new Set(tasks.filter((t) => t.status === "done" || t.status === "closed").flatMap((t) => (t.id ? [/-(\d+)$/.exec(t.id)?.[1]] : [])));
    for (const w of facts.workspaces) {
      const n = w.checkout ? numberOf(w.checkout) : undefined;
      if (n === undefined || w.repo !== settings.repo || !ended.has(n)) continue;
      const err = dryRun ? undefined : world.closeWorkspace?.(w.id);
      out.push({
        time: at,
        project: name,
        kind: "close",
        reason: err
          ? `could not close herdr workspace ${w.id} of an ended task: ${err}`
          : `${dryRun ? "would close" : "closed"} herdr workspace ${w.id}: its task ended`,
      });
    }
  }
  if (!dryRun) writeAtomic(keptPath(env), `${JSON.stringify(kept)}\n`);
  return out;
}
