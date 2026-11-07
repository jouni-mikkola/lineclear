import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFactor } from "../scripts/check-speed.ts";
import { sh } from "./helpers.ts";
import { installFixture } from "./install-fixture.ts";

// Each test runs install.sh for real: 30 s covers an idle machine, and the limit grows with the load.
setDefaultTimeout(30_000 * loadFactor());

const { home, repo, app, git, install, passes, installBroken, inbox } = await installFixture();

// a file of its own, so these tests run beside the other rollback tests in another job
beforeAll(() => passes(install()), 180_000);

test("an update that wipes the task store is rolled back and the tasks come back", () => {
  const data = join(home, ".lineclear");
  const tasks = JSON.stringify({ next: {}, tasks: [{ id: "T-1" }, { id: "T-2" }] });
  writeFileSync(join(data, "tasks.json"), tasks);
  writeFileSync(join(data, "tasks-cold.jsonl"), '{"id":"T-0"}\n');
  const before = sh(["git", "-C", app, "rev-parse", "HEAD"]).out.trim();
  const { r } = installBroken("wipe");
  expect(r.code).not.toBe(0);
  expect(sh(["git", "-C", app, "rev-parse", "HEAD"]).out.trim()).toBe(before); // the version is back
  expect(readFileSync(join(data, "tasks.json"), "utf8")).toBe(tasks); // and so are the tasks
  expect(readFileSync(join(data, "tasks-cold.jsonl"), "utf8")).toBe('{"id":"T-0"}\n');
  const copies = join(app, "store-copies");
  const made = readdirSync(copies)
    .filter((n) => n.startsWith("update-"))
    .sort();
  const newest = made.at(-1) ?? "";
  expect(readFileSync(join(copies, newest, "tasks.json"), "utf8")).toBe(tasks); // the copy aside was made first
  expect(readFileSync(join(copies, newest, "source"), "utf8").trim()).toBe(data);
  expect(inbox().at(-1)?.question).toContain("the task store holds 0 tasks, it held 3 before the update");
}, 180_000);

test("a version that works passes the smoke check and stays", () => {
  writeFileSync(join(repo, "good.txt"), "good\n");
  git("add", "-A");
  git("commit", "-q", "-m", "good");
  const r = install();
  expect(r.code).toBe(0);
  expect(r.out).toContain("the new version works");
  expect(existsSync(join(app, "good.txt"))).toBe(true);
  expect(install().code).toBe(0);
  expect(existsSync(join(app, "good.txt"))).toBe(true);
}, 240_000);
