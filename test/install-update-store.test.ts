import { Database } from "bun:sqlite";
import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFactor } from "../scripts/check-speed.ts";
import { installFixture } from "./install-fixture.ts";

// Each test runs install.sh for real: 30 s covers an idle machine, and the limit grows with the load.
setDefaultTimeout(30_000 * loadFactor());

const { home, repo, app, current, git, install, passes } = await installFixture();

// two files, so the rollback tests run beside the install tests and each other in other jobs
beforeAll(() => passes(install()), 180_000);

/** Commits a version that breaks the service the way BROKEN says, installs it, and puts the repository back. */
function installBroken(how: string) {
  // the project p is Running before the update
  const dir = join(home, ".config/lineclear/projects/p");
  mkdirSync(dir, { recursive: true });
  const settings = join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ repo, space: "p", check: "true", models: {} }));
  writeFileSync(join(repo, "BROKEN"), `${how}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", `broken: ${how}`);
  const good = git("rev-parse", "HEAD~1").out.trim();
  const r = install();
  const after = JSON.parse(readFileSync(settings, "utf8"));
  rmSync(dir, { recursive: true });
  git("reset", "-q", "--hard", good);
  return { r, good, after };
}
// The Inbox items in the store (read here, not through src/inbox.ts: importing that module early changes other test files)
const inbox = (): { kind: string; question: string }[] => {
  const file = join(home, ".config/lineclear/store.sqlite");
  if (!existsSync(file)) return [];
  const db = new Database(file);
  try {
    return db
      .query("select item from inbox order by n")
      .all()
      .map((row) => JSON.parse((row as { item: string }).item));
  } finally {
    db.close();
  }
};

test("an update that wipes the task store is rolled back and the tasks come back", () => {
  const data = join(home, ".lineclear");
  const tasks = JSON.stringify({ next: {}, tasks: [{ id: "T-1" }, { id: "T-2" }] });
  writeFileSync(join(data, "tasks.json"), tasks);
  writeFileSync(join(data, "tasks-cold.jsonl"), '{"id":"T-0"}\n');
  const before = readlinkSync(current);
  const { r } = installBroken("wipe");
  expect(r.code).not.toBe(0);
  expect(readlinkSync(current)).toBe(before); // the version is back
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
  expect(existsSync(join(current, "good.txt"))).toBe(true);
  expect(install().code).toBe(0);
  expect(existsSync(join(current, "good.txt"))).toBe(true);
}, 240_000);
