import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ownSlot } from "../src/waits.ts";
import { sh, tmp } from "./helpers.ts";

let root: string;
let scope: Record<string, string | undefined>;
beforeEach(() => {
  root = tmp("own-slot");
  scope = { ...process.env, LINECLEAR_CONFIG: join(root, "config"), HOME: root };
  delete scope.LINECLEAR_SLOT_HELD;
  scope.LINECLEAR_TASK = "LIN-1";
  const folder = join(root, "config", "projects", "demo");
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(root, "repo"));
  sh(["git", "init", "-q", "-b", "main"], { cwd: join(root, "repo") });
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ name: "demo", repo: join(root, "repo"), space: "s", check: "x" }));
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ loadPerCore: 1e6 }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a check script started by hand runs in a check slot and passes its exit code on", async () => {
  const run = ownSlot("echo $LINECLEAR_SLOT_HELD > held.txt; exit 3", join(root, "repo"), scope);
  expect(run).toBeDefined();
  expect(await run).toBe(3);
  expect(await Bun.file(join(root, "repo", "held.txt")).text()).toBe("1\n");
});

test("a script already in a slot, or in no project, takes no second slot", () => {
  expect(ownSlot("true", join(root, "repo"), { ...scope, LINECLEAR_SLOT_HELD: "1" })).toBeUndefined();
  expect(ownSlot("true", root, scope)).toBeUndefined();
  expect(ownSlot("true", join(root, "repo"), { ...scope, LINECLEAR_TASK: undefined })).toBeUndefined();
});
