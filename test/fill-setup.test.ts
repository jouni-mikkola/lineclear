import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fillSetup } from "../src/fill-setup.ts";
import { readSetup, setupGate } from "../src/project.ts";
import { tmp } from "./helpers.ts";

const dir = tmp("fill-setup");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const envOf = (name: string) => ({ ...process.env, LINECLEAR_CONFIG: join(dir, name) });

function addProject(env: Record<string, string | undefined>, name: string, models: object) {
  const folder = join(env.LINECLEAR_CONFIG!, "projects", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ name, repo: "/r", space: "s", check: "x", models }));
}

test("an install with no setup.json gets it from the models its projects name, so the gate lets it run", () => {
  const env = envOf("old");
  addProject(env, "a", { worker: ["anthropic/opus-x", "anthropic/b"], reviewer: ["openai/gpt-y"] });
  expect(setupGate(env)).toContain("no model chosen");
  fillSetup(env);
  expect(readSetup(env)).toEqual({ worker: "anthropic/opus-x", reviewer: "openai/gpt-y", stepChecker: "openai/gpt-y" });
  expect(setupGate(env)).toBeUndefined();
});

test("a choice already made is kept, and a machine with no project is left as it is", () => {
  const env = envOf("kept");
  addProject(env, "a", { worker: ["x/w"], reviewer: ["y/r"] });
  mkdirSync(env.LINECLEAR_CONFIG!, { recursive: true });
  writeFileSync(join(env.LINECLEAR_CONFIG!, "setup.json"), JSON.stringify({ worker: "mine/m" }));
  fillSetup(env);
  expect(readSetup(env).worker).toBe("mine/m");
  expect(readSetup(env).reviewer).toBe("y/r");
  const bare = envOf("bare");
  fillSetup(bare);
  expect(readSetup(bare)).toEqual({});
});
