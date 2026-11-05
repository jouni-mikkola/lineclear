import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { callsOf, recordCall } from "../pi/extension.ts";
import { readAccounts } from "../src/full.ts";
import { usageLimits } from "../src/limits.ts";
import { availability } from "../src/stalls.ts";
import { codexWindows, goWindows, refreshQuota, registerAdapter, unknownAdapter } from "../src/quota.ts";
import { realWorld, tick } from "../src/rules.ts";
import { tmp } from "./helpers.ts";

// Codex and OpenCode Go report their limits from an endpoint, not in headers: recorded answers stand in for them.

const NOW = Date.parse("2026-11-02T12:00:00Z");
const unix = (iso: string) => Date.parse(iso) / 1000;
const CODEX = (week: number) => ({
  plan_type: "plus",
  rate_limit: {
    primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: unix("2026-11-02T15:00:00Z") },
    secondary_window: { used_percent: week, limit_window_seconds: 604800, reset_at: unix("2026-11-06T09:00:00Z") },
  },
});
const GO = (weekly: number) => ({
  usage: {
    rolling: { status: "ok", percent: 30, resetsAt: "2026-11-02T14:00:00Z" },
    weekly: { status: "ok", percent: weekly, resetsAt: "2026-11-05T00:00:00Z" },
    monthly: { status: "ok", percent: 5, resetsAt: "2026-12-01T00:00:00Z" },
  },
});

function setup() {
  const root = tmp("quota");
  mkdirSync(join(root, "pi"), { recursive: true });
  writeFileSync(
    join(root, "pi", "auth.json"),
    JSON.stringify({
      "openai-codex": { type: "oauth", access: "tok-c", accountId: "acc-1" },
      "opencode-go": { type: "api_key", key: "key-g" },
      anthropic: { type: "api_key", key: "k" },
    }),
  );
  return { root, env: { LINECLEAR_CONFIG: join(root, "config"), PI_CODING_AGENT_DIR: join(root, "pi"), HOME: root } };
}

function answers(codex: unknown, go: unknown) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const get = async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, headers: init.headers });
    return { ok: true, json: async () => (url.includes("wham") ? codex : go) };
  };
  return { seen, get };
}

test("Codex's windows read as session and week by their length, with reset times", () => {
  expect(codexWindows(CODEX(40))).toEqual({
    session: { percent: 12, resetAt: "2026-11-02T15:00:00.000Z" },
    week: { percent: 40, resetAt: "2026-11-06T09:00:00.000Z" },
  });
  expect(codexWindows({})).toEqual({});
});

test("Go's rolling window is the session and its weekly one the week; the monthly one is left out", () => {
  expect(goWindows(GO(60))).toEqual({
    session: { percent: 30, resetAt: "2026-11-02T14:00:00.000Z" },
    week: { percent: 60, resetAt: "2026-11-05T00:00:00.000Z" },
  });
  expect(goWindows({ usage: { weekly: { status: "unavailable", percent: 3 } } })).toEqual({});
});

test("the reader asks each endpoint with pi's login, notes the limits, and Home's usage then shows them", async () => {
  const { env } = setup();
  const { seen, get } = answers(CODEX(40), GO(60));
  await refreshQuota(env, NOW, get);
  expect(seen.map((s) => s.url)).toEqual(["https://chatgpt.com/backend-api/wham/usage", "https://opencode.ai/zen/go/v1/usage"]);
  expect(seen[0]?.headers).toMatchObject({ Authorization: "Bearer tok-c", "ChatGPT-Account-Id": "acc-1" });
  expect(seen[1]?.headers.Authorization).toBe("Bearer key-g");
  const use = usageLimits([], env, NOW);
  expect(use.find((u) => u.account === "openai-codex")?.week?.percent).toBe(40);
  expect(use.find((u) => u.account === "opencode-go")?.week?.percent).toBe(60);
  expect(readAccounts(env)["openai-codex"]).toBeUndefined();
  await refreshQuota(env, NOW + 60_000, get);
  expect(seen).toHaveLength(2);
});

test("a full window marks the account out until its reset, and room again marks it back", async () => {
  const { env } = setup();
  await refreshQuota(env, NOW, answers(CODEX(100), GO(10)).get);
  expect(readAccounts(env)["openai-codex"]).toMatchObject({ out: true, resetAt: "2026-11-06T09:00:00.000Z", window: "week" });
  expect(readAccounts(env)["opencode-go"]?.out).toBeUndefined();
  await refreshQuota(env, NOW + 10 * 60_000, answers(CODEX(30), GO(10)).get);
  expect(readAccounts(env)["openai-codex"]?.out).toBeUndefined();
  expect(usageLimits([], env, NOW + 10 * 60_000).find((u) => u.account === "openai-codex")?.week?.percent).toBe(30);
});

test("a rate-limited Go window is full whatever its percent says", async () => {
  const { env } = setup();
  const limited = { usage: { weekly: { status: "rate-limited", percent: 99.9, resetsAt: "2026-11-05T00:00:00Z" } } };
  await refreshQuota(env, NOW, answers(CODEX(1), limited).get);
  expect(readAccounts(env)["opencode-go"]).toMatchObject({ out: true, resetAt: "2026-11-05T00:00:00.000Z", window: "week" });
});

test("a full monthly Go window keeps the account out although the week has room", async () => {
  const { env } = setup();
  const month = { status: "rate-limited", percent: 100, resetsAt: "2026-12-01T00:00:00Z" };
  const payload = { usage: { rolling: { status: "ok", percent: 10 }, weekly: { status: "ok", percent: 40 }, monthly: month } };
  await refreshQuota(env, NOW, answers(CODEX(1), payload).get);
  expect(readAccounts(env)["opencode-go"]).toMatchObject({ out: true, resetAt: "2026-12-01T00:00:00.000Z" });
});

test("pi's own notes of Claude's limits survive a reading, and a failing login is not asked again within five minutes", async () => {
  const { env } = setup();
  mkdirSync(env.LINECLEAR_CONFIG, { recursive: true });
  let calls = 0;
  const get = async (url: string) => {
    calls++;
    if (calls === 1)
      writeFileSync(join(env.LINECLEAR_CONFIG, "limits.json"), JSON.stringify({ anthropic: { at: "2026-11-02T11:00:00Z", week: { percent: 7 } } }));
    return { ok: url.includes("wham"), json: async () => CODEX(5) };
  };
  await refreshQuota(env, NOW, get);
  expect(
    usageLimits([], env, NOW)
      .map((u) => u.account)
      .sort(),
  ).toEqual(["anthropic", "openai-codex"]);
  await refreshQuota(env, NOW + 60_000, get);
  expect(calls).toBe(2);
});

test("a failed endpoint, a missing login and an unreadable answer change nothing", async () => {
  const { env } = setup();
  await refreshQuota(env, NOW, async () => ({ ok: false, json: async () => ({}) }));
  await refreshQuota(env, NOW + 6 * 60_000, async () => {
    throw new Error("offline");
  });
  await refreshQuota(env, NOW + 12 * 60_000, answers({}, { usage: {} }).get);
  expect(usageLimits([], env, NOW)).toEqual([]);
  await refreshQuota({ ...env, PI_CODING_AGENT_DIR: join(env.HOME, "none") }, NOW, answers(CODEX(1), GO(1)).get);
  expect(usageLimits([], env, NOW)).toEqual([]);
});

test("an account with no adapter reads unknown and counts its own calls and 429 answers since its reset", async () => {
  const { env } = setup();
  const at = (min: number) => new Date(NOW + min * 60_000);
  for (const [i, status] of [200, 429, 200, 429].entries()) recordCall("zai", status, env, at(i));
  expect(unknownAdapter.counts("zai", env, NOW)).toEqual({ calls: 4, limited: 2 });
  expect(await unknownAdapter.read()).toBe("unknown");
  recordCall("zai", 429, env, at(4));
  recordCall("zai", 429, env, at(5));
  recordCall("zai", 429, env, at(6));
  const reset = Date.parse(callsOf("zai", env, at(6)).resetAt ?? "");
  expect(unknownAdapter.counts("zai", env, reset + 1)).toEqual({ calls: 0, limited: 0 });
});

test("three 429s in a row hold an unknown account until its reset, and it is never treated as unlimited", async () => {
  const { env } = setup();
  recordCall("zai", 429, env, new Date(NOW));
  recordCall("zai", 429, env, new Date(NOW + 1000));
  await refreshQuota(env, NOW + 2000, answers({}, {}).get);
  expect(availability("zai/model", env, new Date(NOW + 2000))).toBe("ok");
  recordCall("zai", 429, env, new Date(NOW + 3000));
  await refreshQuota(env, NOW + 4000, answers({}, {}).get);
  const held = readAccounts(env).zai;
  expect(held?.out).toBe(true);
  expect(availability("zai/model", env, new Date(NOW + 4000))).toBe("out");
  expect(availability("zai/model", env, new Date(held?.resetAt ?? 0))).toBe("ok");
});

test("a registered adapter is read by the gate with no other change", async () => {
  const { env } = setup();
  registerAdapter({ account: "fake-co", poll: true, read: async () => ({ week: { percent: 100, resetAt: "2026-11-09T00:00:00.000Z" } }) });
  await refreshQuota(env, NOW, answers({}, {}).get);
  expect(readAccounts(env)["fake-co"]).toMatchObject({ out: true, resetAt: "2026-11-09T00:00:00.000Z", window: "week" });
  expect(availability("fake-co/m", env, new Date(NOW))).toBe("out");
});

// A step whose first account is full starts on the next account of the list; only when every account is out does it wait.

type Accounts = Record<string, { kind: string; out?: boolean; resetAt?: string }>;

function startLoop(accounts: Accounts) {
  const dir = tmp("quota-start");
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  const models = ["first/m", "second/m"];
  writeFileSync(
    join(config, "projects", "demo", "settings.json"),
    JSON.stringify({ repo: join(dir, "repo"), space: "demo", check: "true", models: { worker: models, reviewer: ["rev/m"], planner: models } }),
  );
  writeFileSync(join(config, "machine.json"), JSON.stringify({ loadLimit: 1e6 }));
  writeFileSync(join(config, "accounts.json"), JSON.stringify(accounts));
  const added: string[] = [];
  const vars = { ...process.env, LINECLEAR_CONFIG: config };
  const world = {
    ...realWorld(vars),
    roadmap: () => "# Roadmap\n\n## Phase 0\n\n### X T\n- why: w\n- done when:\n  - x\n- locks: X\n- after: none\n",
    main: () => ({ head: "h", checkedOut: "h", commits: [] }),
    fetch: () => undefined,
    tasks: () => [],
    now: () => new Date(NOW),
    load: () => 0,
    offered: () => undefined,
    maxTasks: () => 5,
    reviewerSetting: () => undefined,
    addTask: (_space: string, _title: string, _brief: string, flags: string[]) => void added.push(flags[flags.indexOf("--model") + 1] ?? ""),
  };
  return { run: () => tick(world, false, vars), added };
}

const RESET = "2026-11-02T20:00:00.000Z";
const EARLY = "2026-11-02T18:00:00.000Z";

test("with the first account full, the start is on the second and the decision log says why", () => {
  const t = startLoop({ first: { kind: "subscription", out: true, resetAt: RESET } });
  const ds = t.run();
  const start = ds.find((d) => d.kind === "start");
  expect(t.added).toEqual(["second/m"]);
  expect(start?.reason).toContain(`account second: first is full until ${RESET}`);
});

test("with every account full, nothing starts before the first reset and one starts after it", () => {
  const t = startLoop({ first: { kind: "subscription", out: true, resetAt: RESET }, second: { kind: "subscription", out: true, resetAt: EARLY } });
  const skip = t.run().find((d) => d.kind === "skip");
  expect(t.added).toEqual([]);
  expect(skip?.reason).toContain("every account of the list is full");
  expect(skip?.reason).toContain(EARLY);
  const later = startLoop({
    first: { kind: "subscription", out: true, resetAt: RESET },
    second: { kind: "subscription", out: true, resetAt: "2026-11-02T11:00:00.000Z" },
  });
  later.run();
  expect(later.added).toEqual(["second/m"]);
});
