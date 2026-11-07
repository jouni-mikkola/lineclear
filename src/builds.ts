import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { INSTALL_URL } from "./paths.ts";

/** Where install.sh puts each release: `<data>/builds/<version>`, with `current` and `previous` beside them. */
export const buildsDir = (data: string) => join(data, "builds");

const real = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

/** What runs the work and from where: the file the service unit starts, and the `lineclear` on PATH. */
export interface RunFrom {
  /** The `bin/lineclear` path in the service unit, or null when no unit names one. */
  service: string | null;
  /** The `lineclear` found on PATH, or null when there is none. */
  command: string | null;
}

/** The `bin/lineclear` a unit file starts. */
export const unitCommand = (unitText: string): string | null => unitText.match(/^ExecStart=.*?(\S+\/bin\/lineclear)\b/m)?.[1] ?? null;

/** Why a path does not run from a release build, or "": it must lie in `builds/<version>`, which has the `.release` file and no `.git`. */
function notRelease(path: string, builds: string): string {
  const where = real(path);
  const root = real(builds);
  if (!where) return `${path} does not exist`;
  if (!root || !where.startsWith(root + sep)) return `${path} is not in ${builds}`;
  const build = join(root, where.slice(root.length + 1).split(sep)[0] ?? "");
  if (existsSync(join(build, ".git"))) return `${build} is a git checkout`;
  if (!existsSync(join(build, ".release"))) return `${build} is not a release build`;
  return "";
}

/** What is wrong with the build the service and the command run from, "" when both run a release. */
export function buildProblem(run: RunFrom, data: string): string {
  const builds = buildsDir(data);
  const service = run.service ? notRelease(run.service, builds) : "the service unit does not name a lineclear";
  const command = run.command ? notRelease(run.command, builds) : "there is no lineclear on PATH";
  return [service && `the service: ${service}`, command && `the lineclear on PATH: ${command}`].filter(Boolean).join("; ");
}

/** The command that installs the release this code was made as. */
export function installReleaseCommand(): string {
  let version = "X.Y.Z";
  try {
    version = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version ?? version;
  } catch {}
  return `curl -fsSL ${INSTALL_URL} | LINECLEAR_REF=v${version} sh`;
}

const versionOf = (link: string): string | null => {
  const where = real(link);
  return where ? (where.split(sep).pop() ?? null) : null;
};

/** The build that runs and the one before it. */
export function buildNames(data: string): { current: string | null; previous: string | null } {
  const builds = buildsDir(data);
  return { current: versionOf(join(builds, "current")), previous: versionOf(join(builds, "previous")) };
}
