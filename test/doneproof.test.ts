import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ProveTools, commandsFor, doneItems, readOnly, readProofs, type Runner, unprovenOf } from "../src/doneproof.ts";
import { checkerModels, proveStep } from "../src/doneproof-run.ts";
import { readPlan } from "../src/progress.ts";
import { checkRoadmap, stepStatuses, type Step } from "../src/roadmap.ts";
import { readItems } from "../src/inbox.ts";
import { tick } from "../src/rules.ts";
import { readFixes } from "../src/self-fix.ts";
import { fakeWorld, scratch } from "./fake-world.ts";

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

function tickSetup() {
  const dir = scratchDir("doneproof-tick");
  const at = (...p: string[]) => join(dir, ...p);
  mkdirSync(at("config", "projects", "demo"), { recursive: true });
  mkdirSync(at("tmp"));
  const worker = ["anthropic/claude-sonnet-5-5"];
  const reviewer = ["anthropic/claude-opus-5-5"];
  const settings = { repo: dir, space: "demo", check: "true", models: { worker, reviewer, planner: reviewer } };
  writeFileSync(at("config", "projects", "demo", "settings.json"), JSON.stringify(settings));
  writeFileSync(at("config", "machine.json"), JSON.stringify({ loadLimit: 1e6 }));
  const own = {
    LINECLEAR_CONFIG: at("config"),
    TMPDIR: at("tmp"),
    LINECLEAR_HOME: at("home"),
    LINECLEAR_STORE_COPIES: at("copies"),
    XDG_CACHE_HOME: at("cache"),
  };
  const env = { ...process.env, ...own };
  const f = fakeWorld(env, [], roadmap, [{ subject: "LIN-9: R3 Release 0.1 tagged", body: "" }]);
  const asked: string[] = [];
  const proof = { key: doneItems(r3).join("\n"), head: "abc", at: "2026-06-01T10:00:00Z", model: "m", items: [{ item: ITEM, ok: false, proof: "no tag" }] };
  f.world.proofs = () => ({ R3: proof });
  f.world.proveStep = (_s, step) => {
    asked.push(step.id);
    return "no answer";
  };
  const once = () => tick(f.world, false, env);
  const finish = () => {
    f.tasks.list = f.tasks.list.map((t) => ({ ...t, status: "done" }));
  };
  return { ...f, env, once, finish, asked };
}

test("an unproven step starts again with its missing item as the brief, three times a day, then one Fix task, never a loop", () => {
  const t = tickSetup();
  t.once();
  expect(t.adds).toHaveLength(1);
  expect(t.adds[0]?.[0]).toBe("R3 Release 0.1 tagged");
  expect(t.adds[0]?.[1]).toContain(ITEM);
  t.finish();
  t.once();
  expect(t.adds).toHaveLength(2);
  t.finish();
  t.once();
  expect(t.adds).toHaveLength(3);
  t.finish();
  t.once();
  expect(t.adds).toHaveLength(4);
  expect(t.adds[3]?.[0]).toBe("R3 Fix: Release 0.1 tagged");
  t.once();
  t.once();
  expect(t.adds).toHaveLength(4);
  expect(t.adds.some((a) => a[0] === "R4 Next")).toBe(false);
  t.finish();
  t.clock.at = new Date(t.clock.at.getTime() + 86_400_000);
  t.once();
  expect(t.adds[4]?.[0]).toBe("R3 Release 0.1 tagged");
});

test("a fix task that ends unmerged makes an Inbox item on the next tick, and the step waits for the owner", () => {
  const t = tickSetup();
  t.once();
  t.finish();
  t.once();
  t.finish();
  t.once();
  t.finish();
  t.once();
  expect(t.adds.at(-1)?.[0]).toBe("R3 Fix: Release 0.1 tagged");
  expect(readItems(t.env)).toHaveLength(0);
  // the fix task closes with nothing merged
  t.tasks.list = t.tasks.list.map((x) => (x.title.startsWith("R3 Fix") ? { ...x, status: "closed" } : x));
  t.once();
  const items = readItems(t.env);
  expect(items).toHaveLength(1);
  expect(items[0]?.question).toContain("R3 Fix: Release 0.1 tagged");
  expect(items[0]?.question).toContain("ended without a merge");
  // while that item waits, no second fix task is filed
  t.once();
  t.once();
  expect(t.adds.filter((a) => a[0]?.startsWith("R3 Fix"))).toHaveLength(1);
  expect(Object.keys(readFixes(t.env))).toEqual(["demo:R3:unproven"]);
});

test("the tick asks the checker about a merged step, and one that did not answer is not asked again within half an hour", () => {
  const t = tickSetup();
  t.world.proofs = () => ({});
  t.once();
  expect(t.asked).toEqual(["R3"]);
  t.once();
  expect(t.asked).toEqual(["R3"]);
  t.clock.at = new Date(t.clock.at.getTime() + 31 * 60_000);
  t.once();
  expect(t.asked).toEqual(["R3", "R3"]);
});

test("an unproven step is not started again while its record is older than main", () => {
  const t = tickSetup();
  t.world.proofs = () => ({
    R3: { key: doneItems(r3).join("\n"), head: "older", at: "2026-06-01T09:00:00Z", model: "m", items: [{ item: ITEM, ok: false, proof: "no tag" }] },
  });
  t.once();
  expect(t.adds).toHaveLength(0);
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
