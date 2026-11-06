import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRuns, redByCause } from "../src/check-runs.ts";
import { checkTier } from "../src/check-tier.ts";
import type { Settings } from "../src/project.ts";

const dir = mkdtempSync(join(tmpdir(), "red-causes-"));
const vars = { ...process.env, LINECLEAR_CONFIG: join(dir, "config") };
const settings = {
  repo: dir,
  space: "s",
  check: "x",
  models: {},
  tiers: { inner: { commands: ["x"], budgetS: 9 }, merge: { commands: ["x"], budgetS: 9 }, nightly: { commands: ["x"], budgetS: 9 } },
} as unknown as Settings;

const redRun = async (name: string, output: string, code: number) => {
  await checkTier(
    ["--tier", "merge", name],
    settings,
    () => {},
    vars,
    dir,
    async (_c, _t, hear) => (hear(output), code),
    // a calm machine: a loaded one would not rerun, and the test would depend on the load of the run
    () => [0, 0, 0],
  );
};

test("a gate, a test and a timeout are each named in the red run", async () => {
  await redRun("gate", "check: types failed: src/a.ts(1,1): error TS2322\n", 1);
  await redRun("test", "test/a.test.ts:\n(fail) adds two [3.00ms]\n 1 fail\n", 1);
  await redRun("timeout", "\nbuild started\n", 124);
  const runs = readRuns(dir, 0, vars);
  expect(runs.map((r) => r.causes)).toEqual([
    ["gate: types: src/a.ts(1,1): error TS2322"],
    ["test: test/a.test.ts: adds two"],
    ["timeout: exit 124"],
    ["timeout: exit 124"],
  ]);
  // a merge-tier failure that names nothing is rerun once, so the timeout shows twice
  expect(runs.every((r) => (r.causes?.length ?? 0) > 0)).toBe(true);
});

test("the check's own time limits are named as timeouts", async () => {
  await redRun("slow", "check: too slow, a test file over 5 s\ncheck: every step ran\n", 1);
  expect(readRuns(dir, 0, vars).at(-1)?.causes).toEqual(["timeout: check: too slow, a test file over 5 s"]);
});

test("a gate and a test that both fail are both named", async () => {
  await redRun("both", "(fail) adds two [3.00ms]\n 1 fail\ncheck: types failed: bad\n", 1);
  expect(readRuns(dir, 0, vars).at(-1)?.causes).toEqual(["gate: types: bad", "test: adds two"]);
});

test("a red run that names nothing still lists its exit", async () => {
  await redRun("silent", "boom\n", 3);
  expect(readRuns(dir, 0, vars).at(-1)?.causes).toEqual(["exit 3: boom"]);
});

test("the red share is counted by first cause", () => {
  const r = redByCause(readRuns(dir, 0, vars));
  // the rerun of each unnamed failure (timeout, slow, silent) is a red run of its own
  expect(r.red).toBe(9);
  expect(r.causes.map(([c]) => c).sort()).toEqual(["exit", "gate types", "test", "timeout"]);
});
