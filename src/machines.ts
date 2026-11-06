import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { cpus, hostname, loadavg } from "node:os";
import { resolve } from "node:path";
import { HOST, machinesFile, readMachines, type SavedMachine } from "./machine-list.ts";
import { doctorChecks, herdrUnsaved, realProbe } from "./doctor.ts";
import { herdrArgv } from "./herdr.ts";
import { networkTrouble, type Trouble } from "./health.ts";
import { relationOf, type Relation, remoteExports } from "./remotes.ts";
import { LINECLEAR, quote, run, sshArgs } from "./ssh.ts";
import { listProjectNames, readSettings } from "./project.ts";
import { cloneOn } from "./spread.ts";
import { codeCommit, pathsFor } from "./paths.ts";
import { readRelease } from "./release.ts";
import { configDir } from "../pi/config.ts";
import { limitOf, loadLimit } from "./waits.ts";
import { gitText } from "./git.ts";

// The machines Lineclear runs on: this one, and each one added by its SSH host. Adding one runs install.sh there over
// SSH and then its doctor. The list is `<config>/machines.json`, written by the CLI and the Settings view alike.

type Env = Record<string, string | undefined>;

type MachineState = "installing" | "ready" | "failed" | "unreachable";

export interface MachineView {
  host: string;
  local: boolean;
  state: MachineState;
  since?: string;
  doctor?: string[];
  load?: number;
  limit?: number;
  /** The commit of the Lineclear it runs, how it stands to this machine's by git ancestry, and whether it is the stable build. */
  version?: string;
  relation?: Relation;
  /** True when it runs a commit older than, or apart from, this machine's: Update moves it. */
  behind?: boolean;
  stable?: boolean;
  /** Its task slots: how many tasks may work on it at once, and how many do now. */
  slots?: { total: number; busy: number };
}

/** An SSH host as `ssh` takes it: an alias, a name or an address, with an optional user. Never an option. */
const INSTALL_SH = resolve(import.meta.dir, "..", "install.sh");
/** A test or demo run (it sets LINECLEAR_DOCTOR_FILE) never reaches out to the network. */
function networkDue(env: Env, last: { at: number; busy: boolean } | undefined, t: number): boolean {
  if (env.LINECLEAR_DOCTOR_FILE !== undefined) return false;
  return !last || (!last.busy && t - last.at > 30_000);
}

/** Changes one machine in the file, read again just before, so two writers do not undo each other. */
function saveMachine(host: string, m: SavedMachine | undefined, env: Env) {
  const all = readMachines(env);
  const at = all.findIndex((x) => x.host === host);
  // a machine keeps its place, and a new one comes last
  const next = !m ? all.filter((x) => x.host !== host) : at < 0 ? [...all, m] : all.map((x, i) => (i === at ? m : x));
  const file = machinesFile(env);
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(file, `${JSON.stringify({ machines: next }, null, 2)}\n`);
}

/** Clones each project's repo the machine lacks, from the origin the server clones from. Returns what failed, one line each. */
function cloneProjects(host: string, env: Env, say: (l: string) => void): string[] {
  const failed: string[] = [];
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s === "string") continue;
    const origin = gitText(s.repo, "remote", "get-url", "origin");
    if (origin === undefined) continue;
    const err = cloneOn(host, s.space, origin, env);
    say(`  ${name}: ${err ? `FAILED ${err}` : `repo is on ${host}`}`);
    if (err) failed.push(`FAILED repo of ${name}: ${err}`);
  }
  return failed;
}

/**
 * Runs install.sh on a machine over SSH, then the safe fixes, the project repos and its doctor, and saves how it went. LINECLEAR_REF and LINECLEAR_REPO go
 * along when set, so the machine gets the same version; with no LINECLEAR_REF it gets this machine's stable build, and
 * it follows this machine (LINECLEAR_FOLLOWS): it promotes no build of its own. The doctor runs with the PATH install.sh and the service use.
 */
export async function installMachine(host: string, env: Env = process.env, say: (l: string) => void = () => {}): Promise<SavedMachine> {
  const since = new Date().toISOString();
  if (!existsSync(INSTALL_SH)) {
    const failed: SavedMachine = { host, state: "failed", since, doctor: [`install.sh is missing: ${INSTALL_SH}`] };
    saveMachine(host, failed, env);
    return failed;
  }
  saveMachine(host, { host, state: "installing", since, pid: process.pid }, env);
  // a machine gets this one's stable build, not main, unless a ref is given
  const stable = readRelease(env).stable?.commit;
  const given: Env = { ...(stable ? { LINECLEAR_REF: stable } : {}), LINECLEAR_FOLLOWS: hostname().split(".")[0] ?? "", ...env };
  const pass = ["LINECLEAR_REF", "LINECLEAR_REPO", "LINECLEAR_NO_FANOUT", "LINECLEAR_FOLLOWS"].filter((k) => given[k]).map((k) => `${k}=${quote(given[k]!)}`);
  say(`Installing Lineclear on ${host} over SSH`);
  const install = await run(sshArgs(env, host, `${pass.length ? `env ${pass.join(" ")} ` : ""}sh -s`), readFileSync(INSTALL_SH, "utf8"), 30 * 60_000, env);
  for (const l of install.lines) say(`  ${l}`);
  let done: SavedMachine;
  if (install.code !== 0) {
    const why =
      install.code === 255
        ? `SSH could not reach ${host}.`
        : install.code === 124
          ? "The install took over 30 minutes."
          : `install.sh failed (exit ${install.code}).`;
    done = { host, state: "failed", since, doctor: [why, ...install.lines.slice(-8)] };
  } else {
    // the server places tasks only on machines herdr has saved; a test or demo run never reaches out
    const listed = (c: string[]) => Bun.spawnSync(c, { stdin: "ignore", env: env as Record<string, string> }).stdout.toString() || null;
    if (env.LINECLEAR_DOCTOR_FILE === undefined && Bun.which("herdr") && herdrUnsaved(listed, [host]).length > 0) {
      const saved = await run(herdrArgv(["machine", "add", host]), undefined, 120_000, env);
      say(saved.code === 0 ? `Saved ${host} in herdr` : `herdr could not save ${host}; run: herdr machine add ${host}`);
    }
    say(`Fixing what is safe to fix on ${host}`);
    const fixed = await run(sshArgs(env, host, `${LINECLEAR} doctor --fix --here`), undefined, 120_000, env);
    for (const l of fixed.lines) say(`  ${l}`);
    say(`Cloning the project repos on ${host}`);
    const cloneFailed = cloneProjects(host, env, say);
    say(`Running lineclear doctor on ${host}`);
    const doctor = await run(sshArgs(env, host, `${LINECLEAR} doctor`), undefined, 60_000, env);
    for (const l of doctor.lines) say(`  ${l}`);
    const lines = doctor.lines.length ? doctor.lines : [`lineclear doctor failed (exit ${doctor.code}).`];
    done = {
      host,
      state: cloneFailed.length === 0 && doctor.code === 0 ? "ready" : "failed",
      since,
      doctor: [...cloneFailed, ...lines],
    };
  }
  // a machine removed while it installed stays removed
  if (readMachines(env).some((m) => m.host === host && m.since === since)) saveMachine(host, done, env);
  return done;
}

/** The build a machine runs, as its `lineclear --version` says; empty when it does not answer. */
async function buildOn(host: string, env: Env): Promise<string> {
  const r = await run(sshArgs(env, host, `${LINECLEAR} --version`), undefined, 30_000, env);
  return r.code === 0 ? (r.lines.at(-1) ?? "") : "";
}

async function rollBack(host: string, env: Env, out: (l: string) => void): Promise<void> {
  const back = await run(sshArgs(env, host, `${LINECLEAR} release rollback`), undefined, 120_000, env);
  out(back.code === 0 ? `${host} is back on its previous build.` : `${host} could not go back: ${back.lines.at(-1) ?? `exit ${back.code}`}`);
}

/** Files the one fix for a machine that did not take a build; returns what it did, in words. */
type FileFix = (evidence: string[]) => string;

/**
 * Updates the machines one by one, each to the build this one runs, with the install's own smoke check there. The
 * machine's own list is not followed (LINECLEAR_NO_FANOUT), so no machine updates the others in a loop. A machine that
 * does not end ready goes back to its previous build, and the machines after it stay on theirs: one fix is filed.
 * Returns how many did not end ready.
 */
async function updateMachines(hosts: string[], env: Env, out: (l: string) => void, fileFix?: FileFix): Promise<number> {
  for (const [i, host] of hosts.entries()) {
    const before = await buildOn(host, env);
    const m = await installMachine(host, { ...env, LINECLEAR_NO_FANOUT: "1" }, out);
    if (m.state === "ready") {
      out(`${host} is up to date.`);
      continue;
    }
    // the doctor lists passing checks too: the reason is the first failed line
    const why = m.doctor?.find((l) => l.startsWith("FAILED")) ?? m.doctor?.[0] ?? "doctor failed";
    out(`${host} is not ready: ${why}`);
    // a machine whose build did not change has nothing to go back from
    const after = await buildOn(host, env);
    // an unknown build is no proof of a change: roll back only when both are known and differ
    if (!before || !after || after === before) out(`${host} still runs its previous build.`);
    else await rollBack(host, env, out);
    const rest = hosts.slice(i + 1);
    if (rest.length) out(`Stopped: ${rest.join(", ")} stay on their old build.`);
    if (fileFix) out(fileFix([`lineclear machine update: ${host} did not take the new build: ${why}`, ...(m.doctor ?? []).slice(1, 4)]));
    return 1;
  }
  return 0;
}

export function removeMachine(host: string, env: Env = process.env): boolean {
  if (!readMachines(env).some((m) => m.host === host)) return false;
  saveMachine(host, undefined, env);
  return true;
}

/** This machine's doctor, as one line per problem, or none when all is well. */
function localDoctor(env: Env = process.env): string[] {
  try {
    const lines: string[] = [];
    for (const c of doctorChecks(realProbe(pathsFor(env), env))) {
      if (c.skip) continue;
      lines.push(c.problem === "" ? `ok     ${c.name}` : `FAILED ${c.name}: ${c.problem}`, ...(c.problem === "" ? [] : [`       fix: ${c.fix}`]));
    }
    return lines;
  } catch (e) {
    return [`FAILED doctor: ${(e as Error).message}`];
  }
}

/** What Settings says of a machine's commit: how it stands to this machine's, and whether it is stable. */
function versionView(theirs: string, mine: string, stable: string | undefined): Pick<MachineView, "version" | "relation" | "behind" | "stable"> {
  const relation = relationOf(mine, theirs);
  return {
    version: theirs,
    ...(relation === "same" ? {} : { relation }),
    behind: relation === "behind" || relation === "different",
    ...(stable === theirs ? { stable: true } : {}),
  };
}

/** Reads a machine's load average, cores and load limit over SSH: `null` when it cannot be reached. */
export async function remoteLoad(host: string, env: Env = process.env): Promise<{ load: number; limit: number } | null> {
  const r = await run(sshArgs(env, host, "cat /proc/loadavg; nproc; cat ~/.config/lineclear/machine.json 2>/dev/null || true"), undefined, 15_000, env);
  if (r.code !== 0) return null;
  const load = Number(r.lines[0]?.split(/\s+/)[0]);
  const cores = Number(r.lines[1]);
  if (!Number.isFinite(load) || !Number.isFinite(cores)) return null;
  let limit = limitOf(undefined, cores);
  try {
    limit = limitOf(JSON.parse(r.lines.slice(2).join("\n")), cores);
  } catch {
    // no machine settings there: the limit is its cores
  }
  return { load, limit };
}

/** How many tasks Lineclear lets work on this machine at once, from `lineclear show`. */
async function localMaxTasks(env: Env = process.env): Promise<number | undefined> {
  try {
    const p = Bun.spawn([env.LINECLEAR_SERVER_BIN ?? "lineclear", "show"], { stdin: "ignore", stderr: "ignore", timeout: 10_000 });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    const m = /^machine\.maxTasks\s+(\d+)/m.exec(out);
    return code === 0 && m ? Number(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The machines as Settings shows them, this one first. Each other machine's load is read over SSH in the
 * background at most every 15 s, and this one's doctor at most once a minute, so a read never waits on SSH.
 *
 * `busy` counts the tasks at work; only this machine's tasks are listed, so they are all this machine's.
 */
export function machinesView(env: Env = process.env, now = () => Date.now(), busy?: () => number) {
  const loads = new Map<string, { at: number; read: { load: number; limit: number } | null; busy: boolean }>();
  let doctor: { at: number; lines: string[] } | undefined;
  // the network is checked in the background, so a read never waits for a timeout
  let network: { at: number; trouble: Trouble | undefined; busy: boolean } | undefined;
  const mine = codeCommit();
  // `lineclear show` can be slow, so the slot count is read in the background, with the doctor
  let max: number | undefined;
  let maxAt = -Infinity;
  const readMax = () => {
    if (!busy) return;
    maxAt = now();
    void localMaxTasks(env).then((m) => (max = m));
  };
  const view = (): MachineView[] => {
    const exported = new Map(remoteExports(env).map((e) => [e.host, e]));
    const stable = readRelease(env).stable?.commit;
    const t = now();
    // the demo shows no real host, load or folder
    if (env.LINECLEAR_DEMO) return [{ host: "this-machine", local: true, state: "ready", doctor: ["All well."], load: 1.4, limit: 8, version: mine }];
    if (!doctor || t - doctor.at > 60_000) doctor = { at: t, lines: localDoctor(env) };
    if (t - maxAt > 60_000) readMax();
    if (networkDue(env, network, t)) {
      const entry = { at: t, trouble: network?.trouble, busy: true };
      network = entry;
      void networkTrouble(env).then((trouble) => Object.assign(entry, { trouble, at: now(), busy: false }));
    }
    const lines = network?.trouble
      ? [...doctor.lines, `FAILED ${network.trouble.name}: ${network.trouble.problem}`, `       fix: ${network.trouble.fix}`]
      : doctor.lines;
    const here: MachineView = {
      host: hostname(),
      local: true,
      state: lines.some((l) => l.startsWith("FAILED")) ? "failed" : "ready",
      doctor: lines,
      load: Math.round((loadavg()[0] ?? 0) * 100) / 100,
      limit: loadLimit(env) || cpus().length,
      version: mine,
      ...(stable === mine ? { stable: true } : {}),
      ...(max && busy ? { slots: { total: max, busy: Math.min(busy(), max) } } : {}),
    };
    const saved = readMachines(env);
    for (const host of loads.keys()) if (!saved.some((m) => m.host === host)) loads.delete(host);
    const others = saved.map((m): MachineView => {
      let l = loads.get(m.host);
      const told = exported.get(m.host);
      // the load rides on the export the work already reads over the worker link; SSH reads it only from a machine whose Lineclear does not tell it
      if (m.state === "ready" && !told?.load && (!l || (!l.busy && t - l.at > 15_000))) {
        const entry = (l ??= { at: t, read: null, busy: false });
        loads.set(m.host, entry);
        entry.busy = true;
        void remoteLoad(m.host, env).then((read) => Object.assign(entry, { read, at: now(), busy: false }));
      }
      l = loads.get(m.host);
      const reached = told?.load ?? l?.read ?? undefined;
      const unreachable = m.state === "ready" && !told && l !== undefined && !l.busy && l.read === null;
      return {
        host: m.host,
        local: false,
        state: unreachable ? "unreachable" : m.state,
        since: m.since,
        ...(told ? versionView(told.commit, mine, stable) : {}),
        ...(m.doctor ? { doctor: m.doctor } : {}),
        ...(reached && m.state === "ready" ? { load: reached.load, limit: reached.limit } : {}),
      };
    });
    return [here, ...others];
  };
  // after a fix, the next read looks again instead of waiting out the minute
  view.recheck = () => {
    doctor = undefined;
  };
  return view;
}

function fail(out: (l: string) => void, message: string): number {
  out(`lineclear machine: ${message}`);
  return 1;
}

async function addMain(host: string, env: Env, out: (l: string) => void): Promise<number> {
  if (!HOST.test(host)) return fail(out, `'${host}' is not an SSH host`);
  if (!existsSync(INSTALL_SH)) return fail(out, `install.sh is missing: ${INSTALL_SH}`);
  const m = await installMachine(host, env, out);
  out(m.state === "ready" ? `${host} is ready: doctor passed there.` : `${host} is not ready: ${m.doctor?.[0] ?? "doctor failed"}`);
  return m.state === "ready" ? 0 : 1;
}

function listMain(env: Env, out: (l: string) => void): number {
  out(`${hostname()}  this machine  load ${(loadavg()[0] ?? 0).toFixed(2)} of ${loadLimit(env)}`);
  for (const m of readMachines(env)) out(`${m.host}  ${m.state}  since ${m.since.slice(0, 16).replace("T", " ")}`);
  return 0;
}

function removeMain(host: string, env: Env, out: (l: string) => void): number {
  if (!removeMachine(host, env)) return fail(out, `no machine named '${host}'`);
  out(`removed machine '${host}' (Lineclear stays installed there; run 'lineclear uninstall' on it to take it away)`);
  return 0;
}

async function updateMain(host: string | undefined, env: Env, out: (l: string) => void, fileFix?: FileFix): Promise<number> {
  const saved = readMachines(env).map((m) => m.host);
  if (host !== undefined && !saved.includes(host)) return fail(out, `no machine named '${host}'`);
  return (await updateMachines(host ? [host] : saved, env, out, fileFix)) ? 1 : 0;
}

export async function machineMain(args: string[], out: (l: string) => void, env: Env = process.env, fileFix?: FileFix): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "add" && rest.length === 1) return addMain(rest[0]!, env, out);
  if (sub === "list" && rest.length === 0) return listMain(env, out);
  if (sub === "remove" && rest.length === 1) return removeMain(rest[0]!, env, out);
  if (sub === "update" && rest.length <= 1) return updateMain(rest[0], env, out, fileFix);
  out("usage: lineclear machine add <ssh host> | list | remove <ssh host> | update [<ssh host>]");
  return 2;
}
