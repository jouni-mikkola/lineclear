import { expect, test } from "bun:test";
import { type CheckRun, infraField, lanePause } from "../src/check-runs.ts";

const NOW = 1_000_000_000;
const run = (o: Partial<CheckRun>): CheckRun => ({
  kind: "run",
  at: NOW - 60_000,
  repo: "/r",
  tier: "merge",
  command: "c",
  commit: "a",
  branch: "work/x",
  dirty: false,
  seconds: 1,
  load: 0,
  cores: 4,
  ok: true,
  failed: [],
  group: "g",
  ...o,
});

test("a red last run on main pauses the line and names its cause", () => {
  const red = run({ branch: "main", ok: false, causes: ["test: a.test.ts: adds"], at: NOW - 5 * 3_600_000 });
  expect(lanePause([red], "main", NOW)).toBe("main is red: test: a.test.ts: adds");
});

test("a later passing merge run lifts a red main", () => {
  const red = run({ branch: "main", ok: false, at: NOW - 3_600_000 });
  expect(lanePause([red, run({ at: NOW - 60_000 })], "main", NOW)).toBeUndefined();
});

test("a red branch run alone does not pause", () => {
  expect(lanePause([run({ ok: false, causes: ["test: x"] })], "main", NOW)).toBeUndefined();
});

test("out of disk, killed and an over-long slot wait pause for a few minutes", () => {
  const infra = { ok: false, causes: ["exit 1: x"] };
  expect(lanePause([run({ ...infra, infra: "out of disk" })], "main", NOW)).toBe("the last check failed: out of disk");
  expect(lanePause([run({ ...infra, infra: "killed" })], "main", NOW)).toBe("the last check failed: killed");
  expect(lanePause([run({ ...infra, slotWaitMin: 45 })], "main", NOW)).toBe("the last check failed: waited 45 min for the check slot");
  expect(lanePause([run({ ...infra, infra: "killed", at: NOW - 20 * 60_000 })], "main", NOW)).toBeUndefined();
});

test("a rerun or a quarantined pass says nothing", () => {
  expect(lanePause([run({ branch: "main", ok: false, rerun: true })], "main", NOW)).toBeUndefined();
  expect(lanePause([run({ branch: "main", ok: false, quarantined: true })], "main", NOW)).toBeUndefined();
});

test("the output names the machine fault", () => {
  expect(infraField("write failed: No space left on device", 1)).toEqual({ infra: "out of disk" });
  expect(infraField("", 137)).toEqual({ infra: "killed" });
  expect(infraField("test/a.test.ts:\n(fail) x", 1)).toEqual({});
});
