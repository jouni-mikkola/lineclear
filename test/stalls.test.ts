import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readItems } from "../src/inbox.ts";
import { decisionsPath } from "../pi/config.ts";
import { reviewerFor } from "../src/stalls.ts";
import { tick } from "../src/rules.ts";
import { availability, parseReset, readAccounts, stallCards } from "../src/stalls.ts";
import { readLimit } from "../src/full.ts";
import { usageLimits } from "../src/limits.ts";
import type { StartState } from "../src/starts.ts";
import { demoConfig, idleWorld } from "./demo-world.ts";
import { recordTaskSteps, tmp } from "./helpers.ts";

const dirs: string[] = [];
// the ladder's own lines, not the stall records of src/stall-class.ts beside them
const _ladder = (d: { kind: string; event?: string }) => d.kind === "stall" && d.event !== "stall" && d.event !== "end";
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

interface Opts {
  accounts?: object;
  tasks?: { id: string; title: string; status: string; sub?: string }[];
  worker?: string[];
}

/** A fake clock, a fake lineclear and a fake task list: every call the ladder makes is logged. */
function setup(o: Opts = {}) {
  const dir = tmp("stalls");
  dirs.push(dir);
  const config = demoConfig(dir, {
    worker: o.worker ?? ["anthropic/claude-sonnet-5-5", "openai-codex/gpt-6.1-sol"],
    reviewer: ["anthropic/claude-opus-5-5", "openai-codex/gpt-6.1-sol"],
    loadPerCore: 1e6,
  });
  if (o.accounts) writeFileSync(join(config, "accounts.json"), JSON.stringify(o.accounts));
  // a tick copies the store aside: into this folder, never the owner's own
  const env = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_HOME: join(dir, "home"), LINECLEAR_STORE_COPIES: join(dir, "store-copies") };
  const clock = { at: new Date("2026-06-01T10:00:00Z") };
  const log: string[] = [];
  const adds: string[][] = [];
  const cards: { id: string; task: string; at: number; late?: boolean }[] = [];
  const starts = new Map<string, StartState>();
  const chat: { id: string; task: string; at: number; text: string }[] = [];
  const tasks = { list: o.tasks ?? [{ id: "LIN-5", title: "A Alpha", status: "work" }] };
  const world = idleWorld(env, {
    now: () => clock.at,
    tasks: () => tasks.list,
    stopTask: (id) => (log.push(`stop ${id}`), undefined),
    tellTask: (id, text) => (log.push(`tell ${id} ${text.slice(0, 200)}`), undefined),
    closeTask: (id) => (log.push(`close ${id}`), undefined),
    branchOf: (_, id) => `work/5-${id}`,
    stallCards: () => cards,
    reviewerSetting: () => "opencode-go/glm-5.3",
    chatCards: () => chat,
    started: (id) => starts.get(id) ?? { kind: "busy" },
    nudge: (id, text) => (log.push(`nudge ${id} ${text.slice(0, 40)}`), undefined),
    addTask: (_s, title, brief, extra) => (adds.push([title, brief, ...extra]), undefined),
  });
  recordTaskSteps(config, Object.fromEntries((o.tasks ?? [{ id: "LIN-5", title: "A Alpha" }]).map((t) => [t.id, t.title.split(" ")[0] as string])));
  const stall = (id: string) => cards.push({ id, task: "LIN-5", at: clock.at.getTime() + cards.length + 1 });
  const lateStall = (id: string) => cards.push({ id, task: "LIN-5", at: clock.at.getTime() + cards.length + 1, late: true });
  const decisions = () =>
    readFileSync(decisionsPath(env), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  return { env, world, log, adds, stall, lateStall, tick: (dry = false) => tick(world, dry, env), decisions, tasks, clock, starts, chat };
}

test("a card is read from a chat file", () => {
  const files = [
    {
      posted: [
        { at: 5, card: { id: "c1", task: "LIN-5", status: "work", text: "may be stuck: quiet for 20m" } },
        { at: 6, card: { id: "c2", task: "LIN-5", text: "Working" } },
      ],
    },
  ];
  expect(stallCards(files)).toEqual([{ id: "c1", task: "LIN-5", at: 5 }]);
  const late = [{ posted: [{ at: 5, card: { id: "c1", task: "LIN-5", text: "may be stuck: past its time left" } }] }];
  expect(stallCards(late)).toEqual([{ id: "c1", task: "LIN-5", at: 5, late: true }]);
});

test("a start passes over a full account and does not ask about a key nothing needs", () => {
  const t = setup({
    tasks: [],
    accounts: { anthropic: { kind: "subscription", out: true }, "openai-codex": { kind: "key" } },
    worker: ["anthropic/claude-sonnet-5-5", "openai-codex/gpt-6.1-sol"],
  });
  t.tick();
  expect(t.adds).toHaveLength(0);
  const asks = readItems(t.env).filter((i) => i.kind === "outward");
  expect(asks).toHaveLength(1);
  t.tick();
  expect(readItems(t.env).filter((i) => i.kind === "outward")).toHaveLength(1);
});

test("the reviewer comes from Settings first, skips an out provider, then the project list", () => {
  const t = setup({ accounts: { "opencode-go": { kind: "subscription", out: true } } });
  const settings = JSON.parse(readFileSync(join(t.env.LINECLEAR_CONFIG!, "projects", "demo", "settings.json"), "utf8"));
  const worker = "anthropic/claude-sonnet-5-5";
  const all = new Set(["opencode-go/glm-5.3", "anthropic/claude-opus-5-5", "openai-codex/gpt-6.1-sol"]);
  // Settings names an out provider: the project list is next, and the worker's own company is passed over.
  expect(reviewerFor(worker, settings, t.world, all, t.env)).toBe("openai-codex/gpt-6.1-sol");
  const open = setup();
  expect(reviewerFor(worker, settings, open.world, all, open.env)).toBe("opencode-go/glm-5.3");
  // Settings names a model pi does not offer.
  all.delete("opencode-go/glm-5.3");
  expect(reviewerFor(worker, settings, open.world, all, open.env)).toBe("openai-codex/gpt-6.1-sol");
});

test("a reported usage limit marks the reviewer's provider out, once", () => {
  const t = setup();
  t.tick();
  t.chat.push({ id: "c1", task: "LIN-5", at: t.clock.at.getTime() + 1000, text: "review hit a usage limit on opencode-go" });
  t.chat.push({ id: "c2", task: "LIN-5", at: t.clock.at.getTime() + 2000, text: "quota notes without a provider name" });
  t.tick();
  expect(readAccounts(t.env)).toEqual({ "opencode-go": { kind: "subscription", out: true, resetAt: "2026-06-01T15:00:00.000Z" } });
  t.tick();
  expect(t.decisions().filter((d) => /opencode-go is out/.test(d.reason))).toHaveLength(1);
});

test("a 429 or usage limit with a reset time marks the account out until then, tells nobody, and asks nobody", () => {
  const t = setup();
  t.tick();
  t.chat.push({ id: "c1", task: "LIN-5", at: t.clock.at.getTime() + 1000, text: "opencode-go: Go usage limit exceeded (429), resets at 2026-06-01T15:00:00Z" });
  t.tick();
  expect(readAccounts(t.env)["opencode-go"]).toEqual({ kind: "subscription", out: true, resetAt: "2026-06-01T15:00:00.000Z" });
  expect(t.log.filter((l) => l.startsWith("tell"))).toEqual([]); // a provider cut-off is never a message to an agent
  t.chat.push({ id: "c3", task: "LIN-5", at: t.clock.at.getTime() + 1500, text: "Fixed the 429 handling in the opencode-go client retry path" });
  t.tick();
  expect(readAccounts(t.env)["opencode-go"]!.resetAt).toBe("2026-06-01T15:00:00.000Z");
  expect(readItems(t.env)).toHaveLength(0);
  // The worker repeats the limit in its report: no second tell. A second provider's limit is blamed on that provider.
  const tells = () => t.log.filter((l) => l.startsWith("tell LIN-5")).length;
  const before = tells();
  expect(before).toBe(0);
  t.chat.push({ id: "c2", task: "LIN-5", at: t.clock.at.getTime() + 2000, text: "Reviewed by openai-codex because opencode-go hit its usage limit" });
  t.tick();
  expect(tells()).toBe(0);
  expect(readAccounts(t.env)["openai-codex"]!.out).toBe(true);
  t.chat.push({ id: "c4", task: "LIN-5", at: t.clock.at.getTime() + 3000, text: "PR note: opencode-go and openai-codex usage limit" });
  t.tick();
  expect(tells()).toBe(0);
});

test("a limit message with no reset time puts the account out for a default while, then it returns", () => {
  const t = setup();
  t.tick();
  t.chat.push({ id: "c1", task: "LIN-5", at: t.clock.at.getTime() + 1000, text: "opencode-go: usage limit reached, nothing more said" });
  t.tick();
  expect(readAccounts(t.env)["opencode-go"]!.resetAt).toBe("2026-06-01T15:00:00.000Z");
  t.clock.at = new Date("2026-06-01T15:01:00Z");
  t.tick();
  expect(readAccounts(t.env)["opencode-go"]).toEqual({ kind: "subscription" });
});

test("an account comes back by itself after its reset time", () => {
  const t = setup({ accounts: { "opencode-go": { kind: "subscription", out: true, resetAt: "2026-06-01T12:00:00.000Z" } } });
  expect(availability("opencode-go/glm-5.3", t.env, t.clock.at)).toBe("out");
  t.clock.at = new Date("2026-06-01T12:00:01Z");
  expect(availability("opencode-go/glm-5.3", t.env, t.clock.at)).toBe("ok");
  t.tick();
  expect(readAccounts(t.env)["opencode-go"]).toEqual({ kind: "subscription" });
  expect(t.decisions().some((d) => /opencode-go is back/.test(d.reason))).toBe(true);
});

test("parseReset reads an ISO time and a relative one", () => {
  const now = new Date("2026-06-01T10:00:00Z");
  expect(parseReset("resets in 3 hours", now)).toBe("2026-06-01T13:00:00.000Z");
  expect(parseReset("resets in 30 min", now)).toBe("2026-06-01T10:30:00.000Z");
  expect(parseReset("limit hit", now)).toBeUndefined();
});

// ---- L46: a full account hands work on ----

const SESSION = "Claude quota exceeded \u2014 rate limit (five_hour) \u2014 resets 8:00:00 PM: You've hit your session limit · resets 8pm (Europe/Helsinki)";
const WEEK =
  "Claude quota exceeded \u2014 rate limit (seven_day) \u2014 resets 11:00:00 PM: You've hit your weekly limit · resets Jun 4, 11pm (Europe/Helsinki)";

test("a reset time is read in its own zone, and a message without one gets the window's length", () => {
  const now = new Date("2026-06-01T10:00:00Z");
  expect(readLimit(SESSION, now)).toEqual({ window: "session", until: new Date("2026-06-01T17:00:00Z") });
  expect(readLimit(WEEK, now)).toEqual({ window: "week", until: new Date("2026-06-04T20:00:00Z") });
  expect(readLimit("Codex error: The usage limit has been reached", now)?.until).toEqual(new Date("2026-06-01T15:00:00Z"));
  expect(readLimit("network down", now)).toBeUndefined();
  // a reset after midnight on the night the clocks go back (Helsinki, 2026-10-25)
  const night = "You've hit your session limit \u00b7 resets 12:30am (Europe/Helsinki)";
  expect(readLimit(night, new Date("2026-10-25T21:36:02Z"))?.until).toEqual(new Date("2026-10-25T22:30:00Z"));
});

test("a full week marks the account until its reset for the reviewers too, then the mark clears by itself", () => {
  const t = setup();
  t.world.lastError = () => ({ text: WEEK, at: t.clock.at.getTime() });
  t.tick();
  expect(readAccounts(t.env).anthropic).toMatchObject({ out: true, window: "week", resetAt: "2026-06-04T20:00:00.000Z" });
  const settings = JSON.parse(readFileSync(join(t.env.LINECLEAR_CONFIG!, "projects", "demo", "settings.json"), "utf8"));
  const all = new Set(["anthropic/claude-opus-5-5", "openai-codex/gpt-6.1-sol"]);
  expect(reviewerFor("openai-codex/gpt-6.1-sol", settings, t.world, all, t.env)).toBeUndefined(); // anthropic is full for reviewers
  t.world.lastError = () => undefined;
  t.clock.at = new Date("2026-06-04T19:59:00Z");
  t.tick();
  expect(readAccounts(t.env).anthropic?.out).toBe(true);
  t.clock.at = new Date("2026-06-04T20:00:01Z");
  const d = t.tick();
  expect(readAccounts(t.env).anthropic).toEqual({ kind: "subscription" });
  expect(d.some((x) => x.reason.includes("anthropic is back"))).toBe(true);
  expect(reviewerFor("openai-codex/gpt-6.1-sol", settings, t.world, all, t.env)).toBe("anthropic/claude-opus-5-5");
});

test("an error the task got past is not read again", () => {
  const t = setup();
  t.world.lastError = () => ({ text: SESSION, at: t.clock.at.getTime() - 3_600_000 });
  t.tick();
  expect(t.log).toEqual([]);
  expect(readAccounts(t.env)).toEqual({});
});

test("Usage reads each account as free or full until a time", () => {
  const t = setup({ accounts: { anthropic: { kind: "subscription", out: true, resetAt: "2026-06-01T17:00:00.000Z", window: "session" } } });
  expect(usageLimits(["openai-codex"], t.env, t.clock.at.getTime())).toEqual([
    { account: "anthropic", session: { percent: 100, resetAt: "2026-06-01T17:00:00.000Z" } },
    { account: "openai-codex", unreported: true },
  ]);
  expect(usageLimits([], t.env, Date.parse("2026-06-01T17:00:01Z"))).toEqual([]);
});

test("an error read after its own reset time marks nothing", () => {
  const t = setup();
  // the error came at 16:59Z and its reset, 8pm in Helsinki, was 17:00Z
  t.world.lastError = () => ({ text: SESSION, at: new Date("2026-06-01T16:59:00Z").getTime() });
  t.clock.at = new Date("2026-06-01T17:01:00Z");
  t.tick();
  expect(t.log).toEqual([]);
  expect(readAccounts(t.env)).toEqual({});
});
