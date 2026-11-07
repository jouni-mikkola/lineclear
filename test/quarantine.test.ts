import { expect, test } from "bun:test";
import type { Failure } from "../scripts/failures.ts";
import { judge, onlyThisTest, QUARANTINE_CAP, type Quarantined } from "../scripts/quarantine.ts";

const fail = (test: string): Failure => ({ file: "./test/a.test.ts", test });

test("a flake is quarantined, a break fails, and a flake past the cap fails", () => {
  const flaky = new Set(["f1", "f2", "f3", "f4", "f5", "f6"]);
  const alone = (f: Failure) => flaky.has(f.test);
  const flake = judge([fail("f1")], [], alone);
  expect(flake.failing).toEqual([]);
  expect(flake.list).toEqual([{ file: "test/a.test.ts", test: "f1", task: "unfiled" }]);

  expect(judge([fail("broken")], [], alone).failing.map((f) => f.test)).toEqual(["broken"]);

  const five = judge(["f1", "f2", "f3", "f4", "f5"].map(fail), [], alone);
  expect(five.failing).toEqual([]);
  expect(five.list).toHaveLength(QUARANTINE_CAP);
  const sixth = judge([fail("f6")], five.list, alone);
  expect(sixth.failing.map((f) => f.test)).toEqual(["f6"]);
  expect(sixth.list).toHaveLength(QUARANTINE_CAP);
});

test("a listed test that also fails alone still fails, and the server's files carry their folder", () => {
  const listed: Quarantined[] = [{ file: "server/test/a.test.ts", test: "x", task: "LIN-9" }];
  expect(judge([fail("x")], listed, () => false, "server/").failing).toHaveLength(1);
  const ok = judge([fail("x")], listed, () => true, "server/");
  expect(ok.failing).toEqual([]);
  expect(ok.ignored).toHaveLength(1);
  expect(ok.added).toEqual([]);
});

test("one test is picked by an escaped, anchored pattern", () => {
  expect(onlyThisTest("suite > a (b) [1]")).toBe("^suite a \\(b\\) \\[1\\]$");
});
