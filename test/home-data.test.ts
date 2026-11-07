import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homeData } from "../src/home-data.ts";
import { lastCards, taskState } from "../src/home-stage.ts";
import { whereTo } from "../src/progress.ts";
import { type RoadmapLine, roadmapLine } from "../src/roadmap-line.ts";
import { roadmapMain } from "../src/roadmap-cli.ts";
import { roadmapData } from "../src/roadmap-view.ts";
import { tmp } from "./helpers.ts";

import { NOW, project, repo, sh } from "./home-fixtures.ts";

describe("taskState", () => {
  test("merged is done, a dropped task is left out", () => {
    expect(taskState({ told: "done", merged: true }, undefined)).toBe("done");
    expect(taskState({ told: "done", closed: true }, undefined)).toBeUndefined();
  });
  test("the task list decides, and a told state only stands in when it cannot say", () => {
    expect(taskState({ told: "work" }, "need")).toBe("need");
    expect(taskState({ told: "need" }, "work")).toBe("work");
    expect(taskState({ told: "work" }, "queued")).toBe("queued");
    expect(taskState({ told: "work" }, undefined)).toBe("work");
    expect(taskState({ told: "merging" }, undefined)).toBe("work");
    expect(taskState({ told: "todo" }, undefined)).toBe("queued");
  });
});

test("lastCards keeps the text and time of the latest card of each task over all files", () => {
  const texts = lastCards([
    {
      posted: [
        { at: 1, card: { task: "A-1", text: "old" } },
        { at: 5, card: { task: "A-1", text: "new" } },
      ],
    },
    { posted: [{ at: 3, card: { task: "A-1", text: "mid" } }, { at: 2, card: { task: "A-2", text: "two" } }, { at: 9 }] },
  ]);
  expect(texts.get("A-1")).toEqual({ at: 5, text: "new" });
  expect(texts.get("A-2")?.text).toBe("two");
  expect(texts.size).toBe(2);
});

test("homeData reads projects and states from Lineclear's files", () => {
  const root = tmp("home");
  const dir = join(root, "lineclear");
  mkdirSync(join(dir, "chatlog"), { recursive: true });
  writeFileSync(
    join(dir, "spaces.json"),
    JSON.stringify([
      { name: "alpha", key: "AL", path: join(root, "alpha") },
      { name: "beta", key: "BE", path: join(root, "beta") },
    ]),
  );
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify({
      red: { [join(root, "beta")]: "abc" },
      tasks: [
        { id: "AL-1", title: "First", told: "done", merged: true, created: 1, doneAt: 2 },
        { id: "AL-2", title: "Second", told: "work", created: 3 },
        { id: "AL-3", title: "Dropped", told: "done", closed: true, created: 4 },
        { id: "BE-1", title: "Waits", told: "queued", created: 5 },
      ],
    }),
  );
  // AL-2 works again after a card that asked for it; BE-1 waits, and says why on its last card
  writeFileSync(
    join(dir, "chatlog", "AL-2_Agent.json"),
    JSON.stringify({ posted: [{ at: 9, card: { task: "AL-2", status: "need", text: "Waits for your reply" } }] }),
  );
  writeFileSync(join(dir, "chatlog", "BE-1_Agent.json"), JSON.stringify({ posted: [{ at: 9, card: { task: "BE-1", status: "work", text: "Merge it?" } }] }));
  project(join(root, "config"), "alpha", "alpha");
  project(join(root, "config"), "beta", "beta");
  const bin = join(root, "task-list.sh");
  const list = (space: string) => (space === "alpha" ? [{ id: "AL-2", title: "Second", status: "work" }] : [{ id: "BE-1", title: "Waits", status: "need" }]);
  writeFileSync(
    bin,
    `#!/bin/sh\ncase "$*" in *"--space alpha"*) echo '${JSON.stringify(list("alpha"))}' ;; *"--space beta"*) echo '${JSON.stringify(list("beta"))}' ;; *) echo '${JSON.stringify([...list("alpha"), ...list("beta")])}' ;; esac\n`,
    { mode: 0o755 },
  );
  const d = homeData({ LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: join(root, "config"), LINECLEAR_SERVER_BIN: bin }, NOW);
  expect(d.projects.map((p) => [p.name, p.done, p.total, p.unit, p.broken])).toEqual([
    ["alpha", 1, 2, "tasks", false],
    ["beta", 0, 1, "tasks", false],
  ]);
  expect(d.projects[0]?.tasks.map((t) => [t.title, t.state])).toEqual([
    ["Second", "work"],
    ["First", "done"],
  ]);
  expect(d.projects[1]?.tasks).toMatchObject([{ title: "Waits", state: "need", text: "Merge it?" }]);
});

test("a task whose turn ended with no question is not in Needs you", () => {
  const root = tmp("home");
  const dir = join(root, "lineclear");
  mkdirSync(join(dir, "chatlog"), { recursive: true });
  writeFileSync(
    join(dir, "spaces.json"),
    JSON.stringify([
      { name: "alpha", key: "AL", path: join(root, "alpha") },
      { name: "beta", key: "BE", path: join(root, "beta") },
    ]),
  );
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify({
      red: { [join(root, "beta")]: "abc" },
      tasks: [
        { id: "AL-1", title: "First", told: "done", merged: true, created: 1, doneAt: 2 },
        { id: "AL-2", title: "Second", told: "work", created: 3 },
        { id: "AL-3", title: "Dropped", told: "done", closed: true, created: 4 },
        { id: "BE-1", title: "Waits", told: "queued", created: 5 },
      ],
    }),
  );
  // AL-2 works again after a card that asked for it; BE-1 waits, and says why on its last card
  writeFileSync(
    join(dir, "chatlog", "AL-2_Agent.json"),
    JSON.stringify({ posted: [{ at: 9, card: { task: "AL-2", status: "need", text: "Waits for your reply" } }] }),
  );
  writeFileSync(
    join(dir, "chatlog", "BE-1_Agent.json"),
    JSON.stringify({ posted: [{ at: 9, card: { task: "BE-1", status: "work", text: "Waits for your reply" } }] }),
  );
  project(join(root, "config"), "alpha", "alpha");
  project(join(root, "config"), "beta", "beta");
  const bin = join(root, "task-list.sh");
  const list = (space: string) =>
    space === "alpha" ? [{ id: "AL-2", title: "Second", status: "work" }] : [{ id: "BE-1", title: "Waits", status: "need", sub: "Waits for your reply" }];
  writeFileSync(
    bin,
    `#!/bin/sh\ncase "$*" in *"--space alpha"*) echo '${JSON.stringify(list("alpha"))}' ;; *"--space beta"*) echo '${JSON.stringify(list("beta"))}' ;; *) echo '${JSON.stringify([...list("alpha"), ...list("beta")])}' ;; esac\n`,
    { mode: 0o755 },
  );
  const d = homeData({ LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: join(root, "config"), LINECLEAR_SERVER_BIN: bin }, NOW);
  expect(d.projects[1]?.tasks).toMatchObject([{ title: "Waits", state: "work" }]);
});

test("Home lists the projects, and an open task of a space with no project shows apart", () => {
  const root = tmp("loose");
  const dir = join(root, "lineclear");
  mkdirSync(dir, { recursive: true });
  const names = ["one", "two", "three", "dispatcher", "retired"];
  writeFileSync(join(dir, "spaces.json"), JSON.stringify(names.map((name, i) => ({ name, key: `K${i}`, path: join(root, name) }))));
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify({
      tasks: [
        { id: "K3-1", title: "Chat", told: "done", merged: true, created: 1, doneAt: 2 },
        { id: "K4-1", title: "Left over", told: "work", created: 3 },
      ],
    }),
  );
  const config = join(root, "config");
  for (const n of names.slice(0, 3)) project(config, n, n);
  const bin = join(root, "task-list.sh");
  writeFileSync(bin, "#!/bin/sh\necho '[]'\n", { mode: 0o755 });
  const d = homeData({ LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: config, LINECLEAR_SERVER_BIN: bin }, NOW);
  expect(d.projects.map((p) => p.name)).toEqual(["one", "two", "three"]);
  expect(d.loose).toMatchObject([{ id: "K4-1", space: "retired", state: "work" }]);
});

const setup = (red: (old: string, head: string) => string, roadmap?: string) => {
  const root = tmp("true");
  const dir = join(root, "lineclear");
  mkdirSync(dir, { recursive: true });
  const path = repo(root, "old-folder", roadmap);
  writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "old-folder", key: "OF", path, github: "me/new-name" }]));
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify({
      red: { [path]: red(sh(path, "rev-parse", "HEAD~1"), sh(path, "rev-parse", "HEAD")) },
      tasks: [1, 2].map((n) => ({ id: `OF-${n}`, title: "t", told: "done", merged: true, created: 1, doneAt: NOW - n * 86_400_000 })),
    }),
  );
  // three retired tasks: two merged count, a closed one does not
  mkdirSync(join(dir, "archive"), { recursive: true });
  writeFileSync(join(dir, "archive", "counts.json"), JSON.stringify({ OF: { merged: 2, closed: 1 }, XX: { merged: 9, closed: 0 } }));
  project(join(root, "cfg"), "old-folder", "old-folder");
  const vars = { LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: join(root, "cfg") };
  return homeData(vars, NOW).projects[0]!;
};

test("red shows when the red commit is the head of main", () => {
  expect(setup((_old, head) => head).broken).toBe(true);
});

test("red does not show when the red commit is behind the head of main", () => {
  expect(setup((old) => old).broken).toBe(false);
});

test("the name is the repo's name, not the folder's", () => {
  expect(setup((old) => old).name).toBe("new-name");
});

test("a Now / Next / Later roadmap counts its items, and says where it goes", () => {
  const p = setup(
    (old) => old,
    "# Roadmap\n\n## Machines\n\n- not a step\n\n## Now\n\n1. **Fix the gate.** Done when it holds.\n\n## Next\n\n- Add the page\n- Ship it\n\n## Later\n\n- Think\n\n## Done\n\n- Old thing\n- [x] Other\n",
  );
  expect([p.unit, p.done, p.total, p.phase, p.next]).toEqual(["steps", 2, 6, "Now", "Fix the gate"]);
  // 2 merged in 7 days, 4 steps left: 14 days
  expect(Math.round(((p.finish ?? 0) - NOW) / 86_400_000)).toBe(14);
});

test("stepped roadmap: nothing can start when every open step waits", () => {
  const p = setup(
    (old) => old,
    "# Roadmap\n\n## Phase 1\n\n### A One\n- why: w\n- done when: d\n- locks: x\n- after: B\n\n### B Two\n- why: w\n- done when: d\n- locks: x\n- after: A\n",
  );
  expect(p.next).toBeUndefined();
  expect(p.blocker).toEqual({ text: "every open step waits for another step" });
});

test("Home and the roadmap view give one roadmap the same numbers and the same phase", () => {
  const step = (id: string, phase: string, extra = "") =>
    `## ${phase}\n\n### ${id} Step ${id}\n- why: w\n- done when: d\n- locks: x\n- after: none\n${extra}\n`;
  const text = `# Roadmap\n\n${step("A", "One")}${step("B", "Two")}${step("C", "One")}${step("D", "One", "- dropped: no longer wanted\n")}`;
  const root = tmp("agree");
  const dir = join(root, "lineclear");
  mkdirSync(dir, { recursive: true });
  const path = repo(root, "proj", text);
  sh(path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "OF-1: A done");
  sh(path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "OF-2: B done");
  writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "proj", key: "OF", path }]));
  writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks: [] }));
  mkdirSync(join(root, "cfg", "projects", "proj"), { recursive: true });
  writeFileSync(join(root, "cfg", "projects", "proj", "settings.json"), JSON.stringify({ repo: path, space: "proj" }));
  const vars = { LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: join(root, "cfg"), LINECLEAR_SERVER_BIN: "true" };
  const home = homeData(vars, NOW).projects[0]!;
  const view = roadmapData("proj", vars, () => []);
  if (!("ok" in view)) throw new Error("no roadmap data");
  expect([view.ok.done, view.ok.total, view.ok.phase]).toEqual([home.done, home.total, home.phase]);
  // A and B done, D dropped: 2 of 3, and C keeps the project in phase One although B is in Two
  expect([home.done, home.total, home.phase]).toEqual([2, 3, "One"]);
});

test("the CLI, the roadmap view and Home give one roadmap the same line: counts, date and reason", () => {
  const step = (id: string, after: string) => `## One\n\n### ${id} Step ${id}\n- why: w\n- done when: d\n- locks: x\n- after: ${after}\n\n`;
  const text = `# Roadmap\n\n${step("S1", "none")}${step("S2", "S1")}${step("S3", "S2")}${step("S4", "none")}`;
  const root = tmp("line-agree");
  const dir = join(root, "lineclear");
  mkdirSync(dir, { recursive: true });
  const path = repo(root, "proj", text);
  sh(path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-m", "OF-1: S1 done\n\nStep: S1");
  sh(path, "update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "proj", key: "OF", path }]));
  const tasks = [
    { id: "OF-2", title: "S2 Step S2", told: "work", created: 2 },
    { id: "OF-3", title: "S4 Step S4", told: "work", created: 3 },
  ];
  writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks }));
  mkdirSync(join(root, "cfg", "projects", "proj"), { recursive: true });
  writeFileSync(join(root, "cfg", "projects", "proj", "settings.json"), JSON.stringify({ repo: path, space: "proj" }));
  writeFileSync(join(root, "cfg", "projects", "proj", "state.json"), JSON.stringify({ taskSteps: { "OF-2": "S2", "OF-3": "S4" } }));
  const vars = { LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: join(root, "cfg"), LINECLEAR_SERVER_BIN: "true" };
  const now = Date.now();
  const listed = [
    { id: "OF-2", title: "S2 Step S2", status: "work" },
    { id: "OF-3", title: "S4 Step S4", status: "work" },
  ];
  const home = homeData(vars, now).projects[0];
  if (!home) throw new Error("no project");
  const view = roadmapData("proj", vars, () => listed, now);
  if (!("ok" in view)) throw new Error("no roadmap data");
  const lines: string[] = [];
  roadmapMain(
    ["status", path, "--space", "proj"],
    (l) => lines.push(l),
    () => listed,
    vars,
    now,
  );
  expect(view.ok.line).toEqual(home.line as RoadmapLine);
  expect(lines[0]).toBe(view.ok.line.text);
  expect(view.ok.line).toMatchObject({ done: 1, work: 2, waiting: 0, left: 1, total: 4 });
  // one step merged in the last 7 days, three left: 21 days; all three hold the same lock
  expect(view.ok.line.finish).toBe(now - (now % 3_600_000) + 3 * 7 * 86_400_000);
  expect(view.ok.line.why).toBe("3 steps use the same part and go one at a time");
});

test("the line counts steps waiting for you, names the longest chain, and says so with no pace", () => {
  const st = (id: string, after: string[], done = false) => ({ id, title: id, phase: "P", done, after, locks: [] });
  const plan = { steps: [st("A", [], true), st("B", ["A"]), st("C", ["B"]), st("D", ["C"]), st("E", [])] };
  const marks = new Map<string, "work" | "need">([
    ["B", "need"],
    ["E", "work"],
  ]);
  const line = roadmapLine(plan, marks, whereTo(plan, [], 7, NOW), 7);
  expect(line).toMatchObject({ done: 1, work: 1, waiting: 1, left: 2, total: 5, why: "3 steps wait on each other in a row" });
  expect(line.text).toContain("1 done, 1 at work, 1 waiting for you, 2 left. Done about");
  const none = roadmapLine(plan, marks, whereTo(plan, [], 0, NOW), 0);
  expect(none.finish).toBeUndefined();
  expect(none.text).toContain("No finish date yet");
  expect(roadmapLine({ steps: [st("A", [], true)] }, new Map(), {}, 0).text).toBe("The only step is done.");
});

test("a task named after a step shows the step's full title, its stage, model and time there", () => {
  const text =
    "# Roadmap\n\n## One\n\n### U20 The line, drawn live on every page\n- why: w\n- done when: d\n- locks: x\n- after: none\n\n### U21 Next\n- why: w\n- done when: d\n- locks: x\n- after: none\n";
  const root = tmp("line");
  const dir = join(root, "lineclear");
  mkdirSync(dir, { recursive: true });
  const path = repo(root, "proj", text);
  writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "proj", key: "PR", path }]));
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify({
      tasks: [
        {
          id: "PR-1",
          title: "U20 The line, drawn live o",
          told: "work",
          created: 1,
          agent: { model: "openai/gpt-codex" },
          reviewer: { model: "anthropic/claude-opus" },
        },
        { id: "PR-2", title: "U21 Next", told: "work", created: 2, reported: true },
        { id: "PR-3", title: "Fix the gate", told: "queued", created: 3 },
        { id: "PR-4", title: "Quiet one", told: "work", created: 4, stalled: { life: 4 } },
        { id: "PR-5", title: "Woke again", told: "work", created: 5, stalled: { over: 5 } },
      ],
    }),
  );
  const list = [
    { id: "PR-1", title: "U20 The line, drawn live o", status: "work", sub: "In review, round 1" },
    { id: "PR-2", title: "U21 Next", status: "work" },
    { id: "PR-3", title: "Fix the gate", status: "queued" },
    { id: "PR-4", title: "Quiet one", status: "work" },
    { id: "PR-5", title: "Woke again", status: "work" },
  ];
  const bin = join(root, "task-list.sh");
  writeFileSync(bin, `#!/bin/sh\necho '${JSON.stringify(list)}'\n`, { mode: 0o755 });
  project(join(root, "cfg"), "proj", "proj");
  const vars = { LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: join(root, "cfg"), LINECLEAR_SERVER_BIN: bin };
  const tasks = homeData(vars, NOW).projects[0]!.tasks;
  expect(tasks.map((t) => [t.id, t.title, t.stage, t.step, t.model])).toEqual([
    ["PR-1", "U20 The line, drawn live on every page", "review", "U20", "anthropic/claude-opus"],
    ["PR-2", "U21 Next", "ready", "U21", undefined],
    ["PR-3", "Fix the gate", "queued", undefined, undefined],
    ["PR-4", "Quiet one", "work", undefined, undefined],
    ["PR-5", "Woke again", "work", undefined, undefined],
  ]);
  // a stall that is over keeps its record in Lineclear, but the task is not stalled
  expect(tasks.filter((t) => t.stalled).map((t) => t.id)).toEqual(["PR-4"]);
  expect(tasks.find((t) => t.id === "PR-3")?.since).toBe(3);
});

test("no roadmap falls back to tasks, with no estimate", () => {
  const p = setup((old) => old);
  expect([p.unit, p.done, p.total, p.finish]).toEqual(["tasks", 4, 4, undefined]);
});

describe("the merge lane's stall on Home", () => {
  const rows = (tasks: object[]) => {
    const root = tmp("lane");
    const dir = join(root, "lineclear");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "alpha", key: "AL", path: join(root, "alpha") }]));
    writeFileSync(join(dir, "tasks.json"), JSON.stringify({ tasks }));
    project(join(root, "config"), "alpha", "alpha");
    const d = homeData({ LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: join(root, "config") }, NOW);
    return d.projects[0]?.tasks ?? [];
  };
  const hung = 'Your merge hung in "Rebasing on main" for 15 min (no progress for 15 min), so the merge lane released it and nothing was merged.';
  const head = (landing: object) => ({ id: "AL-1", title: "Head", told: "merging", reported: true, created: 1, landing });

  test("a head with no progress for 15 minutes is stuck in its step", () => {
    const [stuck, fresh] = rows([head({ step: "rebase", at: NOW - 17 * 60_000 }), { ...head({ step: "rebase", at: NOW - 5 * 60_000 }), id: "AL-2" }]);
    expect(stuck?.lane).toBe('Stuck in "Rebasing" for 17 min');
    expect(fresh?.lane).toBeUndefined();
  });
  test("a released task says so until it joins the line again", () => {
    const [t] = rows([{ id: "AL-1", title: "Head", told: "work", reported: true, created: 1, mergeStopped: hung }]);
    expect(t?.lane).toBe('Released from the merge line: hung in "Rebasing on main" for 15 min (no progress for 15 min)');
  });
  test("a release field names the step, whatever the sentence says", () => {
    const [t] = rows([{ id: "AL-1", title: "Head", told: "work", reported: true, created: 1, mergeStopped: "other words", laneReleased: 'hung in "Merging"' }]);
    expect(t?.lane).toBe('Released from the merge line: hung in "Merging"');
  });
  test("a working task keeps its start across reads at other times, as after a restart", () => {
    const task = { id: "AL-1", title: "Work", told: "work", created: 1, stage: "review", stageAt: NOW - 5000, reported: false };
    const [first] = rows([task]);
    const [later] = rows([task]);
    expect([first?.stage, first?.since, later?.since]).toEqual(["review", NOW - 5000, NOW - 5000]);
  });
  test("a task that joined the line again, or merged, carries no release", () => {
    const [back, done] = rows([
      { ...head({ step: "queue", at: NOW - 1000 }), mergeStopped: hung },
      { id: "AL-2", title: "Done", told: "done", merged: true, created: 1, mergeStopped: hung },
    ]);
    expect(back?.lane).toBeUndefined();
    expect(done?.lane).toBeUndefined();
  });
});
