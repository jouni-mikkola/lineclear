import { existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join, sep } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
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

const newer = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true }) > 0;
const rejectedFile = (data: string) => join(buildsDir(data), "rejected");

/** The versions a rollback put aside: install.sh does not offer them again until a newer version passes. */
function rejectedBuilds(data: string): string[] {
  try {
    return readFileSync(rejectedFile(data), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** The build that runs, the one before it, and the newest finished build above current that was not rolled back. */
export function buildNames(data: string): { current: string | null; previous: string | null; candidate: string | null } {
  const builds = buildsDir(data);
  const current = versionOf(join(builds, "current"));
  let candidate: string | null = null;
  try {
    for (const v of readdirSync(builds)) {
      if (!/^\d+\.\d+\.\d+$/.test(v) || !existsSync(join(builds, v, ".release")) || rejectedBuilds(data).includes(v)) continue;
      if (current && newer(v, current) && (!candidate || newer(v, candidate))) candidate = v;
    }
  } catch {}
  return { current, previous: versionOf(join(builds, "previous")), candidate };
}

/** Points the link `name` beside the builds at `version`, whole or not at all. */
export function pointBuild(data: string, name: "current" | "previous", version: string): void {
  const builds = buildsDir(data);
  const tmp = join(builds, `.${name}.tmp`);
  rmSync(tmp, { force: true });
  symlinkSync(join(builds, version), tmp);
  renameSync(tmp, join(builds, name));
}

/** Whether a rollback put `version` aside, so no promotion may take it. */
export const isRejected = (data: string, version: string): boolean => rejectedBuilds(data).includes(version);

/** A promotion of `version` ends the hold on every version it is newer than. */
export function liftHold(data: string, version: string): void {
  const kept = rejectedBuilds(data).filter((bad) => !newer(version, bad));
  writeAtomic(rejectedFile(data), kept.length ? `${kept.join("\n")}\n` : "");
}

/** Points `current` at `previous` and records the version it left as rejected. Returns what changed, or why it cannot. */
export function swapToPrevious(data: string): { from: string; to: string } | string {
  const { current, previous } = buildNames(data);
  if (current === previous) return "current is already the previous build, so there is nothing older to go back to";
  if (!current || !previous) return "there is no previous build to go back to";
  pointBuild(data, "current", previous);
  writeAtomic(rejectedFile(data), `${[...rejectedBuilds(data), current].join("\n")}\n`);
  return { from: current, to: previous };
}
