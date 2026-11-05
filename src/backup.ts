import { closeSync, mkdirSync, openSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, readJson } from "../pi/config.ts";
import { dataDir } from "./paths.ts";
import { copyStoreQuietly } from "./store-copies.ts";
import { fail, host, maskSecrets, ownerSecret } from "./secrets.ts";

type Env = Record<string, string | undefined>;

/** A restic repository, and for sftp the SSH key that may only write there. */
interface Repo {
  repo: string;
  key?: string;
}

/** `<config>/backup.json`: where the copies go and what else goes in them. */
interface BackupSettings {
  repos: Repo[];
  paths: string[];
}

interface RepoState {
  ok: boolean;
  at: string;
  lastGood?: string;
  snapshot?: string;
  error?: string;
}

/** `<config>/backup-state.json`: each repository's last run, and the last thinning out with prune. */
interface BackupState {
  repos: Record<string, RepoState>;
  pruned?: string;
}

const BACKUP_EVERY_MS = 60 * 60 * 1000;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "LINECLEAR_BACKUP_PASSWORD";
const TAG = "lineclear";
/** Hourly copies for two days, daily ones for a month. */
export const KEEP = ["--keep-hourly", "48", "--keep-daily", "30"];

const settingsFile = (env: Env) => join(configDir(env), "backup.json");
const stateFile = (env: Env) => join(configDir(env), "backup-state.json");
const lockFile = (env: Env) => join(configDir(env), "backup.lock");
const home = (env: Env) => env.HOME ?? homedir();
const expand = (p: string, env: Env) => resolve(p.startsWith("~/") ? join(home(env), p.slice(2)) : p);

export function readBackupSettings(env: Env = process.env): BackupSettings | undefined {
  const s = readJson(settingsFile(env)) as Partial<BackupSettings> | undefined;
  if (s === undefined || !Array.isArray(s.repos) || s.repos.length === 0) return undefined;
  return { repos: s.repos.map((r) => (typeof r === "string" ? { repo: r } : r)), paths: Array.isArray(s.paths) ? s.paths : [] };
}

const readState = (env: Env): BackupState => (readJson(stateFile(env)) as BackupState | undefined) ?? { repos: {} };
const writeState = (s: BackupState, env: Env) => writeAtomic(stateFile(env), `${JSON.stringify(s, null, 2)}\n`);

/** What goes in: Lineclear's data and settings, then the extra paths; what can be made again stays out. */
function backupPaths(s: BackupSettings, env: Env): { paths: string[]; excludes: string[] } {
  const data = dataDir(env);
  return {
    paths: [data, configDir(env), ...s.paths.map((p) => expand(p, env))],
    excludes: [
      join(data, "browser"),
      join(data, "helper"),
      join(data, "autopilot-runtime"),
      join(data, "machines", "*", "mirror"),
      lockFile(env),
      "*.tmp",
      "*.sock",
    ],
  };
}

/** Runs restic with the password and, for sftp, the repository's own key. Returns its exit code and output. */
type Restic = (repo: Repo, args: string[]) => { code: number; out: string; err: string };

function realRestic(password: string, env: Env): Restic {
  return (repo, args) => {
    const sftp = repo.key && /^sftp:([^:/][^:]*):/.exec(repo.repo)?.[1];
    const opts = sftp ? ["-o", `sftp.command=ssh -i ${expand(repo.key ?? "", env)} -o IdentitiesOnly=yes -o BatchMode=yes ${sftp} -s sftp`] : [];
    const p = Bun.spawnSync(["restic", ...opts, ...args], {
      env: { ...env, RESTIC_REPOSITORY: repo.repo, RESTIC_PASSWORD: password } as Record<string, string>,
      stdin: "ignore",
      timeout: 2 * 60 * 60 * 1000,
    });
    return { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
  };
}

const lastLine = (text: string, env: Env) => maskSecrets(text.trim().split("\n").at(-1) ?? "", env);

/** Backs up to one repository, making it on its first use. Returns its new state. */
function backupTo(repo: Repo, restic: Restic, s: BackupSettings, prune: boolean, env: Env, now: Date): RepoState {
  if (restic(repo, ["cat", "config"]).code !== 0) {
    const made = restic(repo, ["init"]);
    if (made.code !== 0) return { ok: false, at: now.toISOString(), error: `could not make the repository: ${lastLine(made.err, env)}` };
  }
  const { paths, excludes } = backupPaths(s, env);
  const args = ["backup", "--json", "--tag", TAG, "--host", host(env), ...excludes.flatMap((e) => ["--exclude", e]), ...paths];
  const run = restic(repo, args);
  // 3: some files could not be read, the copy of the rest is made
  if (run.code !== 0 && run.code !== 3) return { ok: false, at: now.toISOString(), error: lastLine(run.err, env) };
  const summary = run.out
    .split("\n")
    .map((l) => readJsonText(l))
    .find((j) => j?.message_type === "summary");
  // one series per machine: a repository two machines share thins each one's copies apart
  const kept = restic(repo, ["forget", "--tag", TAG, "--host", host(env), ...KEEP, ...(prune ? ["--prune"] : [])]);
  if (kept.code !== 0)
    return { ok: false, at: now.toISOString(), lastGood: now.toISOString(), error: `saved, but old copies were not removed: ${lastLine(kept.err, env)}` };
  return { ok: true, at: now.toISOString(), lastGood: now.toISOString(), snapshot: summary?.snapshot_id?.slice(0, 8) };
}

function readJsonText(line: string): { message_type?: string; snapshot_id?: string } | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** One run to every repository. Two runs never overlap: the second one finds the lock and ends. */
function runBackup(out: (l: string) => void, env: Env = process.env, now = new Date(), restic?: Restic): number {
  const s = readBackupSettings(env);
  if (s === undefined) return fail(out, `no repository set: write ${settingsFile(env)} as {"repos": ["<restic repository>"]}`, "backup");
  const password = env[PASSWORD] ?? ownerSecret(PASSWORD, env);
  if (!password) return fail(out, `${PASSWORD} is not set: lineclear secrets set --owner ${PASSWORD} (the value on stdin)`, "backup");
  mkdirSync(configDir(env), { recursive: true });
  let lock: number;
  try {
    lock = openSync(lockFile(env), "wx");
  } catch {
    out("lineclear backup: another backup runs now");
    return 0;
  }
  try {
    const state = readState(env);
    const prune = now.getTime() - Date.parse(state.pruned ?? "") >= PRUNE_EVERY_MS || state.pruned === undefined;
    const run = restic ?? realRestic(password, env);
    let failed = 0;
    for (const repo of s.repos) {
      const r = backupTo(repo, run, s, prune, env, now);
      const was = state.repos[repo.repo];
      const lastGood = r.lastGood ?? was?.lastGood;
      state.repos[repo.repo] = r.ok ? r : { ...r, ...(lastGood ? { lastGood } : {}) };
      out(r.ok ? `saved to ${repo.repo}${r.snapshot ? ` (${r.snapshot})` : ""}` : `FAILED ${repo.repo}: ${r.error}`);
      if (!r.ok) failed++;
    }
    if (prune && failed === 0) state.pruned = now.toISOString();
    writeState(state, env);
    return failed === 0 ? 0 : 1;
  } finally {
    closeSync(lock);
    rmSync(lockFile(env), { force: true });
  }
}

/** Whether the rule loop starts a run now: a repository is set and the last try is an hour old. */
export function backupDue(env: Env = process.env, now = new Date()): boolean {
  const s = readBackupSettings(env);
  if (s === undefined) return false;
  const state = readState(env);
  return s.repos.some((r) => now.getTime() - Date.parse(state.repos[r.repo]?.at ?? "") >= BACKUP_EVERY_MS || state.repos[r.repo] === undefined);
}

/** The rule loop's part: a due run starts apart and the tick goes on. A lock left by a killed run expires in a day. */
export function startBackupIfDue(env: Env = process.env, now = new Date()): void {
  copyStoreQuietly(env, now); // the local rolling copy, for a machine with no restic repository too
  try {
    if (now.getTime() - statSync(lockFile(env)).mtimeMs > STALE_MS) rmSync(lockFile(env), { force: true });
  } catch {
    // no lock: nothing runs
  }
  if (!backupDue(env, now)) return;
  Bun.spawn([process.execPath, join(import.meta.dir, "..", "bin", "lineclear"), "backup"], {
    env: env as Record<string, string>,
    stdio: ["ignore", "ignore", "ignore"],
  }).unref();
}

/** For doctor: what is wrong with the backup, or "" (also when none is set: that is a choice). */
export function backupProblem(env: Env = process.env, now = new Date()): string {
  const s = readBackupSettings(env);
  if (s === undefined) return "";
  const state = readState(env);
  const old = s.repos.filter((r) => !(now.getTime() - Date.parse(state.repos[r.repo]?.lastGood ?? "") < STALE_MS));
  return old.length === 0
    ? ""
    : `no good backup in a day to ${old.map((r) => r.repo).join(", ")}${state.repos[old[0]?.repo ?? ""]?.error ? `: ${state.repos[old[0]?.repo ?? ""]?.error}` : ""}`;
}

function status(out: (l: string) => void, env: Env): number {
  const s = readBackupSettings(env);
  if (s === undefined) {
    out(`no backup: no repository in ${settingsFile(env)}`);
    return 0;
  }
  const state = readState(env);
  for (const r of s.repos) {
    const x = state.repos[r.repo];
    out(
      `${r.repo}  ${x?.lastGood ? `last copy ${x.lastGood}${x.snapshot && x.ok ? ` (${x.snapshot})` : ""}` : "no copy yet"}${x && !x.ok ? `, last run failed: ${x.error}` : ""}`,
    );
  }
  return 0;
}

/** The latest copy this machine made, or the one machine `from` made: a new disk restores the old machine's. */
function restore(dir: string, from: string, out: (l: string) => void, env: Env, restic?: Restic): number {
  const s = readBackupSettings(env);
  if (s === undefined) return fail(out, `no repository in ${settingsFile(env)}`, "backup");
  const password = env[PASSWORD] ?? ownerSecret(PASSWORD, env);
  if (!password) return fail(out, `${PASSWORD} is not set`, "backup");
  const run = restic ?? realRestic(password, env);
  for (const repo of s.repos) {
    const r = run(repo, ["restore", "latest", "--tag", TAG, "--host", from, "--target", resolve(dir)]);
    if (r.code === 0) {
      out(`restored the latest copy from ${repo.repo} into ${resolve(dir)}`);
      return 0;
    }
    out(`could not restore ${from}'s copy from ${repo.repo}: ${lastLine(r.err, env)}`);
  }
  out("a copy another machine made: lineclear backup restore <dir> --from <its name>");
  return 1;
}

export function backupMain(args: string[], out: (l: string) => void, env: Env = process.env, restic?: Restic, now = new Date()): number {
  const [sub, ...rest] = args;
  if (sub === undefined) return runBackup(out, env, now, restic);
  if (sub === "status" && rest.length === 0) return status(out, env);
  const [dir, flag, from] = rest;
  if (sub === "restore" && dir !== undefined && (rest.length === 1 || (rest.length === 3 && flag === "--from" && from)))
    return restore(dir, from ?? host(env), out, env, restic);
  out("usage: lineclear backup | backup status | backup restore <dir> [--from <machine>]");
  return 2;
}
