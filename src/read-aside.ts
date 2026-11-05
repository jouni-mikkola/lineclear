import { dirname, join } from "node:path";
import { piSpendAndUsage } from "./home-data.ts";
import { inboxAll, statusAll } from "./export.ts";
import { keepReads } from "./reads-cache.ts";
import { roadmapData } from "./roadmap-view.ts";

// The web server's slow reads, each in a process of its own so that the server keeps answering while it runs:
// `bun src/read-aside.ts spend|reads|roadmap <project>` prints the result as JSON.

type Env = Record<string, string | undefined>;
export type Aside = (what: "spend" | "reads" | "heal" | "fix" | "dispatcher" | "roadmap" | "step", arg?: string) => Promise<unknown>;

/** Runs one read in a child process with `env`, and gives its JSON. A failed read throws with its last words;
 * one that takes over a minute (ten for the reads walk) is stopped, so a hung read never holds the server's value for good. */
export function readAside(env: Env): Aside {
  // the child finds git and shepherdr as this process does
  const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, ...env };
  return async (what, arg) => {
    // the fixes live in heal.ts: the server needs the doctor's modules only in a process of its own
    const script =
      what === "heal" || what === "fix" || what === "dispatcher" || what === "step" ? join(dirname(import.meta.path), "heal.ts") : import.meta.path;
    const p = Bun.spawn([process.execPath, script, what, ...(arg ? [arg] : [])], { env: childEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const limit = setTimeout(() => p.kill(), what === "reads" ? 600_000 : 60_000);
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).finally(() => clearTimeout(limit));
    if (code !== 0) throw new Error(err.trim().split("\n").at(-1) || `${what} read ended with ${code}`);
    return JSON.parse(out);
  };
}

/** Walks every project and machine once, as `lineclear status` and `inbox` would, and keeps both answers. */
function walkReads(env: Env = process.env) {
  const run = (read: (out: (l: string) => void) => number) => {
    const lines: string[] = [];
    return { code: read((l) => lines.push(l)), lines };
  };
  keepReads(
    run((out) => statusAll(out, env)),
    run((out) => inboxAll(out, env)),
    env,
  );
}

if (import.meta.main) {
  const [what, arg] = process.argv.slice(2);
  const read = what === "spend" ? piSpendAndUsage() : what === "reads" ? (walkReads(), true) : what === "roadmap" && arg ? roadmapData(arg) : undefined;
  if (read === undefined) {
    console.error("usage: bun src/read-aside.ts spend|reads|roadmap <project>");
    process.exit(2);
  }
  console.log(JSON.stringify(read));
}
