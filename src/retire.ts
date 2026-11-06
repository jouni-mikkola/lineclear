import { existsSync, readFileSync, rmSync } from "node:fs";
import { herdrArgv } from "./herdr.ts";
import { writeAtomic } from "../pi/atomic.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Check, Probe } from "./doctor.ts";
import { readJson } from "../pi/config.ts";
import { OLD_PLUGIN_ID } from "./paths.ts";
import { OLD_NAME, oldDir } from "./old-install.ts";
import { archiveFolder } from "./old-archive.ts";
import { copyBrowsers, uncopiedBrowsers, oldPathRecords, rewriteOldPaths, type Roots } from "./old-paths.ts";
import { remoteLineclear } from "./ssh.ts";
import { readMachines } from "./machine-list.ts";
import { fixLeftovers } from "./leftovers.ts";
import { timerAllowed } from "../server/server/live/timer-rule.ts";

type Env = Record<string, string | undefined>;
type Out = (line: string) => void;

/** The skills herdr-projects 2.0 and its herdr plugin install for agents. */
const OLD_SKILLS = [OLD_NAME, `${OLD_NAME}-agent`, `${OLD_NAME}-coordinator`, OLD_PLUGIN_ID];

/** The folders where agent programs read skills, and the helper folder herdr-projects 2.0 keeps its own in. */
export function skillRoots(env: Env = process.env): string[] {
  const home = env.HOME ?? homedir();
  return [
    join(oldDir(env), "helper", "skill"),
    join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "skills"),
    join(env.CODEX_HOME || join(home, ".codex"), "skills"),
    join(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "skills"),
    join(home, ".agents", "skills"),
  ];
}

/** Skill folders of herdr-projects 2.0: named like one and holding a SKILL.md of the same name. */
function oldSkills(roots: string[]): string[] {
  const found: string[] = [];
  for (const root of roots) {
    for (const name of OLD_SKILLS) {
      try {
        if (new RegExp(`^name: ${name}\\s*$`, "m").test(readFileSync(join(root, name, "SKILL.md"), "utf8"))) found.push(join(root, name));
      } catch {}
    }
  }
  return found;
}

/** Whether herdr has herdr-projects 2.0's plugin installed. */
function pluginInstalled(p: Probe): boolean {
  const text = p.which("herdr") ? p.run(herdrArgv(["plugin", "list", "--json"])) : null;
  if (text === null) return false;
  try {
    const plugins = JSON.parse(text)?.result?.plugins;
    return Array.isArray(plugins) && plugins.some((x: any) => x?.plugin_id === OLD_PLUGIN_ID);
  } catch {
    return false;
  }
}

/** The spaces of this machine whose coordinator wakes on a timer. */
function timerSpaces(dir: string, env: Env = process.env): string[] {
  if (timerAllowed(env)) return [];
  const modes: Record<string, string> = readJson(join(dir, "modes.json")) ?? {};
  return Object.keys(modes).filter((id) => modes[id] === "autopilot");
}

/** Spaces still only in herdr-projects 2.0's folder: it has spaces and Lineclear has not moved them. */
function unmoved(p: Probe): boolean {
  if (!existsSync(join(p.oldDir, "spaces.json"))) return false;
  return !p.dataDir || !existsSync(join(p.dataDir, "migrated.json"));
}

const FIX = "lineclear doctor --fix";

const rootsOf = (p: Probe): Roots | undefined => (p.dataDir ? { old: p.oldDir, now: p.dataDir, app: p.paths.app } : undefined);

export function retiredChecks(p: Probe): Check[] {
  const skills = oldSkills(p.skillRoots ?? []);
  const timers = p.dataDir ? timerSpaces(p.dataDir) : [];
  const roots = rootsOf(p);
  return [
    {
      name: "old install plugin removed",
      problem: pluginInstalled(p) ? `the herdr plugin ${OLD_PLUGIN_ID} is still installed` : "",
      fix: FIX,
    },
    {
      name: "old install skills removed",
      problem: skills.length ? `still installed: ${skills.join(", ")}` : "",
      fix: FIX,
    },
    {
      name: "spaces moved to Lineclear",
      problem: unmoved(p) ? `${p.oldDir} has spaces that run on the old install` : "",
      fix: "lineclear migrate",
    },
    {
      name: "records hold no old paths",
      problem: roots ? oldPathRecords(roots) : "",
      fix: FIX,
    },
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
 * Turns the timers off, when the owner asked (`doctor --fix`); the server's own heal gives `report` instead and changes nothing.
 * A running server keeps the modes in memory and writes them back, so it is asked; the file is edited only when none runs.
 */
function fixTimers(p: Probe & { dataDir: string }, out: Out, report?: (spaces: string[]) => void): number {
  const timers = timerSpaces(p.dataDir);
  if (!timers.length) return 0;
  if (report) {
    report(timers);
    return 0;
  }
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

/** Browser profiles are copied while an agent runs; the records are written only when no server holds them in memory, which would save over the file. */
function fixPaths(p: Probe, roots: Roots, out: Out): number {
  for (const task of copyBrowsers(roots)) out(`Copied the browser profile of ${task} to ${roots.now}/browser`);
  if (!oldPathRecords(roots)) return 0;
  if (p.running?.()) {
    out("Lineclear's server is running and would save over a rewrite: stop it, run lineclear doctor --fix, and start it again");
    return 1;
  }
  for (const f of rewriteOldPaths(roots)) out(`Rewrote the old paths in ${f}`);
  return 0;
}

/** Packs and removes each old folder, unless a running process still uses one: then nothing is removed. */
function archiveOldFolders(p: Probe, out: Out): number {
  const folders = p.oldFolders ?? [];
  if (folders.length === 0) return 0;
  const users = p.oldUsers?.() ?? [];
  if (users.length) {
    out(`Kept ${folders.join(" and ")}: ${users.length} running process${users.length === 1 ? "" : "es"} still use them (${users.slice(0, 3).join("; ")})`);
    return 1;
  }
  let code = 0;
  for (const dir of folders) {
    try {
      out(`Packed ${dir} to ${(p.archiveFolder ?? archiveFolder)(dir)} and removed it`);
    } catch (e) {
      out(`Kept ${dir}: ${e instanceof Error ? e.message : e}`);
      code = 1;
    }
  }
  return code;
}

/** Removes the old plugin and skills and turns every timer off on this machine, printing each (or only reporting the timers, with `reportTimers`). Returns 1 if the plugin stays. */
export function fixRetired(p: Probe, out: Out, reportTimers?: (spaces: string[]) => void): number {
  let code = 0;
  if (pluginInstalled(p)) {
    if (p.run(herdrArgv(["plugin", "uninstall", OLD_PLUGIN_ID])) !== null) out(`Removed the herdr plugin ${OLD_PLUGIN_ID}`);
    else {
      out(`Could not remove the herdr plugin ${OLD_PLUGIN_ID}.`);
      code = 1;
    }
  }
  for (const dir of oldSkills(p.skillRoots ?? [])) {
    rmSync(dir, { recursive: true, force: true });
    out(`Removed the skill ${dir}`);
  }
  if (p.dataDir) code = Math.max(code, fixTimers({ ...p, dataDir: p.dataDir }, out, reportTimers));
  const roots = rootsOf(p);
  const pathsCode = roots ? fixPaths(p, roots, out) : 0;
  code = Math.max(code, pathsCode);
  // records still pointing into the folder, or a profile not yet copied out, must not lose their target
  if (pathsCode === 0 && !(roots && uncopiedBrowsers(roots).length)) code = Math.max(code, archiveOldFolders(p, out));
  else if ((p.oldFolders ?? []).length) {
    out("Kept the old folders: their paths or browser profiles are not moved yet; run lineclear doctor --fix again");
    code = 1;
  }
  const old = p.oldTestFolders ?? [];
  if (old.length && p.removeTestFolders) {
    p.removeTestFolders(old);
    out(`Removed ${old.length} test folder${old.length === 1 ? "" : "s"} older than 6 hours that no process uses`);
  }
  return Math.max(code, fixLeftovers(p, out));
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

/** A machine that has Lineclear installed and only herdr-projects 2.0 left is installed: moving it is the next step. */
export function onlyOldInstallLeft(doctorLines: string[]): boolean {
  const failed = doctorLines.filter((l) => l.startsWith("FAILED "));
  return failed.length > 0 && failed.every((l) => OURS.some((n) => l.startsWith(`FAILED ${n}`)));
}

const OURS = [
  "old folders archived",
  "old install plugin removed",
  "old install skills removed",
  "herdr-projects 2.0 plugin removed",
  "herdr-projects 2.0 skills removed",
  "spaces moved to Lineclear",
  "no coordinator on a timer",
];

/** The failing lines of a machine's `doctor --here` that name what the move to Lineclear left of herdr-projects 2.0. */
function leftLines(doctorLines: string[]): string[] {
  return doctorLines.filter((l) => OURS.some((n) => l.startsWith(`FAILED ${n}`)));
}

/** What other machines still have of herdr-projects 2.0, from their own `lineclear doctor --here`: the failing lines. Returns the count. */
export async function remoteLeft(out: Out, env: Env = process.env): Promise<number> {
  let left = 0;
  for (const { host } of readMachines(env)) {
    const r = await remoteLineclear(host, ["doctor", "--here"], env, 60_000);
    const lines = leftLines(r.lines);
    for (const l of lines) out(`${host}: ${l.slice("FAILED ".length)}`);
    left += lines.length;
  }
  return left;
}
