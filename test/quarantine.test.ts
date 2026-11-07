import { expect, test } from "bun:test";
import type { Failure } from "../scripts/failures.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureKey, judge, type Quarantined, readQuarantine, withFlake } from "../scripts/quarantine.ts";

const fail = (name: string, file = "test/a.test.ts"): Failure => ({ file, test: name });
const listed = (name: string): Quarantined => ({ file: "test/a.test.ts", test: name, task: "VEL-1" });

test("a listed flake that passes alone does not fail the check", () => {
  const f = fail("flake");
  const v = judge([f], new Set([failureKey(f)]), [listed("flake")]);
  expect(v).toEqual({ tolerated: [f], flaky: [], broken: [] });
});

test("a test that fails alone too is a break, listed or not", () => {
  const f = fail("break");
  expect(judge([f], new Set(), []).broken).toEqual([f]);
  expect(judge([f], new Set(), [listed("break")]).broken).toEqual([f]);
});

test("a flake that is not listed yet still fails the check", () => {
  const f = fail("new");
  expect(judge([f], new Set([failureKey(f)]), []).flaky).toEqual([f]);
});

test("the server's files are keyed under server/", () => {
  const f = fail("s", "./test/s.test.ts");
  const q: Quarantined = { file: "server/test/s.test.ts", test: "s", task: "VEL-2" };
  expect(judge([f], new Set([failureKey(f, "server/")]), [q], "server/").tolerated).toEqual([f]);
});

test("the quarantine takes 5 tests and refuses a 6th", () => {
  let list: Quarantined[] = [];
  for (let i = 1; i <= 5; i++) list = withFlake(list, listed(`t${i}`));
  expect(list).toHaveLength(5);
  expect(() => withFlake(list, listed("t6"))).toThrow(/5 tests/);
  expect(withFlake(list, listed("t1"))).toBe(list);
});

test("a list with a 6th entry written by hand is refused", () => {
  const path = join(mkdtempSync(join(tmpdir(), "quarantine-")), "q.json");
  writeFileSync(path, JSON.stringify([1, 2, 3, 4, 5, 6].map((i) => listed(`t${i}`))));
  expect(() => readQuarantine(path)).toThrow(/limit is 5/);
});

test("a flake needs a fix task id", () => {
  expect(() => withFlake([], { ...listed("x"), task: "later" })).toThrow(/fix task/);
});
