import { Database } from "bun:sqlite";
import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadFactor } from "../scripts/check-speed.ts";
import { installFixture } from "./install-fixture.ts";

// Each test runs install.sh for real: 30 s covers an idle machine, and the limit grows with the load.
setDefaultTimeout(30_000 * loadFactor());

const { home, repo, state, current, git, install, passes } = await installFixture();

/** The build folder the service runs from. */
const running = () => readlinkSync(current);

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

test("an update that breaks the chat is rolled back, and the Inbox says so", () => {
  const before = running();
  const restarts = () =>
    readFileSync(join(state, "systemctl.log"), "utf8")
      .split("\n")
      .filter((l) => l.includes("--user restart lineclear.service")).length;
  const restartedBefore = restarts();
  const { r } = installBroken("chat");
  expect(r.code).not.toBe(0);
  expect(running()).toBe(before);
  expect(existsSync(join(current, "BROKEN"))).toBe(false);
  expect(restarts()).toBe(restartedBefore + 2); // on the new version, then back on the old one
  expect(r.out).toContain("a coordinator chat does not accept a message");
  expect(r.out).toContain(`putting ${basename(before)} back`);
  expect(inbox()).toEqual([]);
}, 180_000);

test("an update that pauses a Running project is rolled back too", () => {
  const { r, after } = installBroken("paused");
  expect(r.code).not.toBe(0);
  expect(after.paused).toBeUndefined(); // the project is Running again, not only the code back
  expect(existsSync(join(current, "BROKEN"))).toBe(false);
  expect(r.out).toContain("p is Paused, it was Running");
  expect(inbox()).toEqual([]);
}, 180_000);
