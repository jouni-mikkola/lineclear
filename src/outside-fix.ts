import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir } from "../pi/config.ts";
import { readRuns } from "./check-runs.ts";
import { planBrief } from "./plan-brief.ts";
import type { World } from "./rules.ts";
import { isOpen, selfProject } from "./self-fix.ts";
import { DAY } from "./time.ts";

// A test that goes red on a branch that does not reach it is no fault of the branch: the branch still goes back, and the
// test gets one Fix task, however many branches it fails. The run record (check-runs.jsonl) names it in `outside`.

const TITLE_MAX = 32;

interface Filed {
  title: string;
  since: string;
}

const filedPath = (env = process.env) => join(configDir(env), "outside-fixes.json");

function readFiled(env: NodeJS.ProcessEnv): Record<string, Filed> {
  try {
    return JSON.parse(readFileSync(filedPath(env), "utf8"));
  } catch {
    return {};
  }
}

/** Files a Fix task for each test the last day's runs name as red outside the change, unless a task for that test name is open. Returns what it filed. */
export function fileOutsideFixes(world: World, env = process.env): string[] {
  const self = selfProject(env);
  if (!self) return [];
  const names = new Set(readRuns(self.settings.repo, world.now().getTime() - DAY, env).flatMap((r) => r.outside ?? []));
  if (names.size === 0) return [];
  const tasks = world.tasks(self.settings.space);
  if (typeof tasks === "string") return [];
  const filed = readFiled(env);
  const out: string[] = [];
  const planner = self.settings.models.planner[0];
  for (const test of names) {
    const open = filed[test];
    if (open && isOpen(open, tasks)) continue;
    // a task that closed means the test was fixed: only a run after it can name the test again
    const lastRun = Math.max(
      ...readRuns(self.settings.repo, 0, env)
        .filter((r) => r.outside?.includes(test))
        .map((r) => r.at),
    );
    if (open && lastRun <= Date.parse(open.since)) continue;
    const title = `Fix: ${test}`.slice(0, TITLE_MAX);
    const goal = [
      `Fix the test '${test}': the merge check found it red on a branch that does not reach it.`,
      "Result: it passes under load. Find the root cause (a timeout that does not scale with load, shared temp state, real config or ports) and fix it there, not with a retry.",
      "Run it on main first: if it passes there, the cause is load or shared state.",
    ].join("\n");
    const err = world.addTask(self.settings.space, title, planBrief(self.name, goal, self.settings.repo), [
      "--agent",
      "pi",
      ...(planner ? ["--model", planner] : []),
      "--set",
      "review=off",
    ]);
    if (err) continue;
    filed[test] = { title, since: world.now().toISOString() };
    out.push(title);
  }
  if (out.length > 0) writeAtomic(filedPath(env), `${JSON.stringify(filed, null, 2)}\n`);
  return out;
}
