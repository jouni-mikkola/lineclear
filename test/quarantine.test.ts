import { expect, test } from "bun:test";
import { judge, type Quarantined } from "../scripts/quarantine.ts";

const f = (n: number) => ({ file: "./test/a.test.ts", test: `t${n}` });
const q = (n: number): Quarantined => ({ file: "test/a.test.ts", test: `t${n}`, task: `LIN-${n}` });

test("a quarantined flake passes, a flake not listed and a break fail", () => {
  const passesAlone = (x: { test: string }) => x.test !== "t9";
  expect(judge([f(1)], passesAlone, [q(1)]).ok).toBe(true);
  expect(judge([f(2)], passesAlone, [q(1)]).faults[0]).toContain("flaky");
  expect(judge([f(9)], passesAlone, [q(9)]).faults[0]).toContain("failed alone too");
  expect(judge([f(1), f(9)], passesAlone, [q(1), q(9)]).ok).toBe(false);
});

test("a 6th test in quarantine fails the check", () => {
  const list = [1, 2, 3, 4, 5, 6].map(q);
  const v = judge([f(6)], () => true, list);
  expect(v.ok).toBe(false);
  expect(v.faults[0]).toContain("at most 5");
  expect(judge([f(5)], () => true, list.slice(0, 5)).ok).toBe(true);
});
