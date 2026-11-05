import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkRoadmap, proofFaults, type Step, type Task } from "../src/roadmap.ts";
import { stepBrief } from "../src/brief.ts";
import { tick } from "../src/rules.ts";
import { fileStepFix } from "../src/tick-project.ts";
import { DAY_CAP, fileFix, type FixSpec } from "../src/self-fix.ts";
import type { Settings } from "../src/project.ts";
import { fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();
const HOUR = 3_600_000;

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

test("a reopened step whose proof is in numbers.md fails the gate until its Reopened line is deleted", () => {
  const done = new Set(["A"]);
  const proven = "## A\n\nIt ran in 4 minutes.\n";
  const missing = "## A\n\nNot yet recorded: the run.\n";
  expect(proofFaults(stepsOf(true), done, proven)[0]?.message).toContain("delete its 'Reopened:' line in the same commit");
  expect(proofFaults(stepsOf(true), done, missing)).toEqual([]);
  expect(proofFaults(stepsOf(true), done, "# Numbers\n")).toEqual([]);
  expect(proofFaults(stepsOf(false), done, proven)).toEqual([]);
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

test("a reopened step with a task merged since its Reopened line is not started: one Fix task, once", () => {
  const t = setup(2);
  const first = t.tickOnce();
  t.tickOnce();
  expect(t.adds).toHaveLength(1);
  expect(t.adds[0]?.[0]).toBe("A Fix: Alpha");
  const starts = first.filter((d) => d.kind === "start" && d.step === "A");
  expect(starts).toHaveLength(1);
  expect(starts[0]?.reason).toContain("reopened fix");
});

/** Main gains ten commits, so its newest commit and head are new. */
function moveMain(t: ReturnType<typeof setup>, round: number) {
  const commits = [...Array.from({ length: 10 }, (_, i) => ({ subject: `other ${round}-${i}`, body: "" })), { subject: "LIN-9: A Alpha", body: "" }];
  t.world.main = () => ({ head: `h${round}`, checkedOut: `h${round}`, commits });
  t.world.commitsSince = () => 11;
}

test("a reopened fix that ended with no merge is not filed again when main moves, only when the Reopened line changes", () => {
  const t = setup(2);
  const fixes = () => t.adds.filter((a) => a[0] === "A Fix: Alpha").length;
  t.tickOnce();
  expect(fixes()).toBe(1);
  t.tasks.list = t.tasks.list.map((x) => ({ ...x, status: "done" }));
  for (let round = 1; round <= 10; round++) {
    t.clock.at = new Date(t.clock.at.getTime() + 25 * HOUR);
    moveMain(t, round);
    t.tickOnce();
  }
  expect(fixes()).toBe(1);
  t.world.roadmap = () => roadmap(true).replace("the run is missing", "the run is still missing");
  t.clock.at = new Date(t.clock.at.getTime() + 25 * HOUR);
  moveMain(t, 11);
  t.tickOnce();
  expect(fixes()).toBe(2);
});

test("an unproven fix that ended with no merge is not filed again when main moves", () => {
  const t = setup(0, roadmap(false));
  const fixes = () => t.adds.filter((a) => a[0] === "A Fix: Alpha").length;
  const item = 'A run is in `docs/numbers.md` under "A".';
  const moveTo = (head: string) => {
    t.world.main = () => ({
      head,
      checkedOut: head,
      commits: [
        { subject: `after ${head}`, body: "" },
        { subject: "LIN-9: A Alpha", body: "" },
      ],
    });
    t.world.proofs = () => ({ A: { key: item, head, at: "2026-06-01T10:00:00Z", model: "m", items: [{ item, ok: false, proof: "no run" }] } });
  };
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) {
      t.tickOnce();
      t.tasks.list = t.tasks.list.map((x) => ({ ...x, status: "done" }));
      t.clock.at = new Date(t.clock.at.getTime() + 10 * 60_000);
    }
  };
  moveTo("h0");
  ticks(10);
  expect(fixes()).toBe(1);
  for (let round = 1; round <= 10; round++) {
    t.clock.at = new Date(t.clock.at.getTime() + 25 * HOUR);
    moveTo(`h${round}`);
    ticks(5);
  }
  expect(fixes()).toBe(1);
});

test("a reopened step with no merge since its Reopened line starts as before", () => {
  const t = setup(0);
  t.tickOnce();
  expect(t.adds).toHaveLength(1);
  expect(t.adds[0]?.[0]).toBe("A Alpha");
});

test("a step fix is held by the daily cap the stall fixes share", () => {
  const t = setup(2);
  const config = t.env.LINECLEAR_CONFIG as string;
  const now = t.world.now().toISOString();
  const filed = Array.from({ length: DAY_CAP }, () => now);
  writeFileSync(join(config, "fixes.json"), JSON.stringify({ other: { title: "Plan: other", project: "demo", since: now, evidence: [], filed } }));
  t.tickOnce();
  expect(t.adds).toHaveLength(0);
});

test("one fileFix serves each step fix kind: a title with the step id, a dedupe against the task list, the shared cap", () => {
  const t = setup(0);
  const settings = { repo: "", space: "demo", check: "true" } as Settings;
  const spec = (id: string, kind: string): FixSpec => ({
    key: `demo:${id}:${kind}`,
    title: `${id} Fix: Thing`,
    project: { name: "demo", settings },
    brief: "b",
    evidence: [kind],
  });
  expect(fileFix(t.world, spec("A", "closed"), t.env)).toEqual({ filed: true });
  t.tasks.list = [...t.tasks.list, { title: "A Fix: Thing", status: "running" } as never];
  expect(fileFix(t.world, spec("A", "closed"), t.env).filed).toBe(false);
  expect(fileFix(t.world, spec("B", "reopened"), t.env)).toEqual({ filed: true });
  expect(fileFix(t.world, spec("C", "unproven"), t.env)).toEqual({ filed: true });
  expect(fileFix(t.world, spec("D", "closed"), t.env)).toEqual({ filed: false, why: `${DAY_CAP} fixes were filed in the last 24 hours, the most a day` });
  expect(t.adds.map((a) => a[0])).toEqual(["A Fix: Thing", "B Fix: Thing", "C Fix: Thing"]);
});

test("a step gets one fix a day: open on another machine, open under the old title, ended an hour ago", () => {
  const dir = scratchDir("step-fix-day");
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  const scope = { ...process.env, LINECLEAR_CONFIG: config };
  const settings = { repo: dir, space: "demo", check: "true", machines: ["m2"] } as Settings;
  const spec = (id: string): FixSpec => ({
    key: `demo:${id}:unproven`,
    title: `${id} Fix: Thing`,
    project: { name: "demo", settings },
    brief: "b",
    evidence: ["e"],
  });
  const { world, clock, adds, tasks } = fakeWorld(
    scope,
    [
      { id: "LIN-1", title: "Fix B Thing", status: "work" },
      { id: "LIN-2", title: "C Fix: Thing", status: "done" },
    ],
    "",
  );
  const remote: Task[] = [{ id: "LIN-9@m2", title: "A Fix: Thing", status: "work" }];
  world.room = () => ({ host: "m2", tasks: remote }) as never;
  const ticks = () => {
    for (let i = 0; i < 10; i++) for (const id of ["A", "B", "C"]) fileFix(world, spec(id), scope);
  };
  // C's fix ended an hour ago: it was first seen ended then
  clock.at = new Date(clock.at.getTime() - HOUR);
  fileFix(world, spec("C"), scope);
  clock.at = new Date(clock.at.getTime() + HOUR);
  ticks();
  expect(adds).toEqual([]);

  remote[0] = { id: "LIN-9@m2", title: "A Fix: Thing", status: "done" };
  tasks.list = tasks.list.map((t) => (t.id === "LIN-1" ? { ...t, status: "done" } : t));
  ticks();
  expect(adds).toEqual([]);

  clock.at = new Date(clock.at.getTime() + 25 * HOUR);
  ticks();
  expect(adds.map((a) => a[0]).sort()).toEqual(["A Fix: Thing", "B Fix: Thing", "C Fix: Thing"]);
});

test("each fix filing for a step logs one start with the step's id and a reason naming its kind", () => {
  const t = setup(0);
  const settings = { repo: "", space: "demo", check: "true" } as Settings;
  const notes: [string, string, string | undefined][] = [];
  const tk = {
    name: "demo",
    settings,
    world: t.world,
    state: {},
    dryRun: false,
    env: t.env,
    note: (k: string, r: string, id?: string) => notes.push([k, r, id]),
  };
  for (const [id, kind] of [
    ["A", "reopened"],
    ["B", "unproven"],
    ["C", "closed"],
  ] as const)
    fileStepFix(tk as never, { id, title: "T" } as Step, kind, "why", "b", []);
  const starts = notes.filter(([k, , id]) => k === "start" && id !== undefined);
  expect(starts).toHaveLength(3);
  for (const kind of ["reopened", "unproven", "closed"]) expect(starts.filter(([, r]) => r.includes(`${kind} fix`))).toHaveLength(1);
});

test("an unproven step's Fix task, filed by the tick, logs one start with its id and kind", () => {
  const t = setup(0, roadmap(false));
  const item = 'A run is in `docs/numbers.md` under "A".';
  t.world.proofs = () => ({ A: { key: item, head: "abc", at: "2026-06-01T10:00:00Z", model: "m", items: [{ item, ok: false, proof: "no run" }] } });
  const decisions = [];
  for (let i = 0; i < 6; i++) {
    decisions.push(...t.tickOnce());
    t.tasks.list = t.tasks.list.map((x) => ({ ...x, status: "done" }));
    t.clock.at = new Date(t.clock.at.getTime() + 10 * 60_000);
  }
  expect(t.adds.filter((a) => a[0] === "A Fix: Alpha")).toHaveLength(1);
  const starts = decisions.filter((d) => d.kind === "start" && d.step === "A" && d.reason.includes("unproven fix"));
  expect(starts).toHaveLength(1);
});

test("a local task is a step's fix by the rules' record, not by the title form", () => {
  const dir = scratchDir("step-fix-record");
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  writeFileSync(join(config, "projects", "demo", "state.json"), JSON.stringify({ taskSteps: { "LIN-1": "A", "LIN-2": "B" } }));
  const scope = { ...process.env, LINECLEAR_CONFIG: config };
  const settings = { repo: dir, space: "demo", check: "true" } as Settings;
  const spec = (id: string): FixSpec => ({
    key: `demo:${id}:unproven`,
    title: `${id} Fix: Thing`,
    project: { name: "demo", settings },
    brief: "b",
    evidence: ["e"],
  });
  const { world, adds } = fakeWorld(
    scope,
    [
      { id: "LIN-1", title: "Repair the thing (Fix)", status: "work" },
      { id: "LIN-2", title: "B Alpha work", status: "work" },
    ],
    "",
  );
  expect(fileFix(world, spec("A"), scope).filed).toBe(false);
  expect(fileFix(world, spec("B"), scope).filed).toBe(true);
  expect(adds.map((a) => a[0])).toEqual(["B Fix: Thing"]);
});
