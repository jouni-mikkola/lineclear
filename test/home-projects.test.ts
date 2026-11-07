import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homeData } from "../src/home-data.ts";
import { stageSince, stepOf, taskStage } from "../src/home-stage.ts";
import { waitBlocker } from "../src/home-waits.ts";
import { plainTitle, whereTo } from "../src/progress.ts";
import { waitGroups } from "../src/waits.ts";
import { tmp } from "./helpers.ts";
import { NOW } from "./home-fixtures.ts";

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

  test("its stage comes from the record, not the status line", () => {
    expect(taskStage({ stage: "review" }, "work", "Working")).toBe("review");
    expect(taskStage({ stage: "work" }, "work", "In review")).toBe("work");
  });

  test("its time at the stage is the record's, so a restart keeps it", () => {
    const task = { id: "SINCE-1", created: 5, updated: 150, stage: "work" as const, stageAt: 120 };
    expect(stageSince({ id: "SINCE-1", created: 5 }, "queued", 100)).toBe(5);
    expect(stageSince(task, "work", 200)).toBe(120);
    expect(stageSince(task, "work", 99_999)).toBe(120);
    // a record without stageAt: the first read that saw it at the stage
    expect(stageSince({ id: "SINCE-2", created: 5 }, "work", 200)).toBe(200);
    expect(stageSince({ id: "SINCE-2", created: 5 }, "work", 300)).toBe(200);
    expect(stageSince({ id: "SINCE-2", created: 5 }, "review", 400)).toBe(400);
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
    const dir = join(root, "lineclear");
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
    const home = homeData({ LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: cfg, LINECLEAR_SERVER_BIN: bin }, NOW);
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
