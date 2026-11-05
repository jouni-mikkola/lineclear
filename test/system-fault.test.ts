import { expect, test } from "bun:test";
import { readWaits } from "../src/waits.ts";
import { tick } from "../src/rules.ts";
import { demoEnv, fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();
const MIN = 60_000;

const roadmap = `# Roadmap

## Phase 0

### A Alpha
- why: because
- done when:
  - A thing works.
- locks: none
- after: none
`;

/** A project whose step A has `ended` earlier tries, each failed with the given text. */
function setup(failures: string[]) {
  const env = demoEnv(scratchDir("system-fault"));
  const f = fakeWorld(
    env,
    failures.map((sub, i) => ({ id: `LIN-${i + 1}`, title: "A Alpha", status: "done", sub })),
    roadmap,
  );
  const fixes = () => f.adds.filter((a) => a[0]?.startsWith("A Fix"));
  const starts = () => f.adds.filter((a) => a[0] === "A Alpha");
  return { ...f, env, fixes, starts };
}

for (const cause of ["herdr down", "provider error", "timeout"] as const) {
  test(`a last try that failed on ${cause} waits and does not start, and starts once the cause clears`, () => {
    const t = setup([cause]);
    let herdr = false;
    t.world.herdr = () => ({
      servers: herdr ? [{ pid: 1, cpuSeconds: 0, inService: true }] : [],
      unit: "herdr.service",
      service: { state: herdr ? "active" : "failed", restarts: 0 },
      workspaces: [],
    });
    t.world.restartHerdr = () => undefined;
    // no worker model has room until the cause clears
    t.world.offered = () => (herdr ? undefined : new Set());
    tick(t.world, false, t.env);
    expect(t.starts()).toHaveLength(0);
    expect(readWaits(t.env).find((w) => w.task === "A")).toMatchObject({ kind: "fault", reason: cause });
    // the cause clears
    herdr = true;
    t.clock.at = new Date(t.clock.at.getTime() + 11 * MIN);
    tick(t.world, false, t.env);
    expect(t.starts()).toHaveLength(1);
    expect(readWaits(t.env).some((w) => w.task === "A")).toBe(false);
  });
}

test("a step whose last failure is its own restarts as before", () => {
  const t = setup(["its test failed: expected 1 got 2"]);
  tick(t.world, false, t.env);
  expect(t.starts()).toHaveLength(1);
  expect(readWaits(t.env).some((w) => w.task === "A")).toBe(false);
});

test("a step started a third time in 24 hours is stopped with exactly one fix task naming the cause", () => {
  const t = setup(["x", "timeout", "timeout"]);
  t.clock.at = new Date(t.clock.at.getTime() + 60 * MIN);
  tick(t.world, false, t.env);
  tick(t.world, false, t.env);
  expect(t.starts()).toHaveLength(0);
  expect(t.fixes()).toHaveLength(1);
  expect(t.fixes()[0]?.[0]).toContain("timeout");
});
