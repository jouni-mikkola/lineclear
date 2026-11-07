import { expect, test } from "bun:test";
import { parseRoadmap, type Step } from "../src/roadmap.ts";
import { INPUT_MAX_TOKENS } from "../src/ask-model.ts";
import { checkDiffScales, pickChecker, readAnswer, scalesOf, stepQuestion, tokensOf } from "../src/stepcheck.ts";
import { company } from "../src/company.ts";

const step = parseRoadmap("## P\n\n### A Title\n- why: because\n- done when:\n  - it works\n- locks: none\n- after: none\n- files: src/a.ts\n")
  .steps[0] as Step;

test("the company comes from the model's name, not the provider that routes to it", () => {
  expect(company("claude-bridge-b/claude-sonnet-5-5")).toBe("anthropic");
  expect(company("anthropic/claude-opus-5-5")).toBe("anthropic");
  expect(company("opencode-go/glm-5.3")).toBe("zhipu");
  expect(company("openai/gpt-5")).toBe("openai");
  expect(company("acme/thing-1")).toBe("acme");
});

test("the checker is the first reviewer with room from another company, else a fresh model of the planner's own", () => {
  const planner = "claude-bridge/claude-opus-5-5";
  expect(pickChecker(planner, ["claude-bridge-b/claude-sonnet-5-5", "openai-codex/gpt-6.1-sol"])).toBe("openai-codex/gpt-6.1-sol");
  expect(pickChecker(planner, ["claude-bridge-b/claude-sonnet-5-5", "openai-codex/gpt-6.1-sol"], (m) => !m.startsWith("openai"))).toBe(
    "claude-bridge-b/claude-sonnet-5-5",
  );
  expect(pickChecker(planner, ["claude-bridge/claude-haiku-5-5", "claude-bridge-b/claude-sonnet-5-5"], () => true)).toBe("claude-bridge-b/claude-sonnet-5-5");
  expect(pickChecker(planner, ["claude-bridge/claude-haiku-5-5"])).toBe("claude-bridge/claude-haiku-5-5");
  expect(pickChecker(undefined, ["opencode-go/glm-5.3"])).toBe("opencode-go/glm-5.3");
  expect(pickChecker(undefined, [])).toBeUndefined();
});

test("the question stays under the input size however big the map is", () => {
  const files = Array.from({ length: 20000 }, (_, i) => `src/file-${i}.ts`);
  const q = stepQuestion(step, "rules ".repeat(50000), files, scalesOf("."));
  expect(tokensOf(q)).toBeLessThanOrEqual(INPUT_MAX_TOKENS);
  expect(q).toContain("### A Title");
});

const SCALES_LINES = [
  "N machines and N projects",
  "any model and any harness",
  "10x the data",
  "no global or whole-part lock",
  "no polling or spawning per tick",
  "no fallback for a state that no longer exists",
];

test("every step question carries all six Scales lines", () => {
  const q = stepQuestion(step, "rules", ["src/a.ts"], scalesOf("."));
  for (const line of SCALES_LINES) expect(q.toLowerCase()).toContain(line.toLowerCase());
});

test("a Scales finding in the answer is a no-go that names the line it broke", () => {
  const a = readAnswer("SAID: it adds a lock.\nSCALES: No global or whole-part lock: one lock for all projects.\nGO");
  expect(a.go).toBe(false);
  expect(a.missing).toBe("Scales: No global or whole-part lock: one lock for all projects.");
});

test("the merge check refuses a diff with a whole-part lock, with the Scales reason", () => {
  const diff = "+const lock = flock('/tmp/all-projects.lock'); // one lock for every project\n";
  const env = { ...process.env, LINECLEAR_STEPCHECK: "echo 'SCALES: No global or whole-part lock where a finer one works: flock over every project.'" };
  expect(checkDiffScales(".", diff, "m", env)).toEqual({ refused: expect.stringContaining("Scales: No global or whole-part lock") });
  expect(checkDiffScales(".", diff, "m", { ...process.env, LINECLEAR_STEPCHECK: "echo GO" })).toBeUndefined();
  expect(checkDiffScales(".", diff, "m", { ...process.env, LINECLEAR_STEPCHECK: "echo maybe" })).toEqual({
    refused: expect.stringContaining("no GO or NO-GO"),
  });
  // the model sees the Scales lines and the diff, in every part of a long diff
  const seen = "q=$(cat); echo \"$q\" | grep -q 'whole-part lock' && echo \"$q\" | grep -q 'flock' && echo GO || echo 'NO-GO: blind'";
  expect(checkDiffScales(".", diff, "m", { ...process.env, LINECLEAR_STEPCHECK: seen })).toBeUndefined();
  const long = `${"+x\n".repeat(20000)}${diff}`;
  expect(checkDiffScales(".", long, "m", { ...process.env, LINECLEAR_STEPCHECK: "grep -q flock && echo 'SCALES: lock: found' || echo GO" })).toEqual({
    refused: expect.stringContaining("Scales: lock"),
  });
  expect(checkDiffScales(".", diff, "m", { ...process.env, LINECLEAR_STEPCHECK: "exit 1" })).toHaveProperty("unavailable");
});
