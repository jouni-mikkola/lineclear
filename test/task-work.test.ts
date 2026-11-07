import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWork, recordWork } from "../src/task-work.ts";

test("100 ticks of an unchanged world write one agent line", () => {
  const env = { LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "work-")) };
  for (let i = 0; i < 100; i++) recordWork("T-1", "agent", env, "m1");
  expect(readWork(env)).toHaveLength(1);
  recordWork("T-2", "agent", env, "m1");
  recordWork("T-1", "agent", env, "m2");
  expect(readWork(env)).toHaveLength(3);
});
