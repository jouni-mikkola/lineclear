import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { dataDir } from "./paths.ts";

// `lineclear status` and `lineclear inbox` walk every project and every machine, which takes 10 to 80 s. The web
// server refreshes both answers in a process of its own (read-aside.ts, a walk that may take over a minute) and the commands print the kept lines.

type Env = Record<string, string | undefined>;
type Kind = "status" | "inbox";
type Kept = { at: number; status: { code: number; lines: string[] }; inbox: { code: number; lines: string[] } };

/** A kept answer older than this is read live: the server did not refresh it, so it may be wrong. */
const READS_MAX_AGE_MS = 120_000;

const file = (env: Env) => join(dataDir(env), "reads-cache.json");

/** Keeps the lines of both reads for `cachedRead`. */
export function keepReads(status: Kept["status"], inbox: Kept["inbox"], env: Env = process.env, now = Date.now()): void {
  mkdirSync(dataDir(env), { recursive: true });
  writeAtomic(file(env), JSON.stringify({ at: now, status, inbox } satisfies Kept));
}

/** The kept answer of `kind` printed through `out`, or undefined when none is kept or it is too old. */
export function cachedRead(kind: Kind, out: (l: string) => void, env: Env = process.env, now = Date.now()): number | undefined {
  if (!existsSync(file(env))) return undefined;
  try {
    const kept = JSON.parse(readFileSync(file(env), "utf8")) as Kept;
    if (!(now - kept.at <= READS_MAX_AGE_MS)) return undefined;
    for (const l of kept[kind].lines) out(l);
    return kept[kind].code;
  } catch {
    return undefined;
  }
}

/** Drops the kept answers: after an Inbox item was added or changed, so no answered card shows as open. */
export function forgetReads(env: Env = process.env): void {
  rmSync(file(env), { force: true });
}
