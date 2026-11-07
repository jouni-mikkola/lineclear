import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mainBranch, mainRef, mainRefs } from "../src/main-branch.ts";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const sh = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", "-C", cwd, ...a], { stdin: "ignore", stderr: "ignore" });
function repo(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), "main-branch-"));
  temps.push(dir);
  sh(dir, "init", "-q", "-b", branch);
  sh(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first");
  return dir;
}

test("a repo whose main is master reads master, local until a clone sets origin", () => {
  const old = repo("master");
  expect(mainBranch(old)).toBe("master");
  expect(mainRefs(old)).toEqual(["origin/master", "master"]);
  expect(mainRef(old)).toBe("master");
  const clone = mkdtempSync(join(tmpdir(), "main-branch-clone-"));
  temps.push(clone);
  Bun.spawnSync(["git", "clone", "-q", old, clone], { stdin: "ignore", stderr: "ignore" });
  expect(mainRef(clone)).toBe("origin/master");
});

test("a repo with main, or with no commit yet, reads main", () => {
  expect(mainRef(repo("main"))).toBe("main");
  const empty = mkdtempSync(join(tmpdir(), "main-branch-empty-"));
  temps.push(empty);
  sh(empty, "init", "-q", "-b", "trunk");
  expect(mainBranch(empty)).toBe("main");
  expect(mainRef(empty)).toBeUndefined();
});
