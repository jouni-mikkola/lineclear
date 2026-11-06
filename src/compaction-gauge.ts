import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logLines, notesStats } from "../pi/parts/compaction-notes.ts";
import { dataDir } from "./paths.ts";
import { DAY } from "./time.ts";

type Env = Record<string, string | undefined>;

/** The window of Home's compaction card and of the tokens it divides, the same as its spend chart. */
export const GAUGE_WINDOW = 14 * DAY;

/**
 * Home's compaction card: how often contexts compacted, how often the notes were lost, and the tokens per merged task.
 * Per task, not per roadmap step: the tokens are every session's, coordinators included, so the per-step cost of a
 * project stays `lineclear measure`'s.
 */
export interface CompactionGauge {
  /** Compactions in the window, as the compaction notes' log has them. */
  compactions: number;
  /** Of them, those whose notes could not be used, so pi summarised them itself. */
  fellBack: number;
  /** Every session's tokens in the window per task merged in it; null with no merged task. */
  tokensPerTask: number | null;
  /** Tasks merged in the window, on this machine. */
  tasks: number;
}

/** Tasks merged after a time, from Lineclear's tasks.json in the task store. */
function mergedAfter(env: Env, since: number): number {
  let tasks: unknown;
  try {
    tasks = JSON.parse(readFileSync(join(dataDir(env), "tasks.json"), "utf8"))?.tasks;
  } catch {
    return 0;
  }
  const list: { merged?: unknown; doneAt?: unknown }[] = Array.isArray(tasks) ? tasks : Object.values(tasks ?? {});
  return list.filter((t) => t?.merged === true && typeof t.doneAt === "number" && t.doneAt > since).length;
}

/** The card's numbers, from the notes' log, the task store and the window's tokens pi's session files counted. */
export function compactionGauge(tokens: number, env: Env = process.env, now = Date.now()): CompactionGauge {
  const since = now - GAUGE_WINDOW;
  const recent = logLines(env).filter((l) => Date.parse(/"t":"([^"]+)"/.exec(l)?.[1] ?? "") > since);
  const { compactions, fellBack } = notesStats(recent);
  const tasks = mergedAfter(env, since);
  return { compactions, fellBack, tasks, tokensPerTask: tasks > 0 ? Math.round(tokens / tasks) : null };
}
