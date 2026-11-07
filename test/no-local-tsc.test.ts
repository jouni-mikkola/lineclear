import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp } from "./helpers.ts";

const check = join(import.meta.dir, "..", "scripts", "check.ts");

test("check --changed outside GitHub spawns no tsc and writes no type cache", () => {
  const root = tmp("no-tsc");
  try {
    const bin = join(root, "bin");
    const log = join(root, "spawned.log");
    mkdirSync(bin);
    for (const name of ["bunx", "tsc", "npx"]) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${log}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    delete env.GITHUB_ACTIONS;
    const run = Bun.spawnSync(["bun", check, "--changed"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    expect(run.exitCode).toBe(0);
    const spawned = existsSync(log) ? readFileSync(log, "utf8") : "";
    expect(spawned).not.toMatch(/tsc/);
    expect(existsSync(join(root, "node_modules"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the GitHub run of check.ts still lists tsc", () => {
  expect(readFileSync(check, "utf8")).toContain('"tsc", "--noEmit"');
});
