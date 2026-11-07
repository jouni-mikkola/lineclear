import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import accountFallback, { HOLD_MS, isQuotaError, pick, projectLists, roleOf } from "../pi/account-fallback.ts";
import { sh, tmp } from "./helpers.ts";

const FULL = "Claude quota exceeded - rate limit (five_hour) - resets 8pm: You've hit your session limit - resets 8pm";

test("only a full account counts as a quota error", () => {
  expect(isQuotaError(FULL)).toBe(true);
  expect(isQuotaError("You've hit your weekly limit - resets Oct 29, 11pm")).toBe(true);
  expect(isQuotaError("500 internal error")).toBe(false);
  expect(isQuotaError(undefined)).toBe(false);
});

test("pick keeps the wanted model until it is full, then takes the first free one in list order", () => {
  const list = ["a/m", "b/m", "c/m"];
  const full = new Map([["a/m", 100]]);
  expect(pick(list, full, 50, "b/m")).toBe("b/m");
  expect(pick(list, full, 50, "a/m")).toBe("b/m");
  expect(pick(list, full, 50)).toBe("b/m");
  expect(pick(list, full, 150, "a/m")).toBe("a/m"); // its time has passed
  expect(pick(list, new Map(list.map((m) => [m, 100])), 50, "b/m")).toBe("b/m"); // all full: the real error shows
});

function setup() {
  const root = tmp("fallback");
  const repo = join(root, "repo");
  const config = join(root, "config");
  mkdirSync(repo, { recursive: true });
  sh(["git", "init", "-q", repo]);
  mkdirSync(join(config, "projects/p"), { recursive: true });
  writeFileSync(
    join(config, "projects/p/settings.json"),
    JSON.stringify({ repo, models: { worker: ["claude-bridge-b/s", "claude-bridge/s"], reviewer: ["x/r"] } }),
  );
  return { repo, env: { LINECLEAR_CONFIG: config } };
}

test("the project's lists are found from its repo, and empty ones are left out", () => {
  const { repo, env } = setup();
  const lists = projectLists(repo, env);
  expect(lists).toEqual({ worker: ["claude-bridge-b/s", "claude-bridge/s"], reviewer: ["x/r"] });
  expect(roleOf(lists, "claude-bridge/s")).toBe("worker");
  expect(projectLists(tmp("elsewhere"), env)).toEqual({});
});

test("a worktree finds its project through the .git file", () => {
  const { repo, env } = setup();
  sh(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"]);
  const work = join(repo, "..", "work");
  sh(["git", "-C", repo, "worktree", "add", "-q", "-b", "w", work]);
  expect(Object.keys(projectLists(work, env))).toEqual(["worker", "reviewer"]);
});

test("a full account moves the run to the next model of the list, in the same process", async () => {
  const { repo, env } = setup();
  const models = new Map<string, any>();
  for (const spec of ["claude-bridge-b/s", "claude-bridge/s"]) models.set(spec, { provider: spec.split("/")[0], id: "s" });
  const registered: any[] = [];
  const handlers: Record<string, any> = {};
  const set: any[] = [];
  const pi = {
    registerVirtualModel: (d: any) => registered.push(d),
    on: (e: string, h: any) => (handlers[e] = h),
    setModel: async (m: any) => void set.push(m),
  };
  const ctx = {
    model: models.get("claude-bridge-b/s"),
    modelRegistry: { find: (p: string, id: string) => (p === "lineclear" ? { provider: p, id } : models.get(`${p}/${id}`)) },
  };
  const cwd = process.cwd();
  process.chdir(repo);
  try {
    accountFallback(pi, env, () => 1000);
  } finally {
    process.chdir(cwd);
  }
  expect(registered.map((d) => d.id)).toEqual(["worker", "reviewer"]);
  await handlers.session_start({}, ctx);
  expect(set).toEqual([{ provider: "lineclear", id: "worker" }]);
  const route = registered[0].route;
  const first = route({ reason: "user", thinkingLevel: "high" }, ctx);
  expect(first.model).toBe(models.get("claude-bridge-b/s")); // the model it started on
  const failed = { model: models.get("claude-bridge-b/s"), thinkingLevel: "high", message: { errorMessage: FULL } };
  const next = route({ reason: "retry", failed, thinkingLevel: "high" }, ctx);
  expect(next.model).toBe(models.get("claude-bridge/s"));
  // the next turn stays there while the first is full
  const later = route({ reason: "user", previous: { model: next.model, thinkingLevel: "high" }, thinkingLevel: "high" }, ctx);
  expect(later.model).toBe(models.get("claude-bridge/s"));
  expect(HOLD_MS).toBeGreaterThan(0);
});
