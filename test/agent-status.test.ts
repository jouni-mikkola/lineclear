import { describe, expect, test } from "bun:test";
import { agentStatus, statusLines } from "../src/agent-status.ts";
import type { HomeData, HomeTask } from "../src/home-data.ts";
import { topMain } from "../src/top-cmd.ts";
import { rowsOf } from "../ui/web/home-rows.ts";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const task = (id: string, extra: Partial<HomeTask>): HomeTask => ({
  id,
  title: `${id} title`,
  state: "work",
  stage: "work",
  since: NOW - 7 * 60_000,
  at: NOW,
  ...extra,
});

const board = {
  at: NOW,
  host: "box",
  projects: [
    {
      name: "app",
      tasks: [
        task("A-1", { step: "L1", input: 120_000 }),
        task("A-2", { state: "need", stage: "work", text: "a question waits for you", input: 5000 }),
        task("A-3", { state: "work", stage: "queued" }),
        task("A-4", { stage: "review", machine: "elitebook", since: NOW - 90_000 }),
        task("A-5", { state: "done", stage: "done" }),
      ],
    },
  ],
  loose: [{ ...task("B-1", { stalled: true, input: 42 }), space: "side" }],
} as unknown as HomeData;

const facts = ({ id, project, machine, phase, input, minutes, wait }: ReturnType<typeof agentStatus>[number]) => ({
  id,
  project,
  machine,
  phase,
  input,
  minutes,
  wait,
});

describe("agent status", () => {
  test("lists each running agent once with its facts", () => {
    const rows = agentStatus(board.projects, board.loose, board.host, NOW);
    expect(rows.map((r) => [r.id, r.machine, r.phase, r.input, r.minutes, r.wait])).toEqual([
      ["A-1", "box", "at work", 120_000, 7, ""],
      ["A-2", "box", "at work", 5000, 7, "a question waits for you"],
      ["A-4", "elitebook", "in review", undefined, 1, ""],
      ["B-1", "box", "at work", 42, 7, "no sign of life"],
    ]);
  });

  test("Home's table and `lineclear top` show the same rows", () => {
    const home = rowsOf(board.projects as never, board.loose, board.host, [], NOW);
    const printed: string[] = [];
    topMain((l) => printed.push(l), board);
    const fromStatus = agentStatus(board.projects, board.loose, board.host, NOW);
    expect(home.map(facts)).toEqual(fromStatus.map(facts));
    expect(printed).toEqual(statusLines(fromStatus));
    expect(printed).toHaveLength(1 + home.length);
  });

  test("says so when no agent works", () => {
    expect(statusLines([])).toEqual(["No agent at work."]);
  });
});
