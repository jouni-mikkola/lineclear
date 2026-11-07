import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { removeFolders } from "../src/tmpdirs.ts";
import { chooseModels, ownEnv, sh, tmp, seedSpace } from "./helpers.ts";

const bin = join(import.meta.dir, "..", "bin", "lineclear");
let root: string;
let repo: string;
let vars: Record<string, string>;

beforeEach(async () => {
  root = tmp("agent-first");
  repo = join(root, "repo");
  mkdirSync(repo);
  sh(["git", "init", "-q", "-b", "main"], { cwd: repo });
  const fake = join(root, "lineclear");
  writeFileSync(fake, `#!/bin/sh\nprintf 'demo  DEM  ${repo}  github:x/y\\n'\n`);
  chmodSync(fake, 0o755);
  seedSpace(join(root, "home"), "demo", repo);
  vars = ownEnv(root, { LINECLEAR_CONFIG: join(root, "config"), HOME: root, LINECLEAR_SERVER_BIN: fake, LINECLEAR_BIN: bin });
  chooseModels(join(root, "config"));
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  try {
    await main(["project", "add", repo, "--name", "demo", "--worker", "a", "--reviewer", "b", "--check", "true", "--heavy", "true"], () => {}, null);
  } finally {
    // later test files of this process must not see this test's folders
    for (const k of Object.keys(vars)) if (saved[k] === undefined) delete process.env[k];
    Object.assign(process.env, saved);
  }
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ loadPerCore: 1e6 }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("the temp-folder guard names a process left running from a test's folder, and ends it", async () => {
  const dir = join(root, "scope");
  mkdirSync(dir);
  const left = Bun.spawn(["sleep", "4554"], { cwd: dir, stdout: "ignore" });
  expect(removeFolders([dir])).toEqual([left.pid]);
  await left.exited;
  expect(removeFolders([dir])).toEqual([]);
});
