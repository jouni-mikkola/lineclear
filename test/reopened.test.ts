import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkRoadmap, type Step } from "../src/roadmap.ts";
import { stepBrief } from "../src/brief.ts";
import { tick } from "../src/rules.ts";
import type { Settings } from "../src/project.ts";
import { fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();

const roadmap = (reopened: boolean) => `# Roadmap

## Phase 0

### A Alpha
- why: because
- done when:
  - A run is in \`docs/numbers.md\` under "A".
${reopened ? "  - Reopened: the run is missing\n" : ""}- locks: none
- after: none
`;

const stepsOf = (reopened: boolean) => checkRoadmap(roadmap(reopened)).parsed.steps;

test("the brief of a reopened step says to delete its Reopened line with the proof", () => {
  const settings = { repo: "", space: "s", check: "true" } as Settings;
  expect(stepBrief(stepsOf(true)[0] as Step, settings, "m")).toContain("delete that Reopened line");
  expect(stepBrief(stepsOf(false)[0] as Step, settings, "m")).not.toContain("Reopened");
});

function setup(commitsSince: number, text = roadmap(true)) {
  const dir = scratchDir("reopened");
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  const models = { worker: ["anthropic/claude-sonnet-5-5"], reviewer: ["anthropic/claude-opus-5-5"], planner: ["anthropic/claude-opus-5-5"] };
  writeFileSync(join(config, "projects", "demo", "settings.json"), JSON.stringify({ repo: dir, space: "demo", check: "true", models }));
  writeFileSync(join(config, "machine.json"), JSON.stringify({ loadLimit: 1e6 }));
  const tmp = join(dir, "tmp");
  mkdirSync(tmp);
  const run = {
    ...process.env,
    LINECLEAR_CONFIG: config,
    TMPDIR: tmp,
    LINECLEAR_HOME: join(dir, "home"),
    LINECLEAR_STORE_COPIES: join(dir, "copies"),
    XDG_CACHE_HOME: join(dir, "cache"),
  };
  const f = fakeWorld(run, [], text, [{ subject: "LIN-9: A Alpha", body: "" }]);
  f.world.commitsSince = () => commitsSince;
  return { ...f, env: run, tickOnce: () => tick(f.world, false, run) };
}

test("a reopened step with a task merged since its Reopened line is not started and no fix task is filed", () => {
  const t = setup(2);
  const first = t.tickOnce();
  t.tickOnce();
  expect(t.adds).toHaveLength(0);
  const skips = first.filter((d) => d.kind === "skip" && d.step === "A");
  expect(skips[0]?.reason).toContain("Reopened line stayed");
});

test("a reopened step with no merge since its Reopened line starts as before", () => {
  const t = setup(0);
  t.tickOnce();
  expect(t.adds).toHaveLength(1);
  expect(t.adds[0]?.[0]).toBe("A Alpha");
});
