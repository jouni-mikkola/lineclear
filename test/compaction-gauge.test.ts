import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compactionGauge } from "../src/compaction-gauge.ts";
import { tmp } from "./helpers.ts";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const DAY = 86_400_000;

test("Home's compaction card counts the last 14 days of the notes' log and divides the tokens by the tasks merged in them", () => {
  const root = tmp("gauge");
  const env = { HOME: root, LINECLEAR_STATE: join(root, "state"), LINECLEAR_SHEPHERDR_DIR: join(root, "store") };
  expect(compactionGauge(1_000, env, NOW)).toEqual({ compactions: 0, fellBack: 0, tasks: 0, tokensPerTask: null });
  mkdirSync(join(root, "state", "pack"), { recursive: true });
  const at = (days: number) => new Date(NOW - days * DAY).toISOString();
  const line = (ev: string, days: number) => JSON.stringify({ t: at(days), ev });
  writeFileSync(
    join(root, "state", "pack", "compaction-notes.jsonl"),
    [line("used", 1), line("fallback", 2), line("used", 13), line("used", 15), line("asked", 1)].join("\n"),
  );
  mkdirSync(join(root, "store"), { recursive: true });
  const task = (n: number, days: number, merged = true) => ({ id: `T-${n}`, merged, doneAt: NOW - days * DAY });
  writeFileSync(join(root, "store", "tasks.json"), JSON.stringify({ tasks: [task(1, 1), task(2, 3), task(3, 2, false), task(4, 20)] }));
  expect(compactionGauge(3_000_000, env, NOW)).toEqual({ compactions: 3, fellBack: 1, tasks: 2, tokensPerTask: 1_500_000 });
});
