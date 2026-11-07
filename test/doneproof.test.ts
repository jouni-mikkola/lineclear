import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ProveTools, commandsFor, doneItems, readOnly, readProofs, type Runner, unprovenOf } from "../src/doneproof.ts";
import { checkerModels, proveStep } from "../src/doneproof-run.ts";
import { readPlan } from "../src/progress.ts";
import { checkRoadmap, stepStatuses, type Step } from "../src/roadmap.ts";
import { scratch } from "./fake-world.ts";

const scratchDir = scratch();

const roadmap = `# Roadmap

## Phase 0

### R3 Release 0.1 tagged
- why: because
- done when:
  - The release is tagged v0.1.0 on origin.
  - The README names the release.
- locks: none
- after: none

### R4 Next
- why: because
- done when: it works
- locks: none
- after: R3
`;
const steps = checkRoadmap(roadmap).parsed.steps;
const r3 = steps[0] as Step;
const ITEM = "The release is tagged v0.1.0 on origin.";

/** A folder with a config of its own and a model stub that answers `answer`. */
function setup(answer = "ITEM 1: TRUE - x") {
  const dir = scratchDir("doneproof");
  const config = join(dir, "config");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "machine.json"), JSON.stringify({ loadLimit: 1e6 }));
  const env = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_STEPCHECK: `printf '%s' '${answer}'` };
  return { dir, env };
}

const runner =
  (tagged: boolean): Runner =>
  (argv) => {
    if (argv[1] === "ls-remote") return { code: 0, out: tagged ? "abc123\trefs/tags/v0.1.0" : "" };
    if (argv[1] === "ls-tree") return { code: 0, out: "README.md" };
    if (argv[1] === "show") return { code: 0, out: "The release 0.1" };
    return { code: 1, out: "no" };
  };

const toolsOf = (): ProveTools => ({
  available: () => true,
});

const prove = (s: ReturnType<typeof setup>, run: Runner) =>
  proveStep({
    repo: s.dir,
    step: r3,
    ref: "origin/main",
    head: "h1",
    reviewers: ["anthropic/claude-opus-5-5"],
    env: s.env,
    now: new Date(),
    run,
    tools: toolsOf(),
  });

test("an item that is a tag or a GitHub release is proven by a command, and a plain item is not", () => {
  expect(doneItems(r3)).toEqual([ITEM, "The README names the release."]);
  expect(commandsFor("Release 0.1 tagged")[0]?.argv.join(" ")).toContain("refs/tags/v0.1.0");
  expect(commandsFor("A GitHub release v1.2.3 exists").map((c) => c.argv.slice(0, 3).join(" "))).toContain("gh release view");
  expect(commandsFor("The README names the release.")).toEqual([]);
  expect(checkerModels(["anthropic/claude-opus-5-5", "openai/gpt-5-codex"])[0]).toBe("openai/gpt-5-codex");
});

test("a done-when bullet wrapped over two lines is one item", () => {
  const text =
    "# Roadmap\n\n## Phase 0\n\n### R5 Wrap\n- why: because\n- done when:\n  - First part of it\n    and the rest.\n  - Second:\n    - nested.\n- locks: none\n- after: none\n";
  expect(doneItems(checkRoadmap(text).parsed.steps[0] as Step)).toEqual(["First part of it and the rest.", "Second: - nested."]);
});

test("a missing tag records its item false with the command as proof, whatever the model says", () => {
  const s = setup("ITEM 1: TRUE - the README says so");
  const got = prove(s, runner(false));
  if (typeof got === "string") throw new Error(got);
  expect(got.items.map((i) => i.ok)).toEqual([false, true]);
  expect(got.items[0]?.proof).toContain("git ls-remote --tags origin");
  expect([...unprovenOf(s.dir, s.env)]).toEqual([["R3", ITEM]]);
  expect(Object.keys(readProofs(s.dir, s.env))).toEqual(["R3"]);
});

test("a tag that exists and an item the model finds true prove the step; a checker with no answer records nothing", () => {
  const s = setup("ITEM 1: TRUE - quoted");
  const ok = prove(s, runner(true));
  expect(typeof ok === "string" ? ok : ok.items.every((i) => i.ok)).toBe(true);
  expect(unprovenOf(s.dir, s.env).size).toBe(0);
  const silent = setup("nothing useful");
  expect(prove(silent, runner(true))).toBe("the checker did not answer");
  expect(Object.keys(readProofs(silent.dir, silent.env))).toEqual([]);
});

test("a merged step with an unproven item is its own state, not done, and holds the steps after it", () => {
  const merged = new Set(["R3"]);
  expect(stepStatuses(steps, merged, []).map((s) => s.state)).toEqual(["done", "ready"]);
  const unproven = new Map([["R3", "tagged"]]);
  const s = stepStatuses(steps, merged, [], undefined, [], unproven);
  expect(s.map((x) => x.state)).toEqual(["unproven", "waiting"]);
  expect(s[0]?.unproven).toBe("tagged");
  expect(stepStatuses(steps, merged, [{ title: "R3 Release 0.1 tagged", status: "work" }], undefined, [], unproven)[0]?.state).toBe("work");
});

test("a step closed with nothing to merge is done only with its proof", () => {
  const closed = [{ id: "LIN-1", title: "R3 Release 0.1 tagged", status: "done", closed: true, closedBy: "done" as const }];
  const taskSteps = { "LIN-1": "R3" };
  expect(stepStatuses(steps, new Set(), closed, taskSteps)[0]?.state).toBe("done");
  expect(stepStatuses(steps, new Set(), closed, taskSteps, [], new Map([["R3", "tagged"]]))[0]?.state).toBe("unproven");
});

test("progress counts an unproven step as not done", () => {
  const commits = [{ subject: "LIN-1: R3 Release 0.1 tagged", body: "" }];
  expect(readPlan(roadmap, commits).steps.map((s) => s.done)).toEqual([true, false]);
  expect(readPlan(roadmap, commits, new Map([["R3", "tagged"]])).steps.map((s) => s.done)).toEqual([false, false]);
});

test("the checker runs reads only: a write command is refused", () => {
  expect(readOnly(["git", "ls-remote", "--tags", "origin", "refs/tags/v1"])).toBe(true);
  expect(readOnly(["gh", "release", "view", "v1"])).toBe(true);
  expect(readOnly(["bun", "test", "test/a.test.ts"])).toBe(true);
  for (const w of [
    ["git", "push", "origin", "v1"],
    ["git", "tag", "-d", "v1"],
    ["gh", "release", "create", "v1"],
    ["rm", "-rf", "x"],
    ["bun", "test", ";rm"],
  ])
    expect(readOnly(w)).toBe(false);
  const w = commandsFor("tagged v1.0.0").every((c) => readOnly(c.argv));
  expect(w).toBe(true);
});

test("a wrapped item keeps its continuation line and sub-bullets as one item", () => {
  const road = `# Roadmap

## Phase 0

### W1 Wrapped
- why: because
- done when:
  - \`tool check\` reads the file. It names the
    line of each of these errors:
    - a missing field
    - a duplicate id
  - Second item.
- locks: none
- after: none
`;
  const step = checkRoadmap(road).parsed.steps[0] as Step;
  expect(doneItems(step)).toEqual([
    "`tool check` reads the file. It names the line of each of these errors: - a missing field - a duplicate id",
    "Second item.",
  ]);
});

test("the checker reads the files on the step's files line, and the lines of a long file that the items name", async () => {
  const s = setup();
  const seen = join(s.dir, "question.txt");
  s.env.LINECLEAR_STEPCHECK = `cat > ${seen}; printf 'ITEM 1: TRUE - x'`;
  const text =
    "# Roadmap\n\n## Phase 0\n\n### R6 Refuse\n- why: because\n- done when:\n  - plan submit refuses a missing locks line.\n- locks: none\n- after: none\n- files: src/long.ts\n";
  const step = checkRoadmap(text).parsed.steps[0] as Step;
  const long = `${"// filler\n".repeat(1000)}export const refuses = "missing locks line";\n`;
  const run: Runner = (argv) => (argv[1] === "show" ? { code: 0, out: long } : { code: 0, out: "src/long.ts" });
  proveStep({
    repo: s.dir,
    step,
    ref: "origin/main",
    head: "h1",
    reviewers: ["anthropic/claude-opus-5-5"],
    env: s.env,
    now: new Date(),
    run,
    tools: toolsOf(),
  });
  expect(await Bun.file(seen).text()).toContain('refuses = "missing locks line"');
});
