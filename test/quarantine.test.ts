import { expect, test } from "bun:test";
import { aloneArgs, judge, type Quarantined, quarantineWith } from "../scripts/quarantine.ts";

const f = (n: number) => ({ file: "a.test.ts", test: `t${n}` });
const listed: Quarantined[] = [{ file: "a.test.ts", test: "t1", task: "VEL-9" }];

test("a flake is let through, a break is not", () => {
  const verdict = judge([f(1), f(2), f(3)], (x) => x.test !== "t2", listed);
  expect(verdict.quarantined).toEqual([f(1)]);
  expect(verdict.real).toEqual([f(2)]);
  expect(verdict.unlisted).toEqual([f(3)]);
});

test("a 6th flake fails the check", () => {
  const full = quarantineWith([], [f(1), f(2), f(3), f(4), f(5)], "VEL-9");
  expect(judge([f(6)], () => true, full).real).toEqual([f(6)]);
});

test("a quarantined test that fails alone too still fails", () => {
  expect(judge([f(1)], () => false, listed).real).toEqual([f(1)]);
});

test("the 6th flake in quarantine is refused", () => {
  const five = quarantineWith([], [f(1), f(2), f(3), f(4), f(5)], "VEL-9");
  expect(five).toHaveLength(5);
  expect(() => quarantineWith(five, [f(6)], "VEL-9")).toThrow("at most 5");
});

test("a test is rerun alone by file and escaped name", () => {
  expect(aloneArgs({ file: "a.test.ts", test: "group > does (x)" })).toEqual(["test", "--timeout", "120000", "./a.test.ts", "-t", "group.*does \\(x\\)"]);
});
