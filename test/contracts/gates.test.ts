// The contract of the parts module: how the rules and the planner read a step's parts, locks and files lines.
import { expect, test } from "bun:test";
import { stepFiles, stepLocks, stepParts } from "../../src/parts.ts";
import { checkRoadmap, type Step } from "../../src/roadmap.ts";

const step = (lines: string): Step => {
  const s = checkRoadmap(`# R\n\n## Phase 1: P\n\n### A1 One\n- why: w\n- done when:\n  - d\n${lines}- after: none\n`).parsed.steps[0];
  if (!s) throw new Error("no step");
  return s;
};

test("a step's parts line names its parts; its own locks replace its parts, and without them its parts lock", () => {
  const s = step("- parts: core, ui\n- files: src/a.ts, `ui/b.ts`\n- locks: roadmap\n");
  expect(stepParts(s)).toEqual({ names: ["core", "ui"] });
  expect(stepFiles(s)).toEqual(["src/a.ts", "ui/b.ts"]);
  expect(stepLocks(s)).toEqual(["roadmap"]);
  expect(stepLocks(step("- parts: core, ui\n- locks: none\n"))).toEqual(["core", "ui"]);
});
