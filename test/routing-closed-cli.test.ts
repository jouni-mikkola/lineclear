import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realWorld, taskStatus } from "../src/world.ts";

test("a task show answer gives its status; anything else gives none", () => {
  expect(taskStatus(JSON.stringify({ id: "A-1", status: "done" }))).toBe("done");
  expect(taskStatus("No task A-9")).toBeUndefined();
});

test("a tell or a stop for a done task is refused with its state; the server is asked only for the task", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-closed-"));
  const bin = join(dir, "server");
  const log = join(dir, "calls");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${log}\necho '{"id":"A-1","status":"done"}'\n`);
  chmodSync(bin, 0o755);
  const world = realWorld({ ...process.env, LINECLEAR_SERVER_BIN: bin });
  expect(world.tellTask("A-1", "go on", "resume")).toContain("A-1 is Done already");
  expect(world.stopTask("A-1")).toContain("A-1 is Done already");
  expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["task show A-1 --json", "task show A-1 --json"]);
});
