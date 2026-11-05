import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Failure, FLAKY_CLASS, outsideChange, parseFailures, passesAlone, recordFlake, settleFailures } from "../scripts/flaky.ts";
import { failedOutside } from "../src/check-runs.ts";
import { decisionsPath } from "../src/rules.ts";
import { tmp } from "./helpers.ts";

const a: Failure = { file: "test/a.test.ts", test: "a (slow) one" };
const b: Failure = { file: "test/b.test.ts", test: "b" };
const world = () => {
  const dir = tmp("flaky");
  const vars = { ...process.env, LINECLEAR_CONFIG: join(dir, "config") };
  const records = () =>
    existsSync(decisionsPath(vars))
      ? readFileSync(decisionsPath(vars), "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
  return { dir, vars, records };
};

test("failures are read with their file, and the summary's repeat is left out", () => {
  const out = [
    "bun test",
    "test/a.test.ts:",
    "(pass) ok [1ms]",
    "(fail) a (slow) one [5.5ms]",
    "test/b.test.ts:",
    "(fail) b [2ms]",
    "",
    "2 tests failed:",
    "(fail) a (slow) one [5.5ms]",
  ].join("\n");
  expect(parseFailures(out)).toEqual([a, b]);
});

test("a test that fails, then passes alone, is a recorded flake and the check goes on", () => {
  const w = world();
  const saved: Failure[] = [];
  expect(
    settleFailures(
      [a, b],
      w.vars,
      () => true,
      (f) => saved.push(f),
    ),
  ).toBe(true);
  expect(saved).toEqual([a, b]);
  recordFlake(a, w.vars, new Date("2026-11-02T10:00:00Z"), () => true);
  expect(w.records()).toMatchObject([{ kind: "stall", class: FLAKY_CLASS, file: a.file, test: a.test }]);
});

test("a test that fails again alone fails the check, and records nothing", () => {
  const saved: Failure[] = [];
  expect(
    settleFailures(
      [a, b],
      process.env,
      (f) => f === a,
      (f) => saved.push(f),
    ),
  ).toBe(false);
  expect(saved).toEqual([]);
  expect(settleFailures([], process.env, () => true)).toBe(false);
});

test("a second flake of one test within 24 hours files a task once", () => {
  const w = world();
  const filed: [Failure, number][] = [];
  const file = (f: Failure, n: number) => filed.push([f, n]) > 0;
  const at = (hours: number) => new Date(Date.parse("2026-11-02T00:00:00Z") + hours * 3_600_000);
  recordFlake(a, w.vars, at(0), file);
  recordFlake(b, w.vars, at(1), file);
  expect(filed).toEqual([]);
  recordFlake(a, w.vars, at(2), file);
  expect(filed).toEqual([[a, 2]]);
  recordFlake(a, w.vars, at(3), file);
  expect(filed).toHaveLength(1);
  // a flake a day later starts over
  recordFlake(b, w.vars, at(30), file);
  expect(filed).toHaveLength(1);
  expect(w.records().filter((r) => r.filed)).toHaveLength(1);
});

test("passesAlone runs the one test: a flake fails once and passes on its second run, a broken test fails", () => {
  const w = world();
  mkdirSync(join(w.dir, "t"));
  const mark = join(w.dir, "seen");
  writeFileSync(
    join(w.dir, "t", "x.test.ts"),
    `import { expect, test } from "bun:test";\nimport { existsSync, writeFileSync } from "node:fs";\ntest("flaky (one)", () => { const first = !existsSync(${JSON.stringify(mark)}); writeFileSync(${JSON.stringify(mark)}, "1"); expect(first).toBe(false); });\ntest("broken", () => expect(1).toBe(2));\n`,
  );
  const vars = { PATH: process.env.PATH, HOME: process.env.HOME };
  expect(passesAlone({ file: "t/x.test.ts", test: "flaky (one)" }, vars, w.dir)).toBe(false);
  expect(passesAlone({ file: "t/x.test.ts", test: "flaky (one)" }, vars, w.dir)).toBe(true);
  expect(passesAlone({ file: "t/x.test.ts", test: "broken" }, vars, w.dir)).toBe(false);
  expect(passesAlone({ file: "t/x.test.ts", test: "no such test" }, vars, w.dir)).toBe(false);
  expect(passesAlone({ file: "", test: "x" }, vars, w.dir)).toBe(false);
});

test("a failure outside the files the change reaches is the machine's: only then a shard runs again", () => {
  const touched = new Set(["test/b.test.ts"]);
  expect(outsideChange([a], touched)).toBe(true);
  expect(outsideChange([{ ...a, file: "./test/a.test.ts" }], touched)).toBe(true);
  expect(outsideChange([a, b], touched)).toBe(false);
  expect(outsideChange([], touched)).toBe(false);
  expect(outsideChange([{ file: "", test: "x" }], touched)).toBe(false);
});

test("the tests the check names as outside the change are read from its output", () => {
  expect(failedOutside("x\ncheck: outside the change: a (slow) one\ncheck: outside the change: b\ncheck: tests 1/4 failed")).toEqual(["a (slow) one", "b"]);
});
