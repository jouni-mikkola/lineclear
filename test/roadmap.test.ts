import { readFileSync } from "node:fs";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countSteps, criticalPath, readPlan, roadmapLine } from "../src/progress.ts";
import { FORK_PATH } from "../ui/test/chain-path.ts";
import { roadmapSample } from "../ui/web/roadmap-samples.ts";
import { stepFiles, stepParts } from "../src/parts.ts";
import { roadmapMain } from "../src/roadmap-cli.ts";
import { checkRoadmap, closedSteps, doneIds, fitTitle, formErrors, parseRoadmap, resultFlag, resultOf, type Step, TITLE_MAX } from "../src/roadmap.ts";

const temps: string[] = [];
const scratch = mkdtempSync(join(tmpdir(), "lc-roadmap-cfg-"));
temps.push(scratch);
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const step = (id: string, after: string, extra = "") =>
  `### ${id} Title ${id}\n- result: Title ${id} works.\n- why: because\n- done when:\n  - it works\n- locks: repo\n- after: ${after}\n${extra}\n`;

const doc = (...steps: string[]) => `# Roadmap\n\n## Phase 0: Base\n\n${steps.join("\n")}`;

function repoWith(text: string, commits: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "lc-roadmap-"));
  temps.push(dir);
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs", "ROADMAP.md"), text);
  const git = (...a: string[]) => {
    const p = Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  };
  git("init", "-q", "-b", "main");
  for (const c of commits) git("commit", "-q", "--allow-empty", "-m", c);
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}

/** Records, as the rules do, which step each task was started for. */
function recordSteps(repo: string, taskSteps: Record<string, string>): void {
  const dir = join(scratch, "cfg", "projects", "p");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ repo }));
  writeFileSync(join(dir, "state.json"), JSON.stringify({ taskSteps }));
}
const run = (args: string[], tasks: { id?: string; title: string; status: string }[] = []) => {
  const out: string[] = [];
  const code = roadmapMain(
    args,
    (l) => out.push(l),
    () => tasks,
    // the status line reads the space's waits: a scratch folder, never the machine's own
    { ...process.env, LINECLEAR_CONFIG: join(scratch, "cfg") },
  );
  return { code, out };
};

test("every error kind names its line", () => {
  const text = doc(
    step("A", "none"), // line 5
    step("A", "none"), // duplicate
    step("B", "Z"), // unknown after
    step("C", "D"),
    step("D", "C"), // circular pair
    "### E Missing\n- why: x\n- locks: repo\n- after: none\n- colour: red\n",
  );
  const { errors } = checkRoadmap(text);
  const lines = text.split("\n");
  const at = (needle: string, from = 0) => lines.findIndex((l, i) => i >= from && l.startsWith(needle)) + 1;
  const msg = (line: number) =>
    errors
      .filter((e) => e.line === line)
      .map((e) => e.message)
      .join("|");
  expect(msg(at("### A", at("### A")))).toContain("duplicate id A");
  expect(msg(at("- after: Z"))).toContain("unknown 'after' id Z");
  expect(msg(at("- after: D"))).toContain("circular");
  expect(msg(at("- after: C"))).toContain("circular");
  expect(msg(at("### E"))).toContain("no 'done when' field");
  expect(msg(at("- colour"))).toContain("unknown field 'colour'");
  expect(errors.every((e) => e.line > 0)).toBe(true);
});

test("a step after itself is circular and a missing why is named", () => {
  const { errors } = checkRoadmap(doc(step("A", "A"), "### B T\n- done when: x\n- locks: r\n- after: none\n"));
  expect(errors.map((e) => e.message).join("|")).toContain("circular");
  expect(errors.map((e) => e.message).join("|")).toContain("no 'why' field");
});

test("check prints file:line and exits 1 on errors, 0 when clean", () => {
  const bad = repoWith(doc(step("A", "Q")), ["x"]);
  const r = run(["check", bad]);
  expect(r.code).toBe(1);
  expect(r.out[0]).toMatch(/ROADMAP\.md:\d+: .*unknown 'after' id Q/);
  const good = repoWith(doc(step("A", "none")), ["x"]);
  expect(run(["check", good])).toEqual({ code: 0, out: ["ok: 1 steps"] });
});

test("status covers all five states", () => {
  const text = doc(
    step("L1", "none"), // done by subject
    step("L2", "none"), // done by Step line
    step("L10", "L1"), // work (task), must not match L1
    step("L3", "L1"), // ready
    step("L4", "L10"), // waiting
    step("L5", "none", "- dropped: no longer wanted"),
    step("L6", "L5"), // ready, dropped counts as done
    step("L7", "L6"), // waiting
  );
  const dir = repoWith(text, ["LIN-2: L1 First (#1)", "Import\n\nStep: L2", "LIN-9: L11 other", "Roadmap: L3 plan edit"]);
  recordSteps(dir, { "LIN-1": "L10" });
  const r = run(
    ["status", dir, "--space", "s", "--json"],
    [
      { id: "LIN-1", title: "Something", status: "work" },
      { id: "LIN-2", title: "L4 Old", status: "done" },
    ],
  );
  expect(r.code).toBe(0);
  const states = Object.fromEntries((JSON.parse(r.out.join("\n")) as { id: string; state: string }[]).map((s) => [s.id, s.state]));
  expect(states).toEqual({ L1: "done", L2: "done", L10: "work", L3: "ready", L4: "waiting", L5: "dropped", L6: "ready", L7: "waiting" });
});

test("a task titled with a step's id that the rules did not start for it is not work", () => {
  const dir = repoWith(doc(step("L1", "none")), ["x"]);
  const r = run(["status", dir, "--space", "s"], [{ id: "LIN-5", title: "L1 Other", status: "work" }]);
  expect(r.out[1]).toContain("ready");
});

test("status refuses a bad roadmap and needs --space", () => {
  const dir = repoWith(doc(step("A", "Q")), ["x"]);
  expect(run(["status", dir, "--space", "s"]).code).toBe(1);
  expect(run(["status", dir]).code).toBe(2);
});

test("this repo's roadmap passes", () => {
  expect(run(["check", join(import.meta.dir, "..")])).toMatchObject({ code: 0 });
});

// how fast: scripts/measure-speed.ts
test("400 steps over 12 phases are checked", () => {
  let text = "# Roadmap\n";
  for (let i = 0; i < 400; i++) {
    if (i % 34 === 0) text += `\n## Phase ${i / 34}\n\n`;
    text += step(`S${i}`, i === 0 ? "none" : `S${i - 1}`);
  }
  expect(checkRoadmap(text).errors).toEqual([]);
});

test("usage prints the usage lines and nothing else", () => {
  const usage = [
    "usage: lineclear roadmap check <repo>",
    "       lineclear roadmap show <id> [<repo>]",
    "       lineclear roadmap status <repo> --space <name> [--json]",
    "       lineclear roadmap locks <repo> --space <name>",
    "       lineclear roadmap import <file.json> <repo> [--force] [--no-commit]",
  ];
  for (const args of [["--help"], ["status", "."]]) {
    // like console.log: every argument is printed, so a stray index or array shows up
    const out: string[] = [];
    const code = roadmapMain(
      args,
      (...a: unknown[]) => out.push(a.map(String).join(" ")),
      () => [],
    );
    expect({ code, out }).toEqual({ code: 2, out: usage });
  }
});

test("a reverted merge takes the done mark with it, a merge after the revert gives it back", () => {
  const ids = new Set(["A", "B"]);
  const merge = (subject: string) => ({ subject, body: "" });
  const log = [merge('Revert "LIN-1: A first"'), merge("LIN-2: B second"), merge("LIN-1: A first")];
  expect([...doneIds(log, ids)]).toEqual(["B"]);
  expect([...doneIds([merge("LIN-3: A again"), ...log], ids)].sort()).toEqual(["A", "B"]);
  expect([...doneIds([{ subject: "LIN-1: A first", body: "Step: B" }], ids)].sort()).toEqual(["A", "B"]);
});

test("the form check wants a short title and a one-sentence result", () => {
  const form = (text: string) => formErrors(parseRoadmap(text).steps).map((e) => e.message);
  const ok =
    "## P\n### A Chat survives an update\n- result: You keep your chat after an update.\n- why: x\n- done when:\n  - y\n- locks: none\n- after: none\n";
  expect(form(ok)).toEqual([]);
  expect(form(ok.replace("- result: You keep your chat after an update.\n", ""))).toEqual([expect.stringContaining("no 'result' line")]);
  expect(form(ok.replace("Chat survives an update", "Chat survives an update of the whole app"))).toEqual([expect.stringContaining("title of 40 characters")]);
  expect(form(ok.replace("You keep your chat after an update.", "x".repeat(141)))).toEqual([expect.stringContaining("141 characters")]);
  expect(form(ok.replace("after an update.", "after an update. It stays."))).toEqual([expect.stringContaining("more than one sentence")]);
});

test("a task gets --result only when the server would take it", () => {
  const of = (result: string) => resultFlag(parseRoadmap(step("A", "none").replace("Title A works.", result)).steps[0] as Step);
  expect(of("A user pays.")).toEqual(["--result", "A user pays."]);
  expect(of("First. Second.")).toEqual([]);
  expect(of(`${"long ".repeat(40)}.`)).toEqual([]);
});

test("a result written as a plain Result line is read, and a build without result skips it", () => {
  const { parsed, errors } = checkRoadmap("### A Title\nResult: Title works.\n- why: x\n- done when:\n  - y\n- locks: none\n- after: none\n");
  expect(errors).toEqual([]);
  expect(resultOf(parsed.steps[0] as Step)).toBe("Title works.");
});

test("a done step whose recorded run is missing fails the check until it is reopened, and is then open", () => {
  const proof = (extra = "", id = "L9", under = id) =>
    `### ${id} Title ${id}\n- result: Title ${id} works.\n- why: because\n- done when:\n  - A run is in \`docs/numbers.md\` under "${under}".\n${extra}- locks: repo\n- after: none\n\n`;
  const numbers = "# Numbers\n\n## L9: a run\n\nNot yet recorded: the run.\n\n## Pack\n\nNot yet recorded: L8 only.\n";
  const planted = repoWith(doc(proof(), proof("", "L7", "Pack")), ["LIN-1: L9 Run", "LIN-2: L7 Pack"]);
  writeFileSync(join(planted, "docs", "numbers.md"), numbers);
  const r = run(["check", planted]);
  expect(r.code).toBe(1);
  expect(r.out).toHaveLength(1);
  expect(r.out[0]).toMatch(/ROADMAP\.md:\d+: step L9 is done, but docs\/numbers\.md under "L9" says its run is not yet recorded/);

  const reopened = repoWith(doc(proof("  - Reopened: the run is missing\n")), ["LIN-1: L9 Run"]);
  writeFileSync(join(reopened, "docs", "numbers.md"), numbers);
  expect(run(["check", reopened]).code).toBe(0);
  expect(run(["status", reopened, "--space", "s"]).out[1]).toContain("ready");
  // Home's count and phase say the same
  const plan = readPlan(doc(proof("  - Reopened: the run is missing\n")), [{ subject: "LIN-1: L9 Run", body: "" }]);
  expect(countSteps(plan)).toEqual({ done: 0, total: 1 });

  const recorded = repoWith(doc(proof()), ["LIN-1: L9 Run"]);
  writeFileSync(join(recorded, "docs", "numbers.md"), "## L9: a run\n\nIt ran in 4 minutes.\n");
  expect(run(["check", recorded]).code).toBe(0);
});

test("a task title is cut at the end of a word", () => {
  expect(fitTitle("R2 Run the tests on GitHub Actions instead of Travis CI")).toBe("R2 Run the tests on GitHub");
  expect(fitTitle("R1 Short")).toBe("R1 Short");
  expect(fitTitle("x".repeat(40))).toHaveLength(TITLE_MAX);
});

test("the critical path in `roadmap status` is the one the step page draws", () => {
  // the fixed roadmap of the "chain-fork" sample: ui/test/chain.pw.ts looks for the same path in the drawing
  const sample = roadmapSample("filled", "chain-fork");
  // one merged step gives the line its pace, as the sample's line has one
  const text = doc(
    step("Z0", "none"),
    ...sample.steps.filter((s) => s.state !== "dropped").map((s) => step(s.id, s.after.join(", ") || "none").replace("locks: repo", `locks: ${s.id}`)),
  );
  const r = run(["status", repoWith(text, ["Merge\n\nStep: Z0"]), "--space", "s"], [{ title: "C1 Step", status: "work" }]);
  expect(r.out.find((l) => l.startsWith("Critical path:"))).toBe(`Critical path: ${FORK_PATH.join(" > ")}`);
  expect(sample.line.path).toEqual(FORK_PATH);
});

test("the critical path is the longest chain of open steps, the first listed on a tie", () => {
  const open = (id: string, ...after: string[]) => ({ id, after });
  expect(criticalPath([open("A"), open("B", "A"), open("C", "B"), open("D", "A"), open("E", "X")])).toEqual(["A", "B", "C"]);
  expect(criticalPath([open("A"), open("B")])).toEqual(["A"]);
  expect(criticalPath([])).toEqual([]);
});

test("the line carries no critical path while it gives no finish date", () => {
  const st = (id: string, after: string[]) => ({ id, title: id, phase: "P", done: false, after, locks: [] });
  const plan = { steps: [st("A", []), st("B", ["A"])] };
  expect(roadmapLine(plan, new Map(), {}, 0).path).toBeUndefined();
});

test("testOf reads the test a done-when names; closedSteps counts remote tasks closed by their agent's done", async () => {
  const { testOf } = await import("../src/doneproof.ts");
  const text = "# R\n\n## P\n\n### A T\n- why: w\n- done when:\n  - `bun test test/a.test.ts` passes\n- locks: repo\n- after: none\n";
  const { parsed } = checkRoadmap(text);
  expect(testOf((parsed?.steps ?? [])[0] as Step)).toBe("bun test test/a.test.ts");
  const remote = [{ id: "L-1@host", title: "A T", status: "done", closed: true, closedBy: "done" as const }];
  expect([...closedSteps(parsed?.steps ?? [], [], {}, remote).keys()]).toEqual(["A"]);
});

test("every open step that names parts also names its areas or the part on its locks line", () => {
  const steps = parseRoadmap(readFileSync(join(import.meta.dir, "..", "docs", "ROADMAP.md"), "utf8")).steps;
  const ref = ["main", "origin/main"].find((r) => Bun.spawnSync(["git", "rev-parse", "--verify", "-q", r]).exitCode === 0);
  const log = ref ? Bun.spawnSync(["git", "log", ref, "--format=%s%x1f%b%x1e"]).stdout.toString() : "";
  const commits = log
    .split("\x1e")
    .filter((r) => r.trim() !== "")
    .map((r) => ({ subject: (r.split("\x1f")[0] ?? "").trim(), body: r.split("\x1f")[1] ?? "" }));
  const done = doneIds(commits, new Set(steps.map((s) => s.id)));
  const whole = steps.filter((s) => {
    if (s.dropped || (done.has(s.id) && !s.reopened)) return false;
    const locks = [s.fields.locks?.value ?? "", ...(s.fields.locks?.more ?? [])]
      .join(" ")
      .split(/[,\s]+/)
      .filter((l) => l !== "" && l !== "none");
    return stepParts(s).names.length > 0 && stepFiles(s).length === 0 && locks.length === 0;
  });
  expect(whole.map((s) => s.id)).toEqual([]);
});

test("`roadmap check <repo>` prints the exact file line of each error kind", () => {
  const text = doc(
    step("A", "none"),
    step("A", "none"),
    step("B", "Z"),
    step("C", "D"),
    step("D", "C"),
    "### E Missing\n- why: x\n- locks: repo\n- after: none\n- colour: red\n",
  );
  const lines = text.split("\n");
  const at = (needle: string, from = 0) => lines.findIndex((l, i) => i >= from && l.startsWith(needle)) + 1;
  const { code, out } = run(["check", repoWith(text, ["x"])]);
  const has = (line: number, part: string) => out.some((l) => l.includes(`ROADMAP.md:${line}:`) && l.includes(part));
  expect(code).toBe(1);
  expect(has(at("### A", at("### A")), "duplicate id A")).toBe(true);
  expect(has(at("- after: Z"), "unknown 'after' id Z")).toBe(true);
  expect(has(at("- after: D"), "circular")).toBe(true);
  expect(has(at("### E"), "no 'done when' field")).toBe(true);
  expect(has(at("- colour"), "unknown field 'colour'")).toBe(true);
});

test("L319: a new measuring step is refused unless it waits for L271 or is an existing one", () => {
  const measure = "- parts: measure\n";
  const text = doc(
    step("L271", "none"),
    step("N1", "none", measure),
    step("N2", "L271", measure),
    step("N3", "N2", "- files: docs/numbers.md\n"),
    step("N4", "none", "- files: ui/web/report-view.ts\n"),
    step("OLD", "none", measure),
    step("N5", "none", "- files: src/other.ts\n"),
  );
  const dir = repoWith(text, ["init"]);
  writeFileSync(join(dir, "docs", "simplify.md"), "# Parts\n\nExisting: OLD\n");
  const lines: string[] = [];
  expect(roadmapMain(["check", dir], (l) => lines.push(l))).toBe(1);
  const out = lines.join("\n");
  expect(out).toContain("N1 adds measuring before tier 2 is done (rule L319");
  expect(out).toContain("L271");
  expect(out).toContain("step N4");
  for (const kept of ["step N2", "step N3", "step OLD", "step N5", "step L271"]) expect(out).not.toContain(kept);
});
