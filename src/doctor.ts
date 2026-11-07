import { storedTaskIds, taskIdsUnique } from "./doctor-task-ids.ts";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { herdrArgv, herdrVersionOf } from "./herdr.ts";
import { userInfo } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { configDir, readJson } from "../pi/config.ts";
import { failureTail } from "../server/server/live/secrets.ts";
import { copiesProblem, runByNote } from "./store-copies.ts";
import { cacheEnvFile, dataDir, extensionFile, INSTALL_URL, type Paths, SERVICE } from "./paths.ts";
import { diskTrouble, freeBytes } from "./health.ts";
import { firstModel, readModelFile } from "./models.ts";
import { readSetup, type Setup, setupRoles } from "./project.ts";
import { checkoutPointers } from "./install-paths.ts";
import { buildNames, buildProblem, buildsDir, installReleaseCommand, type RunFrom, unitCommand } from "./builds.ts";
import { publishedAddress, serveCommand } from "./published.ts";
import { type MachineStarts, startsLine } from "./start-failures.ts";
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
  /** The model chosen for each role. Without it the roles are not checked. */
  setup?: Setup;
  /** Lineclear's data folder. */
  dataDir?: string;
  /** Whether Lineclear's own server runs now. */
  running?: () => boolean;
  pathDirs: string[];
  which(cmd: string): string | null;
  /** Runs a command and returns its output, or null when it failed. */
  run(cmd: string[]): string | null;
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
  herdr?: { tested: string; machines: { machine: string; version: string | null }[]; unsaved?: string[] };
  /** What pi loads here and on each other machine (a null diff: it cannot be read), and what the release wants. */
  /** The machine whose board runs this machine's tasks ("" when this one does). */
  runBy?: string;
  /** What is wrong with the store: no restic repository and no fresh local copy. "" when fine. */
  store?: string;
  /** What the service and the `lineclear` on PATH run from. Without it the build is not checked. */
  runFrom?: RunFrom;
  /** Every id and alias in the live task store. Without it the ids are not checked. */
  taskIds?: () => string[];
  /** A CI runner: its checkout has no origin main to read. */
  ci?: boolean;
  /** The failed starts of the last 24 hours, one entry per machine. */
  starts?: MachineStarts[];
}

export function realProbe(paths: Paths, env: Record<string, string | undefined> = process.env): Probe {
  const probe: Probe = {
    paths,
    setup: storedSetup(env),
    dataDir: dataDir(env),
    running: () => {
      try {
        const pid = readJson(join(dataDir(env), "server.json"))?.pid;
        return typeof pid === "number" && process.kill(pid, 0);
      } catch {
        return false;
      }
    },
    pathDirs: (env.PATH ?? "").split(delimiter),
    listen: env.LINECLEAR_HOST,
    published: publishedAddress(env),
    runBy: runByNote(env),
    store: copiesProblem(env),
    runFrom: runFrom(paths, env),
    taskIds: () => storedTaskIds(dataDir(env)),
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

function service(p: Probe): Check {
  const name = "service";
  // install.sh writes no unit where systemd has no user services, and says to run `lineclear run` instead
  if (p.run(["systemctl", "--user", "show-environment"]) === null)
    return { name: "service: none on this machine, `lineclear run` starts it", problem: "", fix: "" };
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

/** The service is the one server. A board unit beside it (an older install's) starts every step twice and makes server.json flip between them. */
function oneServer(p: Probe): Check {
  const out = p.run(["systemctl", "--user", "list-units", "--state=active", "--plain", "--no-legend", "lineclear-serve-*.service"]) ?? "";
  const units = out
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0] ?? "")
    .filter((u) => u.startsWith("lineclear-serve-"));
  return {
    name: "one server",
    problem: units.length > 0 ? `a board unit runs beside the service on this store: ${units.join(", ")}` : "",
    fix: `systemctl --user disable --now ${units.join(" ")}`,
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

/** An installed file or pi setting that points into a git checkout runs that branch's code, and breaks when the checkout goes. */
function checkoutFree(p: Probe, env: Record<string, string | undefined>): Check {
  const { paths } = p;
  const found = checkoutPointers(dirname(paths.unit), dirname(dirname(paths.extension)), p.dataDir ?? dataDir(), paths.binLink, env);
  return { name: "installed paths", problem: found.join("; "), fix: INSTALL_AGAIN };
}

/** The model a start takes when no default model is set: pi's first listed one. */
function newTaskModel(): Check {
  const model = firstModel("pi");
  return { name: "model", problem: "", fix: "", info: model ? `a new task with no model set starts on ${model}` : "pi lists no model yet" };
}

/** The chosen models, or undefined on a machine that has chosen none yet (a fresh install has nothing to lose). */
function storedSetup(env: Record<string, string | undefined>): Setup | undefined {
  const setup = readSetup(env);
  return existsSync(join(configDir(env), "settings.json")) ? setup : undefined;
}

const ROLE_WORDS: Record<string, string> = { stepChecker: "step checker" };

/** One check per role with no model: a lost setting fails every start of that role. */
function roleModels(p: Probe): Check[] {
  const { setup } = p;
  if (!setup) return [];
  return setupRoles
    .filter((role) => !setup[role])
    .map((role) => ({ name: `${role} model`, problem: `no model chosen for the ${ROLE_WORDS[role] ?? role}`, fix: "lineclear setup" }));
}

/** The service and the command are the release build, or the problem and the install that fixes it. */
function stableBuild(p: Probe): Check {
  const problem = p.runFrom ? buildProblem(p.runFrom, p.dataDir ?? dataDir()) : "";
  const { current, previous } = buildNames(p.dataDir ?? dataDir());
  const info = `current ${current ?? "none"}, previous ${previous ?? "none"}`;
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
    { name: "default model", problem: "", fix: "", info: firstModel("pi") ?? "none listed by pi" },
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
    checkoutFree(p, process.env),
    service(p),
    oneServer(p),
    compileCache(p),
    stableBuild(p),
    newTaskModel(),
    ...roleModels(p),
    lingering(p),
    disk(p),
    ...herdrPinned(p),
    listening(p),
    publishedPages(p),
    { name: "store", problem: p.store ?? "", fix: "lineclear store copy; lineclear store list; the rule loop takes a copy every hour" },
    {
      name: "tasks run by",
      problem: "",
      fix: "",
      info: p.runBy ? `${p.runBy} runs this machine's tasks, so its task list is there (lineclear task list on ${p.runBy})` : undefined,
      skip: !p.runBy,
    },
    taskIdsUnique(p),
    ...(p.starts ?? []).map((m) => ({ name: "failed starts", problem: "", fix: "", info: startsLine(m).replace(/^failed starts /, "") })),
  ];
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
