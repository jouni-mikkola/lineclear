import { expect, test } from "bun:test";
import { cpus } from "node:os";
import {
  BUDGET_S,
  junitSlowestCase,
  junitTimes,
  loadFactorMeter,
  lowered,
  overBudget,
  slowFails,
  slowFaults,
  specTimes,
  split,
  table,
} from "../scripts/check-speed.ts";

test("junit times add up per test file, other suites are not files", () => {
  const xml = `<testsuites><testsuite name="test/a.test.ts" tests="2" time="1.5"></testsuite><testsuite name="describe x" time="9"></testsuite><testsuite name="test/a.test.ts" time="0.5"></testsuite></testsuites>`;
  expect([...junitTimes(xml)]).toEqual([["test/a.test.ts", 2]]);
});

test("spec times sum the tests of a file over every project", () => {
  const t = { results: [{ duration: 1500 }] };
  const json = JSON.stringify({
    suites: [
      { file: "x.pw.ts", suites: [{ specs: [{ tests: [t, t] }] }] },
      { file: "x.pw.ts", specs: [{ tests: [t] }] },
    ],
  });
  expect([...specTimes(json)]).toEqual([["ui/test/x.pw.ts", 4.5]]);
});

test("a file over its limit fails by name, slowest first; a known slow file may grow to three times its baseline", () => {
  const times = new Map([
    ["test/a.test.ts", 8],
    ["test/b.test.ts", 9],
    ["test/c.test.ts", 90],
    ["test/d.test.ts", 2],
  ]);
  const faults = slowFaults("unit", times, { "test/c.test.ts": 80 }, 1);
  expect(faults.map((f) => f.split(":")[0])).toEqual(["test/b.test.ts", "test/a.test.ts"]);
  expect(slowFaults("unit", times, { "test/c.test.ts": 20 }, 1)[0]).toContain("test/c.test.ts");
});

test("a busy machine fails nothing for being busy", () => {
  expect(slowFaults("spec", new Map([["ui/test/a.pw.ts", 30]]), {}, 2)).toEqual([]);
  expect(overBudget([{ step: "tests", seconds: 200, ok: true }], 200, 2)).toBeUndefined();
});

test("a check over budget names its slowest steps", () => {
  const steps = [
    { step: "types", seconds: 60, ok: true },
    { step: "tests", seconds: BUDGET_S + 10, ok: true },
  ];
  expect(overBudget(steps, BUDGET_S + 10, 1)).toContain(`tests ${BUDGET_S + 10} s`);
  expect(overBudget(steps, 150, 1)).toBeUndefined();
  expect(table(steps).split("\n")[0]).toContain("tests");
});

test("lowering keeps the files over the limit at their lower time and drops the fixed ones", () => {
  const next = lowered(
    "unit",
    new Map([
      ["test/a.test.ts", 8],
      ["test/b.test.ts", 1],
    ]),
    { "test/a.test.ts": 12, "test/b.test.ts": 9, "ui/test/s.pw.ts": 30 },
    1,
  );
  expect(next).toEqual({ "test/a.test.ts": 8, "ui/test/s.pw.ts": 30 });
});

test("files are split into runs of about equal time by their last time", () => {
  const runs = split(["./test/a.test.ts", "./test/b.test.ts", "./test/c.test.ts"], 2, { "test/a.test.ts": 10, "test/b.test.ts": 5, "test/c.test.ts": 5 });
  expect(runs.map((r) => r.length).sort()).toEqual([1, 2]);
  expect(runs.find((r) => r.length === 1)).toEqual(["./test/a.test.ts"]);
});

test("lowering never adds a file unless told to", () => {
  const times = new Map([["test/new.test.ts", 9]]);
  expect(lowered("unit", times, {}, 1)).toEqual({});
  expect(lowered("unit", times, {}, 1, true)).toEqual({ "test/new.test.ts": 9 });
});

test("the load factor is the busiest the machine was, from the start to the end of the run", () => {
  let reading = [2, 2, 2];
  const factor = loadFactorMeter(() => reading);
  const cores = cpus().length;
  expect(factor()).toBe(1);
  reading = [cores * 6, cores * 3, 0];
  expect(factor()).toBe(6);
  reading = [0, cores * 8, 0];
  expect(factor()).toBe(8);
  reading = [0, 0, 0];
  expect(factor()).toBe(1);
});

test("a slow file fails the run, except in a release run where load decides the times", () => {
  const faults = slowFaults("unit", new Map([["test/a.test.ts", 40]]), {}, 1);
  expect(faults).toHaveLength(1);
  expect(slowFails(faults, false)).toBe(true);
  expect(slowFails(faults, true)).toBe(false);
  expect(slowFails([], false)).toBe(false);
});

test("the slowest test case of a file is what the unit limit judges", () => {
  const xml = `<testcase name="a" classname="" time="0.5" file="test/a.test.ts" line="1" /><testcase name="b" classname="" time="2.5" file="test/a.test.ts" line="9" />`;
  expect([...junitSlowestCase(xml)]).toEqual([["test/a.test.ts", 2.5]]);
});
