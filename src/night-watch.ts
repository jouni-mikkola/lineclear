import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { decisionsPath } from "../pi/config.ts";
import { DISPATCHER } from "./chat.ts";
import { lineclearServer, postAction, readSnapshot } from "./lineclear-client.ts";
import { dataDir } from "./paths.ts";
import { listProjectNames, readSettings } from "./project.ts";
import type { Decision } from "./rules.ts";
import { classify, readDecisionsSince } from "./stall-class.ts";

type Env = Record<string, string | undefined>;

/** The night as local hours, `22-7` unless LINECLEAR_NIGHT_WATCH says another window; `off` turns the watch off. */
const NIGHT = "22-7";
/** A send that failed (no Dispatcher, board away) is tried again after this, not every tick. */
const RETRY_MS = 15 * 60 * 1000;

/** True when `now` is inside a window like `22-7` (it may wrap past midnight). */
export function inNight(now: Date, window: string): boolean {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(window);
  if (!m) return false;
  const [from, to, h] = [Number(m[1]), Number(m[2]), now.getHours()];
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** The loop's lines the Dispatcher should hear: a stall, or a skip that waits for the owner. */
function worthHearing(d: Decision): boolean {
  return (d.kind === "stall" && d.event === "stall") || (d.kind === "skip" && classify(d) === "owner");
}

/** The message: what the rules found, one line each, so the Dispatcher acts on it without a search. */
export function report(found: Decision[]): string {
  const lines = [...new Set(found.map((d) => `- ${d.project}${d.step ? ` ${d.step}` : ""}: ${d.reason}`))];
  return [
    "Night watch. The rules found this since the last message:",
    ...lines,
    "Fix what the rules allow (tell a task to go on). Ask the owner only for a login, money or something that leaves the machine.",
  ].join("\n");
}

/** When tonight began, in ms: the last whole hour outside the night window, walking back from `now`. */
function nightStart(now: Date, window: string): number {
  let t = new Date(now).setMinutes(0, 0, 0);
  while (inNight(new Date(t - 3_600_000), window)) t -= 3_600_000;
  return t;
}

const sentPath = (env: Env) => join(dataDir(env), "night-watch.json");
/** When the watch last sent, and when it last tried, in ms; 0 for never. */
const lastTimes = (env: Env): { sent: number; tried: number } => {
  try {
    const t = JSON.parse(readFileSync(sentPath(env), "utf8"));
    return { sent: Number(t.sent) || 0, tried: Number(t.tried) || 0 };
  } catch {
    return { sent: 0, tried: 0 };
  }
};

/** Sends the Dispatcher's chat a text through Lineclear's server; the reason when it cannot. */
async function sendToDispatcher(text: string, env: Env): Promise<string | undefined> {
  const base = lineclearServer(env);
  if (!base) return "the board server is not running";
  const key = DISPATCHER.find((await readSnapshot(base)) as Parameters<typeof DISPATCHER.find>[0]);
  if (!key) return DISPATCHER.none;
  const failed = await postAction(base, { type: "send", chat: key, text, attachments: [] }, 10_000, "the board server is away", "the board server is slow");
  return failed?.error;
}

/**
 * The rule loop's night part: at night, sends the Dispatcher what the rules found (a stall, a skip that waits for the
 * owner) in the projects that run, since the last send or the start of the night. A quiet night sends nothing.
 * Returns a decision line, or undefined when nothing was due. A send that fails is tried again after RETRY_MS.
 */
export async function nightWatch(
  now: Date,
  env: Env = process.env,
  send: (text: string) => Promise<string | undefined> = (t) => sendToDispatcher(t, env),
): Promise<string | undefined> {
  const last = lastTimes(env);
  const at = now.getTime();
  const window = env.LINECLEAR_NIGHT_WATCH ?? NIGHT;
  if (!inNight(now, window) || at - last.tried < RETRY_MS) return undefined;
  const running = listProjectNames(env as NodeJS.ProcessEnv).filter((n) => {
    const s = readSettings(n, env as NodeJS.ProcessEnv);
    return typeof s !== "string" && !s.paused;
  });
  const since = Math.max(last.sent, nightStart(now, window));
  const found = readDecisionsSince(decisionsPath(env as NodeJS.ProcessEnv), since).filter(
    (d) => Date.parse(d.time) > since && running.includes(d.project) && worthHearing(d),
  );
  if (found.length === 0) return undefined;
  const failed = await send(report(found));
  writeAtomic(sentPath(env), `${JSON.stringify({ sent: failed ? last.sent : at, tried: at })}\n`);
  if (failed) return `night watch: the Dispatcher was not reached: ${failed}`;
  return `night watch: sent the Dispatcher ${found.length} finding${found.length === 1 ? "" : "s"} for ${[...new Set(found.map((d) => d.project))].join(", ")}`;
}
