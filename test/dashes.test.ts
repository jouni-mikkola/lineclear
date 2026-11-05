import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findDashes } from "../src/dashes.ts";

test("findDashes names the line of each dash", () => {
  const hits = findDashes("a.md", "fine\nbad \u2013 here\n\u2014\n");
  expect(hits).toEqual([
    { file: "a.md", line: 2, char: "en dash" },
    { file: "a.md", line: 3, char: "em dash" },
  ]);
});

test("the dash check fails on a fixture repo with each dash", () => {
  const dir = mkdtempSync(join(tmpdir(), "lineclear-dash-"));
  try {
    const git = (...a: string[]) => Bun.spawnSync(["git", "-C", dir, ...a]);
    git("init", "-q");
    writeFileSync(join(dir, "clean.txt"), "plain - hyphen\n");
    writeFileSync(join(dir, "en.txt"), "one\ntwo \u2013 three\n");
    writeFileSync(join(dir, "em.txt"), "x \u2014 y\n");
    git("add", ".");
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/dash-check.ts"), dir]);
    const err = p.stderr.toString();
    expect(p.exitCode).toBe(1);
    expect(err).toContain("en.txt:2: en dash");
    expect(err).toContain("em.txt:1: em dash");
    expect(err).not.toContain("clean.txt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the dash check passes on a clean fixture repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "lineclear-dash-"));
  try {
    Bun.spawnSync(["git", "-C", dir, "init", "-q"]);
    writeFileSync(join(dir, "a.txt"), "ok\n");
    Bun.spawnSync(["git", "-C", dir, "add", "."]);
    const p = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/dash-check.ts"), dir]);
    expect(p.exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
