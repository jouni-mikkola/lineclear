import { decisionsPath } from "../pi/config.ts";
import type { Env, HomeWaiting } from "./home-data.ts";
import type { Decision } from "./rules.ts";
import { readDecisionsSince } from "./stall-class.ts";

/** The rule loop's reason for a skipped step in plain words: no lock names, and the step that holds a lock by its title. */
function plainReason(reason: string, titleOf: (step: string) => string | undefined): string {
  const lock = /^lock '[^']*' is held by (\S+)/.exec(reason);
  if (lock?.[1]) return `waits for ${[lock[1], titleOf(lock[1])].filter(Boolean).join(" ")}, which works on the same part`;
  if (/^no free slot/.test(reason)) return "every work slot is in use";
  if (/^load average is above/.test(reason)) return "the machine is too busy to start more";
  if (/^task add failed/.test(reason)) return "the task could not be created, the rules try again";
  // any other reason: a task id in it is said by its title, and a quoted internal name is dropped
  return reason.replace(/'[^']*'\s*/g, "").replace(/\b[A-Z][A-Z0-9]*-\d+\b/g, (id) => titleOf(id) ?? "another task");
}

/** The rule loop's ticks come every few minutes: an older skip says nothing about now. */
const TICK_WINDOW = 15 * 60_000;

/** Why the ready steps of a project have not started, from the loop's latest skips: the whole project's reason when it stopped before any step. */
export function notStarted(
  project: string | undefined,
  roadmap: { open: Set<string>; titles: Map<string, string> } | undefined,
  taken: Set<string>,
  env: Env,
  now: number,
): HomeWaiting["notStarted"] {
  if (!project || !roadmap) return [];
  const mine = readDecisionsSince(decisionsPath(env as NodeJS.ProcessEnv), now - TICK_WINDOW).filter((d) => d.project === project && d.kind === "skip");
  const titleOf = (id: string) => roadmap.titles.get(id);
  const whole = mine.findLast((d) => !d.step);
  const wholeAt = whole ? Date.parse(whole.time) : 0;
  const last = new Map<string, Decision & { step: string }>();
  for (const d of mine) if (d.step && Date.parse(d.time) > wholeAt) last.set(d.step, { ...d, step: d.step });
  if (whole && last.size === 0) return [{ title: "Every ready step", reason: plainReason(whole.reason, titleOf) }];
  return [...last.values()].flatMap((d) =>
    roadmap.open.has(d.step) && !taken.has(d.step) ? [{ title: `${d.step} ${titleOf(d.step) ?? ""}`.trim(), reason: plainReason(d.reason, titleOf) }] : [],
  );
}
