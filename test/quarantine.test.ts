import { expect, test } from "bun:test";
import type { Failure } from "../scripts/failures.ts";
import { fullyParsed, judge, onlyThisTest, QUARANTINE_CAP, type Quarantined } from "../scripts/quarantine.ts";

const fail = (test: string): Failure => ({ file: "./test/a.test.ts", test });

test("a flake is quarantined, a break fails, and a flake past the cap fails", () => {
  const flaky = new Set(["f1", "f2", "f3", "f4", "f5", "f6"]);
  const alone = (f: Failure) => flaky.has(f.test);
  const flake = judge([fail("f1")], [], alone);
  expect(flake.failing).toEqual([]);
  expect(flake.fresh.map((f) => f.test)).toEqual(["f1"]);

  expect(judge([fail("broken")], [], alone).failing.map((f) => f.test)).toEqual(["broken"]);

  const five = judge(["f1", "f2", "f3", "f4", "f5"].map(fail), [], alone);
  expect(five.failing).toEqual([]);
  expect(five.fresh).toHaveLength(QUARANTINE_CAP);
  const listed = five.fresh.map((f) => ({ file: "test/a.test.ts", test: f.test, task: "LIN-9" }));
  expect(judge([fail("f6")], listed, alone).failing.map((f) => f.test)).toEqual(["f6"]);
  expect(judge([fail("f1")], listed, alone).ignored).toHaveLength(1);
});

test("a listed test that also fails alone still fails, and the server's files carry their folder", () => {
  const listed: Quarantined[] = [{ file: "server/test/a.test.ts", test: "x", task: "LIN-9" }];
  expect(judge([fail("x")], listed, () => false, "server/").failing).toHaveLength(1);
  const ok = judge([fail("x")], listed, () => true, "server/");
  expect(ok.failing).toEqual([]);
  expect(ok.ignored).toHaveLength(1);
  expect(ok.fresh).toEqual([]);
});

test("one test is picked by an escaped, anchored pattern", () => {
  expect(onlyThisTest("suite > a (b) [1]")).toBe("^suite a \\(b\\) \\[1\\]$");
});

test("a run with a failure the log did not name is not fully read", () => {
  expect(fullyParsed(" 3 pass\n 1 fail\n", 1)).toBe(true);
  expect(fullyParsed(" 3 pass\n 2 fail\n", 1)).toBe(false);
  expect(fullyParsed(" 3 pass\n 1 fail\n 1 error\n", 1)).toBe(false);
});
