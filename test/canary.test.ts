import { expect, test } from "bun:test";
import { loadFactor, readyTimeout } from "../scripts/canary.ts";

test("waits stretch with load per core and never shrink", () => {
  expect(loadFactor(2, 8)).toBe(1);
  expect(loadFactor(50, 8)).toBe(6.25);
  expect(loadFactor(500, 8)).toBe(8);
});

test("a ready timeout shows the state and the stub agent's log tail", () => {
  const log = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const text = readyTimeout("CAN-1 did not show ready within 60 s", { status: "work", sub: "Working" }, log);
  expect(text).toContain("CAN-1 did not show ready within 60 s: work Working");
  expect(text).toContain("line 29");
  expect(text).toContain("line 15");
  expect(text).not.toContain("line 14\n");
  expect(readyTimeout("x", undefined, "")).toContain("no task seen");
});
