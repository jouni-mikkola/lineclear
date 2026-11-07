// Parts of the repo tools that the other tests reach only through a child process.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSlowBaseline, writeSlowBaseline } from "../scripts/check-speed.ts";
import { installFromTag } from "../scripts/release-tag.ts";
import { tmp } from "./helpers.ts";

test("the slow baseline is written sorted and read back, and a missing one is empty", () => {
  const root = tmp("slow");
  expect(readSlowBaseline(root)).toEqual({});
  mkdirSync(join(root, "scripts", "gates", "baseline"), { recursive: true });
  writeSlowBaseline(root, { "b.test.ts": 6, "a.test.ts": 7.5 });
  const back = readSlowBaseline(root);
  expect(Object.keys(back)).toEqual(["a.test.ts", "b.test.ts"]);
  expect(back["a.test.ts"]).toBe(7.5);
});

test("an install that fails is reported with its output", () => {
  const repo = tmp("repo");
  const home = tmp("home");
  writeFileSync(join(repo, "install.sh"), "echo no luck\nexit 1\n");
  const r = installFromTag(repo, "v0.0.0", home);
  expect(r.ok).toBe(false);
  expect(r.out).toContain("install.sh failed");
  expect(r.out).toContain("no luck");
});

test("an install that works but has no lineclear command fails at the doctor", () => {
  const repo = tmp("repo");
  const home = tmp("home");
  writeFileSync(join(repo, "install.sh"), "exit 0\n");
  expect(installFromTag(repo, "v0.0.0", home).ok).toBe(false);
});
