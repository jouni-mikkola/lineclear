import { expect, test } from "bun:test";
import { doctor, type Probe } from "../src/doctor.ts";
import { pathsFor } from "../src/paths.ts";
import type { Decision } from "../src/rules.ts";
import { failedStarts, THIS_MACHINE } from "../src/start-failures.ts";

const now = Date.parse("2026-11-07T12:00:00Z");
const MACHINES = [THIS_MACHINE, "farbox"];

const skip = (reason: string, machine: string, ago = 60_000): Decision => ({
  time: new Date(now - ago).toISOString(),
  project: "p",
  kind: "skip",
  reason,
  machine,
});

function startLines(decisions: Decision[]): string[] {
  const p: Probe = {
    paths: pathsFor({ HOME: "/nonexistent-home" }),
    pathDirs: [],
    which: () => null,
    run: () => null,
    starts: failedStarts(decisions, MACHINES, now),
  };
  const out: string[] = [];
  doctor(p, (l) => out.push(l));
  return out.filter((l) => l.includes("failed starts"));
}

test("a start that fails on one of two machines changes only that machine's line", () => {
  const before = startLines([]);
  expect(before).toEqual(["ok     failed starts: on this machine in 24 h: 0", "ok     failed starts: on farbox in 24 h: 0"]);
  const after = startLines([skip("machine farbox skipped: cannot be reached", "farbox"), skip("task add failed: no clone", "farbox")]);
  expect(after[0]).toBe(before[0]!);
  expect(after[1]).toBe("ok     failed starts: on farbox in 24 h: 2 (machine out of reach 1, a command fails 1)");
});

test("a failure older than a day is not counted", () => {
  const rows = failedStarts([skip("machine farbox skipped: cannot be reached", "farbox", 25 * 3_600_000)], MACHINES, now);
  expect(rows.map((r) => r.count)).toEqual([0, 0]);
});

test("a skip that is no start failure or names no machine is not counted", () => {
  const rows = failedStarts([skip("lock 'repo' is held by A", "farbox"), { ...skip("task add failed: x", "farbox"), machine: undefined }], MACHINES, now);
  expect(rows.map((r) => r.count)).toEqual([0, 0]);
});
