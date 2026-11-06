import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { catches, catchesOf } from "../src/catches.ts";
import type { CheckRun } from "../src/check-runs.ts";
import { tmp } from "./helpers.ts";

const NOW = Date.parse("2026-03-10T12:00:00Z");
const DAY = 86_400_000;

const run = (over: Partial<CheckRun>): CheckRun => ({
  kind: "run",
  at: NOW - DAY,
  repo: "/r",
  tier: "merge",
  command: "bun run check",
  commit: "abc",
  branch: "work/x",
  dirty: false,
  seconds: 100,
  load: 1,
  cores: 8,
  ok: false,
  failed: [],
  group: "g",
  ...over,
});

const log: CheckRun[] = [
  run({ gate: { step: "gates", line: "gates failed: lint, size" } }),
  run({ gate: { step: "gates", line: "gates failed: lint" } }),
  run({ gate: { step: "parts", line: "x is outside step" } }),
  run({ failed: ["a test"] }),
  run({ gate: { step: "tests 2/3", line: "boom" } }),
  // not catches: passed, dirty, rerun, quarantined
  run({ ok: true }),
  run({ dirty: true, gate: { step: "parts", line: "x" } }),
  run({ rerun: true, gate: { step: "parts", line: "x" } }),
  run({ quarantined: true, failed: ["flaky"] }),
];

const byName = (list: { name: string; caught: number }[]) => Object.fromEntries(list.map((c) => [c.name, c.caught]));

test("a red run counts once for its step and once for each gate it names", () => {
  const list = catches(log, [], ["lint", "size", "borders"], ["gates", "tests", "parts", "roadmap"]);
  expect(byName(list)).toEqual({
    "gate lint": 2,
    "gate size": 1,
    "gate borders": 0,
    "step gates": 2,
    "step tests": 2,
    "step parts": 1,
    "step roadmap": 0,
  });
  expect(list[0]?.caught).toBe(2);
});

test("a stall of a class a step guards is a catch of that step", () => {
  const stalls = [{ kind: "stall", class: "flaky test" }, { kind: "stall", class: "roadmap-broken" }, { kind: "stall", class: "lock-held" }, { kind: "skip" }];
  expect(byName(catches([], stalls, [], []))).toEqual({ "step tests": 1, "step roadmap": 1 });
});

test("catchesOf reads the last 7 days of the logs in a config folder", () => {
  const root = tmp("catches");
  const config = join(root, "config");
  const repo = join(root, "repo");
  mkdirSync(config, { recursive: true });
  mkdirSync(join(repo, "scripts", "gates"), { recursive: true });
  writeFileSync(join(repo, "scripts", "gates", "g.ts"), '  name: "lint",\n  name: "size",\n');
  const runs = [
    run({ repo, gate: { step: "gates", line: "gates failed: lint" } }),
    run({ repo, at: NOW - 8 * DAY, gate: { step: "gates", line: "gates failed: size" } }),
  ];
  writeFileSync(join(config, "check-runs.jsonl"), `${runs.map((r) => JSON.stringify(r)).join("\n")}\n`);
  writeFileSync(join(config, "check-steps.jsonl"), `${JSON.stringify({ at: NOW - DAY, step: "gates", seconds: 5, ok: true })}\n`);
  writeFileSync(join(config, "decisions.jsonl"), `${JSON.stringify({ time: new Date(NOW - DAY).toISOString(), kind: "stall", class: "flaky test" })}\n`);
  expect(catchesOf(repo, { LINECLEAR_CONFIG: config }, NOW)).toEqual([
    "catches in 7 days, gate lint: 1",
    "catches in 7 days, step gates: 1",
    "catches in 7 days, step tests: 1",
    "catches in 7 days, gate size: 0",
  ]);
});
