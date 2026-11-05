// The speed budget: `bun scripts/budget.ts [--json]` runs the demo with a roadmap of 319 steps, measures it in a phone-sized
// browser on a throttled network (ui/budget) and fails naming each number over its limit in scripts/budgets.json.
// `bun run check` runs it when a change reaches the views or the server's answers; BUDGET_RUN_S of scripts/check-speed.ts is its time.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMeter } from "../src/check-runs.ts";

export interface Numbers {
  [name: string]: number | string[];
  notGzipped: string[];
}

// Times are what a busy machine stretches: their limits are for an idle one and grow with the load the run saw. The rest
// (size, layout shift, memory) do not depend on the load and stay absolute. The server's idle CPU does grow with it:
// on a busy machine its timers run in cold caches, so it is read against the load too.
const TIMES = new Set(["firstViewMs", "largestPaintMs", "homeAnswerMs", "idleCpuPercent"]);

/** How much longer than on an idle machine a run may take: the run's load per core, never below 1. */
export const loadFactor = (load: number, cores: number): number => Math.max(1, load / Math.max(1, cores));

/** The numbers of a run over their limits, as one line each; none when all hold. `factor` stretches the time limits. */
export function broken(budgets: Record<string, unknown>, got: Numbers, factor = 1): string[] {
  const faults = Object.entries(budgets)
    .filter(([name]) => name !== "network")
    .flatMap(([name, limit]) => {
      const value = got[name] as number;
      const allowed = (limit as number) * (TIMES.has(name) ? factor : 1);
      const shown = allowed === limit ? `${limit}` : `${allowed.toFixed(0)} (${limit} at load ${factor.toFixed(1)}x)`;
      return value > allowed ? [`${name}: ${value.toFixed(2)}, over its budget of ${shown}`] : [];
    });
  if (got.notGzipped.length > 0) faults.push(`answers not compressed: ${got.notGzipped.join(", ")}`);
  return faults;
}

async function main(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), "lc-budget-"));
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  const server = Bun.spawn(["bin/lineclear", "run", "--demo"], {
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      LINECLEAR_PORT: String(port),
      LINECLEAR_CONFIG: join(dir, "config"),
      LINECLEAR_STATE: join(dir, "state"),
      LINECLEAR_HOME: join(dir, "home"),
      LINECLEAR_DEMO_STEPS: "313",
    },
  });
  const url = `http://127.0.0.1:${port}`;
  const meter = loadMeter();
  try {
    for (let i = 0; i < 120; i++) {
      if (
        await fetch(`${url}/api/inbox`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      await Bun.sleep(500);
    }
    const out = join(dir, "numbers.json");
    const run = Bun.spawn(["bunx", "playwright", "test", "-c", "playwright.budget.config.ts"], {
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, BUDGET_URL: url, BUDGET_PID: String(server.pid), BUDGET_OUT: out },
    });
    if ((await run.exited) !== 0) return 1;
    const got = JSON.parse(readFileSync(out, "utf8")) as Numbers;
    const budgets = JSON.parse(readFileSync("scripts/budgets.json", "utf8"));
    console.log(JSON.stringify(got, null, 2));
    const { load, cores } = meter();
    const faults = broken(budgets, got, loadFactor(load, cores));
    for (const f of faults) console.error(`budget: ${f}`);
    return faults.length > 0 ? 1 : 0;
  } finally {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await main());
