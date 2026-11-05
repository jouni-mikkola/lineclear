import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { harnesses, readRegistry } from "../src/models.ts";
import { readSetup, setupGate } from "../src/project.ts";
import { saveOffered, setupMain, setupView } from "../src/setup.ts";

function fake(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "setup-")), "fake");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const registry = () =>
  readRegistry(
    harnesses({ PI_BIN: fake(`printf 'provider model\\nanthropic opus-x\\nopenai-codex gpt-y\\n'`), OPENCODE_BIN: fake(`echo opencode-go/kimi-z`) }),
  );
const configEnv = () => ({ ...process.env, LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "setup-cfg-")) });
const flags = ["--worker", "anthropic/opus-x", "--reviewer", "openai-codex/gpt-y", "--planner", "anthropic/opus-x", "--step-checker", "opencode-go/kimi-z"];

test("two fake harnesses: a choice is saved and read back", async () => {
  const env = configEnv();
  const lines: string[] = [];
  expect(await setupMain(flags, (l) => lines.push(l), null, env, registry())).toBe(0);
  expect(lines.join("\n")).toContain("opencode: opencode-go (1 models)");
  expect(readSetup(env)).toEqual({
    worker: "anthropic/opus-x",
    reviewer: "openai-codex/gpt-y",
    planner: "anthropic/opus-x",
    stepChecker: "opencode-go/kimi-z",
  });
  expect(setupGate(env)).toBeUndefined();
});

test("a reviewer of the worker's company is refused and nothing is saved", async () => {
  const env = configEnv();
  const lines: string[] = [];
  const same = [...flags];
  same[3] = "anthropic/opus-x";
  expect(await setupMain(same, (l) => lines.push(l), null, env, registry())).toBe(1);
  expect(lines.join("\n")).toContain("worker's company");
  expect(readSetup(env)).toEqual({});
});

test("until roles are chosen, run and project add stop with a line pointing to setup", async () => {
  const saved = process.env.LINECLEAR_CONFIG;
  process.env.LINECLEAR_CONFIG = mkdtempSync(join(tmpdir(), "setup-cfg-"));
  try {
    for (const [args, name] of [
      [["run", "--once"], "run"],
      [["project", "add", "/tmp"], "add"],
    ] as const) {
      const lines: string[] = [];
      expect(await main([...args], (l) => lines.push(l), null)).toBe(1);
      expect(lines[0]).toContain(`lineclear ${name}: no model chosen`);
      expect(lines[0]).toContain("lineclear setup");
    }
  } finally {
    if (saved === undefined) delete process.env.LINECLEAR_CONFIG;
    else process.env.LINECLEAR_CONFIG = saved;
  }
});

test("the web view lists harnesses and accounts, and saves through the same check", () => {
  const env = configEnv();
  const view = setupView(registry(), env);
  expect(view.harnesses.map((h) => h.name)).toEqual(["pi", "opencode"]);
  expect(view.harnesses[0]?.accounts).toEqual([
    { account: "anthropic", models: ["anthropic/opus-x"] },
    { account: "openai-codex", models: ["openai-codex/gpt-y"] },
  ]);
  expect(view.chosen).toEqual({});
  expect(saveOffered({ worker: "nobody/none" }, registry(), env)).toContain("no logged-in harness offers");
  expect(saveOffered({ worker: "anthropic/opus-x", reviewer: "anthropic/opus-x" }, registry(), env)).toContain("worker's company");
  expect(saveOffered({ worker: "anthropic/opus-x" }, registry(), env)).toBeUndefined();
  expect(setupView(registry(), env).chosen).toEqual({ worker: "anthropic/opus-x" });
});
