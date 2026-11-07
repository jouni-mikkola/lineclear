import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sweepDiskUse } from "../src/disk-use.ts";
import { DAY } from "../src/time.ts";
import { tmp } from "./helpers.ts";

const commit = (cwd: string) => {
  writeFileSync(join(cwd, "file"), "x");
  spawnSync("git", ["add", "."], { cwd });
  spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd });
};

test("a retired task's worktree, an old folder no task owns and autopilot-runtime go; a live task's worktree stays", () => {
  const dir = tmp("disk-use");
  const home = join(dir, "home");
  const wts = join(dir, "worktrees", "repo");
  mkdirSync(join(home, "autopilot-runtime"), { recursive: true });
  const repo = join(dir, "repo");
  mkdirSync(repo);
  spawnSync("git", ["init", "-q"], { cwd: repo });
  commit(repo);
  const plant = (name: string, daysOld: number) => {
    const path = join(wts, name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "file"), "x");
    if (name === "work-6-clone") {
      spawnSync("git", ["init", "-q"], { cwd: path });
      commit(path);
    } else {
      rmSync(path, { recursive: true });
      spawnSync("git", ["-C", repo, "worktree", "add", "-q", "-b", name, path], { stdio: "ignore" });
    }
    const at = Date.now() / 1000 - daysOld * 86400;
    utimesSync(path, at, at);
    return path;
  };
  const retired = plant("work-1-retired", 3);
  const live = plant("work-2-live", 30);
  const old = plant("work-3-old", 30);
  const young = plant("work-4-young", 1);
  const other = plant("mine", 30);
  const clone = plant("work-6-clone", 30);
  const dirty = plant("work-5-dirty", 3);
  writeFileSync(join(dirty, "unsaved"), "y");
  const now = Date.now();
  const tasks = [
    { id: "T-1", worktree: retired, merged: true, doneAt: now - 3 * DAY, updated: now - 3 * DAY },
    { id: "T-3", worktree: dirty, closed: true, doneAt: now - 3 * DAY, updated: now - 3 * DAY },
    { id: "T-2", worktree: live, updated: now },
  ];
  writeFileSync(join(home, "tasks.json"), JSON.stringify({ tasks }));
  const lines = sweepDiskUse(new Date(now), { LINECLEAR_HOME: home });
  expect(lines).toHaveLength(3);
  expect(existsSync(join(home, "autopilot-runtime"))).toBe(false);
  expect(existsSync(retired) || existsSync(old)).toBe(false);
  expect(existsSync(live) && existsSync(young) && existsSync(other) && existsSync(dirty) && existsSync(clone)).toBe(true);
});
