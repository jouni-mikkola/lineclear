import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inboxMain } from "../src/inbox-answer.ts";
import { readItems } from "../src/inbox.ts";
import { decisionsPath } from "../pi/config.ts";
import { reviewerFor } from "../src/stalls.ts";
import { tick } from "../src/rules.ts";
import { availability, parseReset, readAccounts, stallCards } from "../src/stalls.ts";
import { readLimit, readMoves } from "../src/full.ts";
import { usageLimits } from "../src/limits.ts";
import { readWaits, writeWait } from "../src/waits.ts";
import type { StartState } from "../src/starts.ts";
import { waitingForYou } from "../src/waiting.ts";
import { demoConfig, idleWorld } from "./demo-world.ts";
import { recordTaskSteps, tmp } from "./helpers.ts";

const dirs: string[] = [];
// the ladder's own lines, not the stall records of src/stall-class.ts beside them
const ladder = (d: { kind: string; event?: string }) => d.kind === "stall" && d.event !== "stall" && d.event !== "end";
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

test("each stall card moves the task one rung: reminder, restart, next model, Inbox", () => {
  const t = setup({ tasks: [{ id: "LIN-5", title: "A Alpha", status: "need", sub: "Waits for your reply" }] });
  t.tick(); // sets the time from which cards count
  const rungs: string[] = [];
  for (const id of ["c1", "c2", "c3", "c4"]) {
    t.stall(id);
    t.clock.at = new Date(t.clock.at.getTime() + 60_000);
    rungs.push(
      ...t
        .tick()
        .filter(ladder)
        .map((d) => d.reason.split(":")[0]!),
    );
  }
  expect(rungs).toEqual(["rung 1", "rung 2", "rung 3", "rung 4"]);
  expect(t.log[0]).toStartWith("tell LIN-5 You may be stuck");
  expect(t.log.slice(1, 3)).toEqual(["stop LIN-5", expect.stringContaining("tell LIN-5 Your agent was r")]);
  expect(t.log[3]).toBe("close LIN-5");
  expect(t.adds).toHaveLength(1);
  const [title, brief, ...extra] = t.adds[0]!;
  expect(title).toBe("A Alpha");
  expect(brief).toContain("work/5-LIN-5");
  expect(extra[extra.indexOf("--model") + 1]).toBe("openai-codex/gpt-6.1-sol");
  expect(readItems(t.env).map((i) => i.kind)).toEqual(["stuck"]);
  expect(t.decisions().filter(ladder)).toHaveLength(4); // each rung is in decisions.jsonl
});

test("a working task silent for 20 minutes is stopped with an Inbox report and a wait, never reminded", () => {
  const t = setup();
  t.tick();
  t.stall("c1");
  t.clock.at = new Date(t.clock.at.getTime() + 60_000);
  t.tick();
  expect(t.log).toEqual(["stop LIN-5"]);
  expect(readItems(t.env).map((i) => i.kind)).toEqual(["stuck"]);
  expect(readWaits(t.env)).toMatchObject([{ task: "LIN-5", kind: "owner" }]);
});

test("a task at work past its wall-time limit is stopped with a report", () => {
  const t = setup();
  t.tick();
  t.clock.at = new Date(t.clock.at.getTime() + 121 * 60_000);
  t.tick();
  expect(t.log).toContain("stop LIN-5");
  expect(readItems(t.env)[0]?.question).toContain("wall-time limit");
});

test("a late card asks for a new estimate once and climbs only when a second one comes", () => {
  const t = setup();
  t.tick();
  t.lateStall("l1");
  t.clock.at = new Date(t.clock.at.getTime() + 60_000);
  const first = t.tick().filter(ladder);
  expect(first.map((d) => [d.class, d.reason.split(":")[0]])).toEqual([["late", "asked LIN-5 for a new estimate"]]);
  expect(t.log).toEqual([expect.stringContaining("tell LIN-5 You are past your time left")]);
  t.lateStall("l2");
  t.clock.at = new Date(t.clock.at.getTime() + 60_000);
  const second = t.tick().filter(ladder);
  expect(second.map((d) => [d.class, d.reason.split(":")[0]])).toEqual([["no-sign-of-life", "rung 1"]]);
});

test("a late card after a status is asked for a new estimate again, not climbed", () => {
  const t = setup();
  t.tick();
  t.lateStall("l1");
  t.clock.at = new Date(t.clock.at.getTime() + 60_000);
  t.tick();
  t.chat.push({ id: "s1", task: "LIN-5", at: t.clock.at.getTime() + 1_000, text: "Working on it" });
  t.lateStall("l2");
  t.clock.at = new Date(t.clock.at.getTime() + 60_000);
  expect(
    t
      .tick()
      .filter(ladder)
      .map((d) => d.reason.split(":")[0]),
  ).toEqual(["asked LIN-5 for a new estimate"]);
});

test("a quiet card climbs with no sign of life and records no late stall", () => {
  const t = setup();
  t.tick();
  t.stall("q1");
  t.clock.at = new Date(t.clock.at.getTime() + 60_000);
  const d = t.tick().filter(ladder);
  expect(d.map((x) => x.class)).toEqual(["no-sign-of-life"]);
  expect(d[0]?.reason).toContain("no sign of life for 20 minutes");
});

test("the handover is one start: the same tick does not start the step again", () => {
  const t = setup();
  t.tick();
  // the task list still shows the closed task as work, and then as done, as Lineclear would
  for (const id of ["c1", "c2", "c3"]) {
    t.stall(id);
    t.clock.at = new Date(t.clock.at.getTime() + 60_000);
    if (id === "c3") {
      t.tasks.list = [{ id: "LIN-5", title: "A Alpha", status: "done" }];
      t.world.tasks = () => t.tasks.list;
    }
    t.tick();
  }
  expect(t.adds).toHaveLength(1);
  t.tasks.list = [
    { id: "LIN-5", title: "A Alpha", status: "done" },
    { id: "LIN-6", title: "A Alpha", status: "work" },
  ];
  t.tick();
  expect(t.adds).toHaveLength(1);
});

test("a silent Needs you climbs the ladder one rung per card; a question, a plan or a login never does", () => {
  const climbs = (sub: string) => {
    const t = setup({ tasks: [{ id: "LIN-5", title: "A Alpha", status: "need", sub }] });
    t.tick();
    const rungs: string[] = [];
    for (const id of ["c1", "c2"]) {
      t.stall(id);
      t.clock.at = new Date(t.clock.at.getTime() + 60_000);
      rungs.push(
        ...t
          .tick()
          .filter(ladder)
          .map((d) => d.reason.split(":")[0] ?? ""),
      );
    }
    return rungs;
  };
  expect(climbs("Waits for your reply")).toEqual(["rung 1", "rung 2"]);
  for (const sub of ["Question for you", "Plan to approve", "Asks permission", "Use the paid key?"]) expect(climbs(sub)).toEqual([]);
});

test("a task with a declared wait is not moved up", () => {
  const t = setup();
  t.tick();
  writeWait({ task: "LIN-5", kind: "owner", reason: "asked: a thing", since: t.clock.at.toISOString() }, t.env);
  t.stall("c1");
  t.clock.at = new Date(t.clock.at.getTime() + 60_000);
  const d = t.tick();
  expect(d.some((x) => x.kind === "stall")).toBe(false);
  expect(t.log).toEqual([]);
});

test("old cards from before the loop knew the task are ignored", () => {
  const t = setup();
  t.world.stallCards = () => [{ id: "old", task: "LIN-5", at: t.clock.at.getTime() - 3_600_000 }];
  t.tick();
  expect(t.log).toEqual([]);
});

test("a full subscription goes straight to rung 3 with no wait", () => {
  const t = setup({ accounts: { anthropic: { kind: "subscription", out: true } } });
  t.tick();
  expect(t.log).toEqual(["close LIN-5"]);
  expect(t.adds).toHaveLength(1);
  expect(t.adds[0]!.join(" ")).toContain("--model openai-codex/gpt-6.1-sol");
  expect(t.decisions().find((d) => d.kind === "stall").reason).toContain("account of anthropic/claude-sonnet-5-5 is out");
});

test("an ended free account goes straight to rung 3", () => {
  const t = setup({ accounts: { anthropic: { kind: "free", out: true } } });
  t.tick();
  expect(t.log).toEqual(["close LIN-5"]);
  expect(t.adds).toHaveLength(1);
});

test("a task Lineclear left waiting for a login goes straight to rung 3", () => {
  const t = setup({ tasks: [{ id: "LIN-5", title: "A Alpha", status: "need", sub: "Signed out" }] });
  t.tick();
  expect(t.log).toEqual(["close LIN-5"]);
  expect(t.adds).toHaveLength(1);
});

test("a paid key that is not allowed asks in the Inbox, and is used after the answer", () => {
  const t = setup({ accounts: { anthropic: { kind: "subscription", out: true }, "openai-codex": { kind: "key" } } });
  t.tick();
  // no handover yet: the next model is on a key
  expect(t.adds).toHaveLength(0);
  expect(t.log.filter((l) => l.startsWith("close"))).toEqual([]);
  const keyItems = () => readItems(t.env).filter((i) => i.kind === "outward");
  expect(keyItems()).toHaveLength(1);
  expect(keyItems()[0]!.question).toContain("paid API key");
  t.tick();
  expect(keyItems()).toHaveLength(1); // asked once while open
  const out: string[] = [];
  expect(inboxMain(["answer", String(keyItems()[0]!.n), "Allow"], (l) => out.push(l), t.env)).toBe(0);
  t.tick();
  expect(t.adds).toHaveLength(1);
  expect(t.adds[0]!.join(" ")).toContain("--model openai-codex/gpt-6.1-sol");
  expect(keyItems()).toHaveLength(1); // the allow holds, nothing asks again
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

test("a dry run changes nothing", () => {
  const t = setup({ accounts: { anthropic: { kind: "subscription", out: true } } });
  const d = t.tick(true);
  expect(d.some((x) => x.kind === "stall" && x.reason.includes("would hand"))).toBe(true);
  expect(t.log).toEqual([]);
  expect(t.adds).toEqual([]);
});

test("a start with no agent behind it is nudged, restarted, then marked start failed, never an owner question", () => {
  // the planted fault: herdr says "agent_not_ready: not an active named agent" and the task shows Working
  const t = setup();
  t.starts.set("LIN-5", { kind: "gone" });
  const at = (ms: number) => {
    t.clock.at = new Date(t.clock.at.getTime() + ms);
    return t
      .tick()
      .filter(ladder)
      .map((d) => d.reason);
  };
  expect(at(0)).toEqual([]); // first seen
  expect(at(60_000)).toEqual([]);
  expect(at(61_000)).toEqual(["typed its brief nudge into the pane of LIN-5: herdr has no agent for it"]);
  expect(at(120_000)).toEqual(["restarted LIN-5: herdr has no agent for it"]);
  expect(at(120_000)).toEqual(["marked start failed for LIN-5: herdr has no agent for it"]);
  expect(at(600_000)).toEqual([]);
  expect(t.log).toEqual([
    "nudge LIN-5 [lineclear:resume] Your brief is above b",
    "stop LIN-5",
    expect.stringContaining("tell LIN-5 Your agent was restarted because it never started"),
    "stop LIN-5",
  ]);
  expect(readWaits(t.env).map((w) => [w.task, w.kind])).toEqual([["LIN-5", "start"]]);
  // the task stopped and now shows as needing attention: still not a question for the owner
  t.tasks.list = [{ id: "LIN-5", title: "A Alpha", status: "need" }];
  expect(waitingForYou(t.env, [], [{ name: "demo", tasks: [{ id: "LIN-5", title: "A Alpha", state: "need", text: "Waits for you" }] } as never]).tasks).toEqual(
    [],
  );
  // restarted by hand, its agent answers: start failed ends and the task is an ordinary one again
  t.starts.set("LIN-5", { kind: "acted" });
  expect(at(60_000)).toEqual(["cleared start failed of LIN-5: its agent answered"]);
  expect(readWaits(t.env)).toEqual([]);
});

test("a nudge or restart that fails is logged as failed, never as done", () => {
  const t = setup();
  t.starts.set("LIN-5", { kind: "gone" });
  t.world.nudge = () => "no pane";
  t.tick();
  t.clock.at = new Date(t.clock.at.getTime() + 121_000);
  const d = t.tick();
  expect(d.filter(ladder)).toEqual([]);
  expect(d.some((x) => x.kind === "skip" && x.reason === "LIN-5: herdr has no agent for it, but the nudge failed: no pane")).toBe(true);
});

test("an agent that answered and later vanishes is the stall ladder's, never a failed start", () => {
  const t = setup();
  t.starts.set("LIN-5", { kind: "acted" });
  t.tick();
  t.starts.set("LIN-5", { kind: "gone" });
  for (let i = 0; i < 5; i++) {
    t.clock.at = new Date(t.clock.at.getTime() + 121_000);
    t.tick();
  }
  expect(t.log).toEqual([]);
  expect(readWaits(t.env)).toEqual([]);
});

test("a start that answers ends its ladder; a silent one that answers after the nudge is left alone", () => {
  const t = setup();
  t.starts.set("LIN-5", { kind: "silent" });
  t.tick();
  t.clock.at = new Date(t.clock.at.getTime() + 121_000);
  t.tick();
  t.starts.set("LIN-5", { kind: "acted" });
  t.clock.at = new Date(t.clock.at.getTime() + 600_000);
  t.tick();
  expect(t.log).toEqual(["nudge LIN-5 [lineclear:resume] Your brief is above b"]);
  expect(readWaits(t.env)).toEqual([]);
});

test("a first turn herdr sees working holds the ladder for 6 minutes; a declared wait holds it for good", () => {
  const t = setup();
  t.tick();
  t.clock.at = new Date(t.clock.at.getTime() + 300_000);
  t.tick();
  expect(t.log).toEqual([]);
  // the planted fault: herdr says working, but the session never gets an answer
  t.clock.at = new Date(t.clock.at.getTime() + 61_000);
  t.tick();
  expect(t.log).toEqual(["nudge LIN-5 [lineclear:resume] Your brief is above b"]);
  t.log.length = 0;
  t.starts.set("LIN-5", { kind: "silent" });
  writeWait({ task: "LIN-5", kind: "owner", reason: "x", since: t.clock.at.toISOString() }, t.env);
  t.tick();
  t.clock.at = new Date(t.clock.at.getTime() + 600_000);
  t.tick();
  expect(t.log).toEqual([]);
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

test("a failed call on a full session moves the task in the same tick, before any stall rung", () => {
  const t = setup();
  t.world.lastError = () => ({ text: SESSION, at: t.clock.at.getTime() - 1000 });
  const d = t.tick();
  expect(t.log).toEqual(["close LIN-5"]);
  expect(t.adds[0]!.join(" ")).toContain("--model openai-codex/gpt-6.1-sol");
  expect(d.filter((x) => x.kind === "stall").map((x) => x.reason)).toEqual([
    expect.stringMatching(/^anthropic is full until 2026-06-01T17:00:00.000Z/),
    expect.stringMatching(/^rung 3/),
  ]);
  expect(readAccounts(t.env).anthropic).toMatchObject({ out: true, window: "session", resetAt: "2026-06-01T17:00:00.000Z" });
  expect(readMoves(t.env)).toMatchObject([{ task: "LIN-5", step: "A", from: "anthropic/claude-sonnet-5-5", to: "openai-codex/gpt-6.1-sol" }]);
});

test("a refused account is unusable, not waiting for a reply: the task restarts on the next account with the plain error", () => {
  const t = setup({ tasks: [{ id: "LIN-5", title: "A Alpha", status: "need", sub: "Waits for your reply" }] });
  const refusal = "Your organization has disabled Claude subscription access for Claude Code";
  t.world.lastError = () => ({ text: refusal, at: t.clock.at.getTime() - 1000 });
  const d = t.tick();
  expect(t.log).toEqual(["close LIN-5"]);
  expect(t.adds[0]!.join(" ")).toContain("--model openai-codex/gpt-6.1-sol");
  expect(readAccounts(t.env).anthropic).toMatchObject({ out: true, dead: refusal });
  expect(readAccounts(t.env).anthropic?.resetAt).toBeUndefined();
  expect(d.some((x) => x.reason.includes(`the anthropic account is unusable: ${refusal}`))).toBe(true);
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

test("a role whose last model is full waits until the reset", () => {
  const t = setup({ worker: ["anthropic/claude-sonnet-5-5"] });
  // the wait spans hours: the wall-time limit is not what this test is about
  const file = join(t.env.LINECLEAR_CONFIG!, "projects", "demo", "settings.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), taskLimitMin: 100_000 }));
  t.world.lastError = () => ({ text: SESSION, at: t.clock.at.getTime() });
  t.tick();
  expect(t.adds).toHaveLength(0);
  expect(readItems(t.env)).toEqual([]);
  const w = readWaits(t.env);
  expect(w).toMatchObject([{ task: "LIN-5", kind: "until", until: "2026-06-01T17:00:00.000Z" }]);
  t.world.lastError = () => undefined;
  t.clock.at = new Date("2026-06-01T12:00:00Z");
  t.tick();
  expect(t.log).toEqual(["stop LIN-5"]);
  t.clock.at = new Date("2026-06-01T17:00:01Z");
  t.tick();
  expect(readWaits(t.env)).toEqual([]);
  expect(t.log.some((l) => l.startsWith("tell LIN-5 Your wait until"))).toBe(true);
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
