import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Check, Probe } from "./doctor.ts";

/** Control Center units whose verdict in docs/control-center.md is "moves" or "stays": they keep running until their replacement does. */
const KEPT = /^cc-(machine-backup|restore-drill|secrets-check|backup)(?=[@.-]|$)/;

/** Processes of Control Center's web server, its dashboard and its scripts. Not the secrets folder, which Lineclear still reads. */
const PROCESS =
  /scripts\/control-center\/|\bcc-(control-center|playwright-dashboard|tick|compaction-check|context|notify-[a-z]+|status-[a-z]+|agent-names|data-sync|deploy|quota-resume)\b/;

// a unit that failed still shows as failed in systemctl until it is reset
const ACTIVE = new Set(["active", "activating", "reloading", "failed"]);
const ENABLED = new Set(["enabled", "enabled-runtime", "linked", "linked-runtime"]);

const SYSTEMCTL = ["systemctl", "--user"];
const LISTING = ["--plain", "--no-legend", "--no-pager"];

function goes(unit: string): boolean {
  return unit.startsWith("cc-") && !KEPT.test(unit);
}

function rows(p: Probe, args: string[]): string[][] {
  const text = p.which("systemctl") ? p.run([...SYSTEMCTL, ...args, ...LISTING, "cc-*"]) : null;
  return (text ?? "")
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((r) => r.length > 1 && goes(r[0] ?? ""));
}

/** Units of Control Center that Lineclear replaced and that run or are enabled still. */
function ccUnits(p: Probe): string[] {
  const running = rows(p, ["list-units", "--all"])
    .filter((r) => ACTIVE.has(r[2] ?? ""))
    .map((r) => r[0] as string);
  const enabled = rows(p, ["list-unit-files"])
    .filter((r) => ENABLED.has(r[1] ?? ""))
    .map((r) => r[0] as string);
  // an enabled instance of a template (cc-tailnet@8787) is only a link in a .wants folder, which no listing shows
  const links = (p.run(["find", join(homedir(), ".config/systemd/user"), "-path", "*.wants/cc-*@*.service"]) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => basename(l))
    .filter(goes);
  return [...new Set([...running, ...enabled, ...links])];
}

/** Process ids (with their command lines) of Control Center that run now, never this doctor. */
function ccProcesses(p: Probe): { pid: string; args: string }[] {
  const text = p.run(["ps", "-eo", "pid=,args="]);
  const found: { pid: string; args: string }[] = [];
  for (const line of (text ?? "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m && PROCESS.test(m[2] as string) && !/\blineclear\b|\bdoctor\b|\bps -eo\b/.test(m[2] as string) && m[1] !== String(process.pid)) {
      found.push({ pid: m[1] as string, args: m[2] as string });
    }
  }
  return found;
}

export function controlCenterCheck(p: Probe): Check {
  const units = ccUnits(p);
  const procs = ccProcesses(p);
  const parts = [units.length ? `units ${units.join(", ")}` : "", procs.length ? `processes ${procs.map((x) => x.pid).join(", ")}` : ""].filter(Boolean);
  return { name: "no Control Center left", problem: parts.length ? `Control Center still has ${parts.join("; ")}` : "", fix: "lineclear doctor --fix" };
}

/** Stops and disables each unit, then ends each process left. Returns 1 when something stays. */
export function fixControlCenter(p: Probe, out: (line: string) => void): number {
  let code = 0;
  const units = ccUnits(p);
  if (units.length) {
    if (p.run([...SYSTEMCTL, "disable", "--now", ...units]) !== null) {
      p.run([...SYSTEMCTL, "reset-failed", ...units]);
      out(`Stopped and disabled ${units.join(", ")}`);
    } else {
      out(`Could not stop ${units.join(", ")}.`);
      code = 1;
    }
  }
  const procs = ccProcesses(p);
  if (procs.length) {
    if (p.run(["kill", ...procs.map((x) => x.pid)]) !== null) out(`Ended Control Center process ${procs.map((x) => x.pid).join(", ")}`);
    else {
      out(`Could not end Control Center process ${procs.map((x) => x.pid).join(", ")}.`);
      code = 1;
    }
  }
  return code;
}
