import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseRoadmap } from "../src/roadmap.ts";
import { tick } from "../src/rules.ts";
import { demoEnv, fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();

const step = (id: string) => `### ${id} Step ${id}
- why: because
- done when:
  - it works
- locks: none
- after: none
`;
const roadmap = `# Roadmap

## Next in order

${step("A")}
## Frozen by the owner 5 Nov 2026

${step("B")}`;

test("the rule loop starts a ready step and never a frozen one", () => {
  const env = demoEnv(scratchDir("frozen"));
  const f = fakeWorld(env, [], roadmap, []);
  tick(f.world, false, env);
  const started = f.adds.map((a) => a[0]);
  expect(started).toContain("A Step A");
  expect(started).not.toContain("B Step B");
});

test("docs/ROADMAP.md keeps the frozen section last, with open steps in it", () => {
  const steps = parseRoadmap(readFileSync("docs/ROADMAP.md", "utf8")).steps;
  const frozen = steps.filter((s) => s.phase.startsWith("Frozen by the owner 5 Nov 2026"));
  expect(frozen.length).toBeGreaterThan(40);
  expect(steps.slice(-frozen.length).map((s) => s.id)).toEqual(frozen.map((s) => s.id));
});
