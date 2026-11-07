import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readdirSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tick, type World } from "../src/rules.ts";
import { diskTmpRoot, removeGoneSessions, staleFolders, sweepOldTemp } from "../src/tmpdirs.ts";
import { tmp } from "./helpers.ts";

test("the loop removes temp folders of finished runs older than 2 h and keeps newer ones", () => {
  const dir = tmp("sweep");
  const tmpRoot = join(dir, "systmp");
  const cache = join(dir, "cache");
  mkdirSync(tmpRoot);
  mkdirSync(join(cache, "lineclear", "tmp"), { recursive: true });
  mkdirSync(join(dir, "config"));
  const plant = (parent: string, name: string, hoursOld: number) => {
    const path = join(parent, name);
    mkdirSync(path);
    const at = Date.now() / 1000 - hoursOld * 3600;
    utimesSync(path, at, at);
    return path;
  };
  const oldInTmp = plant(tmpRoot, "lc-pick-old", 3);
  const oldOnDisk = plant(join(cache, "lineclear", "tmp"), "lc-check-old", 5);
  const fresh = plant(tmpRoot, "lane-config-fresh", 1);
  const other = plant(tmpRoot, "not-ours", 9);
  // live state of the pi extension: its folder's own time does not move when a task writes inside it
  const live = plant(tmpRoot, "lineclear-notes-1000", 9);
  const env = { ...process.env, LINECLEAR_CONFIG: join(dir, "config"), TMPDIR: tmpRoot, XDG_CACHE_HOME: cache, PI_CODING_AGENT_DIR: join(dir, "pi") };
  const world = { now: () => new Date() } as World;
  const decisions = tick(world, false, env);
  expect(decisions.map((d) => d.reason)).toEqual(["removed 2 temp folders of finished runs older than 2 h"]);
  expect(existsSync(oldInTmp) || existsSync(oldOnDisk)).toBe(false);
  expect(existsSync(fresh) && existsSync(other) && existsSync(live)).toBe(true);
  // the next tick does not look again
  expect(tick(world, false, env)).toEqual([]);
});

test("the sweep removes a session folder only when its worktree is gone and its newest file is over 7 days old", () => {
  const dir = tmp("sessions");
  const live = join(dir, "wt-live");
  mkdirSync(live);
  const plant = (name: string, cwd: string, daysOld: number) => {
    const folder = join(dir, "sessions", name);
    mkdirSync(folder, { recursive: true });
    const file = join(folder, "a.jsonl");
    writeFileSync(file, `${JSON.stringify({ type: "session", cwd })}\n{}\n`);
    const at = Date.now() / 1000 - daysOld * 86400;
    utimesSync(file, at, at);
    return folder;
  };
  const kept = plant("live", live, 30);
  const goneNew = plant("gone-new", join(dir, "wt-gone-1"), 2);
  const goneOld = plant("gone-old", join(dir, "wt-gone-2"), 8);
  expect(removeGoneSessions(join(dir, "sessions"), Date.now())).toBe(1);
  expect(existsSync(kept) && existsSync(goneNew)).toBe(true);
  expect(existsSync(goneOld)).toBe(false);
});

test("the sweep ends a server left running from a test folder it removes", async () => {
  const dir = tmp("sweep-proc");
  const tmpRoot = join(dir, "systmp");
  const left = join(tmpRoot, "lc-left-server");
  mkdirSync(left, { recursive: true });
  const script = join(left, "server.js");
  writeFileSync(script, "setInterval(() => {}, 1000);");
  const quiet = { stdio: ["ignore", "ignore", "ignore"] satisfies ["ignore", "ignore", "ignore"] };
  // one runs a script from the folder, one only inherited the folder as its TMPDIR
  const servers = [Bun.spawn(["bun", script], quiet), Bun.spawn(["sleep", "3137"], { ...quiet, cwd: "/", env: { ...process.env, TMPDIR: left } })];
  try {
    const at = Date.now() / 1000 - 3 * 3600;
    utimesSync(left, at, at);
    const settings = {
      ...process.env,
      LINECLEAR_CONFIG: join(dir, "config"),
      TMPDIR: tmpRoot,
      XDG_CACHE_HOME: join(dir, "cache"),
      PI_CODING_AGENT_DIR: join(dir, "pi"),
    };
    tick({ now: () => new Date() } as World, false, settings);
    for (const server of servers) expect(await Promise.race([server.exited, Bun.sleep(3000).then(() => "alive")])).not.toBe("alive");
    expect(existsSync(left)).toBe(false);
  } finally {
    for (const server of servers) server.kill("SIGKILL");
  }
});

test("the stale-folder sweep finds lc-test and lc-check folders older than 6 h that no process uses, and only those", async () => {
  const dir = tmp("stale");
  const names = { oldTest: "lc-test-aaaa", oldCheck: "lc-check-bbbb", inUse: "lc-test-used", fresh: "lc-check-fresh", other: "not-ours" };
  for (const n of Object.values(names)) mkdirSync(join(dir, n));
  const at = Date.now() / 1000 - 7 * 3600;
  for (const n of [names.oldTest, names.oldCheck, names.inUse, names.other]) utimesSync(join(dir, n), at, at);
  const user = Bun.spawn(["sleep", "3138"], { stdio: ["ignore", "ignore", "ignore"], cwd: "/", env: { ...process.env, TMPDIR: join(dir, names.inUse) } });
  try {
    const found = staleFolders({ TMPDIR: dir, XDG_CACHE_HOME: join(dir, "cache") }).filter((f) => f.startsWith(dir));
    expect(found.sort()).toEqual([join(dir, names.oldTest), join(dir, names.oldCheck)].sort());
  } finally {
    user.kill("SIGKILL");
  }
});

test("a test process leaves nothing in its temp folder: the folder it was given is empty when it ends", () => {
  const base = mkdtempSync(join(diskTmpRoot(), "lc-scope-check-"));
  try {
    const fixture = join(base, "fixture.test.ts");
    writeFileSync(
      fixture,
      'import { test } from "bun:test";\nimport { mkdtempSync } from "node:fs";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\ntest("makes a folder", () => { mkdtempSync(join(tmpdir(), "left-")); });\n',
    );
    const root = join(import.meta.dir, "..");
    const run = Bun.spawnSync(["bun", "test", "--preload", join(root, "test", "tmp-scope.ts"), fixture], {
      cwd: base,
      stdin: "ignore",
      env: { ...process.env, TMPDIR: base },
    });
    expect(run.exitCode).toBe(0);
    expect(readdirSync(base)).toEqual(["fixture.test.ts"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the sweep removes /tmp's compile cache and trims the disk cache to its cap", () => {
  const dir = tmp("sweep-cache");
  const tmpRoot = join(dir, "systmp");
  const cache = join(dir, "cache");
  const disk = join(cache, "lineclear", "node-compile-cache");
  mkdirSync(join(tmpRoot, "node-compile-cache"), { recursive: true });
  writeFileSync(join(tmpRoot, "node-compile-cache", "a"), "x");
  mkdirSync(disk, { recursive: true });
  for (const [i, name] of ["old", "new"].entries()) {
    // sparse: the trim reads sizes, so no bytes need writing
    writeFileSync(join(disk, name), "");
    truncateSync(join(disk, name), 300 * 1024 ** 2);
    utimesSync(join(disk, name), 1000 + i, 1000 + i);
  }
  const env = { ...process.env, TMPDIR: tmpRoot, XDG_CACHE_HOME: cache, PI_CODING_AGENT_DIR: join(tmpRoot, "pi") };
  const lines = sweepOldTemp(new Date(), env);
  expect(existsSync(join(tmpRoot, "node-compile-cache"))).toBe(false);
  expect(existsSync(join(disk, "old"))).toBe(false);
  expect(existsSync(join(disk, "new"))).toBe(true);
  expect(lines).toEqual(["removed the compile cache from the temp folder", "trimmed 300 MB from the compile cache"]);
});
