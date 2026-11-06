// What the gates share: running a tool of this repo's node_modules in the folder under check, and its tracked files.
import { existsSync } from "node:fs";
import { join } from "node:path";

const repoDir = join(import.meta.dir, "..", "..");
const binDir = join(repoDir, "node_modules", ".bin");
let installing: Promise<unknown> | undefined;

/** A fresh checkout has no node_modules (the heavy run is on one); the first tool run installs them once. */
function ensureInstalled(): Promise<unknown> {
  if (existsSync(join(binDir, "biome"))) return Promise.resolve();
  installing ??= Bun.spawn(["bun", "install", "--frozen-lockfile"], { cwd: repoDir, stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited;
  return installing;
}

/** Runs `tool` from this repo's node_modules in `root`; gates run side by side, so this never blocks. */
export async function runTool(root: string, tool: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  await ensureInstalled();
  const p = Bun.spawn([join(binDir, tool), ...args], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

/** Parses a tool's JSON report, or says which tool broke and how, so a broken tool never reads as a clean repo. */
export function parseReport<T>(tool: string, r: { code: number; out: string; err: string }): T {
  try {
    return JSON.parse(r.out) as T;
  } catch {
    throw new Error(`${tool} gave no report (exit ${r.code}): ${(r.err || r.out).trim().slice(0, 800)}`);
  }
}

const SOURCE = /\.(ts|tsx|mts|js|mjs)$/;

/** The files git tracks under `root` that match `pattern` and are on disk (a deletion not yet committed is not). */
export function trackedFiles(root: string, pattern = SOURCE): string[] {
  const p = Bun.spawnSync(["git", "-C", root, "ls-files", "-z"]);
  if (p.exitCode !== 0) throw new Error(`${root} is not a git repository`);
  return p.stdout
    .toString()
    .split("\0")
    .filter((f) => f && pattern.test(f) && existsSync(join(root, f)));
}

export const git = (root: string, args: string[]) => Bun.spawnSync(["git", "-C", root, ...args]);
const names = (out: Buffer) => out.toString().split("\0").filter(Boolean);

/** The files that differ from `commit` now: committed, staged, unstaged or new, deleted ones too. Undefined when git does not know it. */
export function differingFrom(root: string, commit: string): string[] | undefined {
  const diff = git(root, ["diff", "-z", "--name-only", "--no-renames", commit]);
  const added = git(root, ["ls-files", "-z", "--others", "--exclude-standard"]);
  if (diff.exitCode !== 0 || added.exitCode !== 0) return undefined;
  return [...new Set([...names(diff.stdout), ...names(added.stdout)])];
}

/** The files changed since the branch left `base`. Undefined when there is no `base` to compare with. */
export function changedSince(root: string, base: string): string[] | undefined {
  const fork = git(root, ["merge-base", "HEAD", base]);
  return fork.exitCode === 0 ? differingFrom(root, fork.stdout.toString().trim()) : undefined;
}
