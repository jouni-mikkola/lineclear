import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineclearDir, worktreeCost } from "../src/measure.ts";
import { taskDetail, taskFacts } from "../src/task-detail.ts";

const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-detail-"));
  mkdirSync(join(dir, "chatlog"));
  writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks: [{ id: "A-1", title: "A one" }] }));
  const card = (at: number, text: string) => ({ at, card: { task: "A-1", text } });
  writeFileSync(join(dir, "chatlog", "A-1_Agent.json"), JSON.stringify({ posted: [card(2, "second"), card(1, "first")] }));
  writeFileSync(join(dir, "chatlog", "A-1_Reviewer.json"), JSON.stringify({ posted: [card(3, "major: it breaks")] }));
  return { LINECLEAR_HOME: dir, HOME: dir };
};

const detail = (id: string, env = home()) => taskDetail(id, { lineclear: lineclearDir(env), costSoFar: (w) => worktreeCost(w, env) }, env);

test("an opened row has its log oldest first and its reviewer's findings", () => {
  const d = detail("A-1");
  expect(d?.log).toEqual(["first", "second"]);
  expect(d?.review).toEqual(["major: it breaks"]);
  expect(d?.diff).toBe("");
  expect(d?.cost).toBeUndefined();
});

test("a task this machine does not have has no detail", () => {
  expect(detail("B-9")).toBeUndefined();
});

test("a task without a worktree has no files and no check", () => {
  expect(taskFacts({})).toEqual({});
});
