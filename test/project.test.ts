import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let env: Record<string, string | undefined>;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lineclear-project-"));
  repo = join(root, "myrepo");
  mkdirSync(repo);
  mkdirSync(join(root, "home"));
  const store = new Database(join(root, "home", "store.sqlite"), { create: true });
  store.exec("create table spaces (position integer primary key, data text not null)");
  store
    .query("insert into spaces (position, data) values (0, ?), (1, ?)")
    .run(JSON.stringify({ name: "home", path: "/root" }), JSON.stringify({ name: "myspace", path: repo }));
  store.close();
  env = {
    ...process.env,
    LINECLEAR_CONFIG: join(root, "config"),
    LINECLEAR_MAIN_HOME: join(root, "data"),
    LINECLEAR_PORT: "0",
    LINECLEAR_WEB_PORT: "0",
    LINECLEAR_HOME: join(root, "home"),
  };
});
beforeEach(() => chooseModels(join(root, "config")));
afterEach(() => rmSync(root, { recursive: true, force: true }));

import { chooseModels, keepSecret, runCli } from "./helpers.ts";

const models = ["--worker", "a/x,a/y", "--reviewer", "b/z"];
const settingsFile = (name = "myrepo") => join(root, "config", "projects", name, "settings.json");

const run = (args: string[], ask: ((q: string) => Promise<string>) | null = null) => runCli(env, args, ask);

test("add detects the space and a package.json check script", async () => {
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { check: "true" } }));
  writeFileSync(join(repo, "bun.lock"), "");
  const r = await run(["project", "add", repo, ...models]);
  expect(r.code).toBe(0);
  expect(JSON.parse(readFileSync(settingsFile(), "utf8"))).toEqual({
    repo,
    space: "myspace",
    check: "bun run check",
    heavy: ["bun run check"],
    askBefore: { plans: false, releases: true, spending: true },
    models: { worker: ["a/x", "a/y"], reviewer: ["b/z"] },
  });
});

test("add detects a Makefile check target", async () => {
  writeFileSync(join(repo, "Makefile"), "build:\n\ttrue\ncheck:\n\ttrue\n");
  expect((await run(["project", "add", repo, ...models])).code).toBe(0);
  expect(JSON.parse(readFileSync(settingsFile(), "utf8")).check).toBe("make check");
});

test("add keeps the optional health command and lets options beat detection", async () => {
  writeFileSync(join(repo, "Makefile"), "check:\n\ttrue\n");
  const r = await run(["project", "add", repo, "--name", "other", "--space", "s2", "--check", "echo hi", "--health", "curl x", ...models]);
  expect(r.code).toBe(0);
  const s = JSON.parse(readFileSync(settingsFile("other"), "utf8"));
  expect(s).toMatchObject({ space: "s2", check: "echo hi", health: "curl x" });
});

test("add writes every field of the settings file: repo, space, check, health and a model list per role", async () => {
  writeFileSync(join(repo, "Makefile"), "check:\n\ttrue\n");
  expect((await run(["project", "add", repo, "--health", "curl x", ...models])).code).toBe(0);
  const s = JSON.parse(readFileSync(settingsFile(), "utf8"));
  expect(s.repo).toBe(repo);
  expect(s.space).toBe("myspace");
  expect(s.check).toBe("make check");
  expect(s.health).toBe("curl x");
  expect(s.models).toEqual({ worker: ["a/x", "a/y"], reviewer: ["b/z"] });
});

test("add asks only for what is missing", async () => {
  writeFileSync(join(repo, "Makefile"), "check:\n\ttrue\n");
  const asked: string[] = [];
  const r = await run(["project", "add", repo, "--worker", "a/x"], async (q) => {
    asked.push(q);
    return q.includes("reviewer") ? "r/1, r/2" : "p/1";
  });
  expect(r.code).toBe(0);
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("reviewer");
  expect(JSON.parse(readFileSync(settingsFile(), "utf8")).models).toEqual({ worker: ["a/x"], reviewer: ["r/1", "r/2"] });
});

test("add without a way to ask names what is missing and writes nothing", async () => {
  const r = await run(["project", "add", repo, "--worker", "a/x"]);
  expect(r.code).toBe(1);
  expect(r.out).toContain("--check");
  expect(r.out).toContain("--reviewer");
  expect(existsSync(settingsFile())).toBe(false);
});

test("add refuses a missing repo and a duplicate name", async () => {
  const gone = await run(["project", "add", join(root, "nope"), ...models, "--check", "true"]);
  expect(gone.code).toBe(1);
  expect(gone.out).toContain("no such folder");
  expect((await run(["project", "add", repo, "--check", "true", ...models])).code).toBe(0);
  const again = await run(["project", "add", repo, "--check", "true", ...models]);
  expect(again.code).toBe(1);
  expect(again.out).toContain("already exists");
});

test("list and remove", async () => {
  expect((await run(["project", "list"])).out).toContain("no projects");
  await run(["project", "add", repo, "--check", "true", ...models]);
  const listed = await run(["project", "list"]);
  expect(listed.out).toContain("myrepo");
  expect(listed.out).toContain("myspace");
  expect((await run(["project", "remove", "myrepo"])).code).toBe(0);
  expect(existsSync(repo)).toBe(true);
  expect((await run(["project", "list"])).out).toContain("no projects");
  expect((await run(["project", "remove", "myrepo"])).code).toBe(1);
});

test("check passes, then fails on a bad command, then on a missing repo", async () => {
  await run(["project", "add", repo, "--check", "true", ...models]);
  const ok = await run(["project", "check", "myrepo"]);
  expect(ok.code).toBe(0);
  expect(ok.out).toContain("check command runs");

  await run(["project", "add", repo, "--name", "bad", "--check", "exit 3", ...models]);
  const bad = await run(["project", "check", "bad"]);
  expect(bad.code).toBe(1);
  expect(bad.out).toContain("exit 3");

  await run(["project", "add", repo, "--name", "loud", "--check", "seq 1 30; echo token=hunter2 >&2; exit 4", ...models]);
  keepSecret(env, "all", "TOKEN", "hunter2");
  const loud = await run(["project", "check", "loud"]);
  expect(loud.code).toBe(1);
  expect(loud.out).toContain("exit 4");
  expect(loud.out).toContain("token=***");
  expect(loud.out).not.toContain("hunter2");
  expect(loud.out).toContain("30");
  expect(loud.out).not.toMatch(/^10$/m);

  rmSync(repo, { recursive: true });
  const gone = await run(["project", "check", "myrepo"]);
  expect(gone.code).toBe(1);
  expect(gone.out).toContain("repo is missing");
  expect((await run(["project", "check", "nope"])).code).toBe(1);
});

test("bin/lineclear project list runs", () => {
  const p = Bun.spawnSync(["bin/lineclear", "project", "list"], {
    env: { ...env, LINECLEAR_HOME: join(root, "home") } as Record<string, string>,
  });
  expect(p.exitCode).toBe(0);
});

test("bin/lineclear project add writes projects/<name>/settings.json with every field", () => {
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { check: "true" } }));
  const p = Bun.spawnSync(["bin/lineclear", "project", "add", repo, "--health", "curl x", ...models], {
    env: { ...env, LINECLEAR_HOME: join(root, "home") } as Record<string, string>,
  });
  expect(p.exitCode).toBe(0);
  const s = JSON.parse(readFileSync(settingsFile(), "utf8"));
  expect(s).toMatchObject({ repo, space: "myspace", health: "curl x", models: { worker: ["a/x", "a/y"], reviewer: ["b/z"] } });
  expect(s.check).toContain("run check");
});

test("add works when the board has no store yet, and rejects an empty model list", async () => {
  env.LINECLEAR_HOME = join(root, "no-board");
  const asked: string[] = [];
  const r = await run(["project", "add", repo, "--check", "true", "--worker", ",", "--reviewer", "b/z"], async (q) => {
    asked.push(q);
    return q.includes("space") ? "typed" : "a/x";
  });
  expect(r.code).toBe(0);
  expect(asked).toHaveLength(2);
  const s = JSON.parse(readFileSync(settingsFile(), "utf8"));
  expect(s.space).toBe("typed");
  expect(s.models.worker).toEqual(["a/x"]);
});

test("set changes the commands and a role's model order, and list shows them with the secret names only", async () => {
  await run(["project", "add", repo, "--check", "true", ...models]);
  keepSecret(env, "all", "API_TOKEN", "s3cret");
  expect((await run(["project", "set", "myrepo", "--check", "make check", "--health", "curl -f localhost", "--worker", "a/y,a/x"])).code).toBe(0);
  const s = JSON.parse(readFileSync(settingsFile(), "utf8"));
  expect(s).toMatchObject({ check: "make check", health: "curl -f localhost", models: { worker: ["a/y", "a/x"], reviewer: ["b/z"] } });
  const listed = (await run(["project", "list"])).out;
  expect(listed).toContain("check     make check");
  expect(listed).toContain("health    curl -f localhost");
  expect(listed).toContain("worker    a/y, a/x");
  expect(listed).toContain("secrets   API_TOKEN");
  expect(listed).not.toContain("s3cret");
  expect((await run(["project", "set", "myrepo", "--health", ""])).code).toBe(0);
  expect(JSON.parse(readFileSync(settingsFile(), "utf8")).health).toBeUndefined();
  expect((await run(["project", "set", "myrepo", "--check", " "])).out).toContain("the check command cannot be empty");
  expect((await run(["project", "set", "myrepo", "--worker", "a/x,a/x"])).out).toContain("names a model twice");
  expect((await run(["project", "set", "nope", "--check", "x"])).out).toContain("no project named 'nope'");
  expect((await run(["project", "set", "myrepo"])).code).toBe(1);
});

test("a project is Running or Paused: set --paused switches it, and list says which", async () => {
  await run(["project", "add", repo, "--check", "true", ...models]);
  expect((await run(["project", "list"])).out).toContain("space myspace  Running");
  expect((await run(["project", "set", "myrepo", "--paused", "on"])).out).toContain("myrepo is Paused: the rules start none of its steps");
  expect(JSON.parse(readFileSync(settingsFile(), "utf8")).paused).toBe(true);
  expect((await run(["project", "list"])).out).toContain("space myspace  Paused");
  expect((await run(["project", "set", "myrepo", "--paused", "off"])).code).toBe(0);
  expect(JSON.parse(readFileSync(settingsFile(), "utf8")).paused).toBeUndefined();
  expect((await run(["project", "set", "myrepo", "--paused", "yes"])).out).toContain("--paused takes on or off");
});

test("set --step-check off turns the step check's model call off, on brings it back", async () => {
  await run(["project", "add", repo, "--check", "true", ...models]);
  expect((await run(["project", "set", "myrepo", "--step-check", "off"])).code).toBe(0);
  expect(JSON.parse(readFileSync(settingsFile(), "utf8")).stepCheck).toBe(false);
  expect((await run(["project", "set", "myrepo", "--step-check", "on"])).code).toBe(0);
  expect(JSON.parse(readFileSync(settingsFile(), "utf8")).stepCheck).toBeUndefined();
  expect((await run(["project", "set", "myrepo", "--step-check", "maybe"])).out).toContain("--step-check takes on or off");
});
