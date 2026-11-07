import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./helpers.ts";

const repoRoot = join(import.meta.dir, "..");
const check = join(repoRoot, "scripts", "check.ts");

const bytesUnder = (dir: string): number =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? bytesUnder(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0)
    : 0;

test("check --changed outside GitHub spawns no tsc and writes no type cache", () => {
  const root = tmp("no-tsc");
  try {
    const bin = join(root, "bin");
    const log = join(root, "spawned.log");
    mkdirSync(bin);
    for (const name of ["bunx", "tsc", "npx", "bun-x"]) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${log}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    delete env.GITHUB_ACTIONS;
    const cache = join(repoRoot, "node_modules", ".cache");
    const before = bytesUnder(cache);
    const run = Bun.spawnSync(["bun", check, "--changed"], { cwd: repoRoot, env, stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode).toBe(0);
    const spawned = existsSync(log) ? readFileSync(log, "utf8") : "";
    expect(spawned).not.toMatch(/tsc/);
    expect(bytesUnder(cache) - before).toBeLessThanOrEqual(20 * 1024 * 1024);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the GitHub run of check.ts still lists tsc", () => {
  expect(readFileSync(check, "utf8")).toContain('"tsc", "--noEmit"');
  expect(readFileSync(join(repoRoot, ".github", "workflows", "check.yml"), "utf8")).toContain("bun scripts/check.ts --changed");
});
