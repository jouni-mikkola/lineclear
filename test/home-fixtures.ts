import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NOW = Date.parse("2026-10-31T12:00:00Z");
export const project = (config: string, name: string, space: string) => {
  mkdirSync(join(config, "projects", name), { recursive: true });
  writeFileSync(join(config, "projects", name, "settings.json"), JSON.stringify({ space, repo: `/x/${name}` }));
};
export const sh = (cwd: string, ...a: string[]) =>
  Bun.spawnSync(["git", "-C", cwd, ...a], { stdout: "pipe" })
    .stdout.toString()
    .trim();
export const repo = (root: string, name: string, roadmap?: string) => {
  const p = join(root, name);
  mkdirSync(join(p, "docs"), { recursive: true });
  if (roadmap) writeFileSync(join(p, "docs", "ROADMAP.md"), roadmap);
  sh(p, "init", "-b", "main");
  sh(p, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "first");
  sh(p, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "second");
  return p;
};
