import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { herdrArgv, herdrVersionOf } from "./herdr.ts";
import { userInfo } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { failureTail } from "./secrets.ts";
import { backupProblem, readBackupSettings } from "./backup.ts";
import { copiesProblem, runByNote } from "./store-copies.ts";
import { follows, type ReleaseState, readRelease, releaseLines } from "./release.ts";
import { tryLines } from "./try-instance.ts";
import { cacheEnvFile, dataDir, extensionFile, INSTALL_URL, type Paths, SERVICE, OLD_PLUGIN_ID, serverBin } from "./paths.ts";
import { OLD_DIR_NAME, oldDir, pluginConfig, oldFolders, oldFolderUsers } from "./old-install.ts";
import { archiveFolder } from "./old-archive.ts";
import type { Relation } from "./remotes.ts";
import { agentsOnOldName, helperApart } from "./helper.ts";
import { realBusy } from "./old-install.ts";
import { diskTrouble, freeBytes } from "./health.ts";
import { retiredChecks, skillRoots } from "./retire.ts";
import { type Kit, kitDiff, kitOthers, type Wanted } from "./kit.ts";
import { parts } from "./pack.ts";
import { readModelFile } from "./models.ts";
import { checkoutPointers } from "./install-paths.ts";
import { buildNames, buildProblem, buildsDir, installReleaseCommand, type RunFrom, unitCommand } from "./builds.ts";
import { unknownWindows } from "../pi/compaction.ts";
import { publishedAddress, serveCommand } from "./published.ts";
import { compileCacheDir } from "./tmpdirs.ts";

export interface Check {
  name: string;
  /** Empty when the part is fine, else what is wrong. */
  problem: string;
  /** The one command that fixes the problem. */
  fix: string;
  /** True when another check already names the cause. */
  skip?: boolean;
  /** What a fine part says about itself. */
  info?: string;
}

/** What doctor asks of the machine, so a test can answer without one. */
export interface Probe {
  paths: Paths;
  /** herdr-projects 2.0's data folder. */
  oldDir: string;
  /** Lineclear's data folder, and the folders agents read skills from. */
  dataDir?: string;
  skillRoots?: string[];
  /** Whether Lineclear's own server runs now. */
  running?: () => boolean;
  /** Turns a space's timer off through the running server, which keeps its modes in memory. */
  setRegular?: (space: string) => boolean;
  pathDirs: string[];
  which(cmd: string): string | null;
  /** Runs a command and returns its output, or null when it failed. */
  run(cmd: string[]): string | null;
  /** The machines added in Settings and the commit each runs (null when it cannot be read), and this one's. */
  machines?: { commit: string; stable?: string; others: { host: string; commit: string | null; relation?: Relation; helperApart?: boolean }[] };
  /** The running processes that still use the old folder (agents started before the move). Without it none is looked for. */
  oldUsers?: () => string[];
  /** The old folders that still exist here. */
  oldFolders?: string[];
  /** Packs one to the archive folder and removes it (doctor --fix); returns the archive. */
  archiveFolder?: (dir: string) => string;
  /** Whether this machine's helper socket paths differ after migrate. */
  helperApart?: boolean;
  /** Running agents that still call the old command (started before the rename). */
  oldNameAgents?: () => string[];
  /** The exit code and last 20 lines of the latest command that failed, secrets masked. */
  failure?: string;
  /** The user whose lingering is checked. */
  user?: string;
  /** The least free space, in MB, before the disk counts as full. */
  minFreeMb?: string;
  /** Free bytes on the disk that holds a folder. Without it the disk is not checked. */
  free?: (dir: string) => number;
  /** The address the server is told to listen on (LINECLEAR_HOST), when set. */
  listen?: string;
  /** Where the web pages are published on the tailnet (task links open there), when tailscale is here. */
  published?: string;
  /** The herdr version the contract test passed with, and the one each machine runs (null when it cannot say). */
  herdr?: { tested: string; machines: { machine: string; version: string | null }[] };
  /** What pi loads here and on each other machine (a null diff: it cannot be read), and what the release wants. */
  kit?: { here: Kit; want: Wanted; others: { host: string; diff: string[] | null; own?: string[] }[] };
  /** What is wrong with the backup, "" when it is fine or none is set. */
  backup?: string;
  /** The machine whose board runs this machine's tasks ("" when this one does). */
  runBy?: string;
  /** What is wrong with the store: no restic repository and no fresh local copy. "" when fine. */
  store?: string;
  /** What the service and the `lineclear` on PATH run from. Without it the build is not checked. */
  runFrom?: RunFrom;
  /** The stable and next builds, the last promotion and why next is held. */
  release?: ReleaseState;
  /** The lines of the test instance of a build, none when there is none. */
  tryInstance?: string[];
  /** The machine whose promotions this one takes, when another machine installed it. */
  follows?: string;
  /** A CI runner: its checkout has no origin main to read. */
  ci?: boolean;
}

export function realProbe(paths: Paths, env: Record<string, string | undefined> = process.env): Probe {
  const probe: Probe = {
    paths,
    oldDir: oldDir(env),
    oldUsers: () => oldFolderUsers(env),
    oldFolders: oldFolders(env),
    archiveFolder: (dir) => archiveFolder(dir, env),
    dataDir: dataDir(env),
    skillRoots: skillRoots(env),
    running: () => realBusy("lineclear", env),
    setRegular: (space) => Bun.spawnSync([serverBin(env), "mode", space, "regular"], { stdin: "ignore", timeout: 60_000 }).exitCode === 0,
    pathDirs: (env.PATH ?? "").split(delimiter),
    listen: env.LINECLEAR_HOST,
    helperApart: helperApart(env),
    oldNameAgents: () => agentsOnOldName(),
    published: publishedAddress(env),
    backup: backupProblem(env),
    runBy: runByNote(env),
    store: readBackupSettings(env) === undefined ? copiesProblem(env) : "",
    runFrom: runFrom(paths, env),
    release: readRelease(env),
    tryInstance: tryLines(env),
    follows: follows(env),
    ci: env.CI === "true",
    user: env.USER ?? userInfo().username,
    free: freeBytes,
    minFreeMb: env.LINECLEAR_MIN_FREE_MB,
    which: (cmd) => Bun.which(cmd),
    run(cmd) {
      probe.failure = undefined;
      try {
        const p = Bun.spawnSync(cmd, { stdin: "ignore" });
        if (p.exitCode === 0) return p.stdout.toString();
        probe.failure = failureTail(p.exitCode, `${p.stdout}${p.stderr}`, env);
        return null;
      } catch {
        return null;
      }
    },
  };
  return probe;
}

function runFrom(paths: Paths, env: Record<string, string | undefined>): RunFrom {
  let service: string | null = null;
  try {
    service = unitCommand(readFileSync(paths.unit, "utf8"));
  } catch {}
  return { service, command: Bun.which("lineclear", { PATH: env.PATH }) };
}

const INSTALL_AGAIN = `curl -fsSL ${INSTALL_URL} | sh`;

function tool(p: Probe, name: string, fix: string): Check {
  return { name, problem: p.which(name) ? "" : `${name} is not installed`, fix };
}

function linkTo(path: string, target: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink() && readlinkSync(path) === target;
  } catch {
    return false;
  }
}

/** Why pi cannot load Lineclear's extension, or "" when it can. A link fails: pi would not find the extension's imports. */
function extensionProblem(paths: Paths): string {
  try {
    if (lstatSync(paths.extension).isSymbolicLink()) return `${paths.extension} is a link, so pi cannot find the extension's imports`;
    return readFileSync(paths.extension, "utf8") === extensionFile(paths.app) ? "" : `${paths.extension} does not import ${paths.app}/pi/extension.ts`;
  } catch {
    return `${paths.extension} is missing`;
  }
}

/** herdr-projects 2.0 is retired: its server must not run beside the fork. */
function oldInstallStopped(p: Probe): Check {
  const name = "old install stopped";
  let pid: unknown;
  try {
    pid = JSON.parse(readFileSync(join(p.oldDir, "server.json"), "utf8")).pid;
  } catch {
    return { name, problem: "", fix: "" }; // no server file: it never ran, or it was removed
  }
  if (typeof pid !== "number" || p.run(["kill", "-0", String(pid)]) === null) return { name, problem: "", fix: "" };
  return { name, problem: `The old install is still running (process ${pid})`, fix: `herdr plugin disable ${OLD_PLUGIN_ID}` };
}

function service(p: Probe): Check {
  const name = "service";
  // install.sh writes no unit where systemd has no user services, and says to run `lineclear run --board` instead
  if (p.run(["systemctl", "--user", "show-environment"]) === null)
    return { name: "service: none on this machine, `lineclear run --board` starts it", problem: "", fix: "" };
  if (!existsSync(p.paths.unit)) {
    return { name, problem: `the ${SERVICE} unit file is missing`, fix: INSTALL_AGAIN };
  }
  const want = `${p.paths.app}/bin/lineclear`;
  if (!readFileSync(p.paths.unit, "utf8").includes(want)) {
    return { name, problem: `the ${SERVICE} unit does not run this install`, fix: INSTALL_AGAIN };
  }
  const active = p.run(["systemctl", "--user", "is-active", SERVICE])?.trim() === "active";
  return {
    name,
    problem: active ? "" : `${SERVICE} is not running${p.failure ? `\n${p.failure}` : ""}`,
    fix: `systemctl --user enable --now ${SERVICE}`,
  };
}

/** Node writes its compile cache to /tmp by default, which is RAM on many machines; install sets it to the disk cache. */
function compileCache(p: Probe): Check {
  const name = "compile cache on disk";
  const live = p.run(["systemctl", "--user", "show-environment"]);
  if (live === null) return { name, problem: "", fix: "", skip: true };
  let text = "";
  try {
    text = readFileSync(p.paths.cacheEnv, "utf8");
  } catch {}
  return {
    name,
    // the file serves the next login; the manager's own value is what the services started now get
    problem:
      text === cacheEnvFile() && live.split("\n").includes(cacheEnvFile().trim())
        ? ""
        : `NODE_COMPILE_CACHE is not set to ${compileCacheDir()} in ${p.paths.cacheEnv}`,
    fix: INSTALL_AGAIN,
  };
}

/** Two board units on one store start every step twice and make server.json flip between them. */
function oneServer(p: Probe): Check {
  const out = p.run(["systemctl", "--user", "list-units", "--state=active", "--plain", "--no-legend", "lineclear-serve-*.service"]) ?? "";
  const units = out
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0] ?? "")
    .filter((u) => u.startsWith("lineclear-serve-"));
  return {
    name: "one server",
    problem: units.length > 1 ? `${units.length} servers share this store: ${units.join(", ")}` : "",
    fix: `systemctl --user stop ${units.slice(1).join(" ")}`,
  };
}

/** Without lingering the user service starts at the first login, not at boot, so a reboot leaves Lineclear down. */
function lingering(p: Probe): Check {
  const user = p.user ?? "$USER";
  const on = p.run(["loginctl", "show-user", user, "--property=Linger"])?.trim() === "Linger=yes";
  return {
    name: "starts at boot",
    problem: on ? "" : `lingering is off for ${user}, so Lineclear starts only after you log in`,
    fix: `sudo loginctl enable-linger ${user}`,
  };
}

/** A nearly full disk: the check that Home shows until space is free again. */
function disk(p: Probe): Check {
  const t = p.free
    ? diskTrouble(
        [p.dataDir, p.paths.config].filter((d): d is string => !!d),
        p.minFreeMb,
        p.free,
      )
    : undefined;
  return { name: t?.name ?? "disk space", problem: t?.problem ?? "", fix: t?.fix ?? "" };
}

/** A machine that runs another Lineclear than this one, or that cannot be read, with the command that updates it. */
function machinesBehind(p: Probe): Check[] {
  const mine = p.machines?.commit ?? "";
  const stable = p.machines?.stable;
  const short = (c: string) => c.slice(0, 7);
  return (p.machines?.others ?? []).map(({ host, commit, relation }) => {
    const name = `machine ${host}`;
    const fix = `lineclear machine update ${host}`;
    if (commit === null) return { name, problem: `${host} cannot be reached or runs a Lineclear that is too old to say its version`, fix };
    if (commit === mine) return { name, problem: "", fix };
    const stableNote = stable ? `; stable is ${short(stable)}, which ${stable === commit ? host : stable === mine ? "this machine" : "neither"} runs` : "";
    const how = { behind: "older than", ahead: "newer than", different: "apart from", same: "equal to" }[relation ?? "different"];
    const text = `${host} runs ${short(commit)}, ${how} this machine's ${short(mine)}${stableNote}`;
    // a machine ahead of this one needs no update; this one does
    return relation === "ahead" ? { name, problem: "", fix, info: text } : { name, problem: text, fix };
  });
}

/** The herdr version the contract test passed with: the adapter's pin, read as a file since the CLI may not import the server. */
export function testedHerdr(): string {
  const adapter = readFileSync(join(import.meta.dir, "..", "server", "server", "live", "herdr.ts"), "utf8");
  const pin = adapter.match(/export const HERDR_TESTED\s*=\s*\{([^}]+)\}/)?.[1];
  const version = pin?.match(/\bversion:\s*['"]([^'"]+)['"]/)?.[1];
  if (!version) throw new Error("The herdr adapter has no tested version");
  return version;
}

/** The herdr each machine runs: this one's, and through herdr's own forwarding each enabled machine saved in it. */
export function herdrVersions(run: Probe["run"], here: boolean): { machine: string; version: string | null }[] {
  const out = [{ machine: "this machine", version: herdrVersionOf(run(herdrArgv(["--version"]))) }];
  if (here) return out;
  let saved: { id: string; label: string; enabled: boolean }[] = [];
  try {
    saved = JSON.parse(run(herdrArgv(["machine", "list", "--json"])) ?? "[]");
  } catch {
    // no saved machines to read
  }
  for (const m of saved.filter((x) => x.enabled))
    out.push({ machine: m.label, version: herdrVersionOf(run(["timeout", "-k", "5", "20", ...herdrArgv(["status", "server"], m.id)])) });
  return out;
}

/** Every machine runs the herdr the contract test passed with: another version may have changed a call Lineclear makes. */
function herdrPinned(p: Probe): Check[] {
  const tested = p.herdr?.tested ?? "";
  return (p.herdr?.machines ?? []).map(({ machine, version }) => ({
    name: `herdr ${tested} on ${machine}`,
    problem:
      version === null
        ? `the herdr on ${machine} does not answer`
        : version === tested
          ? ""
          : `${machine} runs herdr ${version}, and Lineclear is tested with ${tested}`,
    fix:
      version === null
        ? "herdr machine list"
        : `install herdr ${tested} on ${machine}; to move to ${version}, make it a step: raise HERDR_TESTED in server/server/live/herdr.ts and pass bun test test/herdr-contract.test.ts in server/`,
  }));
}

/** Whether the old folder may be archived: only when no running process, agent or tool, still uses it. */
function oldFolderFree(p: Probe): Check {
  const users = p.oldUsers?.() ?? [];
  return {
    name: "old folder free",
    problem: users.length
      ? `${users.length} running process${users.length === 1 ? "" : "es"} still use ${OLD_DIR_NAME}, so it must not be archived yet: ${users.slice(0, 3).join("; ")}`
      : "",
    fix: "let those agents finish (or restart them), then check again",
  };
}

/** The old folders left on this machine, named so `lineclear doctor` shows which machine still has them. */
function oldFoldersArchived(p: Probe): Check {
  const left = p.oldFolders ?? [];
  return {
    name: "old folders archived",
    problem: left.length ? `${left.join(" and ")} still ${left.length === 1 ? "exists" : "exist"}` : "",
    fix: "lineclear doctor --fix (packs each to ~/archive/<name>-<date>.tgz and removes it)",
  };
}

const oldNameAgents = (p: Probe): Check => ({
  name: "agents on the old command name",
  problem: `${p.oldNameAgents?.().join(", ") ?? ""}`.replace(/^(.)/, "still call the old name: $1"),
  fix: "lineclear restart <task id>, or let the task end",
});

/** After migrate, an agent started under herdr-projects 2.0 reaches the server only if both helper socket paths lead to it. */
function helperPaths(p: Probe): Check[] {
  const name = "helper socket paths";
  const fix = "lineclear migrate --link-helper";
  return [
    {
      name,
      problem: p.helperApart
        ? `${OLD_DIR_NAME}/helper/main.sock does not lead to ~/.lineclear/helper/main.sock, so agents started before the move cannot reach the server`
        : "",
      fix,
    },
    ...(p.machines?.others ?? [])
      .filter((m) => m.helperApart)
      .map(({ host }) => ({
        name: `helper socket paths on ${host}`,
        problem: `on ${host} the old and new helper socket paths differ, so its agents cannot reach the server`,
        fix: `ssh ${host} lineclear migrate --link-helper`,
      })),
  ];
}

/** The server listens on 127.0.0.1 only: your phone reaches it through a private network's HTTPS proxy. */
function listening(p: Probe): Check {
  const name = "listens on 127.0.0.1 only";
  let host = p.listen;
  try {
    host ??= /^Environment=["']?LINECLEAR_HOST=([^"'\s]+)/m.exec(readFileSync(p.paths.unit, "utf8"))?.[1];
  } catch {
    // no unit file: the service check names that
  }
  const local = host === undefined || host === "" || host === "127.0.0.1" || host === "localhost" || host === "::1";
  return {
    name,
    problem: local ? "" : `the server listens on ${host}, so anyone on that network can reach it`,
    fix: `systemctl --user unset-environment LINECLEAR_HOST && sed -i '/LINECLEAR_HOST=/d' ${p.paths.unit} && systemctl --user daemon-reload && systemctl --user restart ${SERVICE}  # then reach it with: tailscale serve --bg 7420`,
  };
}

/** The tailnet address of the web pages must answer: task links open there. Any reply counts, a refused connection does not. */
function publishedPages(p: Probe): Check {
  const url = p.published;
  if (!url) return { name: "published address", problem: "", fix: "" };
  const answered = p.run(["curl", "-sS", "-o", "/dev/null", "--max-time", "5", url]) !== null;
  return {
    name: `published address ${url}`,
    problem: answered ? "" : `${url} does not answer, so task links from your phone fail${p.failure ? `\n${p.failure}` : ""}`,
    fix: serveCommand(new URL(url).port),
  };
}

/** The token pack's parts and which are on. A part turned off is a choice, not a problem. */
function tokenPack(p: Probe): Check {
  const all = parts({ ...process.env, LINECLEAR_CONFIG: p.paths.config, LINECLEAR_PACK_PARTS: join(p.paths.app, "pi", "parts") });
  const shown = all.length === 0 ? "no parts yet" : all.map((x) => `${x.name} ${x.on ? "on" : "off"}`).join(", ");
  return { name: `token pack: ${shown}`, problem: "", fix: "" };
}

/** Every machine loads the kit the release names (pi, package versions, extension owners): another may behave otherwise. */
function agentKit(p: Probe): Check[] {
  if (!p.kit) return [];
  const fix = "lineclear kit shows it; lineclear machine update <machine>, then pi install the pinned versions in pi/kit.json";
  const row = (name: string, diff: string[] | null, own: string[] = []): Check => ({
    name: `agent kit on ${name}`,
    problem: diff === null ? `${name} cannot be read` : diff.join("; "),
    fix,
    ...(own.length ? { info: `extensions of its owner, left alone: ${own.join(", ")}` } : {}),
  });
  return [row("this machine", kitDiff(p.kit.here, p.kit.want), kitOthers(p.kit.here)), ...p.kit.others.map((o) => row(o.host, o.diff, o.own))];
}

/** An installed file or pi setting that points into a git checkout runs that branch's code, and breaks when the checkout goes. */
function checkoutFree(p: Probe, env: Record<string, string | undefined>): Check {
  const { paths } = p;
  const found = checkoutPointers(dirname(paths.unit), dirname(dirname(paths.extension)), p.dataDir ?? dataDir(), paths.binLink, env);
  return { name: "installed paths", problem: found.join("; "), fix: INSTALL_AGAIN };
}

/** Models whose window pi does not know: the pack leaves their compaction as it is. Named, not a problem. */
function compactionWindows(p: Probe): Check {
  const unknown = unknownWindows({ ...process.env, PI_CODING_AGENT_DIR: dirname(dirname(p.paths.extension)) });
  const shown = unknown.length === 0 ? "every model has a window" : `no window known for ${unknown.join(", ")}, compaction left as it is`;
  return { name: `compaction: ${shown}`, problem: "", fix: "" };
}

/** The service and the command are the release build, or the problem and the install that fixes it. */
function stableBuild(p: Probe): Check {
  const problem = p.runFrom ? buildProblem(p.runFrom, p.dataDir ?? dataDir()) : "";
  const { current, previous, candidate } = buildNames(p.dataDir ?? dataDir());
  const info = `current ${current ?? "none"}, previous ${previous ?? "none"}, candidate ${candidate ?? "none"}`;
  return { name: "stable build", problem, fix: installReleaseCommand(), info, skip: !p.runFrom };
}

export function doctorChecks(probe: Probe): Check[] {
  // a release install has no checkout: its code is builds/current
  const current = join(buildsDir(probe.dataDir ?? dataDir()), "current");
  const p: Probe = existsSync(current) ? { ...probe, paths: { ...probe.paths, app: current } } : probe;
  const { paths } = p;
  const binDir = dirname(paths.binLink);
  return [
    tool(p, "git", INSTALL_AGAIN),
    tool(p, "bun", "curl -fsSL https://bun.sh/install | bash"),
    tool(p, "rsync", "sudo apt install rsync"),
    tool(p, "herdr", "curl -fsSL https://herdr.dev/install.sh | sh"),
    tool(p, "pi", "curl -fsSL https://pi.dev/install.sh | sh"),
    oldInstallStopped(p),
    { name: "plugin config.json", ...pluginConfig(p.dataDir ?? dataDir()) },
    ...retiredChecks(p),
    { name: "models.json", problem: readModelFile(p.dataDir ?? dataDir()).problem, fix: "fix or delete models.json in the data folder" },
    {
      name: "lineclear files",
      problem: existsSync(`${paths.app}/bin/lineclear`) ? "" : `Lineclear is not installed in ${paths.app}`,
      fix: INSTALL_AGAIN,
    },
    {
      name: "lineclear command",
      problem: linkTo(paths.binLink, `${paths.app}/bin/lineclear`) ? "" : `${paths.binLink} is missing or points elsewhere`,
      fix: INSTALL_AGAIN,
    },
    {
      name: "PATH",
      problem: p.pathDirs.includes(binDir) ? "" : `${binDir} is not in your PATH`,
      fix: `echo 'export PATH="${binDir}:$PATH"' >> ~/.profile`,
    },
    {
      name: "pi extension",
      problem: extensionProblem(paths),
      fix: INSTALL_AGAIN,
    },
    tokenPack(p),
    ...agentKit(p),
    compactionWindows(p),
    checkoutFree(p, process.env),
    service(p),
    oneServer(p),
    compileCache(p),
    stableBuild(p),
    lingering(p),
    disk(p),
    ...machinesBehind(p),
    ...herdrPinned(p),
    ...helperPaths(p),
    oldNameAgents(p),
    oldFolderFree(p),
    oldFoldersArchived(p),
    listening(p),
    publishedPages(p),
    { name: "backup", problem: p.backup ?? "", fix: "lineclear backup (it names what fails); lineclear backup status" },
    { name: "store", problem: p.store ?? "", fix: "lineclear store copy; lineclear store list; the rule loop takes a copy every hour" },
    {
      name: "tasks run by",
      problem: "",
      fix: "",
      info: p.runBy ? `${p.runBy} runs this machine's tasks, so its task list is there (lineclear task list on ${p.runBy})` : undefined,
      skip: !p.runBy,
    },
    release(p),
  ];
}

/** The builds, as a fine part: a held next is the promotion doing its job. Only main that cannot be read is a problem. */
function release(p: Probe): Check {
  const s = p.release ?? {};
  const fix = "lineclear release (it names what holds next); lineclear release run";
  if (p.follows) return { name: "release", problem: "", fix, info: `follows ${p.follows}, which promotes for it` };
  const test = p.tryInstance ?? [];
  if (!s.checked && test.length === 0) return { name: "release", problem: "", fix, skip: true };
  const lines = s.checked ? [...releaseLines(s), ...test] : test;
  return {
    name: "release",
    problem: s.held?.startsWith("cannot read main") && !p.ci ? s.held : "",
    fix,
    info: lines.join("; ").replace(/ {2,}/g, " "),
  };
}

/** Prints each part and returns 0 only when all are well. */
export function doctor(p: Probe, out: (line: string) => void): number {
  let bad = 0;
  for (const c of doctorChecks(p)) {
    if (c.skip) continue;
    if (c.problem === "") {
      out(`ok     ${c.name}${c.info ? `: ${c.info}` : ""}`);
    } else {
      bad++;
      out(`FAILED ${c.name}: ${c.problem}`);
      out(`       fix: ${c.fix}`);
    }
  }
  if (bad === 0) out("All well.");
  return bad === 0 ? 0 : 1;
}
