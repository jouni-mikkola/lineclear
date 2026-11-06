import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UpdateHooks } from "../src/update.ts";
import { updateMain } from "../src/update.ts";
import { sh, tmp } from "./helpers.ts";

const root = tmp("update");
afterAll(() => sh(["rm", "-rf", root]));

const SECRETS = ["va", "ult.json"].join("");
const put = (dir: string, name: string, value: string) => {
  mkdirSync(join(dir, name, ".."), { recursive: true });
  writeFileSync(join(dir, name), value);
};
const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

/** An old folder with one space, one running task with its chat and one secret. */
function plant(name: string) {
  const old = join(root, `${name}-old`);
  const home = join(root, `${name}-home`);
  put(old, "spaces.json", JSON.stringify([{ name: "demo", path: "/x/demo", key: "DEM", base: "main" }]));
  put(old, "tasks.json", JSON.stringify({ next: { DEM: 2 }, tasks: [{ id: "DEM-1", told: "work" }], red: {} }));
  put(old, "chatlog/DEM-1_Agent.json", JSON.stringify({ posted: [{ at: 1 }] }));
  put(old, "agents.json", JSON.stringify({ "DEM-1": { kind: "pi" } }));
  put(old, SECRETS, JSON.stringify({ TOKEN: "s3" }));
  const env = { LINECLEAR_OLD_DIR: old, LINECLEAR_OLD_PROJECTS_DIR: join(root, `${name}-none`), LINECLEAR_HOME: home };
  return { old, home, env };
}

/** A machine that copied the old install earlier and has a task of its own working in Lineclear's folder. */
function plantMigrated(name: string) {
  const p = plant(name);
  put(p.home, "migrated.json", JSON.stringify({ at: 1 }));
  put(p.home, "tasks.json", JSON.stringify({ next: { DEM: 3 }, tasks: [{ id: "DEM-2", told: "working now" }], red: {} }));
  put(p.home, "agents.json", JSON.stringify({ "DEM-2": { kind: "pi", pid: 4242 } }));
  return p;
}

const run = (args: string[], env: Record<string, string>, hooks: UpdateHooks = {}) => {
  const lines: string[] = [];
  const code = updateMain(
    args,
    (l) => lines.push(l),
    env,
    () => false,
    { users: () => [], ...hooks },
  );
  return { code, text: lines.join("\n") };
};

test("update finds every task, chat and secret in the new place and the old folder gone", () => {
  const { old, home, env } = plant("a");
  expect(run([], env).code).toBe(0);
  expect(existsSync(old)).toBe(false);
  expect(JSON.parse(read(home, "tasks.json")).tasks[0].id).toBe("DEM-1");
  expect(existsSync(join(home, "chatlog/DEM-1_Agent.json"))).toBe(true);
  expect(read(home, SECRETS)).toContain("s3");
  expect(existsSync(join(home, "before-update"))).toBe(true);
});

test("a task working in Lineclear's folder is unchanged by the move", () => {
  const { old, home, env } = plantMigrated("b");
  const tasks = read(home, "tasks.json");
  const agents = read(home, "agents.json");
  expect(run([], env).code).toBe(0);
  expect(existsSync(old)).toBe(false);
  expect(read(home, "tasks.json")).toBe(tasks);
  expect(read(home, "agents.json")).toBe(agents);
});

test("a process still working in the old folder keeps it: nothing moves until a later update", async () => {
  const { old, home, env } = plant("c");
  const worker = Bun.spawn(["sleep", "30"], { cwd: old });
  try {
    const r = run([], env, { users: undefined });
    expect(r.code).toBe(0);
    expect(r.text).toContain("still use the old folders");
    expect(read(old, "tasks.json")).toContain("DEM-1");
    expect(existsSync(join(home, "before-update"))).toBe(false);
    expect(worker.exitCode).toBeNull();
  } finally {
    worker.kill();
    await worker.exited;
  }
  expect(run([], env).code).toBe(0);
  expect(existsSync(old)).toBe(false);
});

const planted = {
  afterCopy: () => {
    throw new Error("planted");
  },
};

test("a planted failure rolls back to the old folder", () => {
  const { old, home, env } = plant("d");
  const r = run([], env, planted);
  expect(r.code).toBe(1);
  expect(r.text).toContain("rolled back");
  expect(read(old, SECRETS)).toContain("s3");
  expect(existsSync(join(home, "tasks.json"))).toBe(false);
  expect(existsSync(join(home, "before-update"))).toBe(false);
});

test("a planted failure leaves Lineclear's own folder as it was", () => {
  const { old, home, env } = plantMigrated("e");
  const tasks = read(home, "tasks.json");
  expect(run([], env, planted).code).toBe(1);
  expect(existsSync(join(old, "tasks.json"))).toBe(true);
  expect(read(home, "tasks.json")).toBe(tasks);
});

test("update --back returns the old folder with the work done since", () => {
  const { old, home, env } = plant("f");
  expect(run([], env).code).toBe(0);
  put(home, "chatlog/DEM-1_Agent.json", JSON.stringify({ posted: [{ at: 1 }, { at: 2 }] }));
  expect(run(["--back"], env).code).toBe(0);
  expect(existsSync(join(old, SECRETS))).toBe(true);
  expect(JSON.parse(read(old, "chatlog/DEM-1_Agent.json")).posted).toHaveLength(2);
  expect(existsSync(join(home, "before-update"))).toBe(false);
});

test("update --back puts nothing over an old folder that exists again", () => {
  const { old, env } = plant("g");
  expect(run([], env).code).toBe(0);
  put(old, "spaces.json", "[]");
  const r = run(["--back"], env);
  expect(r.code).toBe(1);
  expect(read(old, "spaces.json")).toBe("[]");
});

test("a machine with only the projects folder moves it", () => {
  const home = join(root, "e-home");
  const projects = join(root, "e-projects");
  put(projects, "x.json", "{}");
  const env = { LINECLEAR_OLD_DIR: join(root, "e-none"), LINECLEAR_OLD_PROJECTS_DIR: projects, LINECLEAR_HOME: home };
  expect(run([], env).code).toBe(0);
  expect(existsSync(projects)).toBe(false);
  expect(run(["--back"], env).code).toBe(0);
  expect(existsSync(join(projects, "x.json"))).toBe(true);
});

test("a machine that migrated earlier still gets its secrets, and a rollback leaves its running work alone", () => {
  const { old, home, env } = plantMigrated("f");
  expect(run([], env).code).toBe(0);
  expect(read(home, SECRETS)).toContain("s3");
  expect(JSON.parse(read(home, "tasks.json")).tasks[0].id).toBe("DEM-2");
  const g = plantMigrated("g");
  put(g.home, "tasks.json", JSON.stringify({ tasks: [{ id: "DEM-9" }] }));
  const r = run([], g.env, {
    afterCopy: () => {
      throw new Error("planted");
    },
  });
  expect(r.code).toBe(1);
  expect(JSON.parse(read(g.home, "tasks.json")).tasks[0].id).toBe("DEM-9");
  expect(existsSync(old)).toBe(false);
  expect(existsSync(g.old)).toBe(true);
});
