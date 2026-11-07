import { expect, test } from "bun:test";
import { longestChain, planProblems, readinessPrompt, stepFormProblems } from "../src/autoplan.ts";
import { stepRule, askableKinds } from "../src/inbox.ts";
import { askBefore } from "../src/project.ts";
import { checkRoadmap } from "../src/roadmap.ts";

const step = (id: string, after: string, done = "it works", locks = "repo") =>
  `### ${id} Title ${id}\n- result: Title ${id} works.\n- why: because\n- done when:\n  - ${done}\n- locks: ${locks}\n- after: ${after}\n`;
const doc = (...steps: string[]) => `# Roadmap\n\n## Phase 0: Base\n\n${steps.join("\n")}`;

const base = doc(step("A1", "none"), step("U43", "A1"));

test("the longest chain counts the steps on the longest after path", () => {
  const steps = checkRoadmap(doc(step("A1", "none"), step("A2", "A1"), step("U43", "A2"))).parsed.steps;
  expect(longestChain(steps, "U43")).toBe(3);
  expect(longestChain(steps, "ZZ")).toBeUndefined();
});

test("a change that keeps the rules has no problem", () => {
  expect(planProblems(base, doc(step("A1", "none"), step("B1", "A1"), step("U43", "A1")))).toEqual([]);
});

test("the chain is counted to the last step of any roadmap", () => {
  const was = doc(step("P1", "none"), step("P2", "P1"));
  expect(planProblems(was, doc(step("P1", "none"), step("X1", "P1"), step("P2", "X1"))).join("\n")).toContain("longest chain to P2 grew from 2 to 3");
});

test("each rule refuses what breaks it", () => {
  const bad = (after: string) => planProblems(base, after).join("\n");
  expect(bad("# Roadmap\nnothing")).toContain("form:");
  expect(bad(doc(step("U43", "none")))).toContain("A1 is gone");
  expect(bad(doc(step("A1", "none", "it works", "none"), step("U43", "A1")))).toContain("lost the lock repo");
  expect(bad(doc(step("A1", "none", "it half works"), step("U43", "A1")))).toContain("done when");
  expect(bad(doc(step("A1", "none"), step("B1", "A1"), step("U43", "B1")))).toContain("longest chain");
  expect(bad(doc(step("A1", "none"), step("U43", "A1"), step("B1", "A1", "ok", "none")))).toBe("");
});

test("the readiness prompt carries the change", () => {
  expect(readinessPrompt("+ a line")).toContain("+ a line");
});

test("an agent is told a written rule for a step question, and may ask only login or outward", () => {
  expect(askableKinds).toEqual(["login", "outward"]);
  expect(stepRule("Merge now or wait?")).toContain("Merge now");
  expect(stepRule("Which reviewer?")).toContain("another company");
  expect(stepRule("Is this flaky?")).toContain("once more");
  expect(stepRule("Anything else?")).toContain("safer choice");
});

test("Ask me before: a new project asks for releases and spending, not for plans", () => {
  expect(askBefore({})).toMatchObject({ plans: false, releases: true, spending: true });
});

test("a whole new step passes the form check, and an unchanged old one is not looked at", () => {
  const whole = `${step("B1", "A1")}- files: src/b.ts\n`;
  expect(stepFormProblems(base, `${base}\n${whole}`)).toEqual([]);
  expect(stepFormProblems(base, base)).toEqual([]);
});

test("a step missing one part is named for that part only", () => {
  const parts = {
    "a why": "- result: It works.\n- done when:\n  - ok\n- locks: none\n- after: A1\n- files: src/b.ts\n",
    "a done when": "- result: It works.\n- why: w\n- done when:\n- locks: none\n- after: A1\n- files: src/b.ts\n",
    "a locks line": "- result: It works.\n- why: w\n- done when:\n  - ok\n- after: A1\n- files: src/b.ts\n",
    "an after line": "- result: It works.\n- why: w\n- done when:\n  - ok\n- locks: none\n- files: src/b.ts\n",
    "known ids in after": "- result: It works.\n- why: w\n- done when:\n  - ok\n- locks: none\n- after: Q9\n- files: src/b.ts\n",
    "a files line": "- result: It works.\n- why: w\n- done when:\n  - ok\n- locks: none\n- after: A1\n",
  };
  for (const [part, text] of Object.entries(parts)) {
    const out = stepFormProblems(base, `${base}\n### B1 Title\n${text}`);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("step B1 needs");
    expect(out[0]).toContain(part);
  }
});

test("files must name a path, and a dropped step is left alone", () => {
  expect(stepFormProblems(base, `${base}\n${step("B1", "A1").replace("- locks", "- files: none\n- locks")}`)[0]).toContain("a files line");
  expect(stepFormProblems(base, `${base.replace("- after: none\n", "- after: none\n- dropped: not needed\n")}`)).toEqual([]);
});

test("a changed old step is checked as well", () => {
  expect(stepFormProblems(base, base.replace("it works", "it works well"))[0]).toContain("step A1 needs a files line");
});
