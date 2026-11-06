// The faults each gate and each merge-check step caught, counted from the logs the check and the rule loop write:
// a red run of `check-runs.jsonl` is one catch for the step that failed (and for each gate named in a failed `gates`
// step), and a stall of `decisions.jsonl` whose class a step guards is one catch for that step. A gate or step with 0
// catches in the window is the one `docs/simplify.md` weighs for a cut (L318).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir, decisionsPath } from "../pi/config.ts";
import { type CheckRun, readRuns } from "./check-runs.ts";
import { readDecisionsSince } from "./stall-class.ts";

export interface Catch {
  /** `gate lint`, `step tests` */
  name: string;
  caught: number;
}

/** The step a stall class belongs to: the check that holds its fault. */
const STALL_STEP: Record<string, string> = { "flaky test": "tests", "roadmap-broken": "roadmap" };
const GATES_FAILED = /^gates failed: (.+)$/;

/** The step name without its split (`tests 2/3` is `tests`). */
const stepOf = (s: string) => s.replace(/ \d+\/\d+$/, "");

/** The gate names of a repo, from `name:` in scripts/gates/. */
function gateNames(repo: string): string[] {
  const dir = join(repo, "scripts", "gates");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/^\s+name: "([a-z-]+)",/gm)].map((m) => m[1] as string));
}

/** Catches per gate and per step in `runs` and `decisions`, every known gate listed even at 0, the most first. `steps` are the check's step names (they list at 0 too). */
export function catches(runs: CheckRun[], decisions: { kind: string; class?: string }[], gates: string[], steps: string[]): Catch[] {
  const count = new Map<string, number>([...gates.map((g) => `gate ${g}`), ...steps.map((s) => `step ${stepOf(s)}`)].map((k) => [k, 0]));
  const add = (key: string) => count.set(key, (count.get(key) ?? 0) + 1);
  // a dirty run is not of its commit, a rerun or quarantined one is no refusal: none proves a catch
  for (const r of runs.filter((x) => !x.ok && !x.dirty && !x.rerun && !x.quarantined)) {
    if (r.gate) {
      const step = stepOf(r.gate.step);
      add(`step ${step}`);
      const named = step === "gates" ? GATES_FAILED.exec(r.gate.line)?.[1] : undefined;
      for (const g of named?.split(", ") ?? []) add(`gate ${g}`);
    } else if (r.failed.length > 0) add("step tests");
  }
  for (const d of decisions) {
    const step = d.kind === "stall" && d.class ? STALL_STEP[d.class] : undefined;
    if (step) add(`step ${step}`);
  }
  return [...count].map(([name, caught]) => ({ name, caught })).sort((a, b) => b.caught - a.caught || a.name.localeCompare(b.name));
}

const catchLines = (list: Catch[], days: number): string[] => list.map((c) => `catches in ${days} days, ${c.name}: ${c.caught}`);

const WINDOW_DAYS = 7;

/** The step names the check logged in the window, with the time each took (`check-steps.jsonl`). */
function loggedSteps(since: number, env: NodeJS.ProcessEnv): string[] {
  const file = join(configDir(env), "check-steps.jsonl");
  if (!existsSync(file)) return [];
  const names = new Set<string>();
  for (const l of readFileSync(file, "utf8").split("\n")) {
    try {
      const s = JSON.parse(l) as { at?: number; step?: string };
      if (s.step && s.step !== "wall" && Number(s.at) >= since) names.add(stepOf(s.step));
    } catch {}
  }
  return [...names];
}

/** The catches of a project's last 7 days, read from its logs. */
export function catchesOf(repo: string, env: NodeJS.ProcessEnv, now: number): string[] {
  const since = now - WINDOW_DAYS * 86_400_000;
  const decisions = readDecisionsSince(decisionsPath(env), since);
  return catchLines(catches(readRuns(repo, since, env), decisions, gateNames(repo), loggedSteps(since, env)), WINDOW_DAYS);
}
