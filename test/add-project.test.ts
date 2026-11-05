import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { detectProject, FIRST_ROADMAP, findRepos, pickModels, saveProject } from "../src/add-project.ts";
import { companyOfModel, type ModelFile, modelFile } from "../src/models.ts";
import { detectCheck } from "../src/project.ts";
import { pickReviewer } from "../src/stalls.ts";
import { tmp } from "./helpers.ts";

const root = tmp("add-project");
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A git repo folder with these files. */
function repo(path: string, files: Record<string, string> = {}): string {
  mkdirSync(join(path, ".git"), { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, f)), { recursive: true });
    writeFileSync(join(path, f), text);
  }
  return path;
}

/** A board command that knows the spaces in `spaces.txt`, adds one, and starts a task as `Added NEW-1`. */
function board(dir: string): string {
  const bin = join(dir, "shepherdr");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    bin,
    `#!/bin/sh
echo "$*" >> "${dir}/calls.log"
case "$1 $2" in
  "space list") cat "${dir}/spaces.txt" 2>/dev/null ;;
  "space add") echo "$5  $3" >> "${dir}/spaces.txt" ;;
  "task add") echo "Added NEW-1" ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

test("the best models pi offers come first, the second from another company, a lesser one last", () => {
  const offered = [
    "opencode-go/glm-5.3-flash",
    "opencode-go/kimi-k3",
    "opencode-go/gpt-6-luna",
    "anthropic/claude-haiku-5-5",
    "anthropic/claude-opus-5-5",
    "anthropic/claude-opus-4-1",
  ];
  expect(pickModels(offered)).toEqual(["anthropic/claude-opus-5-5", "opencode-go/gpt-6-luna", "anthropic/claude-opus-4-1"]);
  expect(pickModels(["openrouter/qwen/qwen3-coder", "google/gemini-2.5-flash-lite", "google/gemini-3-pro"])[0]).toBe("google/gemini-3-pro");
  expect(pickModels(["x/only-free"])).toEqual(["x/only-free"]);
  expect(pickModels([])).toEqual([]);
});

// A registry fixture: the shipped facts plus a user file that adds a new family from a new provider.
const withNewcomer = (): ModelFile => {
  const dir = tmp("registry");
  writeFileSync(join(dir, "models.json"), JSON.stringify({ families: { zorblax: { company: "zorb", tier: "top" } } }));
  return modelFile(dir);
};

test("a model of a new family and provider ranks by its tier, and a reviewer of another company is picked", () => {
  const offered = ["newco/zorblax-9", "anthropic/claude-sonnet-5-5", "opencode-go/kimi-k3", "newco/zorblax-9-mini"];
  const [best, other] = pickModels(offered, withNewcomer());
  expect(best).toBe("newco/zorblax-9");
  expect(other).toBe("anthropic/claude-sonnet-5-5");
  expect(pickModels(["newco/zorblax-9", "newco/zorblax-8"], withNewcomer())).toEqual(["newco/zorblax-9", "newco/zorblax-8"]);
  expect(companyOfModel("newco/zorblax-9", withNewcomer())).toBe("zorb");
  expect(pickModels(offered)[0]).toBe("anthropic/claude-sonnet-5-5");
  expect(pickModels(["zz/unknown-1", "opencode-go/kimi-k3", "openai/gpt-5", "anthropic/claude-sonnet-5-5"])).toEqual([
    "openai/gpt-5",
    "anthropic/claude-sonnet-5-5",
    "opencode-go/kimi-k3",
  ]);
  expect(pickReviewer("newco/zorblax-9", ["newco/zorblax-8", "anthropic/claude-sonnet-5-5"], undefined)).toBe("anthropic/claude-sonnet-5-5");
});

test("the check is the repo's check, else its own tests", () => {
  const at = (n: string, files: Record<string, string>) => detectCheck(repo(join(root, "checks", n), files));
  expect(at("check", { "package.json": JSON.stringify({ scripts: { check: "x", test: "y" } }) })).toBe("npm run check");
  expect(at("npm-test", { "package.json": JSON.stringify({ scripts: { test: "mocha" } }) })).toBe("npm run test");
  expect(at("bun-test", { "package.json": JSON.stringify({ scripts: { test: "x" } }), "bun.lockb": "" })).toBe("bun run test");
  expect(at("placeholder", { "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })).toBeUndefined();
  expect(at("make", { Makefile: "test:\n\ttrue\n" })).toBe("make test");
  expect(at("rust", { "Cargo.toml": "" })).toBe("cargo test");
  expect(at("go", { "go.mod": "" })).toBe("go test ./...");
  expect(at("python", { "pyproject.toml": "" })).toBe("python3 -m pytest");
  expect(at("none", { "README.md": "" })).toBeUndefined();
});

test("Home offers the git repos of the usual folders that are no project yet, newest first", () => {
  const home = join(root, "home");
  const old = repo(join(home, "code", "old"));
  repo(join(home, "src", "group", "deep"));
  repo(join(home, "code", "new"));
  mkdirSync(join(home, "code", "not-a-repo"), { recursive: true });
  utimesSync(join(old, ".git"), new Date(2000, 1, 1), new Date(2000, 1, 1));
  const found = findRepos({ HOME: home, LINECLEAR_CONFIG: join(root, "repos-config") });
  expect(found.map((r) => r.name).sort()).toEqual(["deep", "new", "old"]);
  expect(found.at(-1)?.repo).toBe(old);
});

test("a folder that is not a git repo is refused in plain words", () => {
  mkdirSync(join(root, "plain"), { recursive: true });
  expect(detectProject(join(root, "plain"), {})).toEqual({
    error: `${join(root, "plain")} is not a git repo. Lineclear works on git repos: pick the folder that holds .git.`,
  });
});

test("Start makes the space, saves the project, sets up the Dispatcher and has a repo without a roadmap get its first one", async () => {
  const dir = join(root, "start");
  const bin = board(join(dir, "board"));
  const r = repo(join(dir, "shop"), { "package.json": JSON.stringify({ scripts: { test: "mocha" } }) });
  const env = { HOME: dir, LINECLEAR_CONFIG: join(dir, "config"), LINECLEAR_HOME: join(dir, "data"), SHEPHERDR_BIN: bin, PI_BIN: "/nowhere/pi" };
  expect(detectProject(r, env)).toMatchObject({ name: "shop", check: "npm run test", roadmap: false, models: [] });
  expect(await saveProject({ repo: r, check: "npm run test", models: [] }, env)).toMatchObject({ status: 400, error: expect.stringContaining("/login") });
  expect(await saveProject({ repo: r, check: "", models: ["a/b"] }, env)).toMatchObject({ status: 400, error: expect.stringContaining("no tests") });
  expect(await saveProject({ repo: r, check: "npm run test", models: ["a/b"] }, env)).toEqual({ name: "shop", planning: true });
  const calls = readFileSync(join(dir, "board", "calls.log"), "utf8");
  expect(calls).toContain(`space add ${r} --name shop`);
  expect(calls).toContain(`space add ${join(dir, "config", "dispatcher")} --name dispatcher`);
  expect(calls).toContain("task add Plan: A first roadmap --brief");
  expect(JSON.parse(readFileSync(join(dir, "config", "projects", "shop", "settings.json"), "utf8"))).toMatchObject({ space: "shop", check: "npm run test" });
  expect(FIRST_ROADMAP).toContain("at most 8");
});

test("a repo with a roadmap starts with no planning task", async () => {
  const dir = join(root, "planned");
  const bin = board(join(dir, "board"));
  const r = repo(join(dir, "app"), { "docs/ROADMAP.md": "# Roadmap\n" });
  writeFileSync(join(dir, "board", "spaces.txt"), `app-space  ${r}\n`);
  const env = { HOME: dir, LINECLEAR_CONFIG: join(dir, "config"), LINECLEAR_HOME: join(dir, "data"), SHEPHERDR_BIN: bin };
  expect(await saveProject({ repo: r, check: "make test", models: ["a/b"] }, env)).toEqual({ name: "app" });
  expect(readFileSync(join(dir, "board", "calls.log"), "utf8")).not.toContain("task add");
});
