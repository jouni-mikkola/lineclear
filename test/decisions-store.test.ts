import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { addDecisions, decisionsSince, pruneDecisions, storeFile } from "../src/decisions-store.ts";

const scratch = () => ({ LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "decisions-")) });
const DAY = 86_400_000;

test("decisions since a time come back oldest first, and old ones are pruned", () => {
  const env = scratch();
  const now = Date.parse("2026-11-01T12:00:00Z");
  const at = (days: number) => new Date(now - days * DAY).toISOString();
  addDecisions(
    env,
    [200, 95, 30, 1].map((d, i) => ({ time: at(d), project: "p", step: `T${i}`, kind: "stall", reason: "r", class: "late" })),
  );
  expect(decisionsSince(env, now - 40 * DAY).map((d) => d.step)).toEqual(["T2", "T3"]);
  expect(decisionsSince(env, now - 40 * DAY)[0]).toMatchObject({ class: "late" });
  expect(pruneDecisions(env, now)).toBe(2);
  expect(decisionsSince(env, 0).map((d) => d.step)).toEqual(["T2", "T3"]);
});

test("an old decisions.jsonl is read into the table once", () => {
  const env = scratch();
  const line = JSON.stringify({ time: new Date().toISOString(), project: "p", kind: "skip", reason: "old line" });
  writeFileSync(join(env.LINECLEAR_CONFIG, "decisions.jsonl"), `${line}\nnot json\n`);
  expect(decisionsSince(env, 0).map((d) => d.reason)).toEqual(["old line"]);
  expect(decisionsSince(env, 0)).toHaveLength(1);
});

test("the last hour (`lineclear status`) is one indexed query over 100,000 rows in under 10 ms", () => {
  const env = scratch();
  const now = Date.now();
  const db = new Database(storeFile(env));
  addDecisions(env, [{ time: new Date(now).toISOString(), project: "p", kind: "skip", reason: "first" }]);
  db.transaction(() => {
    const add = db.query("insert into decisions (ms, project, step, kind, reason, body) values (?, 'p', 's', 'skip', 'r', '{}')");
    for (let i = 0; i < 100_000; i++) add.run(now - 2 * 3_600_000 - i * 1000);
  }).immediate();
  db.close();
  const withEnv = { ...env, HOME: env.LINECLEAR_CONFIG };
  decisionsSince(withEnv, now - 3_600_000);
  const start = performance.now();
  const rows = decisionsSince(withEnv, now - 3_600_000);
  expect(performance.now() - start).toBeLessThan(10);
  expect(rows).toHaveLength(1);
});
