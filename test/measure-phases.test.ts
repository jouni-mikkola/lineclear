import { describe, expect, test } from "bun:test";
import { type PHASES, phaseTable, taskPhases } from "../src/measure-phases.ts";
import { sessionCalls } from "../src/session-text.ts";

function call(at: number, ms: number, usage: number[], command?: string, name = "bash") {
  const [input, cacheRead, cacheWrite, output] = usage;
  const content = command === undefined ? [{ type: "text", text: "ok" }] : [{ type: "toolCall", name, arguments: { command } }];
  return JSON.stringify({
    type: "message",
    message: { role: "assistant", content, timestamp: at, durationMs: ms, usage: { input, cacheRead, cacheWrite, output } },
  });
}

const AGENT = [
  call(60_000, 10_000, [2, 100, 50, 10], "cat /x/skill/lineclear/SKILL.md"),
  call(100_000, 5_000, [3, 200, 0, 20], "x", "edit"),
  call(130_000, 4_000, [4, 300, 10, 5], "bun test test/a.test.ts"),
  call(200_000, 3_000, [5, 400, 0, 7], "lineclear ready --summary done"),
].join("\n");

const REVIEWER = [call(150_000, 8_000, [1, 1000, 100, 50], "cat src/a.ts")].join("\n");

const CPU = [
  { at: 10_000, kind: "agent", ticks: 6 },
  { at: 55_000, kind: "agent", ticks: 600 },
  { at: 120_000, kind: "tests", ticks: 1200 },
  { at: 150_000, kind: "tests", ticks: 3000 },
  { at: 210_000, kind: "agent", ticks: 60 },
];

describe("cost per phase", () => {
  const t = taskPhases(
    "T-1",
    [
      { reviewer: false, calls: sessionCalls(AGENT) },
      { reviewer: true, calls: sessionCalls(REVIEWER) },
    ],
    CPU,
  );

  test("each phase gets its exact numbers", () => {
    const n = (p: (typeof PHASES)[number]) => Object.values(t.phases[p]);
    // calls, input, cache writes, output, wall ms, cpu ticks
    expect(n("start")).toEqual([1, 102, 50, 10, 50_000, 606]);
    expect(n("reading")).toEqual([0, 0, 0, 0, 0, 0]);
    expect(n("coding")).toEqual([1, 203, 0, 20, 30_000, 1200]);
    expect(n("tests")).toEqual([1, 304, 10, 5, 70_000, 3000]);
    expect(n("review")).toEqual([1, 1001, 100, 50, 0, 0]);
    expect(n("check wait")).toEqual([0, 0, 0, 0, 0, 0]);
    expect(n("finishing")).toEqual([1, 405, 0, 7, 3_000, 60]);
  });

  test("per task numbers", () => {
    expect([t.medianCallInput, t.largestCallInput, t.readyMs]).toEqual([304, 1001, 150_000]);
    expect(t.cpuByKind).toEqual({ agent: 666, tests: 4200 });
  });

  test("the table has a row per phase and a total", () => {
    const lines = phaseTable([t]);
    expect(lines.find((l) => l.startsWith("tests"))?.split(/\s{2,}/)).toEqual(["tests", "1", "304", "10", "5", "1.2", "0.5"]);
    expect(lines.find((l) => l.startsWith("all"))?.split(/\s{2,}/)).toEqual(["all", "5", "2015", "160", "92", "2.5", "0.8"]);
  });
});
