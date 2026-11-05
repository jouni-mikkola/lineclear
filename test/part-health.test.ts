import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { healthLines, partHealth, scoreOf, taskSignals, worstParts } from "../src/part-health.ts";
import { parsePart } from "../src/parts.ts";
import { checkRoadmap } from "../src/roadmap.ts";
import { tmp } from "./helpers.ts";

const part = (name: string, files: string, debts = "- none") => parsePart(name, `# ${name}\n\nx\n\n## Files\n\n- ${files}\n\n## Debts\n\n${debts}\n`);
const parts = [part("core", "`src/`", "- one debt"), part("ui", "`ui/`")];

test("the score follows the formula of docs/architecture.md", () => {
  expect(scoreOf({ oversize: 1, copied: 120, debts: 2, uncovered: 0, stalls: 1, findings: 3, flaky: 1 })).toBe(3 + 2 + 2 + 2 + 3 + 2);
});

test("taskSignals counts stalls and flaky tests from cards, findings from ready facts, each card once", () => {
  const stuck = { at: 1, card: { id: "c1", task: "T-1", text: "may be stuck: no output" } };
  const files = [{ posted: [stuck, stuck, { at: 2, card: { id: "c2", task: "T-1", text: "a flaky test failed once" } }] }];
  const signals = taskSignals(files, [{ id: "T-1", facts: "review: 2 rounds, 1 major fixed, 2 minor left" }, { id: "T-2" }]);
  expect(signals.get("T-1")).toEqual({ stalls: 1, findings: 3, flaky: 1 });
  expect(signals.get("T-2")).toBeUndefined();
});

test("partHealth counts the size and copies baselines, debts, and the signals of the tasks of steps that touched a part", () => {
  const repo = tmp("health");
  mkdirSync(join(repo, "scripts/gates/baseline"), { recursive: true });
  writeFileSync(join(repo, "scripts/gates/baseline/size.json"), JSON.stringify({ "ui/big.tsx": 900 }));
  writeFileSync(join(repo, "scripts/gates/baseline/copies.json"), JSON.stringify({ "src/a.ts = ui/b.ts": 100 }));
  const steps = checkRoadmap(
    "# R\n\n## Phase 1: P\n\n### A1 One\n- why: w\n- done when:\n  - d\n- parts: ui\n- after: none\n\n### A2 Two\n- why: w\n- done when:\n  - d\n- files: src/x.ts\n- locks: none\n- after: none\n",
  ).parsed.steps;
  const tasks = [
    { id: "T-1", title: "A1 One" },
    { id: "T-2", title: "A2 Two" },
    { id: "T-3", title: "Owner work" },
  ];
  const signals = new Map([
    ["T-1", { stalls: 1, findings: 2, flaky: 0 }],
    ["T-2", { stalls: 0, findings: 1, flaky: 1 }],
    ["T-3", { stalls: 5, findings: 5, flaky: 5 }],
  ]);
  const h = partHealth(repo, parts, steps, tasks, signals);
  expect(h).toEqual([
    { part: "ui", oversize: 1, copied: 100, debts: 0, uncovered: 0, stalls: 1, findings: 2, flaky: 0, score: 3 + 2 + 2 + 2 },
    { part: "core", oversize: 0, copied: 100, debts: 1, uncovered: 0, stalls: 0, findings: 1, flaky: 1, score: 2 + 1 + 1 + 2 },
  ]);
  expect(worstParts(h)).toEqual(["ui"]);
  expect(healthLines(h)[1]).toMatch(/^ {2}ui +9 /);
  expect(healthLines([])).toEqual([]);
});

test("a part under the coverage floors of its modules scores worse", () => {
  const repo = tmp("health-cov");
  mkdirSync(join(repo, ".coverage"), { recursive: true });
  // core: 70 % against a floor of 90 %, 20 points under: 4; ui: at its floor
  writeFileSync(
    join(repo, ".coverage/files.json"),
    JSON.stringify({ "src/a.ts": { hit: 70, found: 100, floor: 90 }, "ui/b.ts": { hit: 90, found: 100, floor: 90 } }),
  );
  const h = partHealth(repo, parts, [], [], new Map());
  expect(h.map((x) => [x.part, x.uncovered, x.score])).toEqual([
    ["core", 4, 5],
    ["ui", 0, 0],
  ]);
});
