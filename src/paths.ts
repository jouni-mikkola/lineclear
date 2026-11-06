import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { configDir } from "../pi/config.ts";
import { compileCacheDir } from "./tmpdirs.ts";
import { gitText } from "./git.ts";

/** The address install.sh is fetched from: read from the install.sh shipped beside this code, so the repo's address lives in README and install.sh only. */
export const INSTALL_URL = (() => {
  try {
    return (
      readFileSync(join(import.meta.dir, "..", "install.sh"), "utf8").match(/https:\/\/raw\.githubusercontent\.com\/\S+\/install\.sh/)?.[0] ?? "install.sh"
    );
  } catch {
    return "install.sh";
  }
})();
export const OLD_PLUGIN_ID = "herdr-projects";
export const SERVICE = "lineclear.service";

/** Where install puts each thing. It follows the XDG folders and pi's own folder variable. */
export interface Paths {
  app: string;
  /** The folder of release builds: a release install links the command and the pi extension into builds/current. */
  builds: string;
  binLink: string;
  unit: string;
  extension: string;
  config: string;
  /** The systemd user environment file that points NODE_COMPILE_CACHE at the disk cache. */
  cacheEnv: string;
}

export function pathsFor(env: Record<string, string | undefined> = process.env): Paths {
  const home = env.HOME;
  if (!home) throw new Error("HOME is not set");
  const data = env.XDG_DATA_HOME || join(home, ".local", "share");
  const config = env.XDG_CONFIG_HOME || join(home, ".config");
  const piDir = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
  return {
    app: join(data, "lineclear"),
    builds: join(env.LINECLEAR_HOME ?? join(home, ".lineclear"), "builds"),
    binLink: join(home, ".local", "bin", "lineclear"),
    unit: join(config, "systemd", "user", SERVICE),
    extension: join(piDir, "extensions", "lineclear.ts"),
    config: configDir(env),
    cacheEnv: join(config, "environment.d", "60-lineclear.conf"),
  };
}

/** The one line of the environment file; install.sh writes the same text. */
export const cacheEnvFile = (env: Record<string, string | undefined> = process.env) => `NODE_COMPILE_CACHE=${compileCacheDir(env)}\n`;

/**
 * What install writes as pi's `lineclear.ts`: an import of the extension by its full path. Not a link: pi resolves an
 * extension's own imports from the link's folder, so `./pack.ts` would not be found. `install.sh` writes the same text.
 */
export const extensionFile = (app: string) =>
  `// Lineclear's pi extension, written by install.sh. It imports the real one, so its own imports resolve.\nexport { default } from "${app}/pi/extension.ts";\n`;

type Env = Record<string, string | undefined>;

/** The board's data folder: the fork's `~/.lineclear`. */
export const dataDir = (env: Env = process.env) => env.LINECLEAR_HOME ?? join(homedir(), ".lineclear");

/** The board's command, the fork's own `lineclear` in server/bin. */
export const serverBin = (env: Env = process.env) => env.LINECLEAR_SERVER_BIN ?? join(import.meta.dir, "..", "server", "bin", "lineclear");

/** pi's own folder: its settings, extensions, packages and session files. */
export const piDir = (env: Env = process.env) => env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");

/** The port the stable web pages listen on when nothing sets one (src/web-address.ts). */
const STABLE_PORT = 7420;

/** The port in the stable board's `server.json`, when it has written one. */
function stableBoardPort(stableData: string): unknown {
  try {
    return JSON.parse(readFileSync(join(stableData, "server.json"), "utf8")).port;
  } catch {
    return undefined;
  }
}

/**
 * Why a source checkout's own `bin/lineclear` must not run, or "": it may use only a config folder, a data folder and
 * a port of its own, never those of the stable system that runs every other task (the account's home, whatever HOME says). A release build has no `.git` and is
 * never refused, nor is the installed app: both are the stable system itself. Help and `--version` touch nothing and pass.
 */
export function accountHome(): string {
  try {
    const row = readFileSync("/etc/passwd", "utf8")
      .split("\n")
      .find((l) => l.split(":")[2] === String(process.getuid?.()));
    return row?.split(":")[5] || homedir();
  } catch {
    return homedir();
  }
}

export function stableRefusal(root: string, args: string[], env: Env = process.env, account = accountHome()): string {
  if (!existsSync(join(root, ".git")) || [undefined, "help", "--help", "-h", "--version"].includes(args[0])) return "";
  // `roadmap check` only reads a file in the repo it is given: it touches no config, data folder or port
  if (args[0] === "roadmap" && args[1] === "check") return "";
  const stableData = join(account, ".lineclear");
  if (resolve(root) === resolve(pathsFor(env).app) || resolve(root).startsWith(join(stableData, "builds") + sep)) return "";
  const used: string[] = [];
  if (resolve(configDir(env)) === join(account, ".config", "lineclear")) used.push("the stable config folder");
  if (resolve(dataDir(env)) === stableData) used.push("the stable data folder");
  const flag = args.find((a) => a.startsWith("--port="))?.slice(7) ?? (args.includes("--port") ? args[args.indexOf("--port") + 1] : undefined);
  // a command that serves listens on the stable port when no other is given
  const serves = ["run", "serve"].includes(args[0] ?? "");
  const set = flag ?? env.LINECLEAR_WEB_PORT ?? env.LINECLEAR_PORT ?? (serves ? String(STABLE_PORT) : undefined);
  if (set !== undefined && [STABLE_PORT, stableBoardPort(stableData)].includes(Number(set))) used.push(`the stable port ${set}`);
  if (!used.length) return "";
  return `this checkout's bin/lineclear would use ${used.join(", ")}. The stable lineclear on PATH runs the real system. To try this code, start a test instance (lineclear release try, L130), or set LINECLEAR_CONFIG, LINECLEAR_HOME and LINECLEAR_PORT to a folder and a port of your own.`;
}

/** The commit of the code that runs here. */
export function codeCommit(): string {
  return gitText(resolve(import.meta.dir, ".."), "rev-parse", "HEAD") ?? "unknown";
}

/** The lock file `<name>.lock` in the config folder: one guard per job that must not run twice at once. */
export const lockFile = (env: Env, name: string) => join(configDir(env), `${name}.lock`);
