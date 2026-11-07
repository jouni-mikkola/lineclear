import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDir } from "../pi/config.ts";
import { main } from "../src/cli.ts";
import { harnesses, readRegistry } from "../src/models.ts";
import { changeSettings } from "../src/project-change.ts";
import { projectsDir, readSettings, readSetup, saveSetup, type Settings, setupGate } from "../src/project.ts";
import { saveOffered, setupMain, setupView } from "../src/setup.ts";

function fake(body: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "setup-")), "fake");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const registry = () => readRegistry(harnesses({ PI_BIN: fake(`printf 'provider model\\nanthropic opus-x\\nopenai-codex gpt-y\\n'`) }));
const configEnv = () => ({ ...process.env, LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "setup-cfg-")) });
const flags = ["--worker", "anthropic/opus-x", "--reviewer", "openai-codex/gpt-y", "--step-checker", "openai-codex/gpt-y"];

test("a fake harness: a choice is saved and read back", async () => {
  const env = configEnv();
  const lines: string[] = [];
  expect(await setupMain(flags, (l) => lines.push(l), null, env, registry())).toBe(0);
  expect(lines.join("\n")).toContain("pi: ");
  expect(readSetup(env)).toEqual({
    worker: "anthropic/opus-x",
    reviewer: "openai-codex/gpt-y",
    stepChecker: "openai-codex/gpt-y",
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
  expect(view.harnesses.map((h) => h.name)).toEqual(["pi"]);
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

test("a role model set in Settings is the next task's model, and setup.json is imported once", () => {
  const env = { ...process.env, LINECLEAR_CONFIG: mkdtempSync(join(tmpdir(), "lc-store-")) };
  writeFileSync(join(env.LINECLEAR_CONFIG, "setup.json"), JSON.stringify({ worker: "a/old", reviewer: "b/r", stepChecker: "b/r" }));
  expect(readSetup(env).worker).toBe("a/old");
  mkdirSync(join(projectsDir(env), "p"), { recursive: true });
  writeFileSync(join(projectsDir(env), "p", "settings.json"), JSON.stringify({ repo: "/r", space: "p", check: "true", models: { worker: [], reviewer: [] } }));
  expect((readSettings("p", env) as Settings).models.worker).toEqual(["a/old"]);
  expect(saveSetup({ worker: "a/new" }, (m) => m.split("/")[0]!, env)).toBeUndefined();
  expect((readSettings("p", env) as Settings).models.worker).toEqual(["a/new"]);
  changeSettings("p", { check: "true2" }, env);
  expect(JSON.parse(readFileSync(join(projectsDir(env), "p", "settings.json"), "utf8")).models.worker).toEqual([]);
});

describe("the machine settings file", () => {
  const file = (env: Record<string, string>) => join(configDir(env), "settings.json");

  test("a truncated settings.json stops with a message naming the file and stays unchanged", () => {
    const env = configEnv();
    mkdirSync(configDir(env), { recursive: true });
    writeFileSync(file(env), '{"setup": {"worker": "a/x"');
    expect(() => readSetup(env)).toThrow(file(env));
    expect(() => saveSetup({ reviewer: "b/y" }, (m) => m.split("/")[0]!, env)).toThrow(file(env));
    expect(readFileSync(file(env), "utf8")).toBe('{"setup": {"worker": "a/x"');
    expect(setupGate(env)).toContain(file(env));
  });

  test("a settings.json of any version is imported into the table once and left in place", () => {
    const env = configEnv();
    mkdirSync(configDir(env), { recursive: true });
    writeFileSync(file(env), JSON.stringify({ setup: { worker: "a/x", reviewer: "b/y", stepChecker: "b/s" } }));
    expect(readSetup(env)).toEqual({ worker: "a/x", reviewer: "b/y", stepChecker: "b/s" });
    expect(existsSync(file(env))).toBe(true);
    writeFileSync(file(env), JSON.stringify({ setup: { worker: "a/changed" } }));
    expect(readSetup(env).worker).toBe("a/x");
  });
});

test("readSettings returns the message of a bad machine settings file instead of throwing", () => {
  const env = configEnv();
  mkdirSync(join(projectsDir(env), "p"), { recursive: true });
  writeFileSync(join(projectsDir(env), "p", "settings.json"), JSON.stringify({ repo: "/r", space: "s", check: "c", models: {} }));
  writeFileSync(join(configDir(env), "settings.json"), "{ bad");
  expect(readSettings("p", env)).toContain(join(configDir(env), "settings.json"));
});
