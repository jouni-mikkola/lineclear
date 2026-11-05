import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullCheckPassed, recordStepTimes } from "../src/check-runs.ts";

test("a full check that passed at a commit is not run again by a release", () => {
  const dir = mkdtempSync(join(tmpdir(), "steps-"));
  const where = { LINECLEAR_CONFIG: dir };
  expect(fullCheckPassed("abc", where)).toBe(false);
  writeFileSync(
    join(dir, "check-steps.jsonl"),
    `{"mode":"lane","commit":"abc","step":"wall","ok":true}\n{"mode":"full","commit":"abd","step":"wall","ok":true}\n`,
  );
  expect(fullCheckPassed("abc", where)).toBe(false);
  recordStepTimes([{ mode: "full", commit: "abc", step: "wall", ok: true }], where);
  expect(fullCheckPassed("abc", where)).toBe(true);
});

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
  expect(fullCheckPassed("old", where)).toBe(false);
  recordStepTimes([{ mode: "full", commit: "kept", step: "wall", ok: true }], where);
  recordStepTimes(
    Array.from({ length: 100 }, (_, n) => ({ mode: "lane", n })),
    where,
  );
  expect(fullCheckPassed("kept", where)).toBe(true);
});
