import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadFactor } from "../scripts/check-speed.ts";
import { sh } from "./helpers.ts";
import { installFixture } from "./install-fixture.ts";

// Each test runs install.sh for real: 30 s covers an idle machine, and the limit grows with the load.
setDefaultTimeout(30_000 * loadFactor());

const { state, app, install, passes, installBroken, inbox } = await installFixture();

// a file of its own, so the rollback tests run beside the install tests in another job
beforeAll(() => passes(install()), 180_000);

test("an update that breaks the chat is rolled back, and the Inbox says so", () => {
  const before = sh(["git", "-C", app, "rev-parse", "HEAD"]).out.trim();
  const restarts = () =>
    readFileSync(join(state, "systemctl.log"), "utf8")
      .split("\n")
      .filter((l) => l.includes("--user restart lineclear.service")).length;
  const restartedBefore = restarts();
  const { r, good } = installBroken("chat");
  expect(before).toBe(good);
  expect(r.code).not.toBe(0);
  expect(sh(["git", "-C", app, "rev-parse", "HEAD"]).out.trim()).toBe(before);
  expect(existsSync(join(app, "BROKEN"))).toBe(false);
  expect(restarts()).toBe(restartedBefore + 2); // on the new version, then back on the old one
  const items = inbox();
  expect(items).toHaveLength(1);
  expect(items[0]!.kind).toBe("stuck");
  expect(items[0]!.question).toContain("a coordinator chat does not accept a message");
  expect(items[0]!.question).toContain(`Putting ${before.slice(0, 7)} back`);
}, 180_000);

test("an update that pauses a Running project is rolled back too", () => {
  const { r, after } = installBroken("paused");
  expect(r.code).not.toBe(0);
  expect(after.paused).toBeUndefined(); // the project is Running again, not only the code back
  expect(existsSync(join(app, "BROKEN"))).toBe(false);
  const items = inbox();
  expect(items).toHaveLength(2);
  expect(items[1]?.question).toContain("p is Paused, it was Running");
}, 180_000);
