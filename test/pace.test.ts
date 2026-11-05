import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paceOf, roomPerDay, usageLimits } from "../src/limits.ts";
import { criticalSteps } from "../src/pace.ts";
import { parseRoadmap, stepStatuses } from "../src/roadmap.ts";
import { realWorld, tick } from "../src/rules.ts";
import { tmp } from "./helpers.ts";

// Spending the week evenly (LIN-166): the allowance of each account over the days to its reset gives a daily
// budget; the rule loop starts on the account with most room a day and holds what is not critical when all are ahead.

const NOW = Date.parse("2026-11-01T18:00:00Z");
const week = (percent: number, resetAt: string) => ({ percent, resetAt });
// The measured case: after 3.5 days, A 67 % (resets 5 Nov), C 72 % (6 Nov), B 1 % (8 Nov)
const A = week(67, "2026-11-05T03:00:00Z");
const C = week(72, "2026-11-06T03:00:00Z");
const B = week(1, "2026-11-08T03:00:00Z");

test("the room a day is the share left over the days to the reset, and an account past an even spend is ahead", () => {
  expect(roomPerDay(B, NOW)).toBeGreaterThan(roomPerDay(A, NOW) ?? 0);
  expect(roomPerDay(A, NOW) ?? 0).toBeGreaterThan(roomPerDay(C, NOW) ?? 0);
  expect(paceOf(A, NOW)).toBe("ahead");
  expect(paceOf(C, NOW)).toBe("ahead");
  expect(paceOf(B, NOW)).toBe("on pace");
  // a first burst inside the grace is not ahead; no reset time, no pace
  expect(paceOf(week(3, "2026-11-08T17:00:00Z"), NOW)).toBe("on pace");
  expect(paceOf({ percent: 90 }, NOW)).toBeUndefined();
});

test("Usage tells each account's pace", () => {
  const root = tmp("pace-usage");
  mkdirSync(join(root, "config"), { recursive: true });
  const at = new Date(NOW).toISOString();
  writeFileSync(join(root, "config", "limits.json"), JSON.stringify({ a: { at, week: A }, b: { at, week: B } }));
  const use = usageLimits([], { LINECLEAR_CONFIG: join(root, "config"), HOME: root }, NOW);
  expect(Object.fromEntries(use.map((u) => [u.account, u.pace]))).toEqual({ a: "ahead", b: "on pace" });
});

const roadmap = (rows: [string, string][]) =>
  `# Roadmap\n\n## Phase 0\n\n${rows.map(([id, after]) => `### ${id} T\n- why: w\n- done when:\n  - x\n- locks: ${id}\n- after: ${after}\n`).join("\n")}`;

test("only the ready steps that head the longest chain are critical", () => {
  const steps = parseRoadmap(
    roadmap([
      ["A", "none"],
      ["B", "none"],
      ["C", "A"],
      ["D", "C"],
    ]),
  ).steps;
  expect([...criticalSteps(steps, stepStatuses(steps, new Set(), []))]).toEqual(["A"]);
  expect([...criticalSteps(steps, stepStatuses(steps, new Set(["A"]), []))]).toEqual(["C"]);
});

/** The rule loop on a project whose accounts have these weekly limits; `added` lists the tasks it started. */
function loop(models: string[], limits: Record<string, { percent: number; resetAt: string }>, rows: [string, string][], pace?: "spend" | "even") {
  const dir = tmp("pace-loop");
  const config = join(dir, "config");
  const repo = join(dir, "repo");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  writeFileSync(
    join(config, "projects", "demo", "settings.json"),
    JSON.stringify({ repo, space: "demo", check: "true", ...(pace ? { pace } : {}), models: { worker: models, reviewer: models, planner: models } }),
  );
  writeFileSync(join(config, "machine.json"), JSON.stringify({ loadLimit: 1e6 }));
  const at = new Date(NOW).toISOString();
  writeFileSync(join(config, "limits.json"), JSON.stringify(Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, { at, week: v }]))));
  const added: string[][] = [];
  const vars = { ...process.env, LINECLEAR_CONFIG: config };
  const world = {
    ...realWorld(vars),
    roadmap: () => roadmap(rows),
    main: () => ({ head: "h", checkedOut: "h", commits: [] }),
    fetch: () => undefined,
    tasks: () => [],
    now: () => new Date(NOW),
    load: () => 0,
    offered: () => undefined,
    maxTasks: () => 5,
    reviewerSetting: () => undefined,
    addTask: (_space: string, title: string, _brief: string, flags: string[]) => void added.push([title, flags[flags.indexOf("--model") + 1] ?? ""]),
  };
  return { run: () => tick(world, false, vars), added };
}

test("a new task goes to the account with the most room a day, not the first of the list", () => {
  const t = loop(["a/m", "c/m", "b/m"], { a: A, c: C, b: B }, [["X", "none"]]);
  t.run();
  expect(t.added).toEqual([["X T", "b/m"]]);
});

test("with pace spend (the default) no step waits for pace", () => {
  const t = loop(["a/m", "c/m"], { a: A, c: C }, [
    ["X", "none"],
    ["Y", "none"],
  ]);
  t.run();
  expect(t.added.map((x) => x[0])).toEqual(["X T", "Y T"]);
});

test("an account just after its reset is not ahead: its room a day is past a day's share", () => {
  expect(paceOf(week(5, "2026-11-08T10:00:00Z"), NOW)).toBe("on pace");
});

test("with pace even and every account ahead, only the critical path starts", () => {
  const t = loop(
    ["a/m", "c/m"],
    { a: A, c: C },
    [
      ["X", "none"],
      ["Y", "none"],
      ["Z", "X"],
    ],
    "even",
  );
  const d = t.run();
  expect(t.added.map((x) => x[0])).toEqual(["X T"]);
  expect(d.find((x) => x.step === "Y")?.reason).toContain("ahead of its weekly pace");
});
