import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { releaseLines } from "../src/release-cli.ts";
import { releaseView } from "../src/release-view.ts";
import type { State } from "../src/roadmap.ts";

const RELEASE = `# Release v9.0

## What v9.0 gives you

Plain words.

## The checks

Some words.

### P1: the core loop works

| Id | Must hold | Measured by | Today |
| --- | --- | --- | --- |
| R1 | Fast starts | a meter | holds: 4 s |
| R2 | No stalls | a meter | 15 an hour |
| R3 | Small | a meter | not measured |

### P2: the web

| Id | Must hold | Measured by |
| --- | --- | --- |
| R4 | Every view has its states | a walk |

## The parts and their order

| R9 | not a check | here | 1 |
`;

const step = (id: string, phase: string, state: State) => ({ id, title: `Title ${id}`, result: `Result ${id}.`, phase, state });

const STEPS = [
  step("A1", "The core loop (P1)", "done"),
  step("A2", "The core loop (P1)", "work"),
  step("A3", "The core loop (P1)", "dropped"),
  step("A4", "The core loop (P1)", "waiting"),
  step("B1", "Open steps for the web (P2)", "ready"),
  step("C1", "Open steps from the audits", "ready"),
  step("F1", "Frozen by the owner 5 Nov 2026", "ready"),
];

test("the parts count the steps of their ranked phases, without dropped and frozen ones", () => {
  const r = releaseView(RELEASE, STEPS);
  expect(r?.version).toBe("v9.0");
  expect(r?.parts).toEqual([
    { rank: "P1", name: "the core loop works", done: 1, total: 3 },
    { rank: "P2", name: "the web", done: 0, total: 1 },
  ]);
  expect(r?.unranked).toEqual({ done: 0, total: 1 });
});

test("a check holds, fails with today's number or is not measured yet, by its Today cell", () => {
  const checks = releaseView(RELEASE, STEPS)?.checks ?? [];
  expect(checks.map((c) => [c.id, c.part, c.state, c.today])).toEqual([
    ["R1", "the core loop works", "holds", "4 s"],
    ["R2", "the core loop works", "fails", "15 an hour"],
    ["R3", "the core loop works", "unmeasured", "not measured"],
    ["R4", "the web", "unmeasured", undefined],
  ]);
});

test("now is the steps at work, next the ready ones before the waiting ones, frozen ones never", () => {
  const r = releaseView(RELEASE, STEPS);
  expect(r?.now.map((s) => s.id)).toEqual(["A2"]);
  expect(r?.next.map((s) => s.id)).toEqual(["B1", "C1", "A4"]);
});

test("a text with no version or no checks is no release", () => {
  expect(releaseView("# Notes\n", STEPS)).toBeUndefined();
  expect(releaseView("# Release v1\n\nNo checks.\n", STEPS)).toBeUndefined();
});

test("the command prints the parts, the checks and the steps by their results", () => {
  const text = releaseLines(releaseView(RELEASE, STEPS) as NonNullable<ReturnType<typeof releaseView>>).join("\n");
  expect(text).toContain("  The core loop works  1 of 3");
  expect(text).toContain("Checks: 1 hold, 1 fail, 2 not measured yet");
  expect(text).toContain("  R2  fails: today 15 an hour\n      No stalls");
  expect(text).toContain("Running now\n  Title A2: Result A2.");
  expect(text).toContain("Next, waiting\n  Title B1: Result B1.");
});

test("this repo's release.md has the five parts and the checks R1 to R22", () => {
  const r = releaseView(readFileSync(join(import.meta.dir, "..", "docs", "release.md"), "utf8"), []);
  expect(r?.parts.map((p) => p.rank)).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  expect(r?.checks.map((c) => c.id)).toEqual(Array.from({ length: 22 }, (_, i) => `R${i + 1}`));
});
