import { dirname, join } from "node:path";
import { piSpendAndUsage } from "./home-data.ts";
import { roadmapData } from "./roadmap-view.ts";

// The web server's slow reads, each in a process of its own so that the server keeps answering while it runs:
// `bun src/read-aside.ts spend|roadmap <project>` prints the result as JSON.

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

if (import.meta.main) {
  const [what, arg] = process.argv.slice(2);
  const read = what === "spend" ? piSpendAndUsage() : what === "roadmap" && arg ? roadmapData(arg) : undefined;
  if (read === undefined) {
    console.error("usage: bun src/read-aside.ts spend|roadmap <project>");
    process.exit(2);
  }
  console.log(JSON.stringify(read));
}
