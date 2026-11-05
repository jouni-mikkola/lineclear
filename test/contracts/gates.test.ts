// The contract of the parts module: how planner, rules, measure and ui read parts and a step's parts line.
import { expect, test } from "bun:test";
import { HEALTH_TAG, ownerOf, parsePart, stepFiles, stepLocks, stepPartFaults, stepParts } from "../../src/parts.ts";
import { checkRoadmap, type Step } from "../../src/roadmap.ts";

const parts = [parsePart("core", "# core\n\nx\n\n## Files\n\n- `src/`\n"), parsePart("ui", "# ui\n\nx\n\n## Files\n\n- `src/web/`, `ui/`\n")];

const step = (lines: string): Step => {
  const s = checkRoadmap(`# R\n\n## Phase 1: P\n\n### A1 One\n- why: w\n- done when:\n  - d\n${lines}- after: none\n`).parsed.steps[0];
  if (!s) throw new Error("no step");
  return s;
};

test("ownerOf gives the part with the longest entry; a part's page and contract test are its own", () => {
  expect(ownerOf("src/a.ts", parts)?.name).toBe("core");
  expect(ownerOf("src/web/x.ts", parts)?.name).toBe("ui");
  expect(ownerOf("docs/parts/ui.md", parts)?.name).toBe("ui");
  expect(ownerOf("test/contracts/core.test.ts", parts)?.name).toBe("core");
  expect(ownerOf("README.md", parts)).toBeUndefined();
});

test("a step's parts line names its parts and health steps; its own locks replace its parts, and without them its parts lock", () => {
  const s = step(`- parts: core ${HEALTH_TAG}, ui\n- files: src/a.ts, \`ui/b.ts\`\n- locks: roadmap\n`);
  expect(stepParts(s)).toEqual({ names: ["core", "ui"], health: ["core"] });
  expect(stepFiles(s)).toEqual(["src/a.ts", "ui/b.ts"]);
  expect(stepLocks(s)).toEqual(["roadmap"]);
  expect(stepLocks(step(`- parts: core, ui\n- locks: none\n`))).toEqual(["core", "ui"]);
  expect(stepPartFaults(s, parts)).toEqual([]);
});

test("stepPartFaults names an unknown part and a file outside the step's parts", () => {
  const faults = stepPartFaults(step("- parts: core, nope\n- files: ui/b.ts\n"), parts);
  expect(faults.some((f) => f.includes("unknown part 'nope'"))).toBe(true);
  expect(faults.some((f) => f.includes("ui/b.ts, which is in part ui"))).toBe(true);
});
