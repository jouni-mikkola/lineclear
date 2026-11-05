import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { archiveDir } from "./old-install.ts";

/**
 * Packs an old folder to `<archive>/<name>-<date>.tgz`, checks the pack reads back, then removes the folder. A
 * file that is a hard link into ~/.lineclear loses only this name, so the other stays whole. Returns the archive.
 */
export function archiveFolder(dir: string, env: Record<string, string | undefined> = process.env, now = new Date()): string {
  const target = archiveDir(env);
  mkdirSync(target, { recursive: true });
  const name = basename(dir).replace(/^\./, "");
  const file = join(target, `${name}-${now.toISOString().slice(0, 10)}.tgz`);
  // a second run on one day must not replace the first archive
  const final = existsSync(file) ? file.replace(/\.tgz$/, `-${now.getTime()}.tgz`) : file;
  const part = `${final}.partial`;
  const parent = join(dir, "..");
  const pack = Bun.spawnSync(["tar", "-czf", part, "-C", parent, basename(dir)], { stdin: "ignore" });
  if (pack.exitCode !== 0 || Bun.spawnSync(["tar", "-tzf", part], { stdin: "ignore" }).exitCode !== 0) {
    rmSync(part, { force: true });
    throw new Error(`could not pack ${dir}: ${pack.stderr.toString().trim()}`);
  }
  renameSync(part, final);
  rmSync(dir, { recursive: true, force: true });
  return final;
}
