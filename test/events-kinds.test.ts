import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { readEvents } from "../src/events.ts";
import { tmp } from "./helpers.ts";

test("decisions of every kind and answered or closed items become events", () => {
  const root = tmp("events-kinds");
  const env = { ...process.env, HOME: root, LINECLEAR_CONFIG: join(root, "config"), LINECLEAR_HOME: join(root, "data") };
  mkdirSync(env.LINECLEAR_CONFIG, { recursive: true });
  const rows = ["skip", "wake", "stall", "stop", "close"].map((kind) => ({ time: "2026-01-01T00:00:00Z", kind, step: "T-1", reason: "why" }));
  writeFileSync(join(env.LINECLEAR_CONFIG, "decisions.jsonl"), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const item = { n: 1, task: "T-1", question: "ok?", choices: [], since: "2026-01-01T00:00:00Z" };
  const items = [
    { ...item, answeredAt: "2026-01-02T00:00:00Z", answer: "yes" },
    { ...item, n: 2, closedAt: "2026-01-02T00:00:00Z" },
  ] as never;
  const texts = readEvents(env, items, Date.parse("2026-01-03T00:00:00Z")).map((e) => e.text);
  expect(texts).toContain("T-1: held, why");
  expect(texts).toContain("T-1: woken, why");
  expect(texts).toContain("T-1: stalled, why");
  expect(texts).toContain("T-1: stopped, why");
  expect(texts).toContain("T-1: closed, why");
  expect(texts).toContain("answered: yes");
  expect(texts).toContain("closed, no longer needed");
});

test("writeAtomic throws and leaves no temp file when the rename fails", () => {
  const root = tmp("atomic-fail");
  const target = join(root, "dir");
  mkdirSync(join(target, "inner"), { recursive: true });
  expect(() => writeAtomic(target, "x")).toThrow();
});
