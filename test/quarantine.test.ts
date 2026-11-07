import { expect, test } from "bun:test";
import type { Failure } from "../scripts/failures.ts";
import { judge, QUARANTINE_MAX, withQuarantined } from "../scripts/quarantine.ts";

const f = (test: string): Failure => ({ file: "test/a.test.ts", test });
const passes = (names: string[]) => async (x: Failure) => names.includes(x.test);

test("a quarantined flake does not fail the step, a new flake and a break do", async () => {
  const list = [{ test: "test/a.test.ts: flake", task: "LIN-1" }];
  expect((await judge([f("flake")], passes(["flake"]), list)).ok).toBe(true);
  const fresh = await judge([f("other")], passes(["other"]), list);
  expect(fresh.ok).toBe(false);
  expect(fresh.flaky).toEqual(["test/a.test.ts: other"]);
  const broken = await judge([f("flake"), f("broken")], passes(["flake"]), list);
  expect(broken.ok).toBe(false);
  expect(broken.broken).toEqual(["test/a.test.ts: broken"]);
  // failing alone wins over quarantine
  expect((await judge([f("flake")], passes([]), list)).ok).toBe(false);
});

test("a sixth flake is refused", () => {
  let list: { test: string; task: string }[] = [];
  for (let i = 0; i < QUARANTINE_MAX; i++) list = withQuarantined(list, `t${i}`, `LIN-${i}`);
  expect(() => withQuarantined(list, "t6", "LIN-6")).toThrow("quarantine is full");
  expect(withQuarantined(list, "t0", "LIN-0")).toBe(list);
});
