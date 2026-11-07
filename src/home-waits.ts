import { readJson } from "../pi/config.ts";
import { dataDir } from "./paths.ts";
import { join } from "node:path";
import { type Blocker, day } from "./progress.ts";
import { readWaits, type Wait, waitGroups } from "./waits.ts";
import type { Env, HomeTask, HomeWaiting } from "./home-data.ts";
import { notStarted } from "./home-not-started.ts";

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
export function spaceStops(key: string, waits: Wait[]): Blocker[] {
  return [...waits.filter((w) => String(w.task).startsWith(`${key}-`)).map(waitBlocker)];
}

/** `spaceStops` for a space known by its name. */
export function stopsOfSpace(name: string, env: Env): Blocker[] {
  const spaces: { name?: string; key?: string }[] = readJson(join(dataDir(env), "spaces.json")) ?? [];
  const key = spaces.find((s) => s.name === name)?.key;
  return key ? spaceStops(String(key), readWaits(env)) : [];
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
