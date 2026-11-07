import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tick } from "../src/rules.ts";
import { cheapWorker, isRoutine } from "../src/routine.ts";
import { parseRoadmap } from "../src/roadmap.ts";
import { decisionsSince } from "../src/decisions-store.ts";
import { demoConfig, idleWorld } from "./demo-world.ts";
import { recordTaskSteps, tmp } from "./helpers.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const CHEAP = "openai/gpt-cheap";
const STRONG = "anthropic/claude-sonnet-5-5";

const roadmap = (files: string) =>
  `# Roadmap\n\n## Phase 0\n\n### A Alpha\n- why: because\n- done when:\n  - it works\n- locks: none\n- after: none\n- files: ${files}\n`;

/** One project whose worker list holds a strong and a cheap model, priced in pi's models store. */
function setup(files: string, tasks: { id: string; title: string; status: string }[] = []) {
  const dir = tmp("routine");
  dirs.push(dir);
  const config = demoConfig(dir, { worker: [STRONG, CHEAP], reviewer: ["openai-codex/gpt-6.1-sol"], loadPerCore: 1e6 });
  const pi = join(dir, "pi");
  mkdirSync(pi, { recursive: true });
  const cost = (n: number) => ({ input: n, output: n, cacheRead: 0, cacheWrite: 0 });
  writeFileSync(
    join(pi, "models-store.json"),
    JSON.stringify({
      anthropic: {
        models: [{ id: "claude-sonnet-5-5", cost: cost(3) }],
      },
      openai: { models: [{ id: "gpt-cheap", cost: cost(1) }] },
    }),
  );
  const vars = {
    ...process.env,
    LINECLEAR_CONFIG: config,
    LINECLEAR_HOME: join(dir, "home"),
    LINECLEAR_STORE_COPIES: join(dir, "store-copies"),
    PI_CODING_AGENT_DIR: pi,
  };
  const adds: string[][] = [];
  const closed: string[] = [];
  const world = idleWorld(vars, {
    roadmap: () => roadmap(files),
    tasks: () => tasks,
    closeTask: (id) => (closed.push(id), undefined),
    branchOf: () => "work/5-a-alpha",
    addTasks: (_s, jobs) => jobs.map(({ title, brief, extra }) => (adds.push([title, brief, ...extra]), undefined)),
  });
  recordTaskSteps(config, Object.fromEntries(tasks.map((t) => [t.id, "A"])));
  const decisions = () => decisionsSince(vars, 0);
  const statePath = join(config, "projects", "demo", "state.json");
  return { dir, vars, world, adds, closed, decisions, statePath, tick: () => tick(world, false, vars) };
}

const modelOf = (add: string[]) => add[add.indexOf("--model") + 1];

test("a step that names only docs, tests or a baseline is routine; any other file makes it not", () => {
  const step = (files: string) => parseRoadmap(roadmap(files)).steps[0]!;
  expect(isRoutine(step("docs/numbers.md, test/a.test.ts, scripts/gates/baseline/lint.json"))).toBe(true);
  expect(isRoutine(step("docs/numbers.md, src/a.ts"))).toBe(false);
  expect(isRoutine(step("none"))).toBe(false);
});

test("the cheap model is the cheapest priced one of the worker list", () => {
  const price = (m: string) => ({ a: 3, b: 1 })[m as "a" | "b"];
  expect(cheapWorker(["a", "b", "c"], price)).toBe("b");
  expect(cheapWorker(["c"], price)).toBeUndefined();
});

test("a routine step starts on the cheap model and a code step on the worker model of Settings", () => {
  const routine = setup("docs/numbers.md, test/a.test.ts");
  routine.tick();
  expect(modelOf(routine.adds[0]!)).toBe(CHEAP);
  expect(routine.decisions().find((d) => d.kind === "start")?.reason).toContain("routine step on the cheap worker model");

  const code = setup("src/a.ts, docs/numbers.md");
  code.tick();
  expect(modelOf(code.adds[0]!)).toBe(STRONG);
});
