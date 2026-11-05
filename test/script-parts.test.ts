// Parts of the repo tools that the other tests reach only through a child process.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSlowBaseline, writeSlowBaseline } from "../scripts/check-speed.ts";
import { filmParts, railWithMotion } from "../scripts/media-lib.ts";
import { installFromTag } from "../scripts/release-tag.ts";
import { tmp } from "./helpers.ts";

test("the film's parts take their sizes from the rail parts and their curves from motion.json", () => {
  const f = filmParts();
  expect(f.length).toBeGreaterThan(0);
  expect(f.parts.train.w).toBeGreaterThan(0);
  expect(f.parts.rail.gap).toBeGreaterThan(f.parts.rail.tie);
  expect(Object.keys(f.ink)).toContain("fg");
  expect(Object.keys(f.ease).length).toBeGreaterThan(0);
});

test("rail.ts is rewritten with its motion block from motion.json", () => {
  const src = railWithMotion();
  expect(src).toContain("export const MS = {");
});

test("a rail.ts that lost its motion markers is named", () => {
  const root = tmp("rail");
  mkdirSync(join(root, "ui", "brand"), { recursive: true });
  writeFileSync(join(root, "ui", "brand", "rail.ts"), "export {};\n");
  expect(() => railWithMotion(root)).toThrow("lost its motion markers");
});

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
