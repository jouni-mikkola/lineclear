import { decisionsPath, readJson } from "../pi/config.ts";
import { dataDir } from "./paths.ts";
import { join } from "node:path";
import { type Blocker, day } from "./progress.ts";
import { checkLines, readWaits, type Wait, waitGroups } from "./waits.ts";
import type { Decision } from "./rules.ts";
import { readDecisionsSince } from "./stall-class.ts";
import type { Env, HomeTask, HomeWaiting } from "./home-data.ts";

/** A wait named by its kind, never by its reason: "a question waits for you", linked to the Inbox. */
export function waitBlocker(w: Wait): Blocker {
  const at = w.until ? Date.parse(w.until) : NaN;
  if (w.kind === "until" && !Number.isNaN(at)) return { text: `waits until ${day(at)}`, until: at };
  if (w.kind === "owner") return { text: "a question waits for you", href: "/inbox" };
  if (w.kind === "login") return { text: "a login waits for you", href: "/browsers" };
  if (w.kind === "browser") return { text: "a browser waits for you", href: "/browsers" };
  if (w.kind === "checks") return { text: "waits for a check slot" };
  if (w.kind === "until") return { text: "waits for a set time" };
  if (w.kind === "start") return { text: "start failed" };
  return { text: w.for ? `waits for ${w.for}` : "waits for another task" };
}

/** What holds up a space's open tasks: their waits, and a main that stays red. Home and the roadmap's line read the same. */
export function spaceStops(key: string, path: string, waits: Wait[], env: Env): Blocker[] {
  return [...waits.filter((w) => String(w.task).startsWith(`${key}-`)).map(waitBlocker), ...checkLines(path, env).map((text) => ({ text }))];
}

/** `spaceStops` for a space known by its name. */
export function stopsOfSpace(name: string, path: string, env: Env): Blocker[] {
  const spaces: { name?: string; key?: string }[] = readJson(join(dataDir(env), "spaces.json")) ?? [];
  const key = spaces.find((s) => s.name === name)?.key;
  return key ? spaceStops(String(key), path, readWaits(env), env) : [];
}

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
function notStarted(
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

export function waitingOf(
  shown: HomeTask[],
  own: { t: { id: string; title?: unknown } }[],
  waits: Wait[],
  roadmap: Parameters<typeof notStarted>[1],
  project: string | undefined,
  env: Env,
  now: number,
): HomeWaiting {
  const openIds = new Set(shown.filter((t) => t.state !== "done").map((t) => t.id));
  return {
    running: shown
      .filter((t) => t.state === "work" && (t.stage === "work" || t.stage === "review"))
      .map((t) => ({ id: t.id, title: t.title, stage: t.stage, since: t.since })),
    paused: waitGroups(
      waits.filter((w) => openIds.has(w.task)),
      new Map([...own.map((x) => [x.t.id as string, String(x.t.title ?? x.t.id)] as const), ...shown.map((t) => [t.id, t.title] as const)]),
    ),
    notStarted: notStarted(project, roadmap, new Set(shown.flatMap((t) => (t.state !== "done" && t.step ? [t.step] : []))), env, now),
  };
}
