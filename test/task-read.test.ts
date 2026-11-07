import { afterAll, expect, test } from "bun:test";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lineclearAllTasks, lineclearTasks } from "../src/roadmap-source.ts";
import { realWorld } from "../src/rules.ts";
import { forgetTaskReads } from "../src/task-read.ts";
import { tmp } from "./helpers.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A server command that logs each call and answers `task list` for two spaces. */
function counting() {
  const dir = tmp("task-read");
  dirs.push(dir);
  const log = join(dir, "calls");
  const bin = join(dir, "server");
  const list = JSON.stringify([
    { id: "A-1", title: "one", status: "work", space: "alpha" },
    { id: "B-1", title: "two", status: "done", space: "beta" },
    { id: "A-2", title: "far", status: "work", space: "alpha", machine: "other" },
  ]);
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> '${log}'\nif [ "$1 $2" = "task list" ]; then cat <<'J'\n${list}\nJ\nfi\n`);
  chmodSync(bin, 0o755);
  const calls = () => (readFileSync(log, "utf8").match(/task list/g) ?? []).length;
  return { env: { ...process.env, LINECLEAR_SERVER_BIN: bin }, calls };
}

test("every reader of a tick shares one task list, filtered by space here", () => {
  const t = counting();
  forgetTaskReads();
  expect(lineclearAllTasks(t.env)).toHaveLength(2);
  expect((lineclearTasks("alpha", t.env) as { id: string }[]).map((x) => x.id)).toEqual(["A-1", "A-2@other"]);
  expect(lineclearTasks("beta", t.env)).toHaveLength(1);
  expect(lineclearTasks("empty", t.env)).toHaveLength(0);
  expect(t.calls()).toBe(1);
});

test("the rule loop's tick reads tasks once however many callers ask, and again on the next tick", () => {
  const t = counting();
  forgetTaskReads();
  const world = realWorld(t.env);
  world.newTick?.();
  for (let i = 0; i < 5; i++) {
    world.tasks("alpha");
    world.tasks("beta");
    world.tasks("empty");
  }
  expect(t.calls()).toBe(1);
  world.newTick?.();
  world.tasks("alpha");
  expect(t.calls()).toBe(2);
});
