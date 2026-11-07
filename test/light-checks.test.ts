import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const workflows = readdirSync(join(root, ".github", "workflows")).filter((f) => f.endsWith(".yml"));

/** The `timeout-minutes` of every job of a workflow file. */
const timeouts = (text: string) => [...text.matchAll(/^ {4}timeout-minutes: (\d+)$/gm)].map((m) => Number(m[1]));

test("every job of the check workflow takes 5 minutes at most, and has a limit", () => {
  const text = read(".github", "workflows", "check.yml");
  const limits = timeouts(text);
  expect(limits.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...limits)).toBeLessThanOrEqual(5);
});

test("no workflow runs a browser, a coverage run or a UI suite, and none runs over 10 minutes", () => {
  for (const f of workflows) {
    const text = read(".github", "workflows", f);
    if (f !== "install.yml") {
      expect(text, f).not.toMatch(/playwright|chromium|ui:test|run coverage/);
      expect(Math.max(0, ...timeouts(text)), f).toBeLessThanOrEqual(10);
    }
  }
});

test("no code path runs the full check or a browser suite on a machine of the owner's", () => {
  const code = ["scripts/release-tag.ts"];
  for (const f of code) expect(read(f), f).not.toMatch(/check\.ts["', ]+--full|runFullCheck|playwright test|ui:test/);
});

test("a lane label runs the 8 full shards on a pull request, and the changed job otherwise", () => {
  const text = read(".github", "workflows", "check.yml");
  expect(text).toMatch(/pull_request:\n {4}types: \[[^\]]*synchronize[^\]]*labeled[^\]]*\]/);
  expect(text).toMatch(/changed:[\s\S]*?if: .*!contains\(github\.event\.pull_request\.labels\.\*\.name, 'lane'\)/);
  expect(text).toMatch(/pull_request' && contains\(github\.event\.pull_request\.labels\.\*\.name, 'lane'\)/);
  expect(text).toContain("shard: [1, 2, 3, 4, 5, 6, 7, 8]");
});

test("a push to main whose tree a green lane run checked runs one job of 10 s or less, else the full check", () => {
  const text = read(".github", "workflows", "check.yml");
  expect(text).toMatch(/reuse:[\s\S]*?if: github\.event_name == 'push'[\s\S]*?timeout-minutes: 1\n/);
  expect(text).toContain("needs.reuse.outputs.reused != 'true'");
  expect(text).toContain("needs: [changed, reuse, full]");
});

test("the product conventions say checks are light and run on GitHub", () => {
  expect(read("AGENTS.md")).toContain("Checks are light and run on GitHub");
});
