import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decisionsPath } from "../pi/config.ts";
import { readItems } from "../src/inbox.ts";
import { tick } from "../src/rules.ts";
import { demoEnv, fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();
const HOUR = 3600_000;

const roadmap = (reopened: boolean) => `# Roadmap

## Phase 0

### A Alpha
- why: because
- done when:
  - A run is in \`docs/numbers.md\` under "A".
${reopened ? "  - Reopened: the run is missing\n" : ""}- locks: none
- after: none
`;

/** A project whose every task closes empty before the next tick. `kind` is the state the step is in. */
function setup(kind: "ready" | "reopened" | "unproven") {
  const dir = scratchDir("start-limit");
  const env = demoEnv(dir);
  const merged = kind === "ready" ? [] : [{ subject: "LIN-9: A Alpha", body: "" }];
  const f = fakeWorld(env, [], roadmap(kind === "reopened"), merged);
  // the unproven step is merged, and the checker records its item false at main's head
  const item = 'A run is in `docs/numbers.md` under "A".';
  if (kind === "unproven")
    f.world.proofs = () => ({ A: { key: item, head: "abc", at: "2026-06-01T10:00:00Z", model: "m", items: [{ item, ok: false, proof: "no run" }] } });
  if (kind === "reopened") f.world.commitsSince = () => 0;
  const step = () => {
    tick(f.world, false, env);
    f.tasks.list = f.tasks.list.map((t) => ({ ...t, status: "done" }));
  };
  return { ...f, step, env };
}

const starts = (adds: string[][]) => adds.filter((a) => a[0] === "A Alpha").length;

for (const kind of ["ready", "reopened", "unproven"] as const) {
  test(`a ${kind} step whose tasks all close empty starts at most three times in ten ticks`, () => {
    const t = setup(kind);
    for (let i = 0; i < 10; i++) {
      t.step();
      t.clock.at = new Date(t.clock.at.getTime() + 10 * 60_000);
    }
    // an unproven step is held by its restart rule first: one Fix task, no Inbox item
    expect(starts(t.adds)).toBe(3);
    const items = readItems(t.env).filter((i) => i.kind === "step");
    expect(items).toHaveLength(kind === "unproven" ? 0 : 1);
    if (kind !== "unproven") expect(items[0]?.question).toContain("A run is in");
  });

  test(`a ${kind} step starts at most three times in any 24 hours over three days`, () => {
    const t = setup(kind);
    const at: number[] = [];
    for (let i = 0; i < 72 * 2; i++) {
      const before = starts(t.adds);
      t.step();
      if (starts(t.adds) > before) at.push(t.clock.at.getTime());
      t.clock.at = new Date(t.clock.at.getTime() + HOUR / 2);
    }
    for (const x of at) expect(at.filter((y) => y >= x && y < x + 24 * HOUR).length).toBeLessThanOrEqual(3);
    // an unproven step stops at one Fix task after its three starts
    expect(at.length).toBeGreaterThanOrEqual(kind === "unproven" ? 3 : 5);
  });
}

test("a reopened step started three times in a day gets no Fix task when a task has merged since: one Inbox item", () => {
  const t = setup("reopened");
  for (let i = 0; i < 3; i++) t.step();
  expect(starts(t.adds)).toBe(3);
  // a task merged after the Reopened line, but the line stayed: the refile would be a fourth start
  t.world.commitsSince = () => 2;
  const out = tick(t.world, false, t.env);
  expect(t.adds).toHaveLength(3);
  expect(out.filter((d) => d.kind === "start" && d.step === "A")).toHaveLength(0);
  expect(readItems(t.env).filter((i) => i.kind === "step")).toHaveLength(1);
});

test("a reopened step whose Reopened line cannot be placed does not start, and Home says so", () => {
  const t = setup("reopened");
  t.world.commitsSince = () => undefined;
  const out = tick(t.world, false, t.env);
  expect(t.adds).toHaveLength(0);
  expect(out.some((d) => d.kind === "skip" && d.reason.includes("Reopened line cannot be placed"))).toBe(true);
});

test("starts here and on another machine share the cap", () => {
  const t = setup("ready");
  const file = join(t.env.LINECLEAR_CONFIG as string, "projects", "demo", "settings.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), machines: ["far"] }));
  let here = true;
  const remote: string[] = [];
  t.world.maxTasks = () => (here ? 3 : 0);
  t.world.room = (host) => ({ host, tasks: [], working: 0, max: 3, load: 0, loadLimit: 1e6 });
  t.world.load = () => 0;
  t.world.addTaskOn = (host, _s, title) => {
    remote.push(`${host} ${title}`);
    return undefined;
  };
  for (let i = 0; i < 10; i++) {
    here = i % 2 === 0;
    tick(t.world, false, t.env);
    t.tasks.list = t.tasks.list.map((x) => ({ ...x, status: "done" }));
    t.clock.at = new Date(t.clock.at.getTime() + 10 * 60_000);
  }
  const logged = readFileSync(decisionsPath(t.env), "utf8")
    .split("\n")
    .filter((l) => l.includes('"kind":"start"') && l.includes('"step":"A"'));
  expect(logged).toHaveLength(3);
  expect(starts(t.adds) + remote.length).toBe(3);
  expect(remote.length).toBeGreaterThan(0);
});

test("an answered limit item is not made again while the step stays over the limit", () => {
  const t = setup("ready");
  for (let i = 0; i < 6; i++) t.step();
  const [item] = readItems(t.env).filter((i) => i.kind === "step");
  writeFileSync(join(t.env.LINECLEAR_CONFIG as string, "inbox", `${item?.n}.json`), JSON.stringify({ ...item, answer: "Ok" }));
  for (let i = 0; i < 3; i++) t.step();
  expect(readItems(t.env).filter((i) => i.kind === "step")).toHaveLength(1);
  expect(starts(t.adds)).toBe(3);
});

test("an unreadable task list stops the start and Home says so", () => {
  const t = setup("ready");
  t.world.tasks = () => "task list failed: down";
  const out = tick(t.world, false, t.env);
  expect(t.adds).toHaveLength(0);
  expect(out.some((d) => d.kind === "skip" && d.reason.includes("task list failed"))).toBe(true);
});

test("archived tasks of a step still count in its 24 hours", () => {
  const t = setup("ready");
  for (let i = 0; i < 3; i++) {
    t.step();
    t.clock.at = new Date(t.clock.at.getTime() + 10 * 60_000);
    t.tasks.list = [];
  }
  tick(t.world, false, t.env);
  expect(starts(t.adds)).toBe(3);
});
