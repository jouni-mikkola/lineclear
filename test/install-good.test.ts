import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFactor } from "../scripts/check-speed.ts";
import { installFixture } from "./install-fixture.ts";

// Each test runs install.sh for real: 30 s covers an idle machine, and the limit grows with the load.
setDefaultTimeout(30_000 * loadFactor());

const { repo, app, git, install, passes } = await installFixture();

// a file of its own, so it runs beside the rollback tests in another job
beforeAll(() => passes(install()), 180_000);

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
