import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nightlyDue, nightlyTasks, slowFailures } from "../src/nightly.ts";
import type { Settings } from "../src/project.ts";
import { setup } from "./rules-world.ts";

const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });
const resultOf = (t: ReturnType<typeof setup>) => join(String(t.env.LINECLEAR_CONFIG), "projects", "demo", "nightly-result.json");

test("a planted fault in a slow check is reported with its output", () => {
  const t = setup();
  const failures = slowFailures(t.repo, ["echo planted-fault; exit 1", "true"]);
  expect(failures.map((f) => f.name)).toEqual(["echo planted-fault; exit 1"]);
  expect(failures[0]?.output).toContain("planted-fault");
});

test("the night's run is due once a day, after 3 in the morning", () => {
  expect(nightlyDue(undefined, new Date(2026, 10, 2, 2, 59))).toBe(false);
  expect(nightlyDue(undefined, new Date(2026, 10, 2, 3, 0))).toBe(true);
  expect(nightlyDue("2026-11-02", new Date(2026, 10, 2, 15, 0))).toBe(false);
  expect(nightlyDue("2026-11-02", new Date(2026, 10, 3, 3, 0))).toBe(true);
});

test("the rule loop runs the night in the background, then turns each failure into one fix task", async () => {
  const t = setup({ steps: [] });
  writeFileSync(join(t.repo, "package.json"), pkg({ coverage: "echo planted-fault; exit 1" }));
  const result = resultOf(t);
  t.now.at = new Date(2026, 10, 2, 4, 0);
  t.doTick();
  expect(t.adds()).toHaveLength(0);
  while (!existsSync(result)) await Bun.sleep(50);
  t.doTick();
  const adds = t.adds();
  expect(adds).toHaveLength(1);
  expect(adds[0]?.[2]).toBe("Fix nightly coverage");
  expect(adds[0]?.[adds[0].indexOf("--brief") + 1]).toContain("planted-fault");
  expect(existsSync(result)).toBe(false);
  t.now.at = new Date(2026, 10, 2, 9, 0);
  t.doTick();
  expect(existsSync(result)).toBe(false);
});

test("a failure with an open fix task starts no second one, and one that would not start is read again", () => {
  const t = setup({ steps: [] });
  const world = { now: () => new Date(2026, 10, 2, 4, 0), addTask: (): string | undefined => undefined };
  const settings = { repo: t.repo, space: "demo" } as Settings;
  const file = resultOf(t);
  const notes = (...a: [string, Settings, string, { title: string; status: string }[], typeof world]) => {
    const got: { kind: string; reason: string }[] = [];
    nightlyTasks(...a, t.env, (kind, reason) => got.push({ kind, reason }));
    return got;
  };
  const write = () => writeFileSync(file, JSON.stringify([{ name: "bun run coverage", output: "x" }]));
  const open = { title: "Fix nightly coverage", status: "work" };
  write();
  expect(notes("demo", settings, "abc1234", [open], world)).toEqual([]);
  write();
  expect(notes("demo", settings, "abc1234", [{ ...open, status: "done" }], world)).toHaveLength(1);
  write();
  const failing = { ...world, addTask: () => "no room" };
  expect(notes("demo", settings, "abc1234", [], failing)[0]?.kind).toBe("skip");
  expect(existsSync(file)).toBe(true);
});
