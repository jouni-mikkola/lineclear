import { expect, test } from "bun:test";
import { failingLines } from "../src/check-runs.ts";

test("a red check's lines keep the failed test and its error, not the passing ones", () => {
  const output = [
    "a.test.ts:",
    "(pass) adds",
    "error: expected 1 to be 2",
    "      at a.test.ts:9",
    "(fail) subtracts [1.00ms]",
    "(pass) multiplies",
    " 2 pass",
    " 1 fail",
    "check: outside the change: a.test.ts: subtracts",
  ].join("\n");
  expect(failingLines(output)).toBe(
    "error: expected 1 to be 2\n      at a.test.ts:9\n(fail) subtracts [1.00ms]\ncheck: outside the change: a.test.ts: subtracts",
  );
  expect(failingLines("✘ one (1.0s)\ncheck: x")).toBe("");
  expect(failingLines("all fine")).toBe("");
});
