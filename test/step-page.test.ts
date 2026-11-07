import { expect, test } from "bun:test";
import { checklistItems, namedBy } from "../src/step-page.ts";
import { roadmapSample, stepSample } from "../ui/test/roadmap-samples.ts";

const parts = (id: string) => {
  const d = roadmapSample("filled", "web-shop");
  return stepSample(d, id);
};

test("a done-when list is split into its top-level items, with the lines under each joined", () => {
  expect(checklistItems("- A works.\n  - B works\n    - and its detail.")).toEqual(["A works.", "B works - and its detail."]);
  expect(checklistItems("  - A\n  - B")).toEqual(["A", "B"]);
});

test("an item is named by four of its words in a row or by its place", () => {
  expect(namedBy("The page shows the cost in dollars", 1, "ready: the page shows the cost in dollars, checked")).toBe(true);
  expect(namedBy("The page shows the cost", 2, "done when 2 holds")).toBe(true);
  expect(namedBy("The page shows the cost in dollars", 1, "nothing relevant")).toBe(false);
});

test("a done step is ticked from its merge, a step at work only where named, and a wait is a link", () => {
  expect(parts("W2").checklist.every((c) => c.evidence?.startsWith("merge commit"))).toBe(true);
  expect(parts("W5").checklist.some((c) => !c.evidence)).toBe(true);
  expect(parts("W7").waits.find((w) => w.kind === "lock")?.href).toMatch(/\/roadmap\/W\d+$/);
  expect(parts("W3").waits.find((w) => w.kind === "you")?.href).toBe("/inbox");
});
