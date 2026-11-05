import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decisionsPath, configDir } from "../pi/config.ts";
import { buildNames, buildsDir, swapToPrevious } from "./builds.ts";
import { dataDir } from "./paths.ts";

type Env = Record<string, string | undefined>;

/** Restarts the service and the board. Running work lives in herdr, a unit of its own, so it is not touched. */
export function restartService(env: Env): boolean {
  const sh = (...a: string[]) => Bun.spawnSync(["systemctl", "--user", ...a], { env: env as Record<string, string>, stdin: "ignore" });
  if (sh("restart", "lineclear.service").exitCode !== 0) return false;
  const listed = sh("list-units", "--state=active", "--plain", "--no-legend", "lineclear-serve-*.service").stdout.toString();
  for (const line of listed.split("\n")) if (line.trim()) sh("restart", line.trim().split(/\s+/)[0] as string);
  return true;
}

/** The smoke check install.sh runs after an update, on the build now current. Returns its failures. */
export function smoke(env: Env): string {
  const folder = mkdtempSync(join(tmpdir(), "lineclear-rollback-"));
  try {
    const script = join(buildsDir(dataDir(env)), "current", "scripts", "smoke.ts");
    const r = Bun.spawnSync(["bun", script, "check", folder, "noapi"], { env: env as Record<string, string>, stdin: "ignore" });
    return r.exitCode === 0 ? "" : (r.stdout.toString() + r.stderr.toString()).trim().split("\n").join("; ");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** `lineclear release rollback`: current goes back to previous, the service restarts, the smoke check runs, the decision is logged. */
export function rollbackMain(out: (l: string) => void, env: Env = process.env, from?: string): number {
  const stable = buildNames(dataDir(env)).current;
  if (from && stable !== from) {
    out(`lineclear release rollback: ${from} is not stable any more (${stable ?? "none"} is), so nothing is rolled back`);
    return 1;
  }
  const swapped = swapToPrevious(dataDir(env));
  if (typeof swapped === "string") {
    out(`lineclear release rollback: ${swapped}`);
    return 1;
  }
  out(`current is now ${swapped.to}; ${swapped.from} stays in its folder and is not offered again until a newer version passes`);
  const restarted = restartService(env);
  const failed = restarted ? smoke(env) : "the service did not restart";
  mkdirSync(configDir(env), { recursive: true });
  const reason = `rolled back ${swapped.from} to ${swapped.to}${failed ? `; ${failed}` : "; the smoke check passed"}`;
  appendFileSync(decisionsPath(env), `${JSON.stringify({ time: new Date().toISOString(), project: "-", kind: "skip", reason })}\n`);
  out(failed ? `after the rollback: ${failed}` : "the smoke check passed");
  return failed ? 1 : 0;
}
