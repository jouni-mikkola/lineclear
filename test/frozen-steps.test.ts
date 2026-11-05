import { expect, test } from "bun:test";
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
