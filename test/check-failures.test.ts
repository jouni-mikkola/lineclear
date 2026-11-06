import { expect, test } from "bun:test";
import { firstCause, isFixSubject, renderReport, sortRuns, type GhRun } from "../src/check-failures.ts";

const line = (job: string, step: string, text: string) => `${job}\t${step}\t2026-11-06T21:19:20.1785389Z ${text}`;
const CHECK = "Run bun scripts/check.ts --changed --untimed";
const testLog = (name: string, ms = "32.87ms") =>
  [line("full check (1/4)", CHECK, `(fail) ${name} [${ms}]`), line("full check (1/4)", CHECK, "check: server tests failed")].join("\n");
const gateLog = [
  line("changed tests", CHECK, "lint: 1 fault"),
  line("changed tests", CHECK, "check: gates failed: error: script exited"),
  line("check", "Run test", "##[error]Process completed with exit code 1."),
].join("\n");
const setupLog = line("changed tests", "Run bun install --frozen-lockfile", "##[error]Process completed with exit code 1.");
const limitLog = line("full check (2/4)", "UNKNOWN STEP", "##[error]The job running on runner X has exceeded the maximum execution time of 5 minutes.");

let n = 0;
const run = (over: Partial<GhRun>): GhRun => ({ id: ++n, event: "push", branch: "main", sha: `s${n}`, conclusion: "success", at: n * 1000, log: "", ...over });

test("each first cause is read from the log", () => {
  expect(firstCause(testLog("a flaky one", "1.5s"))).toEqual({ kind: "test", tests: [{ name: "a flaky one", ms: 1500 }] });
  expect(firstCause(gateLog).kind).toBe("gate");
  expect(firstCause(setupLog).kind).toBe("setup");
  expect(firstCause(limitLog).kind).toBe("time limit");
  expect(firstCause("nothing known").kind).toBe("unknown");
});

test("a test that failed and passed on the same commit is flaky, one that stays red is a real break", () => {
  const report = sortRuns([
    run({ event: "pull_request", branch: "w/1", sha: "x", conclusion: "failure", log: testLog("a") }),
    run({ event: "pull_request", branch: "w/1", sha: "x" }),
    run({ event: "pull_request", branch: "w/2", sha: "y", conclusion: "failure", log: testLog("b", "2000ms") }),
    run({ event: "pull_request", branch: "w/3", sha: "z", conclusion: "failure", log: gateLog }),
    run({ event: "pull_request", branch: "w/4", sha: "u", conclusion: "cancelled" }),
  ]);
  expect(report.pullRequests).toMatchObject({ runs: 5, green: 1, red: 3, cancelled: 1, causes: { "flaky test": 1, "real break": 1, gate: 1 } });
  expect(report.tests).toEqual([
    { name: "a", runs: 1, cause: "flaky test", longestMs: 32.87 },
    { name: "b", runs: 1, cause: "real break", longestMs: 2000 },
  ]);
});

test("on main a red run followed by a green one is flaky unless a fix lies between", () => {
  const runs = () => [
    run({ conclusion: "failure", log: testLog("m") }),
    run({}),
    run({ conclusion: "failure", log: setupLog }),
    run({ conclusion: "failure", log: limitLog }),
  ];
  expect(sortRuns(runs()).main.causes).toMatchObject({ "flaky test": 1, setup: 1, "time limit": 1 });
  expect(sortRuns(runs(), () => true).main.causes).toMatchObject({ "flaky test": 0, "real break": 1 });
});

test("the table names each count", () => {
  const text = renderReport(sortRuns([run({ conclusion: "failure", log: testLog("m") })]), 2).join("\n");
  expect(text).toContain("| main | 1 | 0 | 1 | 0 |");
  expect(text).toContain("| m | 1 | real break | 0.0 s |");
});

test("a fix is a subject that starts with Fix or Main green, after a task id or not", () => {
  expect(["Fix the lock", "LIN-1185: Fix a race (#9)", "LE-10: Main green after LIN-1207 (#61)"].map(isFixSubject)).toEqual([true, true, true]);
  expect(["LIN-1215: L423 An agent ends at ready (#66)", "Prefix the name"].map(isFixSubject)).toEqual([false, false]);
});

const fixture = (name: string) => Bun.file(`${import.meta.dir}/fixtures/check-logs/${name}`).text();

test("logs kept from GitHub runs give the right first cause", async () => {
  const one = firstCause(await fixture("flaky-test.log"));
  expect(one).toEqual({ kind: "test", tests: [{ name: "a read that began while a write ran is not shared once the write is done", ms: 32.87 }] });
  const two = firstCause(await fixture("slow-tests.log"));
  expect(two.kind).toBe("test");
  expect(two.tests.map((t) => Math.round(t.ms / 1000))).toEqual([60, 60]);
  const report = sortRuns([run({ conclusion: "failure", log: await fixture("flaky-test.log") }), run({})]);
  expect(report.main.causes["flaky test"]).toBe(1);
  expect(report.tests[0]).toMatchObject({ cause: "flaky test", runs: 1 });
});

test("a gate fails the run from a GitHub log, on a pull request", async () => {
  const log = await fixture("gate.log");
  expect(firstCause(log)).toEqual({ kind: "gate", tests: [] });
  const report = sortRuns([run({ event: "pull_request", branch: "w/9", conclusion: "failure", log })]);
  expect(report.pullRequests.causes.gate).toBe(1);
});
