import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/git.ts";
import { briefModel, readFindings, review, reviewMain, reviewPath } from "../src/review-call.ts";

function repoWithChange(): string {
  const repo = mkdtempSync(join(tmpdir(), "review-repo-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "AGENTS.md"), "RULE: short names\n");
  writeFileSync(join(repo, "a.ts"), `${Array.from({ length: 60 }, (_, n) => `line ${n}`).join("\n")}\n`);
  writeFileSync(join(repo, "x.test.ts"), "test(1)\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  git(repo, "checkout", "-qb", "work");
  writeFileSync(join(repo, "a.ts"), readFileSync(join(repo, "a.ts"), "utf8").replace("line 30", "changed 30"));
  rmSync(join(repo, "x.test.ts")); // a deleted test makes the full form
  return repo;
}

function fakePi(home: string): NodeJS.ProcessEnv {
  const pi = join(home, "pi");
  writeFileSync(pi, "#!/bin/sh\necho 'FINDING minor | a.ts | 1 | x'\n");
  chmodSync(pi, 0o755);
  return { ...process.env, LINECLEAR_HOME: home, PI_BIN: pi, PI_CODING_AGENT_DIR: join(home, "agent") };
}

function repoWithBigRules(changed: number): string {
  const repo = mkdtempSync(join(tmpdir(), "review-size-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "AGENTS.md"), `${"rule ".repeat(40_000)}\n`);
  writeFileSync(join(repo, "a.ts"), "base\n");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  git(repo, "checkout", "-qb", "work");
  writeFileSync(join(repo, "a.ts"), `${Array.from({ length: changed }, (_, n) => `const value${n} = ${n};`).join("\n")}\n`);
  return repo;
}

test("a small diff gets the light form in 15 k tokens or less, a 300-line one the full form in 50 k or less", () => {
  const home = mkdtempSync(join(tmpdir(), "review-home-"));
  const env = fakePi(home);
  const small = review({ task: "T-2", repo: repoWithBigRules(20), base: "main", brief: "B", reviewer: "x/y" }, env);
  const big = review({ task: "T-3", repo: repoWithBigRules(300), base: "main", brief: "B", reviewer: "x/y" }, env);
  if (!small.ok || !big.ok) throw new Error("review failed");
  expect(small.form).toBe("light");
  expect(small.inputTokens).toBeLessThanOrEqual(15_000);
  expect(big.form).toBe("full");
  expect(big.inputTokens).toBeLessThanOrEqual(50_000);
});

test("--json prints the findings and the input size", () => {
  const home = mkdtempSync(join(tmpdir(), "review-home-"));
  const env = fakePi(home);
  const bin = join(home, "server-bin");
  writeFileSync(bin, `#!/bin/sh\necho '{"desc":"B","base":"main"}'\n`);
  chmodSync(bin, 0o755);
  const cwd = process.cwd();
  process.chdir(repoWithBigRules(5));
  const lines: string[] = [];
  try {
    expect(reviewMain(["T-4", "--json"], (l) => lines.push(l), { ...env, LINECLEAR_SERVER_BIN: bin })).toBe(0);
  } finally {
    process.chdir(cwd);
  }
  const printed = JSON.parse(lines.join(""));
  expect(printed.findings).toHaveLength(1);
  expect(printed.inputTokens).toBeGreaterThan(0);
});

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
  const r = review(
    { task: "T-1", repo, base: "main", brief: "BRIEF TEXT\nThis step was checked by a fresh model\nWORKER PROCEDURE", reviewer: "x/y", worker: "z/w" },
    env,
  );
  expect(r.ok).toBe(true);
  const call = readFileSync(join(home, "call"), "utf8");
  expect(call).toContain("--no-tools");
  expect(call).toContain("BRIEF TEXT");
  expect(call).not.toContain("WORKER PROCEDURE");
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
