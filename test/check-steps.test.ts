import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordStepTimes } from "../src/check-runs.ts";

test("the steps log keeps the newest 5000 lines and still finds a passed full check", () => {
  const dir = mkdtempSync(join(tmpdir(), "steps-"));
  const where = { LINECLEAR_CONFIG: dir };
  recordStepTimes([{ mode: "full", commit: "old", step: "wall", ok: true }], where);
  recordStepTimes(
    Array.from({ length: 6000 }, (_, n) => ({ mode: "lane", n })),
    where,
  );
  const lines = readFileSync(join(dir, "check-steps.jsonl"), "utf8").trim().split("\n");
  expect(lines.length).toBe(5000);
  expect(JSON.parse(lines[4999] ?? "").n).toBe(5999);
  recordStepTimes([{ mode: "full", commit: "kept", step: "wall", ok: true }], where);
  recordStepTimes(
    Array.from({ length: 100 }, (_, n) => ({ mode: "lane", n })),
    where,
  );
});
