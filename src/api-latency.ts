import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../pi/config.ts";
import { MIN } from "./time.ts";

// How long the board's API takes to answer, one line a minute with that minute's count and 95th percentile, so the
// waste watch (src/waste.ts) can read it from the rule loop's process, which is not the server's.

type Env = Record<string, string | undefined>;
const file = (env: Env) => join(configDir(env), "api-latency.jsonl");

let minute = 0;
let samples: number[] = [];

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] ?? 0;

/** Notes one answer's time. The minute that just ended is written when the next one starts. */
export function recordLatency(ms: number, env: Env = process.env, now = Date.now()): void {
  const at = Math.floor(now / MIN) * MIN;
  if (at !== minute && samples.length > 0) {
    try {
      mkdirSync(configDir(env), { recursive: true });
      appendFileSync(file(env), `${JSON.stringify({ at: minute, n: samples.length, p95: Math.round(p95(samples)) })}\n`);
    } catch {
      // a full disk is the disk check's to say
    }
    samples = [];
  }
  minute = at;
  samples.push(ms);
}

/** The median of the minutes' 95th percentiles in the last `windowMs`: one slow minute is no alarm. Undefined with fewer than 3 minutes noted. */
export function apiP95(env: Env = process.env, now = Date.now(), windowMs = 10 * MIN): number | undefined {
  if (!existsSync(file(env))) return undefined;
  const from = now - windowMs;
  const lines = readFileSync(file(env), "utf8").trimEnd().split("\n").slice(-200);
  const ps = lines.flatMap((l) => {
    try {
      const e = JSON.parse(l) as { at: number; p95: number };
      return e.at >= from ? [e.p95] : [];
    } catch {
      return [];
    }
  });
  if (ps.length < 3) return undefined;
  return [...ps].sort((a, b) => a - b)[Math.floor(ps.length / 2)];
}
