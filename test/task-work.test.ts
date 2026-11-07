import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordWork } from "../src/task-work.ts";

test("100 ticks of an unchanged world write one run line", () => {
  const env = { LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "work-")), LINECLEAR_MACHINE: "m1" };
  for (let i = 0; i < 100; i++) recordWork("T-1", "agent", env);
  const lines = readFileSync(join(env.LINECLEAR_CONFIG, "decisions.jsonl"), "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  recordWork("T-1", "review", env);
  recordWork("T-2", "agent", env);
  expect(readFileSync(join(env.LINECLEAR_CONFIG, "decisions.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
});
