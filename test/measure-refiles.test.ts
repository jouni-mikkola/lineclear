import { expect, test } from "bun:test";
import { refileLines, refiles } from "../src/measure-refiles.ts";

const H = 3_600_000;
const t0 = Date.parse("2026-01-05T00:00:00Z");
const fix = (id: string, title: string, project: string, hours: number, end?: number, merged?: boolean) => ({
  id,
  title,
  project,
  created: t0 + hours * H,
  ...(end === undefined ? {} : { doneAt: t0 + end * H, merged }),
});

test("one fix task of each cause is printed with its cause", () => {
  const a = "p:laptop:proj";
  const b = "p:desktop:proj";
  const tasks = [
    fix("X-1", "Fix S1 title", a, 0), // first
    fix("X-2", "Fix S1 title", a, 1), // X-1 still open, same machine and form: missed open
    fix("X-3", "S1 Fix: title", a, 2), // X-2 open, other form: open elsewhere
    fix("X-4", "S1 Fix: title", a, 3, 3.5, false), // X-3 still open, same machine and form: missed open
    fix("X-5", "S1 Fix: title", b, 4, 4.5, true), // X-4 ended unmerged before: ended unmerged
    fix("X-6", "S1 Fix: title", b, 5), // X-5 ended merged
  ];
  const [row] = refiles(tasks, ["S1"], t0, t0 + 24 * H);
  expect(row?.fixes.map((f) => f.cause)).toEqual(["first", "missed open", "open elsewhere", "missed open", "ended unmerged", "ended merged"]);
  expect(row?.mostIn24h).toBe(6);
  expect(row?.endedUnmerged).toBe(1);
  const lines = refileLines(refiles(tasks, ["S1"], t0, t0 + 24 * H));
  expect(lines[0]).toContain("S1: most in 24 hours 6");
  expect(lines.join("\n")).toContain("X-5 2026-01-05T04:00:00.000Z desktop: ended unmerged");
});

test("a cause reads the fix task before --since; steps with one fix task a day are left out; largest first", () => {
  const a = "p:laptop:proj";
  const tasks = [
    fix("X-1", "Fix S1 t", a, -48, -47, true),
    fix("X-2", "Fix S1 t", a, 0),
    fix("X-3", "Fix S1 t", a, 1),
    fix("X-4", "Fix S2 t", a, 0),
    fix("X-5", "Fix S2 t", a, 30),
    fix("X-6", "Fix S3 t", a, 0),
    fix("X-7", "Fix S3 t", a, 1),
    fix("X-8", "Fix S3 t", a, 2),
    fix("X-9", "Unrelated", a, 2),
  ];
  const rows = refiles(tasks, ["S1", "S2", "S3"], t0, t0 + 48 * H);
  expect(rows.map((r) => r.step)).toEqual(["S3", "S1"]);
  expect(rows[1]?.fixes.map((f) => f.cause)).toEqual(["ended merged", "missed open"]);
});
