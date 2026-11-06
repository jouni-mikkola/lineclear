import { statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, readJson } from "../pi/config.ts";
import { fileFix, planningFix, readFixes, selfProject } from "./self-fix.ts";
import type { Decision, World } from "./rules.ts";
import { type Alarm, alarms, type Facts, LIMITS, wasteLine } from "./waste.ts";
import { readFacts } from "./waste-facts.ts";
import { DAY, MIN } from "./time.ts";

// The waste watch, once in 10 minutes from the rule loop: reads the facts, keeps the alarms that stand for Home and
// files one Fix task for each alarm that has none open, under the same cap of fixes a day as the stall fixes.

type Env = Record<string, string | undefined>;
const WATCH_EVERY = 10 * MIN;
/** A fix that closed is not filed again for a day: the 24-hour numbers it was filed for still carry the old waste. */
const QUIET_AFTER_FIX = DAY;

/** What the watch keeps between looks: when it looked, and what it found. */
interface Kept {
  at: number;
  alarms: Alarm[];
}

const keptPath = (env: Env) => join(configDir(env), "waste.json");
const readKept = (env: Env = process.env): Kept => {
  const k = readJson(keptPath(env)) as Partial<Kept> | undefined;
  return { at: k?.at ?? 0, alarms: k?.alarms ?? [] };
};

// what this process last wrote, so a read of Home that changes nothing touches no file
const noted = new Map<string, number | null>();

/** The board notes the tokens per merged step it computes, for the watch to read. */
export function noteTokens(env: Env, tokensPerTask: number | null): void {
  const file = join(configDir(env), "waste-tokens.json");
  if (noted.get(file) === tokensPerTask) return;
  noted.set(file, tokensPerTask);
  writeAtomic(file, JSON.stringify({ tokensPerTask }));
}

/** Home's lines: the alarms of the last look, when it was in the last hour. */
export function wasteLines(env: Env = process.env, now = Date.now()): string[] {
  const file = keptPath(env);
  const at = statSync(file, { throwIfNoEntry: false })?.mtimeMs;
  if (at === undefined) return [];
  if (seen?.file !== file || seen.at !== at) seen = { file, at, kept: readKept(env) };
  return now - seen.kept.at > 6 * WATCH_EVERY ? [] : seen.kept.alarms.map(wasteLine);
}
let seen: { file: string; at: number; kept: Kept } | undefined;

const keyOf = (id: Alarm["id"]) => `waste:${id}`;
const fixTitle = (id: Alarm["id"]) => `Fix waste: ${id}`;

function goalOf(a: Alarm): string {
  const l = LIMITS[a.id];
  return [
    `Remove the waste '${l.what}' in Lineclear itself: ${a.number}, past its limit of ${l.limit} ${l.unit}.`,
    `Why the limit: ${l.reason}`,
    "Result: the cause is fixed, so the number stays under its limit; a test plants the waste.",
    "Add one step to docs/ROADMAP.md with that result as its done when.",
    "Evidence (from the waste watch):",
    ...a.evidence.slice(0, 8).map((e) => `- ${e}`),
  ].join("\n");
}

/** Files a Fix task for each standing alarm with none open, through the one `fileFix`. Returns the decisions it made. */
function fileFor(found: Alarm[], world: World, env: Env): Decision[] {
  const now = world.now();
  const self = selfProject(env);
  const out: Decision[] = [];
  const note = (kind: Decision["kind"], reason: string) => out.push({ time: now.toISOString(), project: self?.name ?? "-", kind, reason });
  if (!self) return out;
  for (const a of found) {
    const f = readFixes(env)[keyOf(a.id)];
    if (f && (f.closed === undefined || now.getTime() - Date.parse(f.closed) < QUIET_AFTER_FIX)) continue;
    const r = fileFix(world, planningFix(keyOf(a.id), fixTitle(a.id), goalOf(a), self, a.evidence.slice(0, 8)), env);
    if (!r.filed) {
      note("skip", `a fix for the waste '${LIMITS[a.id].what}' waits: ${r.why}`);
      continue;
    }
    note("start", `filed a fix for the waste '${LIMITS[a.id].what}', ${a.number}: ${fixTitle(a.id)}`);
  }
  return out;
}

/** One look, when the last was over 10 minutes ago. `facts` is for tests; a real look reads them. */
export function watchWaste(world: World, env: Env = process.env, facts?: Facts): Decision[] {
  const now = world.now().getTime();
  const kept = readKept(env);
  if (!facts && now - kept.at < WATCH_EVERY) return [];
  try {
    kept.alarms = alarms(facts ?? readFacts(world, env, now));
    kept.at = now;
    const out = fileFor(kept.alarms, world, env);
    writeAtomic(keptPath(env), `${JSON.stringify(kept, null, 2)}\n`);
    return out;
  } catch (e) {
    return [{ time: world.now().toISOString(), project: "-", kind: "skip", reason: `the waste watch failed: ${e instanceof Error ? e.message : e}` }];
  }
}
