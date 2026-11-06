import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRIEF_MAX, stepText } from "../src/brief.ts";
import { roadmapMain } from "../src/roadmap-cli.ts";
import { parseRoadmap } from "../src/roadmap.ts";
import { stepBrief } from "../src/brief.ts";
import { roadmapReads, roadmapUse } from "../src/session-text.ts";
import { READER_ASK } from "../src/reader-ask.ts";
import { sh, tmp } from "./helpers.ts";

const step = (id: string, after: string, why = "because") =>
  `### ${id} Title ${id}\n- why: ${why} ${id}\n- done when:\n  - first ${id} in \`src/named.ts\`\n- locks: x\n- after: ${after}\n\n`;
const ROADMAP = `# R\n\n## Phase 0: P\n\n${step("A1", "none")}${step("A2", "A1")}${step("A3", "A2")}`;

function repoWith(agents: string) {
  const repo = tmp("briefs");
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "docs", "ROADMAP.md"), ROADMAP);
  writeFileSync(join(repo, "AGENTS.md"), agents);
  writeFileSync(join(repo, "src", "named.ts"), "");
  writeFileSync(join(repo, "src", "changed.ts"), "");
  writeFileSync(join(repo, "src", "other.ts"), "");
  const git = (...a: string[]) => sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo });
  git("init", "-b", "main");
  git("add", "-A");
  git("commit", "-m", "start");
  writeFileSync(join(repo, "src", "changed.ts"), "x");
  git("add", "-A");
  git("commit", "-m", "LIN-1: A1 the first");
  writeFileSync(join(repo, "src", "other.ts"), "x");
  git("add", "-A");
  git("commit", "-m", "LIN-2: A2 the second");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return repo;
}

const settings = { check: "bun run check", reviewRounds: 2 } as any;
const stepOf = (id: string) => parseRoadmap(ROADMAP).steps.find((s) => s.id === id)!;

test("the brief holds the why, done when, the named files, the files of the after steps and the rules", () => {
  const repo = repoWith("# Rules\n\n- Short sentences.\n");
  const brief = stepBrief(stepOf("A2"), settings, "r/model", "w/model", { repo, roadmap: ROADMAP });
  expect(brief).toContain("because A2");
  expect(brief).toContain("first A2");
  expect(brief).toContain("- src/named.ts");
  expect(brief).toContain("- src/changed.ts"); // changed by A1, which A2 comes after
  expect(brief).not.toContain("- src/other.ts"); // changed by A2 itself: not an `after` step
  expect(brief).not.toContain("docs/ROADMAP.md\n- ");
  expect(brief).toContain("Short sentences.");
  expect(brief).not.toContain("{{");
});

test("the brief says to use roadmap show instead of reading the whole file", () => {
  const brief = stepBrief(stepOf("A1"), settings, "r/model", "w/model");
  expect(brief).toContain("lineclear roadmap show <id>");
  expect(brief).toContain("Do not read the whole docs/ROADMAP.md");
});

test("the brief says a project script keeps no global lock of its own and wraps heavy tests in lineclear slot", () => {
  const brief = stepBrief(stepOf("A1"), settings, "r/model", "w/model");
  expect(brief).toContain("must not keep its own global lock");
  expect(brief).toContain("`lineclear slot`");
});

test("the brief stays under its size however long the rules are", () => {
  const repo = repoWith("- a long rule line\n".repeat(5000));
  const brief = stepBrief(stepOf("A2"), settings, "r/model", "w/model", { repo, roadmap: ROADMAP });
  expect(brief.length).toBeLessThanOrEqual(BRIEF_MAX);
  expect(brief).toContain("because A2"); // the step itself is never cut
  expect(brief).toContain("cut: read AGENTS.md");
  expect(brief).toContain("- src/changed.ts");
});

test("roadmap show prints one step and nothing else", () => {
  const repo = repoWith("rules");
  const lines: string[] = [];
  expect(roadmapMain(["show", "A2", repo], (l) => lines.push(l))).toBe(0);
  const text = lines.join("\n");
  expect(text).toBe(stepText(ROADMAP, stepOf("A2")));
  expect(text.startsWith("### A2 Title A2")).toBe(true);
  expect(text).toContain("- after: A1");
  expect(text).not.toContain("A1 Title");
  expect(text).not.toContain("A3 Title");
});

test("roadmap show of an unknown step or with no id fails", () => {
  const repo = repoWith("rules");
  const lines: string[] = [];
  expect(roadmapMain(["show", "ZZ", repo], (l) => lines.push(l))).toBe(1);
  expect(lines.join("\n")).toContain("no step 'ZZ'");
  expect(roadmapMain(["show"], () => {})).toBe(2);
});

const call = (name: string, args: object) => JSON.stringify({ message: { role: "assistant", content: [{ type: "toolCall", name, arguments: args }] } });
const user = (text: string) => JSON.stringify({ message: { role: "user", content: text } });

test("measure counts the sessions that read the whole roadmap, before and after the small brief", () => {
  const old = [user("L1 T\n\nBuild step A"), call("read", { path: "/w/docs/ROADMAP.md" })].join("\n");
  const old2 = [user("L1 T\n\nBuild step B"), call("bash", { command: "cat docs/ROADMAP.md | head" })].join("\n");
  const old3 = [user("L1 T\n\nBuild step C"), call("read", { path: "/w/docs/ROADMAP.md", offset: 10, limit: 20 })].join("\n");
  const small = [user("Build step D. Use `lineclear roadmap show <id>`"), call("bash", { command: "lineclear roadmap show L5" })].join("\n");
  const small2 = [user("Build step E. Use `lineclear roadmap show <id>`"), call("read", { path: "docs/ROADMAP.md" })].join("\n");
  const review = [user("Review this change"), call("read", { path: "/w/docs/ROADMAP.md" })].join("\n");
  expect(roadmapUse(old)).toEqual({ small: false, whole: true });
  expect(roadmapUse(old3).whole).toBe(false);
  expect(roadmapReads([old, old2, old3, small, small2, review])).toEqual({
    before: { sessions: 3, whole: 2 },
    after: { sessions: 2, whole: 1 },
  });
});

test("a why of several lines is kept whole", () => {
  const roadmap = "# R\n\n## Phase 0: P\n\n### A1 T\n- why: first line\n  second line\n- done when:\n  - d\n- locks: x\n- after: none\n";
  const s = parseRoadmap(roadmap).steps[0]!;
  expect(stepBrief(s, settings, "r/m", "w/m")).toContain("first line\n  second line");
});

test("a step with a files line lists those files in its brief, one without keeps working", () => {
  const withFiles = ROADMAP.replace("- locks: x\n- after: A2", "- locks: x\n- after: A2\n- files: src/only-declared.ts, `src/`");
  const parsed = parseRoadmap(withFiles);
  expect(parsed.errors).toEqual([]);
  const repo = repoWith("# Rules\n");
  writeFileSync(join(repo, "src", "only-declared.ts"), "");
  const a3 = parsed.steps.find((s) => s.id === "A3")!;
  const brief = stepBrief(a3, settings, "r/model", "w/model", { repo, roadmap: withFiles });
  expect(brief).toContain("- src/only-declared.ts");
  expect(brief).toContain("- src\n");
  const plain = parseRoadmap(ROADMAP);
  expect(plain.errors).toEqual([]);
  expect(plain.steps[0]!.fields.files).toBeUndefined();
});

test("roadmap show prints the files line", () => {
  const repo = tmp("files-show");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs", "ROADMAP.md"), ROADMAP.replace("- after: A2", "- after: A2\n- files: src/x.ts"));
  const lines: string[] = [];
  expect(roadmapMain(["show", "A3", repo], (l) => lines.push(l))).toBe(0);
  expect(lines.join("\n")).toContain("- files: src/x.ts");
});

test("the brief gives the step check's words and asks for a note where the step lacked something", () => {
  const brief = stepBrief(stepOf("A1"), settings, "r/model", "w/model");
  expect(brief).toContain(READER_ASK);
  expect(brief).toContain("note where the step still lacked something");
});

test("a docs-only step is told it needs no review and a code step is told its review", () => {
  const docs = parseRoadmap(`# R\n\n## Phase 0: P\n\n${step("D1", "none")}`.replace("- locks: x", "- files: docs/idea.md, docs/ROADMAP.md\n- locks: x"))
    .steps[0]!;
  const code = parseRoadmap(`# R\n\n## Phase 0: P\n\n${step("C1", "none")}`.replace("- locks: x", "- files: docs/idea.md, src/brief.ts\n- locks: x")).steps[0]!;
  const docsBrief = stepBrief(docs, settings, "r/model", "w/model");
  const codeBrief = stepBrief(code, settings, "r/model", "w/model");
  expect(docsBrief).toContain("No review while your change touches only files under docs/");
  expect(docsBrief).not.toContain("have the change reviewed by fresh eyes");
  expect(codeBrief).toContain("have the change reviewed by fresh eyes using the model r/model");
  expect(codeBrief).toContain("unless your change touches only files under docs/");
  expect(codeBrief).toContain('LINECLEAR_CHAT="C1/Reviewer"');
  expect(codeBrief).not.toContain("{{");
});
