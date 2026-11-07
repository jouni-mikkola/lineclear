import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/git.ts";
import { briefModel, readFindings, review, reviewPath } from "../src/review-call.ts";

function repoWithChange(): string {
  const repo = mkdtempSync(join(tmpdir(), "review-repo-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "AGENTS.md"), "RULE: short names\n");
  writeFileSync(join(repo, "a.ts"), `${Array.from({ length: 60 }, (_, n) => `line ${n}`).join("\n")}\n`);
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  git(repo, "checkout", "-qb", "work");
  writeFileSync(join(repo, "a.ts"), readFileSync(join(repo, "a.ts"), "utf8").replace("line 30", "changed 30"));
  return repo;
}

test("a review is one tool-less call with the brief, the diff with 8 lines of context and the rules, and stores the findings", () => {
  const repo = repoWithChange();
  const home = mkdtempSync(join(tmpdir(), "review-home-"));
  const pi = join(home, "pi");
  writeFileSync(
    pi,
    `#!/bin/sh\necho "$@" > "${home}/call"\necho 'FINDING major | a.ts | 30 | the line is wrong'\necho 'chatter'\necho 'FINDING trivial | a.ts | 31 | style'\n`,
  );
  chmodSync(pi, 0o755);
  const env = { ...process.env, LINECLEAR_HOME: home, PI_BIN: pi, PI_CODING_AGENT_DIR: join(home, "agent") };
  writeFileSync(join(repo, "new.ts"), "brand new file\n");
  const r = review({ task: "T-1", repo, base: "main", brief: "BRIEF TEXT\n## The owner's direction\nLONG DIRECTION", reviewer: "x/y", worker: "z/w" }, env);
  expect(r.ok).toBe(true);
  const call = readFileSync(join(home, "call"), "utf8");
  expect(call).toContain("--no-tools");
  expect(call).toContain("BRIEF TEXT");
  expect(call).not.toContain("LONG DIRECTION");
  expect(call).toContain("RULE: short names");
  expect(call).toContain("+brand new file");
  expect(call).toContain("+changed 30");
  expect(call).toContain(" line 22\n"); // 8 lines before the change
  expect(call).not.toContain("\n line 21\n");
  const stored = JSON.parse(readFileSync(reviewPath("T-1", env), "utf8"));
  expect(stored.findings).toEqual([
    { severity: "major", file: "a.ts", line: 30, why: "the line is wrong" },
    { severity: "trivial", file: "a.ts", line: 31, why: "style" },
  ]);
});

test("findings are read from tagged lines and the reviewer's model from the brief", () => {
  expect(readFindings("FINDING Critical | b.ts | 2 | breaks\nnoise")).toEqual([{ severity: "critical", file: "b.ts", line: 2, why: "breaks" }]);
  expect(briefModel("- Reviewer: a headless pi (model claude-bridge/claude-opus-5-5, its default effort).\n- Agent: pi (model a/b, x).", "Agent")).toBe("a/b");
});
