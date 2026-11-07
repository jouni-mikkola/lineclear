import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forgetTaskReads, readTasks } from "../src/task-read.ts";
import { readRoom } from "../src/spread.ts";

const row = (machine: string, freeKb: number) => ({ machine, room: { load: 0.5, cores: 4, freeKb, totalKb: 16_000_000 }, slots: { working: 1, max: 3 } });

test("the room of 3 workers comes from the snapshot: no `room` command, 0 processes", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-room-"));
  const bin = join(dir, "lineclear");
  writeFileSync(bin, `#!/bin/sh\necho '[{"id":"A-1","title":"t","status":"work","machine":"mac","space":"lineclear"}]'\n`);
  chmodSync(bin, 0o755);
  const env = { ...process.env, LINECLEAR_SERVER_BIN: bin };
  forgetTaskReads();
  readTasks(env, "lineclear"); // the one list a tick reads for its own tasks
  const spawned: string[][] = [];
  const real = Bun.spawnSync;
  (Bun as { spawnSync: unknown }).spawnSync = (cmd: string[], ...rest: unknown[]) => {
    spawned.push(cmd);
    return (real as (...a: unknown[]) => unknown)(cmd, ...rest);
  };
  try {
    const snapshot = { machines: [row("mac", 2_000_000), row("a", 1), row("b", 2)] };
    const rooms = ["mac", "a", "b"].map((h) => readRoom(h, "lineclear", snapshot, env));
    expect(rooms.map((r) => (typeof r === "string" ? r : r.freeKb))).toEqual([2_000_000, 1, 2]);
    expect(spawned.filter((c) => c.includes("room"))).toHaveLength(0);
    expect(spawned).toHaveLength(0);
    expect(typeof readRoom("gone", "lineclear", snapshot, env)).toBe("string");
  } finally {
    (Bun as { spawnSync: unknown }).spawnSync = real;
  }
});
