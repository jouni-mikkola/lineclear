// The contract of planner: the roadmap's form and states as rules, dispatcher, measure and ui read them.
import { expect, test } from "bun:test";
import { planProblems } from "../../src/autoplan.ts";
import { BRIEF_MAX, fitSections } from "../../src/brief.ts";
import { ownerDirection } from "../../src/direction.ts";
import { checkRoadmap, doneIds, stepStatuses } from "../../src/roadmap.ts";

const ROADMAP = `# Roadmap

## Phase 1: First

### A1 One
- why: a reason
- done when:
  - it works
- parts: core
- after: none

### A2 Two
- why: a reason
- done when:
  - it works too
- locks: none
- after: A1
`;

test("checkRoadmap gives each step its id, title, phase, fields and after", () => {
  const { parsed, errors } = checkRoadmap(ROADMAP);
  expect(errors).toEqual([]);
  const [a1, a2] = parsed.steps;
  expect([a1?.id, a1?.title, a1?.phase]).toEqual(["A1", "One", "Phase 1: First"]);
  expect(a1?.fields.parts?.value).toBe("core");
  expect(a2?.after).toEqual(["A1"]);
});

test("a step that names its parts needs no locks line, one with neither fails", () => {
  expect(checkRoadmap(ROADMAP.replace("- locks: none\n", "")).errors.length).toBeGreaterThan(0);
});

test("doneIds reads `<TASK>: <id>` subjects; stepStatuses gives the states", () => {
  const { steps } = checkRoadmap(ROADMAP).parsed;
  const done = doneIds([{ subject: "LIN-1: A1 One", body: "" }], new Set(["A1", "A2"]));
  expect([...done]).toEqual(["A1"]);
  expect(stepStatuses(steps, done, []).map((s) => s.state)).toEqual(["done", "ready"]);
  expect(stepStatuses(steps, new Set(), [{ title: "A1 One", status: "work" }]).map((s) => s.state)).toEqual(["work", "waiting"]);
});

test("fitSections keeps the brief within BRIEF_MAX, the rules giving way before the part pages", () => {
  const s = fitSections(BRIEF_MAX - 3000, ["src/a.ts"], "r".repeat(5000), "p".repeat(1000));
  expect(s.files).toContain("src/a.ts");
  expect(s.parts).toContain("p".repeat(1000));
  expect(s.files.length + s.rules.length + s.parts.length).toBeLessThanOrEqual(3000);
});

test("planProblems passes an unchanged roadmap and refuses a deleted step", () => {
  expect(planProblems(ROADMAP, ROADMAP)).toEqual([]);
  expect(planProblems(ROADMAP, ROADMAP.slice(0, ROADMAP.indexOf("### A2")))).not.toEqual([]);
});

test("the owner's direction is one section with its heading, for every brief and the Dispatcher", () => {
  const d = ownerDirection();
  expect(d.startsWith("## The owner's direction\n")).toBe(true);
  expect(d.slice(3)).not.toContain("\n## ");
});
