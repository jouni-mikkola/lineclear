import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { readJson } from "../pi/config.ts";
import type { Check, Probe } from "./doctor.ts";
import { readMachines } from "./machine-list.ts";
import { remoteLineclear } from "./ssh.ts";
import { timerAllowed } from "../server/server/live/timer-rule.ts";

type Env = Record<string, string | undefined>;
type Out = (line: string) => void;

/** The spaces of this machine whose coordinator wakes on a timer. */
function timerSpaces(dir: string, env: Env = process.env): string[] {
  if (timerAllowed(env)) return [];
  const modes: Record<string, string> = readJson(join(dir, "modes.json")) ?? {};
  return Object.keys(modes).filter((id) => modes[id] === "autopilot");
}

const FIX = "lineclear doctor --fix";

export function retiredChecks(p: Probe): Check[] {
  const timers = p.dataDir ? timerSpaces(p.dataDir) : [];
  return [
    {
      name: "no coordinator on a timer",
      problem: timers.length
        ? `${timers.length} ${timers.length === 1 ? "space wakes its coordinator" : "spaces wake their coordinator"} on a timer: ${timers.join(", ")}`
        : "",
      fix: FIX,
    },
  ];
}

/**
 * Turns the timers off, when the owner asked (`doctor --fix`).
 * A running server keeps the modes in memory and writes them back, so it is asked; the file is edited only when none runs.
 */
function fixTimers(p: Probe & { dataDir: string }, out: Out): number {
  const timers = timerSpaces(p.dataDir);
  if (!timers.length) return 0;
  if (!p.running?.()) {
    const file = join(p.dataDir, "modes.json");
    const modes: Record<string, string> = readJson(file) ?? {};
    for (const id of timers) modes[id] = "regular";
    writeAtomic(file, JSON.stringify(modes, null, 2));
    out(`Turned off the timer of ${timers.join(", ")}`);
    return 0;
  }
  const failed = timers.filter((id) => !p.setRegular?.(id));
  if (failed.length) out(`Could not turn off the timer of ${failed.join(", ")}: Lineclear's server did not take the change`);
  const done = timers.filter((id) => !failed.includes(id));
  if (done.length) out(`Turned off the timer of ${done.join(", ")}`);
  return failed.length ? 1 : 0;
}

/** Turns every timer off on this machine, printing each. */
export function fixRetired(p: Probe, out: Out): number {
  let code = 0;
  if (p.dataDir) code = Math.max(code, fixTimers({ ...p, dataDir: p.dataDir }, out));
  return code;
}

/** `lineclear doctor --fix`: here, then on each machine added in Settings (`here`: only this one, which a machine reached over SSH runs). */
export async function fixAll(p: Probe, out: Out, env: Env = process.env, here = false): Promise<number> {
  if (here) return fixRetired(p, out);
  out("This machine");
  const lines: string[] = [];
  let bad = fixRetired(p, (l) => lines.push(l));
  for (const l of lines.length ? lines : ["Nothing to remove."]) out(`  ${l}`);
  for (const { host } of readMachines(env)) {
    out(host);
    const r = await remoteLineclear(host, ["doctor", "--fix", "--here"], env, 120_000);
    for (const l of r.lines) out(`  ${l}`);
    if (r.code !== 0) bad = 1;
  }
  return bad;
}
