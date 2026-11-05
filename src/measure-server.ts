import { writeAtomic } from "../pi/atomic.ts";
import { join } from "node:path";
import { shepherdrServer } from "./shepherdr-client.ts";

type Out = (line: string) => void;
type Env = Record<string, string | undefined>;

const USAGE = "usage: lineclear measure --server [--window <seconds>] [--profile]  (the window is 10 s by default)";

interface Figures {
  windowMs: number;
  samples: number;
  p50: number;
  p95: number;
  max: number;
  cpu: number;
}

/** `measure --server`: the running server's event-loop lag and CPU share over a window, or with `--profile` a CPU profile of it saved to a file. */
export async function measureServer(args: string[], out: Out, env: Env = process.env, cwd = process.cwd()): Promise<number> {
  const at = args.indexOf("--window");
  const seconds = at >= 0 ? Number(args[at + 1]) : 10;
  const profile = args.includes("--profile");
  const stray = args.filter((a, i) => !["--server", "--profile", "--window"].includes(a) && i !== at + 1);
  if (stray.length > 0 || !(seconds > 0)) {
    out(USAGE);
    return 2;
  }
  const base = shepherdrServer(env);
  if (!base) {
    out("lineclear measure: the server is not running");
    return 1;
  }
  try {
    const res = await fetch(`${base}/api/${profile ? "loop-profile" : "loop-lag"}?window=${seconds}`, { signal: AbortSignal.timeout(seconds * 1000 + 10_000) });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    if (profile) {
      const file = join(cwd, `server-${new Date().toISOString().replace(/[:.]/g, "-")}.cpuprofile`);
      writeAtomic(file, await res.text());
      out(`CPU profile of the server over ${seconds} s saved to ${file}`);
      return 0;
    }
    const f = (await res.json()) as Figures;
    out(
      `server event-loop lag over ${(f.windowMs / 1000).toFixed(1)} s (${f.samples} samples): p50 ${f.p50.toFixed(1)} ms, p95 ${f.p95.toFixed(1)} ms, max ${f.max.toFixed(1)} ms`,
    );
    out(`server main-thread CPU share: ${(f.cpu * 100).toFixed(1)} %`);
    return 0;
  } catch (e) {
    out(`lineclear measure: ${(e as Error).message}`);
    return 1;
  }
}
