import { dirname, join } from "node:path";
import { roadmapData } from "./roadmap-view.ts";

// The web server's slow reads, each in a process of its own so that the server keeps answering while it runs:
// `bun src/read-aside.ts roadmap <project>` prints the result as JSON.

type Env = Record<string, string | undefined>;
export type Aside = (what: "spend" | "dispatcher" | "roadmap" | "step", arg?: string) => Promise<unknown>;

/** Runs one read in a child process with `env`, and gives its JSON. A failed read throws with its last words;
 * one that takes over a minute is stopped, so a hung read never holds the server's value for good. */
export function readAside(env: Env): Aside {
  // the child finds git and lineclear as this process does
  const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  return async (what, arg) => {
    // heal.ts holds the reads that need the doctor's or dispatcher's modules, which the server loads only in a process of its own
    const script = what === "dispatcher" || what === "step" ? join(dirname(import.meta.path), "heal.ts") : import.meta.path;
    const p = Bun.spawn([process.execPath, script, what, ...(arg ? [arg] : [])], { env: childEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const limit = setTimeout(() => p.kill(), 60_000);
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).finally(() => clearTimeout(limit));
    if (code !== 0) throw new Error(err.trim().split("\n").at(-1) || `${what} read ended with ${code}`);
    return JSON.parse(out);
  };
}

export interface Kept<T> {
  /** The last value at once, undefined before the first; a new read starts when it is old. */
  now(): T | undefined;
  /** The same, but it waits for a new read when there is no value yet, or the last one is older than `wait` ms. */
  ready(wait?: number): Promise<T | undefined>;
}

/** A value read by `read` and kept for `ms`. One read runs at a time, and a failed read keeps the last value. */
export function keptAside<T>(read: () => Promise<T>, ms: number, now: () => number): Kept<T> {
  let value: T | undefined;
  let at = -Infinity;
  let reading: Promise<T | undefined> | undefined;
  const refresh = () =>
    (reading ??= read()
      .then(
        (v) => (value = v),
        (e) => (console.error(`lineclear: a read failed: ${(e as Error).message}`), value),
      )
      .finally(() => {
        at = now();
        reading = undefined;
      }));
  const get = () => {
    if (now() - at > ms) void refresh();
    return value;
  };
  return { now: get, ready: async (wait = Infinity) => (value === undefined || now() - at > wait ? refresh() : get()) };
}

if (import.meta.main) {
  const [what, arg] = process.argv.slice(2);
  const read = what === "roadmap" && arg ? roadmapData(arg) : undefined;
  if (read === undefined) {
    console.error("usage: bun src/read-aside.ts spend|roadmap <project>");
    process.exit(2);
  }
  console.log(JSON.stringify(read));
}
