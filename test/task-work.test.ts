import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWork, recordWork } from "../src/task-work.ts";

test("100 ticks of an unchanged world write one run line, not 100", () => {
  const env = { LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "work-")), LINECLEAR_MACHINE: "m1" };
  for (let i = 0; i < 100; i++) recordWork("T-1", "agent", env);
  expect(readWork(env)).toHaveLength(1);
  recordWork("T-1", "review", env);
  recordWork("T-2", "agent", env);
  expect(readWork(env)).toHaveLength(3);
});
