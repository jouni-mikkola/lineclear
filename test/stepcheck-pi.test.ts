import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askModel } from "../src/ask-model.ts";
import { checkSteps } from "../src/stepcheck.ts";

/** A fake pi that logs its arguments and answers by the given shell body. */
function fakePi(dir: string, body: string): string {
  const bin = join(dir, "pi");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${dir}/calls"\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const calls = (dir: string) => readFileSync(join(dir, "calls"), "utf8").trim().split("\n");

test("the model call runs pi without tools and without a session", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-"));
  const run = askModel("Q?", "m/x", undefined, "V", { ...process.env, PI_BIN: fakePi(dir, "echo GO") });
  expect(run.stdout.toString().trim()).toBe("GO");
  expect(calls(dir)).toEqual(["-p --no-tools --no-session --no-extensions --no-context-files --no-skills --model m/x Q?"]);
});

test("an answer without a verdict is asked again of the next model and is no no-go round", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-"));
  const bin = fakePi(dir, `case "$*" in *openai*) echo "Done; no files changed." ;; *) printf 'SAID: x\\nGO\\n' ;; esac`);
  const config = join(dir, "config");
  const after = "## P\n\n### A Title\n- why: because\n- done when:\n  - it works\n- locks: none\n- after: none\n- files: src/a.ts\n";
  const verdict = checkSteps({
    task: "T-1",
    root: dir,
    before: "## P\n\n",
    after,
    planner: "claude-bridge/claude-opus-5-5",
    reviewers: ["openai-codex/gpt-6.1-sol", "claude-bridge-b/claude-sonnet-5-5"],
    env: { ...process.env, PI_BIN: bin, LINECLEAR_CONFIG: config },
  });
  expect(verdict.kind).toBe("go");
  expect(calls(dir).filter((l) => l.startsWith("-p --no-tools --no-session --no-extensions --no-context-files --no-skills --model "))).toHaveLength(2);
  expect(JSON.parse(readFileSync(join(config, "plan-checks", "T-1.json"), "utf8")).rounds).toBe(0);
});
