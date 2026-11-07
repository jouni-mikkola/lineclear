import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordWork } from "../src/task-work.ts";

test("100 records of the same work on one machine write 1 line", () => {
  const env = { LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "work-")) };
  for (let i = 0; i < 100; i++) recordWork("T-1", "agent", env, "m1");
  recordWork("T-1", "agent", env, "m2");
  recordWork("T-1", "review", env, "m1");
  expect(readFileSync(join(env.LINECLEAR_CONFIG, "decisions.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
});
