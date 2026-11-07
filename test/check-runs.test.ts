import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { failedTests, prChecks } from "../src/check-runs.ts";
import { tmp } from "./helpers.ts";

test("prChecks keeps the finished checks of the pull request, oldest first, and reads gh once a minute", () => {
  const bin = join(tmp("gh"), "bin");
  mkdirSync(bin);
  const json = JSON.stringify([
    { name: "late", bucket: "fail", startedAt: "2026-11-01T12:00:00Z", completedAt: "2026-11-01T12:02:00Z" },
    { name: "early", bucket: "pass", startedAt: "2026-11-01T11:00:00Z", completedAt: "2026-11-01T11:01:00Z" },
    { name: "waiting", bucket: "pending", startedAt: "2026-11-01T12:00:00Z", completedAt: "0001-01-01T00:00:00Z" },
  ]);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ncat <<'EOF2'\n${json}\nEOF2\nexit 1\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  try {
    const cwd = tmp("repo");
    const now = Date.parse("2026-11-01T13:00:00Z");
    expect(prChecks(cwd, "work/1", now).map((c) => [c.name, c.ok, c.seconds])).toEqual([
      ["early", true, 60],
      ["late", false, 120],
    ]);
    chmodSync(join(bin, "gh"), 0o644);
    expect(prChecks(cwd, "work/1", now + 30_000)).toHaveLength(2);
    expect(prChecks(cwd, "work/1", now + 61_000)).toEqual([]);
  } finally {
    process.env.PATH = old;
  }
});

test("failedTests names each failed test once with its file", () => {
  expect(failedTests("a.test.ts:\n(fail) one [1ms]\n(fail) one [1ms]\nnot ok 2 - two")).toEqual(["a.test.ts: one", "a.test.ts: two"]);
});
