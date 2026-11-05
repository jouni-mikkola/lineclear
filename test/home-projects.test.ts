import { describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monthSpend, homeData, piSpendAndUsage, spendAndUsage, stageSince, stepOf, taskStage } from "../src/home-data.ts";
import { waitBlocker } from "../src/home-waits.ts";
import { plainTitle, whereTo } from "../src/progress.ts";
import { waitGroups } from "../src/waits.ts";
import { tmp } from "./helpers.ts";
import { sessionLine, writeSessions } from "../scripts/fake-sessions.ts";
import { NOW, usage } from "./home-fixtures.ts";

describe("where a task is on the line", () => {
  test("a step id starts the title", () => {
    expect(stepOf("U20 The line, drawn live")).toBe("U20");
    expect(stepOf("L8 Pilot")).toBe("L8");
    expect(stepOf("Fix the gate")).toBeUndefined();
    expect(stepOf("U20")).toBeUndefined();
  });

  test("its stage: in line, at work, in review, ready, merged", () => {
    expect(taskStage({}, "queued")).toBe("queued");
    expect(taskStage({}, "work")).toBe("work");
    expect(taskStage({}, "need", "In review, round 2")).toBe("review");
    expect(taskStage({ reported: true }, "work", "In review")).toBe("ready");
    expect(taskStage({ reported: true }, "done")).toBe("done");
  });

  test("its time at the stage holds while it stays, and starts again when it moves", () => {
    const task = { id: "SINCE-1", created: 5 };
    expect(stageSince(task, "queued", 100)).toBe(5);
    expect(stageSince(task, "work", 200)).toBe(200);
    expect(stageSince(task, "work", 300)).toBe(200);
    expect(stageSince(task, "review", 400)).toBe(400);
  });
});

describe("the line under a project", () => {
  const wait = (kind: any, extra = {}) =>
    waitBlocker({ task: "OF-1", kind, reason: "Which mail provider do we use for the new sign-up mails?", since: "", ...extra });

  test("a step shows its plain title, with no id and no closing full stop", () => {
    expect(plainTitle("Data sync made light (AGE-25).")).toBe("Data sync made light");
    expect(plainTitle("AGE-25: Fix the gate.")).toBe("Fix the gate");
    expect(plainTitle("Wait for it...")).toBe("Wait for it...");
  });

  test("a blocker is named by its kind and links to it, never quoting the question", () => {
    expect(wait("owner")).toEqual({ text: "a question waits for you", href: "/inbox" });
    expect(wait("login")).toEqual({ text: "a login waits for you", href: "/browsers" });
    expect(wait("checks")).toEqual({ text: "waits for a check slot" });
    expect(wait("until", { until: "2026-11-20T08:00:00Z" })).toEqual({ text: "waits until 20 Nov", until: Date.parse("2026-11-20T08:00:00Z") });
  });

  test("the finish date is never earlier than the end of a dated wait on an open task, and differs from it", () => {
    const plan = { steps: [{ id: "A", title: "One", phase: "P", done: false, after: [], locks: [] }] };
    const until = Date.parse("2026-12-24T00:00:00Z");
    // one step left at 7 a week: the pace alone says tomorrow
    expect(whereTo(plan, [], 7, NOW).finish).toBe(NOW + 86_400_000);
    const w = whereTo(plan, [wait("until", { until: new Date(until).toISOString() })], 7, NOW);
    // the waiting task still takes a step's time, a day at this pace, once the wait ends
    expect(w.finish).toBe(until + 86_400_000);
    expect(w.blocker).toEqual({ text: "waits until 24 Dec" });
  });
});

describe("spend cache", () => {
  const NOW2 = Date.parse("2026-10-31T12:00:00Z");

  test("500 session files: same totals as a full read, a warm refresh reads none of them, grown files re-read", () => {
    const root = tmp("spend");
    const pi = join(root, "pi");
    const env = { PI_CODING_AGENT_DIR: pi, XDG_CACHE_HOME: join(root, "cache") };
    writeSessions(pi, NOW2, 500);
    const cold = piSpendAndUsage(env, NOW2);
    // unreadable now, so a warm refresh that read one would miss its totals (how fast it is: scripts/measure-speed.ts)
    const files = readdirSync(join(pi, "sessions"), { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => join(pi, "sessions", f));
    for (const f of files) chmodSync(f, 0o000);
    const warm = piSpendAndUsage(env, NOW2);
    for (const f of files) chmodSync(f, 0o644);
    expect(warm).toEqual(cold);
    expect(existsSync(join(root, "cache", "lineclear", "spend.json"))).toBe(true);
    // the same totals as with no cache at all
    expect(piSpendAndUsage({ ...env, XDG_CACHE_HOME: join(root, "other") }, NOW2)).toEqual(cold);
    // a grown file is read again
    appendFileSync(join(pi, "sessions", "--f0--", "s0.jsonl"), `${sessionLine(NOW2, 99999).replace('"provider":"a"', '"provider":"c"')}\n`);
    expect(piSpendAndUsage(env, NOW2).active).toEqual(["a", "b", "c"]);
  });
});

test("a broken spend cache is read over, not crashed on", () => {
  const root = tmp("spend-bad");
  const dir = join(root, "pi", "sessions", "--f--");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "s.jsonl"),
    `${JSON.stringify({ timestamp: "2026-10-31T11:00:00Z", message: { role: "assistant", model: "m", provider: "a", usage: { input: 5, output: 0 } } })}\n`,
  );
  mkdirSync(join(root, "cache", "lineclear"), { recursive: true });
  const env = { PI_CODING_AGENT_DIR: join(root, "pi"), XDG_CACHE_HOME: join(root, "cache") };
  for (const bad of ["null", "[]", "not json"]) {
    writeFileSync(join(root, "cache", "lineclear", "spend.json"), bad);
    expect(piSpendAndUsage(env, Date.parse("2026-10-31T12:00:00Z")).active).toEqual(["a"]);
  }
});

describe("month spend: paid and at API prices", () => {
  const price = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }; // $1 a token
  const MID = Date.parse("2026-10-20T12:00:00Z");
  const msg = (at: number, account: string, n: number) => ({ at, account, usage: usage(n) });

  test("two subscriptions and one API key", () => {
    const pi = spendAndUsage([msg(MID - 1000, "a", 30), msg(MID - 2000, "b", 10), msg(MID - 3000, "k", 5)], () => price, MID);
    const m = monthSpend(
      pi,
      { a: { kind: "subscription", price: 100, currency: "USD" }, b: { kind: "subscription", price: 20, currency: "USD" }, k: { kind: "key" } },
      MID,
    )!;
    expect(m.month).toBe("2026-10");
    expect(m.paid).toEqual([{ amount: 125, currency: "USD" }]);
    expect(m.paidUnknown).toBe(false);
    expect(m.apiEquivalent).toBe(45);
    expect(m.accounts.find((a) => a.account === "a")).toEqual({
      account: "a",
      kind: "subscription",
      paid: { amount: 100, currency: "USD" },
      apiEquivalent: 30,
    });
    expect(m.accounts.find((a) => a.account === "k")?.paid).toEqual({ amount: 5, currency: "USD" });
  });

  test("a subscription without a price is not reported, never 0", () => {
    const pi = spendAndUsage([msg(MID - 1000, "a", 30), msg(MID - 2000, "b", 10)], () => price, MID);
    const m = monthSpend(pi, { a: { kind: "subscription", price: 100, currency: "EUR" } }, MID)!;
    expect(m.paid).toEqual([{ amount: 100, currency: "EUR" }]);
    expect(m.paidUnknown).toBe(true);
    const b = m.accounts.find((a) => a.account === "b")!;
    expect(b.paid).toBeUndefined();
    expect(b.apiEquivalent).toBe(10);
    const none = monthSpend(pi, {}, MID)!;
    expect(none.paid).toEqual([]);
    expect(none.paidUnknown).toBe(true);
  });

  test("tokens with no list price are not reported, never 0", () => {
    const pi = spendAndUsage([msg(MID - 1000, "a", 30)], () => undefined, MID);
    const m = monthSpend(pi, { a: { kind: "key" } }, MID)!;
    expect(m.apiEquivalent).toBeUndefined();
    expect(m.accounts[0]!.paid).toBeUndefined();
    expect(m.accounts[0]!.apiEquivalent).toBeUndefined();
  });

  test("a month boundary: last month's tokens do not count, and a new month starts at 0 tokens but full prices", () => {
    const last = Date.parse("2026-09-30T23:30:00Z");
    const first = Date.parse("2026-10-01T00:30:00Z");
    const now = Date.parse("2026-10-01T06:00:00Z");
    const pi = spendAndUsage([msg(last, "a", 100), msg(first, "a", 3)], () => price, now);
    const m = monthSpend(pi, { a: { kind: "subscription", price: 100, currency: "USD" } }, now)!;
    expect(m.month).toBe("2026-10");
    expect(m.apiEquivalent).toBe(3);
    expect(m.paid).toEqual([{ amount: 100, currency: "USD" }]);
    // the 14 day chart still sees both days
    expect(pi.spend.reduce((s, d) => s + d.dollars, 0)).toBe(103);
    // no tokens yet this month: the API equivalent is a known 0, the subscription is still paid in full
    const empty = monthSpend(
      spendAndUsage([msg(last, "a", 100)], () => price, now),
      { a: { kind: "subscription", price: 100, currency: "USD" } },
      now,
    )!;
    expect(empty.apiEquivalent).toBe(0);
    expect(empty.paid).toEqual([{ amount: 100, currency: "USD" }]);
  });

  test("the window reads the whole month, not only 14 days", () => {
    const root = tmp("month-window");
    const now = Date.parse("2026-10-30T12:00:00Z");
    const dir = join(root, "pi", "sessions", "s");
    mkdirSync(dir, { recursive: true });
    const early = join(dir, "early.jsonl");
    writeFileSync(
      early,
      `${JSON.stringify({ timestamp: "2026-10-02T10:00:00Z", message: { role: "assistant", provider: "p", model: "m", usage: { input: 7, output: 0, cacheRead: 0, cacheWrite: 0 } } })}\n`,
    );
    const t = new Date("2026-10-02T10:00:00Z");
    require("node:fs").utimesSync(early, t, t);
    const env = { HOME: root, PI_CODING_AGENT_DIR: join(root, "pi"), XDG_CACHE_HOME: join(root, "cache") } as NodeJS.ProcessEnv;
    const pi = piSpendAndUsage(env, now);
    expect(pi.monthAccounts).toEqual(["p"]);
  });
});

describe("why work waits", () => {
  const roadmap = [
    "# Roadmap",
    "",
    "## One",
    "",
    ...[
      ["U1", "Held by a lock"],
      ["U2", "Held by a full machine"],
      ["U3", "Holds the lock"],
    ].flatMap(([id, title]) => [`### ${id} ${title}`, "- why: w", "- done when: d", "- locks: ui", "- after: none", ""]),
  ].join("\n");

  test("five tasks that wait for one task count together, and ready steps say why they have not started", () => {
    const root = tmp("waiting");
    const dir = join(root, "shepherdr");
    const cfg = join(root, "cfg");
    mkdirSync(dir, { recursive: true });
    const path = join(root, "proj");
    mkdirSync(join(path, "docs"), { recursive: true });
    writeFileSync(join(path, "docs", "ROADMAP.md"), roadmap);
    const git = (...a: string[]) => Bun.spawnSync(["git", "-C", path, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    git("init", "-b", "main");
    git("commit", "--allow-empty", "-m", "first");
    writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "proj", key: "PR", path }]));
    const tasks = [
      { id: "PR-1", title: "U3 Holds the lock", told: "work", created: 1 },
      ...[2, 3, 4, 5, 6].map((n) => ({ id: `PR-${n}`, title: `Merge ${n}`, told: "queued", created: n })),
    ];
    writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks }));
    mkdirSync(join(cfg, "projects", "lc"), { recursive: true });
    writeFileSync(join(cfg, "projects", "lc", "settings.json"), JSON.stringify({ repo: path, space: "proj" }));
    mkdirSync(join(cfg, "waits"), { recursive: true });
    // two wait by a task wait, three by a timed wait whose reason names the task
    const wait = (n: number, w: object) =>
      writeFileSync(join(cfg, "waits", `PR-${n}.json`), JSON.stringify({ task: `PR-${n}`, since: "2026-10-31T11:00:00Z", ...w }));
    wait(2, { kind: "task", for: "PR-1", reason: "waits for PR-1" });
    wait(3, { kind: "task", for: "PR-1", reason: "waits for PR-1" });
    for (const n of [4, 5, 6]) wait(n, { kind: "until", until: "2026-11-02T10:00:00Z", reason: "merge waits for PR-1 to land" });
    const decision = (step: string, reason: string) =>
      `${JSON.stringify({ time: new Date(NOW - 60_000).toISOString(), project: "lc", step, kind: "skip", reason })}\n`;
    writeFileSync(
      join(cfg, "decisions.jsonl"),
      decision("U1", "lock 'ui' is held by U3") + decision("U2", "load average is above the limit of 4, no new task starts"),
    );
    const bin = join(root, "task-list.sh");
    writeFileSync(bin, `#!/bin/sh\necho '${JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, status: t.id === "PR-1" ? "work" : "queued" })))}'\n`, {
      mode: 0o755,
    });
    const home = homeData({ LINECLEAR_SHEPHERDR_DIR: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: cfg, SHEPHERDR_BIN: bin }, NOW);
    const w = home.projects[0]?.waiting;
    if (!w) throw new Error("no waiting");
    expect(w.running.map((t) => [t.title, t.stage])).toEqual([["U3 Holds the lock", "work"]]);
    expect(w.paused).toEqual([{ text: "5 tasks wait for U3 Holds the lock", count: 5 }]);
    expect(w.notStarted).toEqual([
      { title: "U1 Held by a lock", reason: "waits for U3 Holds the lock, which works on the same part" },
      { title: "U2 Held by a full machine", reason: "the machine is too busy to start more" },
    ]);
    expect(JSON.stringify([w.paused, w.notStarted])).not.toMatch(/PR-\d|'ui'/);
  });
});

test("every kind of wait is said in words", () => {
  const w = (kind: string) => ({ task: "A-1", kind, reason: "r", since: "" }) as never;
  const say = (kind: string) => waitGroups([w(kind)], new Map([["A-1", "Task"]]))[0]?.text;
  expect(say("owner")).toBe("Task waits for your answer");
  expect(say("checks")).toBe("Task waits for a check slot");
  expect(say("start")).toBe("Task did not start");
});
