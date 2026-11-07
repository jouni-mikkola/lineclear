import { expect, test } from "bun:test";
import { inboxMain } from "../src/inbox-answer.ts";
import { readItems } from "../src/inbox.ts";
import { classify } from "../src/stall-class.ts";
import { checkRoadmap } from "../src/roadmap.ts";
import { tick } from "../src/rules.ts";
import { demoEnv, fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();

const roadmap = `# Roadmap

## Phase 0

### A Pull the plug
- why: only the owner can.
- done when:
  - Owner only: a hand test.
  - The plug was pulled and the result is written down.
- locks: none
- after: none

### B After the plug
- why: needs A.
- done when:
  - It runs.
- locks: none
- after: A
`;

test("the check accepts the owner-only mark", () => {
  const { parsed, errors } = checkRoadmap(roadmap);
  expect(errors).toEqual([]);
  expect(parsed.steps.map((s) => s.ownerOnly)).toEqual([true, false]);
});

test("a ready owner-only step starts no task and makes one Inbox item; Done releases the next step", () => {
  const dir = scratchDir("owner-steps");
  const run = demoEnv(dir);
  const f = fakeWorld(run, [], roadmap, []);
  const seen = [0, 1, 2].flatMap(() => tick(f.world, false, run));
  expect(seen.filter((d) => d.step === "A").map(classify)).toEqual(["owner", "owner"]);
  expect(f.adds).toHaveLength(0);
  const items = readItems(run).filter((i) => i.ownerStep === "A");
  expect(items).toHaveLength(1);
  expect(items[0]?.question).toContain("The plug was pulled");
  const n = String(items[0]?.n);
  expect(inboxMain(["answer", n, "Done"], () => {}, run)).toBe(2);
  expect(inboxMain(["answer", n, "Done", "--note", "it came back"], () => {}, run)).toBe(0);
  tick(f.world, false, run);
  expect(f.adds.some((a) => a[0]?.startsWith("B "))).toBe(true);
  expect(readItems(run).filter((i) => i.ownerStep === "A")).toHaveLength(1);
});
