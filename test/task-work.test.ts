import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWork, recordWork } from "../src/task-work.ts";

test("100 ticks asking for the same work leave 1 line, a new span or machine leaves another", () => {
  const env = { LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "work-")) };
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) recordWork("T-1", "agent", env, "boxa", t0 + i * 1000);
  expect(readWork(env)).toHaveLength(1);
  recordWork("T-1", "agent", env, "boxb", t0 + 200_000);
  recordWork("T-2", "agent", env, "boxa", t0 + 200_000);
  expect(readWork(env)).toHaveLength(3);
  recordWork("T-1", "agent", env, "boxa", t0 + 31 * 60_000);
  expect(readWork(env)).toHaveLength(4);
});
