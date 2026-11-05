import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { instanceEnv, readTry, startTry, stopTry, tryLines, tryMain } from "../src/try-instance.ts";
import { sh, tmp } from "./helpers.ts";

let root: string;
let env: Record<string, string>;
let repo: string;

const repoRoot = join(import.meta.dir, "..");

/** Every file under `dir` with its bytes (a link by its target), so two states compare byte for byte. */
function tree(dir: string, base = dir): Record<string, string> {
  const found: Record<string, string> = {};
  for (const e of readdirSync(dir)) {
    const path = join(dir, e);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) found[path.slice(base.length)] = `-> ${readlinkSync(path)}`;
    else if (st.isDirectory()) Object.assign(found, tree(path, base));
    else if (st.isFile()) found[path.slice(base.length)] = readFileSync(path).toString("base64");
  }
  return found;
}

beforeEach(() => {
  root = tmp("try");
  env = {
    PATH: process.env.PATH as string,
    HOME: root,
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_DATA_HOME: join(root, "share"),
    LINECLEAR_CONFIG: join(root, "config"),
    LINECLEAR_HOME: join(root, "data"),
  };
  repo = join(root, "code", "proj");
  mkdirSync(repo, { recursive: true });
  sh(["git", "init", "-q", "-b", "main"], { cwd: repo });
  writeFileSync(join(repo, "README.md"), "hi\n");
  sh(["git", "add", "."], { cwd: repo });
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start"], { cwd: repo });
  mkdirSync(join(root, "data", "chatlog"), { recursive: true });
  writeFileSync(join(root, "data", "chatlog", "a.jsonl"), '{"text":"hello"}\n');
  writeFileSync(join(root, "data", "vapid.json"), '{"key":"push-key"}');
  writeFileSync(join(root, "data", "settings.json"), '{"machine":{"machine.maxTasks":"9"},"everywhere":{},"spaces":{}}');
  writeFileSync(join(root, "data", "spaces.json"), JSON.stringify([{ name: "proj", path: repo, key: "PRJ", base: "main" }]));
  writeFileSync(
    join(root, "data", "tasks.json"),
    JSON.stringify({
      next: { PRJ: 1 },
      tasks: [
        {
          id: "PRJ-1",
          n: 1,
          project: `p:${hostname()}:proj`,
          base: "main",
          title: "Copied task",
          desc: "",
          status: "todo",
          worktree: join(root, "real-worktree"),
          branch: "work/real",
        },
      ],
    }),
  );
  mkdirSync(join(root, "config", "projects", "proj"), { recursive: true });
  writeFileSync(join(root, "config", "projects", "proj", "settings.json"), JSON.stringify({ repo }));
  // a release build that is there already: the code of this tree under builds/9.9.9
  const build = join(root, "data", "builds", "9.9.9");
  mkdirSync(build, { recursive: true });
  for (const e of readdirSync(repoRoot)) if (e !== ".git") symlinkSync(join(repoRoot, e), join(build, e));
  writeFileSync(join(build, ".release"), "9.9.9\n");
});
afterEach(() => {
  stopTry(env);
  rmSync(root, { recursive: true, force: true });
});

test.skipIf(!Bun.which("herdr"))(
  "a try run answers on its own port with the copied tasks and leaves the real files alone",
  async () => {
    const realRefs = () => sh(["git", "for-each-ref"], { cwd: repo }).out + JSON.stringify(tree(join(repo, ".git")));
    const before = { data: tree(join(root, "data")), config: tree(join(root, "config")), refs: realRefs() };
    const state = await startTry("v9.9.9", "9.9.9", env);
    expect(state).toBeObject();
    const s = state as { port: number };
    const snapshot = await (await fetch(`http://127.0.0.1:${s.port}/api/snapshot`)).text();
    expect(snapshot).toContain("Copied task");
    expect(snapshot).not.toContain("push-key");
    // the copied task keeps no link to a real worktree or branch
    const copied = readFileSync(join(root, "cache", "lineclear", "try", "world", "home", "tasks.json"), "utf8");
    expect(copied).toContain("Copied task");
    expect(copied).not.toContain("real-worktree");
    expect(copied).not.toContain("work/real");
    expect(tryLines(env)[0]).toMatch(new RegExp(`^test +9\\.9\\.9 on port ${s.port}, running$`));

    // the instance works on a clone whose remote is a bare copy of its own
    const world = join(root, "cache", "lineclear", "try", "world");
    const clone = join(world, "repos", "proj");
    const inst = instanceEnv(env, world, s.port, "x");
    const remote = sh(["git", "remote", "get-url", "origin"], { cwd: clone, env: inst }).out.trim();
    expect(remote).toBe(join(world, "bare", "proj.git"));
    expect(sh(["sh", "-c", "command -v claude"], { env: inst }).out.trim()).toBe(join(world, "shims", "claude"));
    // the server makes a push key of its own; the real one is not copied
    expect(readFileSync(join(world, "home", "vapid.json"), "utf8")).not.toContain("push-key");

    // a planted push to the real repo and a planted gh call fail; a push to its own bare copy goes through
    const planted = sh(["git", "push", repo, "HEAD:refs/heads/planted"], { cwd: clone, env: inst });
    expect(planted.code).not.toBe(0);
    expect(planted.out).toContain("only the test instance's own copies");
    expect(sh(["gh", "api", "user"], { cwd: clone, env: inst }).code).not.toBe(0);
    expect(sh(["git", "push", "origin", "HEAD:refs/heads/own"], { cwd: clone, env: inst }).code).toBe(0);

    expect(stopTry(env)).toBe(true);
    expect(readTry(env)).toBeUndefined();
    expect(existsSync(world)).toBe(false);
    expect({ data: tree(join(root, "data")), config: tree(join(root, "config")), refs: realRefs() }).toEqual(before);
  },
  330_000,
);

test("a candidate needs a green commit, and the instance env has no credentials", async () => {
  const out: string[] = [];
  expect(await tryMain([], (l) => out.push(l), env, undefined)).toBe(1);
  expect(out.join("\n")).toContain("no green commit");
  expect(await tryMain(["x"], (l) => out.push(l), env, undefined)).toBe(2);
  const e = instanceEnv({ ...env, GITHUB_TOKEN: "t", GH_TOKEN: "t", SSH_AUTH_SOCK: "/s" }, join(root, "w"), 1, "s");
  expect(e.GITHUB_TOKEN ?? e.GH_TOKEN ?? e.SSH_AUTH_SOCK).toBeUndefined();
  expect(e.LINECLEAR_HOME).toBe(join(root, "w", "home"));
});

test("a pid left in the state file that is not the instance's is not signalled", async () => {
  const bystander = Bun.spawn(["sleep", "30"], { detached: true } as never);
  mkdirSync(join(root, "cache", "lineclear", "try"), { recursive: true });
  writeFileSync(
    join(root, "cache", "lineclear", "try", "state.json"),
    JSON.stringify({ version: "1.0.0", port: 1, session: "gone", pids: [bystander.pid], at: new Date().toISOString() }),
  );
  expect(stopTry(env)).toBe(true);
  expect(process.kill(bystander.pid, 0)).toBe(true);
  bystander.kill();
});

test("a failed candidate is not tried again within 30 minutes", async () => {
  const out: string[] = [];
  mkdirSync(join(root, "cache", "lineclear", "try"), { recursive: true });
  writeFileSync(join(root, "cache", "lineclear", "try", "candidate.json"), JSON.stringify({ commit: "a".repeat(40), at: new Date().toISOString() }));
  expect(await tryMain([], (l) => out.push(l), env, "b".repeat(40))).toBe(1);
  expect(out.join("\n")).toContain("less than 30 minutes");
});

test("stop with nothing running says so", async () => {
  const out: string[] = [];
  expect(await tryMain(["--stop"], (l) => out.push(l), env, undefined)).toBe(0);
  expect(out[0]).toContain("no test instance");
});
