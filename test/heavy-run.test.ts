import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HEAVY_WORKFLOW, heavyTasks, type RedRun, slowFailures } from "../src/heavy-run.ts";
import type { Settings } from "../src/project.ts";
import { setup } from "./rules-world.ts";

const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });
const resultOf = (t: ReturnType<typeof setup>) => join(String(t.env.LINECLEAR_CONFIG), "projects", "demo", "heavy-result.json");

test("a planted fault in a slow check is reported with its output", () => {
  const t = setup();
  const failures = slowFailures(t.repo, ["echo planted-fault; exit 1", "true"]);
  expect(failures.map((f) => f.name)).toEqual(["echo planted-fault; exit 1"]);
  expect(failures[0]?.output).toContain("planted-fault");
});

test("the rule loop runs the heavy tier in the background after main moves, then turns each failure into one fix task", async () => {
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
  expect(adds[0]?.[2]).toBe("Fix heavy coverage");
  expect(adds[0]?.[adds[0].indexOf("--brief") + 1]).toContain("planted-fault");
  expect(existsSync(result)).toBe(false);
  t.doTick();
  expect(existsSync(result)).toBe(false);
  expect(t.adds()).toHaveLength(1);
});

test("a failure with an open fix task starts no second one, and one that would not start is read again", () => {
  const t = setup({ steps: [] });
  const world = { now: () => new Date(2026, 10, 2, 4, 0), addTask: (): string | undefined => undefined };
  const settings = { repo: t.repo, space: "demo" } as Settings;
  const file = resultOf(t);
  const notes = (...a: [string, Settings, string, { title: string; status: string }[], typeof world]) => {
    const got: { kind: string; reason: string }[] = [];
    heavyTasks(...a, t.env, (kind, reason) => got.push({ kind, reason }));
    return got;
  };
  const write = () => writeFileSync(file, JSON.stringify([{ name: "bun run coverage", output: "x" }]));
  const open = { title: "Fix heavy coverage", status: "work" };
  write();
  expect(notes("demo", settings, "abc1234", [open], world)).toEqual([]);
  write();
  expect(notes("demo", settings, "abc1234", [{ ...open, status: "done" }], world)).toHaveLength(1);
  write();
  const failing = { ...world, addTask: () => "no room" };
  expect(notes("demo", settings, "abc1234", [], failing)[0]?.kind).toBe("skip");
  expect(existsSync(file)).toBe(true);
});

test("a repo with the heavy workflow files one fix task for the commit of a red run on GitHub, and none for a green one", () => {
  const t = setup({ steps: [] });
  mkdirSync(join(t.repo, ".github", "workflows"), { recursive: true });
  writeFileSync(join(t.repo, HEAVY_WORKFLOW), "name: heavy\n");
  const added: (string | string[])[][] = [];
  const world = { now: () => new Date(2026, 10, 6, 12, 0), addTask: (...a: [string, string, string, string[]]): string | undefined => void added.push(a) };
  const settings = { repo: t.repo, space: "demo" } as Settings;
  const started: string[][] = [];
  const log = "job\tstep\t2026-11-06T10:00:00Z check: failing tests:\njob\tstep\t2026-11-06T10:00:01Z   a.test.ts > breaks: expected 1";
  const run = (red: RedRun | undefined, tasks: { title: string; status: string }[] = []) =>
    heavyTasks(
      "demo",
      settings,
      "abc1234",
      tasks,
      world,
      t.env,
      () => {},
      (_r, _o, c) => void started.push(c),
      () => red,
    );
  run(undefined);
  expect(added).toHaveLength(0);
  run({ sha: "1234567890", log });
  expect(added).toHaveLength(1);
  expect(added[0]?.[1]).toBe("Fix heavy 1234567");
  expect(added[0]?.[2]).toContain("a.test.ts > breaks: expected 1");
  run({ sha: "1234567890", log });
  expect(added).toHaveLength(1);
  run({ sha: "9999999999", log }, [{ title: "Fix heavy 9999999", status: "work" }]);
  expect(added).toHaveLength(1);
  run({ sha: "9999999999", log });
  expect(added).toHaveLength(2);
  expect(started).toEqual([]);
});
