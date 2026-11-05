import { expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { partProblems } from "../src/autoplan.ts";
import { briefParts } from "../src/brief.ts";
import { partsFaults, partsMain, repoState } from "../src/parts-check.ts";
import { fileClash, readParts, stepHeld, stepNeeds, unblockedByFiles } from "../src/parts.ts";
import { checkRoadmap, type Step } from "../src/roadmap.ts";
import { roadmapMain } from "../src/roadmap-cli.ts";
import { sh, tmp } from "./helpers.ts";

const page = (name: string, iface: string, files: string, debts = "- none") =>
  `# ${name}\n\nWhat ${name} is for.\n\n## Invariants\n\n- it holds\n\n## Interface\n\n${iface}\n\n## Files\n\n${files}\n\n## Tests\n\n- \`test/${name}.test.ts\`${name === "a" ? ", `test/contracts/a.test.ts`" : ""}\n\n## Debts\n\n${debts}\n`;

/** A repo of two parts: b's code uses `foo` of part a. */
function scratch(): string {
  const repo = tmp("parts");
  const put = (f: string, text: string) => {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), text);
  };
  put("src/a.ts", "export function foo(x: number): number {\n  return x;\n}\nexport const bar = 1;\n");
  put("src/b.ts", 'import { foo } from "./a.ts";\nexport const baz = foo(1);\n');
  put("test/a.test.ts", "");
  put("test/b.test.ts", "");
  put("test/contracts/a.test.ts", "");
  put("docs/parts/a.md", page("a", "- `src/a.ts`: `foo`", "- `src/a.ts`, `test/a.test.ts`"));
  put("docs/parts/b.md", page("b", "none", "- `src/b.ts`, `test/b.test.ts`, `docs/`"));
  put("docs/architecture.md", "# Map\n\n## Parts\n\n| Part | What | Page |\n| --- | --- | --- |\n| `a` | a | a |\n| `b` | b | b |\n");
  for (const c of [
    ["init", "-q", "-b", "main"],
    ["add", "."],
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start"],
    ["checkout", "-qb", "work"],
  ])
    sh(["git", ...c], { cwd: repo });
  return repo;
}

const faults = (repo: string) => {
  const { tracked, since } = repoState(repo);
  return partsFaults(repo, tracked, since);
};

test("a repo whose pages are true passes the parts check", () => {
  const repo = scratch();
  const lines: string[] = [];
  expect(partsMain(["check", repo], (l) => lines.push(l))).toBe(0);
  expect(lines).toEqual(["ok: 2 parts, every file in one, every interface on its page"]);
});

test("the page check fails on a used name not on the page, a file in no part and a page too long", () => {
  const repo = scratch();
  writeFileSync(join(repo, "src/b.ts"), 'import { bar, foo } from "./a.ts";\nexport const baz = foo(bar);\n');
  writeFileSync(join(repo, "loose.ts"), "");
  writeFileSync(join(repo, "docs/parts/b.md"), `${readFileSync(join(repo, "docs/parts/b.md"), "utf8")}${"- more\n".repeat(40)}`);
  const f = faults(repo);
  expect(f).toContain("docs/parts/a.md: other parts use `bar` of src/a.ts: list them under Interface");
  expect(f).toContain("loose.ts is in no part: add it under Files on one page in docs/parts/");
  expect(f.some((l) => l.startsWith("docs/parts/b.md: ") && l.includes("at most 45"))).toBe(true);
});

test("the page check fails on a name the page lists and no other part uses", () => {
  const repo = scratch();
  writeFileSync(join(repo, "docs/parts/a.md"), page("a", "- `src/a.ts`: `foo`, `bar`", "- `src/a.ts`, `test/a.test.ts`"));
  expect(faults(repo)).toContain("docs/parts/a.md: no other part uses `bar` of src/a.ts: take them off Interface");
});

test("the page check fails when an interface changed and its page did not, and passes once the page changes", () => {
  const repo = scratch();
  writeFileSync(join(repo, "src/a.ts"), "export function foo(x: string): number {\n  return x.length;\n}\nexport const bar = 1;\n");
  expect(faults(repo)).toEqual(["src/a.ts changed the interface `foo` of part a since main: update docs/parts/a.md in the same change"]);
  writeFileSync(join(repo, "docs/parts/a.md"), page("a", "- `src/a.ts`: `foo` (takes a string)", "- `src/a.ts`, `test/a.test.ts`"));
  expect(faults(repo)).toEqual([]);
  // a change inside the body is no change of the interface
  const quiet = scratch();
  writeFileSync(join(quiet, "src/a.ts"), "export function foo(x: number): number {\n  return x + 0;\n}\nexport const bar = 1;\n");
  expect(faults(quiet)).toEqual([]);
});

test("the page check sees a change in any field of an exported interface or type, not only the first", () => {
  const repo = scratch();
  const shapes = (extra: string) =>
    `export interface Shape {\n  a: number;\n  b: number;${extra}\n}\nexport type Box = {\n  w: number;\n  h: number;${extra}\n};\n`;
  writeFileSync(join(repo, "src/a.ts"), `export function foo(x: number): number {\n  return x;\n}\nexport const bar = 1;\n${shapes("")}`);
  writeFileSync(join(repo, "src/b.ts"), 'import { type Box, foo, type Shape } from "./a.ts";\nexport const baz = foo(1);\nexport type Both = Box & Shape;\n');
  writeFileSync(join(repo, "docs/parts/a.md"), page("a", "- `src/a.ts`: `foo`, `Shape`, `Box`", "- `src/a.ts`, `test/a.test.ts`"));
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "shapes"], { cwd: repo });
  sh(["git", "branch", "-qf", "main"], { cwd: repo });
  expect(faults(repo)).toEqual([]);
  writeFileSync(join(repo, "src/a.ts"), `export function foo(x: number): number {\n  return x;\n}\nexport const bar = 1;\n${shapes("\n  c: number;")}`);
  expect(faults(repo)).toEqual(["src/a.ts changed the interface `Box`, `Shape` of part a since main: update docs/parts/a.md in the same change"]);
});

test("the page check sees the return type of a function that takes a callback or an arrow default", () => {
  const repo = scratch();
  const foo = (ret: string) =>
    `export function foo(x: number, f: (n: number) => number = (n) => n, now = () => 0): ${ret} {\n  return f(x) + now();\n}\nexport const bar = 1;\n`;
  writeFileSync(join(repo, "src/a.ts"), foo("number"));
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "callback"], { cwd: repo });
  sh(["git", "branch", "-qf", "main"], { cwd: repo });
  expect(faults(repo)).toEqual([]);
  writeFileSync(join(repo, "src/a.ts"), foo("number | string"));
  expect(faults(repo)).toEqual(["src/a.ts changed the interface `foo` of part a since main: update docs/parts/a.md in the same change"]);
});

test("a part with an interface needs its contract test, or names it under Debts", () => {
  const repo = scratch();
  sh(["git", "rm", "-q", "test/contracts/a.test.ts"], { cwd: repo });
  expect(faults(repo)).toContain("docs/parts/a.md: part a has an interface and no contract test test/contracts/a.test.ts: write it, or name it under Debts");
  const owed = page("a", "- `src/a.ts`: `foo`", "- `src/a.ts`, `test/a.test.ts`", "- No contract test yet: `test/contracts/a.test.ts`.");
  writeFileSync(join(repo, "docs/parts/a.md"), owed.replace(", `test/contracts/a.test.ts`\n", "\n"));
  expect(faults(repo)).toEqual([]);
});

test("a contract test fails on a fault planted in its provider", () => {
  const root = join(import.meta.dir, "..");
  const copy = tmp("contract-fault");
  for (const d of [
    "src",
    "pi",
    "templates",
    "server/server/live/engine/check-queue.ts",
    "server/server/live/timer-rule.ts",
    "test/helpers.ts",
    "test/contracts/inbox.test.ts",
    "package.json",
    "tsconfig.json",
  ])
    cpSync(join(root, d), join(copy, d), { recursive: true });
  const run = () => sh(["bun", "test", "test/contracts/inbox.test.ts"], { cwd: copy, env: { PATH: process.env.PATH ?? "", HOME: copy } });
  expect(run().code).toBe(0);
  const inbox = join(copy, "src/inbox.ts");
  writeFileSync(inbox, readFileSync(inbox, "utf8").replace("i.answer === undefined && i.closed === undefined", "i.answer === undefined"));
  expect(run().code).not.toBe(0);
});

const ROADMAP = (steps: string) => `# Roadmap\n\n## Phase 1: P\n${steps}`;
const stepOf = (id: string, lines: string) => `\n### ${id} Step ${id}\n- result: It works.\n- why: w\n- done when:\n  - d\n${lines}- after: none\n`;

test("the roadmap check fails on a step with no parts, an unknown part and a file outside its parts", () => {
  const repo = scratch();
  const run = (text: string) => {
    writeFileSync(join(repo, "docs/ROADMAP.md"), text);
    const lines: string[] = [];
    return { code: roadmapMain(["check", repo], (l) => lines.push(l)), lines };
  };
  expect(run(ROADMAP(stepOf("A1", "- parts: a\n- files: src/a.ts\n"))).code).toBe(0);
  const none = run(ROADMAP(stepOf("A1", "- locks: none\n")));
  expect(none.code).toBe(1);
  expect(none.lines[0]).toContain("step A1 names no parts");
  const wrong = run(ROADMAP(stepOf("A1", "- parts: a, c\n- files: src/b.ts\n")));
  expect(wrong.lines.some((l) => l.includes("unknown part 'c'"))).toBe(true);
  expect(wrong.lines.some((l) => l.includes("src/b.ts, which is in part b, not in its parts"))).toBe(true);
});

test("a step's brief carries the pages of its parts", () => {
  const repo = scratch();
  const step = checkRoadmap(ROADMAP(stepOf("A1", "- parts: b\n"))).parsed.steps[0];
  if (!step) throw new Error("no step");
  expect(briefParts(repo, step)).toBe(readFileSync(join(repo, "docs/parts/b.md"), "utf8").trim());
});

test("the planner keeps one step in five a health step, for a part with the worst health", () => {
  const parts = readParts(scratch());
  const ctx = { parts, worst: ["a"] };
  const steps = (text: string) => checkRoadmap(ROADMAP(text)).parsed.steps;
  const four = [1, 2, 3, 4].map((n) => stepOf(`A${n}`, "- parts: b\n")).join("");
  expect(partProblems([], steps(four), ctx)).toEqual([]);
  const five = four + stepOf("A5", "- parts: b\n");
  expect(partProblems(steps(four), steps(five), ctx)).toEqual([
    "parts: keep one step in five a health step ((health) after a part on its parts line): add one for a",
  ]);
  expect(partProblems(steps(four), steps(four + stepOf("A5", "- parts: a (health)\n")), ctx)).toEqual([]);
  expect(partProblems(steps(four), steps(four + stepOf("A5", "- parts: b (health)\n")), ctx)).toEqual([
    "parts: step A5 is a health step for b, but the worst health is a",
  ]);
  // a roadmap already short of health steps passes while it gets no shorter, and refuses once it does
  const six = five + stepOf("A6", "- parts: b\n");
  expect(partProblems(steps(five), steps(six), ctx)).toEqual([]);
  expect(partProblems(steps(five), steps(six + [7, 8, 9, 10].map((n) => stepOf(`A${n}`, "- parts: b\n")).join("")), ctx)).toHaveLength(1);
  // a new step must name its parts; an old step that did not change keeps its form
  expect(partProblems(steps(stepOf("A0", "- locks: none\n")), steps(stepOf("A0", "- locks: none\n") + stepOf("A1", "- locks: none\n")), ctx)).toEqual([
    "parts: step A1 names no parts (one or more of a, b)",
  ]);
});

test("steps on different files of one part start together, steps on the same file or a whole part do not", () => {
  const step = (id: string, lines: string) => checkRoadmap(ROADMAP(stepOf(id, lines))).parsed.steps[0] as Step;
  const a = step("A1", "- parts: b\n- files: src/b/one.ts\n");
  const other = step("A2", "- parts: b\n- files: src/b/two.ts\n");
  const same = step("A3", "- parts: b\n- files: src/b/one.ts\n");
  const dir = step("A4", "- parts: b\n- files: src/b/\n");
  const whole = step("A5", "- parts: b\n");
  const blocked = (s: Step, running: Step[]) => {
    const held = new Set(running.flatMap(stepHeld));
    return stepNeeds(s).some((l) => held.has(l)) || fileClash(s, held) !== undefined;
  };
  expect(blocked(other, [a])).toBe(false);
  expect(blocked(same, [a])).toBe(true);
  expect(blocked(dir, [a])).toBe(true);
  expect(blocked(whole, [a])).toBe(true);
  expect(blocked(a, [whole])).toBe(true);
  expect(blocked(whole, [whole])).toBe(true);
  expect(unblockedByFiles([other, same, whole], [a]).map((s) => s.id)).toEqual(["A2"]);
});

test("a narrow lock holds its area: a step with files starts beside it, a whole-part step waits", () => {
  const step = (id: string, lines: string) => checkRoadmap(ROADMAP(stepOf(id, lines))).parsed.steps[0] as Step;
  const narrow = step("A1", "- parts: b\n- locks: kit\n");
  const files = step("A2", "- parts: b\n- files: src/b/one.ts\n");
  const whole = step("A3", "- parts: b\n");
  const named = step("A4", "- parts: b\n- locks: b\n");
  const blocked = (s: Step, running: Step[]) => {
    const held = new Set(running.flatMap(stepHeld));
    return stepNeeds(s).some((l) => held.has(l)) || fileClash(s, held) !== undefined;
  };
  expect([...stepHeld(narrow)].sort()).toEqual(["kit", "~b"]);
  expect(stepHeld(narrow)).not.toContain("b");
  expect(blocked(files, [narrow])).toBe(false);
  expect(blocked(whole, [narrow])).toBe(true);
  expect(blocked(narrow, [narrow])).toBe(true);
  // a lock named after the part holds it whole
  expect(blocked(files, [named])).toBe(true);
  expect(blocked(whole, [named])).toBe(true);
  expect(blocked(named, [files])).toBe(true);
});

test("U72 stall: a running ui step with locks kit no longer holds ui, so a ui step with files starts", () => {
  const step = (id: string, lines: string) => checkRoadmap(ROADMAP(stepOf(id, lines))).parsed.steps[0] as Step;
  const running = step("A1", "- parts: ui\n- locks: kit\n");
  const ready = step("A2", "- parts: ui\n- files: ui/web/settings.tsx\n");
  const whole = step("A3", "- parts: ui\n");
  const held = new Set(stepHeld(running));
  expect(held.has("ui")).toBe(false);
  expect(held.has("~ui")).toBe(true);
  expect(stepNeeds(ready).some((l) => held.has(l)) || fileClash(ready, held)).toBeFalsy();
  expect(stepNeeds(whole).some((l) => held.has(l))).toBe(true);
});
