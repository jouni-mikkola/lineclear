import { expect, test } from "bun:test";
import { toolRun } from "../pi/heavy-tool.ts";

test("a type check and a parallel test run are heavy, a test of named files is free", () => {
  expect(toolRun("tsc --noEmit")).toBe("heavy");
  expect(toolRun("bunx tsc --noEmit -p server")).toBe("heavy");
  expect(toolRun("tsc --watch")).toBe("free");
  expect(toolRun("bun test --parallel")).toBe("heavy");
  expect(toolRun("bun test --parallel test/a.test.ts")).toBe("heavy");
  expect(toolRun("bun test test/a.test.ts")).toBe("free");
});
