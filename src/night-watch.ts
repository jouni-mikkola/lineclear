import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { DISPATCHER } from "./chat.ts";
import { lineclearServer, postAction, readSnapshot } from "./lineclear-client.ts";
import { dataDir } from "./paths.ts";
import { listProjectNames, readSettings } from "./project.ts";

type Env = Record<string, string | undefined>;

/** The night as local hours, `22-7` unless LINECLEAR_NIGHT_WATCH says another window; `off` turns the watch off. */
const NIGHT = "22-7";
const WATCH_EVERY_MS = 2 * 60 * 60 * 1000;
/** A send that failed (no Dispatcher, board away) is tried again after this, not every tick. */
const RETRY_MS = 15 * 60 * 1000;

/** True when `now` is inside a window like `22-7` (it may wrap past midnight). */
export function inNight(now: Date, window: string): boolean {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(window);
  if (!m) return false;
  const [from, to, h] = [Number(m[1]), Number(m[2]), now.getHours()];
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** The checklist the Dispatcher works through, for the projects that run. */
export function checklist(projects: string[]): string {
  return [
    "Night watch. Work through this once and answer in one short line per project:",
    ...projects.map((p) => `- ${p}: any open step ready that did not start, any stalled or silent task, any task waiting on a check or a merge?`),
    "Fix what the rules allow (tell a task to go on). Ask the owner only for a login, money or something that leaves the machine.",
  ].join("\n");
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
 * The rule loop's night part: at night, every WATCH_EVERY_MS, sends the Dispatcher the checklist for the projects that
 * run. Returns a decision line, or undefined when nothing was due. A send that fails is tried again next tick.
 */
export async function nightWatch(
  now: Date,
  env: Env = process.env,
  send: (text: string) => Promise<string | undefined> = (t) => sendToDispatcher(t, env),
): Promise<string | undefined> {
  const last = lastTimes(env);
  const at = now.getTime();
  if (!inNight(now, env.LINECLEAR_NIGHT_WATCH ?? NIGHT) || at - last.sent < WATCH_EVERY_MS || at - last.tried < RETRY_MS) return undefined;
  const running = listProjectNames(env as NodeJS.ProcessEnv).filter((n) => {
    const s = readSettings(n, env as NodeJS.ProcessEnv);
    return typeof s !== "string" && !s.paused;
  });
  if (running.length === 0) return undefined;
  const failed = await send(checklist(running));
  writeAtomic(sentPath(env), `${JSON.stringify({ sent: failed ? last.sent : at, tried: at })}\n`);
  if (failed) return `night watch: the Dispatcher was not reached: ${failed}`;
  return `night watch: sent the Dispatcher its checklist for ${running.join(", ")}`;
}
