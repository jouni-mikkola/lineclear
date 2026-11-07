import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordWork } from "../src/task-work.ts";

test("100 ticks that start the same agent write 1 line, a later start writes another", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-"));
  const env = { LINECLEAR_CONFIG: dir, LINECLEAR_MACHINE: "m" };
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) recordWork("T-1", "agent", env, "m", t0 + i * 5_000);
  const lines = () => readFileSync(join(dir, "decisions.jsonl"), "utf8").trim().split("\n");
  expect(lines()).toHaveLength(1);
  recordWork("T-2", "agent", env, "m", t0);
  recordWork("T-1", "agent", env, "m", t0 + 31 * 60_000);
  expect(lines()).toHaveLength(3);
});
