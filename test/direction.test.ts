import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readinessPrompt } from "../src/autoplan.ts";
import { directionOf, ownerDirection, taskIds } from "../src/direction.ts";
import { dispatcherPrompt } from "../src/dispatcher.ts";
import { stepBrief } from "../src/brief.ts";
import type { Settings } from "../src/project.ts";
import { parseRoadmap, type Step } from "../src/roadmap.ts";
import { sh } from "./helpers.ts";

const LINE = "Lineclear is where all development happens from now on";
const step = parseRoadmap("# R\n\n## P\n\n### A1 Title\n- why: because\n- done when:\n  - first\n- locks: none\n- after: none\n").steps[0] as Step;

test("the section is in docs/idea.md and names its tasks", () => {
  const idea = readFileSync("docs/idea.md", "utf8");
  const section = directionOf(idea) ?? "";
  expect(section).toContain(LINE);
  expect(section).not.toContain("## The core");
  expect(taskIds(section)).toContain("LIN-147");
});

test("directionOf is undefined without the heading and stops at the next one", () => {
  expect(directionOf("# T\n\n## Other\n\nx\n")).toBeUndefined();
  expect(directionOf("# T\n\n## The owner's direction\n\n- a\n\n## Next\n\nb\n")).toBe("## The owner's direction\n\n- a");
});

test("the step brief, the plan brief, the readiness question and the Dispatcher's prompt carry the direction", () => {
  const brief = stepBrief(step, { check: "c", repo: "." } as Settings, "r/m", "w/m");
  expect(brief).toContain(LINE);
  expect(brief).toContain("critical finding");
  expect(readinessPrompt("diff")).toContain(ownerDirection());
  expect(dispatcherPrompt()).toContain(ownerDirection());
  const plan = readFileSync("templates/plan.md", "utf8");
  expect(plan).toContain("{{direction}}");
});

test("a repo without its own direction gets the general one, never another project's lines", () => {
  const brief = stepBrief(step, { check: "c", repo: "/nowhere" } as Settings, "r/m", "w/m");
  expect(brief).toContain(ownerDirection());
  expect(brief).not.toContain(LINE);
  expect(ownerDirection()).not.toContain("webshop");
  expect(ownerDirection(".")).toContain(LINE);
});

test("the direction check passes on this repo", () => {
  expect(sh(["bun", "scripts/direction-check.ts", "."]).code).toBe(0);
});
