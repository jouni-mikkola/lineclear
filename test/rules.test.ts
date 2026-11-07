import { freshDecisions } from "../src/decision-dedupe.ts";
import { expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { readItems } from "../src/inbox.ts";
import { decisionsPath } from "../pi/config.ts";
import { readState, realWorld, runMain, tick, TICK_MS } from "../src/rules.ts";
import { pickReviewer } from "../src/stalls.ts";
import { company } from "../src/company.ts";
import { recordTaskSteps } from "./helpers.ts";
import { setup, status, step } from "./rules-world.ts";
import type { World } from "../src/world.ts";

test("a ready step starts with the brief from the template", () => {
  const t = setup({ steps: [step("A", "none")], rounds: 3 });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["A:start"]);
  const [add] = t.adds();
  expect(add!.slice(0, 3)).toEqual(["task", "add", "A Title A"]);
  const brief = add![add!.indexOf("--brief") + 1]!;
  expect(add).toContain("--space");
  expect(brief).toContain("because A");
  expect(brief).toContain("  - first A\n  - second A");
  expect(brief).toContain("`bun run check`");
  expect(brief).toContain("openai-codex/gpt-6.1-sol");
  expect(brief).toContain("at most 3 rounds");
  expect(brief).not.toContain("{{");
  expect(add![add!.indexOf("--reviewer-model") + 1]).toBe("openai-codex/gpt-6.1-sol");
});

test("a task closed with nothing to merge marks its step done: the next tick starts nothing for it", () => {
  const t = setup({
    steps: [step("A", "none")],
    tasks: [{ id: "LIN-1", title: "A Title A", status: "done", sub: "Nothing to merge", closed: true, closedBy: "done" }],
  });
  writeFileSync(join(t.config, "projects", "demo", "state.json"), JSON.stringify({ taskSteps: { "LIN-1": "A" } }));
  const first = t.doTick();
  expect(first.some((x) => x.kind === "start")).toBe(false);
  expect(first.find((x) => x.step === "A")!.reason).toContain("LIN-1 closed with nothing to merge");
  expect(t.decisions().some((x) => x.step === "A" && x.reason.includes("nothing to merge"))).toBe(true);
  // even when the task is gone from the list (archived)
  writeFileSync(join(t.fake, "tasks.json"), "[]");
  t.doTick();
  expect(t.adds()).toEqual([]);
});

test("a task closed any other way (moved, Dispatcher close) does not mark its step done", () => {
  const t = setup({
    steps: [step("A", "none")],
    tasks: [{ id: "LIN-1", title: "A Title A", status: "done", sub: "Nothing to merge", closed: true, closedBy: "close" }],
  });
  writeFileSync(join(t.config, "projects", "demo", "state.json"), JSON.stringify({ taskSteps: { "LIN-1": "A" } }));
  expect(t.doTick().some((x) => x.kind === "close")).toBe(false);
});

test("a closed step whose named test fails is not restarted and gets no Fix task", () => {
  const named = step("A", "none").replace("first A", "`bun test missing.test.ts` passes");
  const t = setup({ steps: [named], tasks: [{ id: "LIN-1", title: "A Title A", status: "done", closed: true, closedBy: "done" }] });
  writeFileSync(join(t.config, "projects", "demo", "state.json"), JSON.stringify({ taskSteps: { "LIN-1": "A" } }));
  t.doTick();
  t.doTick();
  expect(t.adds().length).toBe(0);
});

/** A tick whose world answers like the one it read first, until the step is about to start: then the second read differs. */
function staleTick(t: ReturnType<typeof setup>, later: Partial<World>) {
  const real = realWorld(t.env);
  const reads = { main: 0 };
  const world: World = {
    ...real,
    load: () => 0,
    now: () => t.now.at,
    tasks: (space) => (reads.main > 1 ? (later.tasks ?? real.tasks)(space) : real.tasks(space)),
    main: (repo) => (reads.main++ === 0 ? real.main(repo) : (later.main ?? real.main)(repo)),
  };
  return tick(world, false, t.env);
}

test("a step whose task appeared since the tick read its list is not started again", () => {
  const t = setup({ steps: [step("A", "none")] });
  staleTick(t, { tasks: () => [{ id: "LIN-9", title: "A Title A", status: "work" }] });
  expect(t.adds()).toEqual([]);
  expect(t.decisions().some((x) => x.step === "A" && x.reason.includes("does not start twice"))).toBe(true);
});

test("the same step added twice gives one start and one refusal", () => {
  const t = setup({ steps: [step("A", "none")] });
  t.doTick();
  writeFileSync(join(t.fake, "tasks.json"), JSON.stringify([{ id: "LIN-1", title: "A Title A", status: "work" }]));
  const second = t.doTick();
  expect(t.adds().length).toBe(1);
  expect(second.some((x) => x.kind === "start")).toBe(false);
  const lock = join(t.config, "projects", "demo", "tick.lock");
  writeFileSync(lock, String(process.pid));
  const refused = t.doTick();
  expect(refused.some((x) => x.kind === "skip" && x.reason.includes("another tick is running"))).toBe(true);
  expect(t.adds().length).toBe(1);
  rmSync(lock);
  t.doTick();
  expect(t.adds().length).toBe(1);
  expect(existsSync(lock)).toBe(false);
});

test("a step closed with nothing to merge since the tick read its list is not started", () => {
  const t = setup({ steps: [step("A", "none")] });
  const closed = { id: "LIN-9", title: "A Title A", status: "done", closed: true, closedBy: "done" } as const;
  writeFileSync(join(t.config, "projects", "demo", "state.json"), JSON.stringify({ taskSteps: { "LIN-9": "A" } }));
  staleTick(t, { tasks: () => [closed] });
  expect(t.adds()).toEqual([]);
  expect(t.decisions().some((x) => x.step === "A" && x.reason.includes("closed with nothing to merge"))).toBe(true);
});

test("a step merged on origin/main since the tick read it is not started", () => {
  const t = setup({ steps: [step("A", "none")] });
  const real = realWorld(t.env);
  staleTick(t, { main: (repo) => ({ ...(real.main(repo) as object), commits: [{ subject: "LIN-9: A Title A", body: "" }] }) as ReturnType<World["main"]> });
  expect(t.adds()).toEqual([]);
  expect(t.decisions().some((x) => x.step === "A" && x.reason.includes("merged on origin/main"))).toBe(true);
});

test("the order of the worker list decides the model the next task starts on", () => {
  const model = (worker: string[]) => {
    const t = setup({ steps: [step("A", "none")], worker });
    t.doTick();
    const add = t.adds()[0]!;
    return add[add.indexOf("--model") + 1];
  };
  expect(model(["anthropic/claude-sonnet-5-5", "openai-codex/gpt-6.1-sol"])).toBe("anthropic/claude-sonnet-5-5");
  expect(model(["openai-codex/gpt-6.1-sol", "anthropic/claude-sonnet-5-5"])).toBe("openai-codex/gpt-6.1-sol");
});

test("the model list is read only when a step is about to start, and at most every 10 minutes", () => {
  const t = setup({ steps: [step("A", "none", "a")], tasks: [{ id: "LIN-1", title: "A Title A", status: "work" }] });
  recordTaskSteps(t.config, { "LIN-1": "A" });
  for (let i = 0; i < 20; i++) t.doTick();
  expect(t.piCalls()).toEqual([]);
  const s = setup({ steps: [step("A", "none", "a"), step("B", "none", "b")], max: 1 });
  expect(s.doTick().map((x) => x.kind)).toEqual(["start", "skip"]);
  expect(s.piCalls()).toEqual(["--list-models"]);
  s.doTick();
  expect(s.piCalls().length).toBe(1);
  s.now.at = new Date(s.now.at.getTime() + 11 * 60_000);
  s.doTick();
  expect(s.piCalls().length).toBe(2);
});

test("after: a step waits for the steps it follows, and starts when they are done on main", () => {
  const steps = [step("A", "none", "a"), step("B", "A", "b")];
  const t = setup({ steps });
  expect(t.doTick().map((x) => x.step)).toEqual(["A"]);
  const merged = setup({ steps, commits: ["LIN-1: A Title A"] });
  expect(merged.doTick().map((x) => x.step)).toEqual(["B"]);
});

test("a step with free locks, a free slot and an idle machine starts in the tick that sees it ready", () => {
  const steps = [step("A", "none", "a"), step("B", "A", "b")];
  // B's predecessor merged: this is the first tick that sees B ready, and it starts B, with no skip line before.
  const t = setup({ steps, commits: ["LIN-1: A Title A"], tasks: [] });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["B:start"]);
  expect(t.adds()).toHaveLength(1);
});

test("locks: a step whose lock is held, or taken in the same tick, does not start", () => {
  const t = setup({
    steps: [step("A", "none", "rules"), step("B", "none", "rules"), step("C", "none", "other,docs"), step("D", "none", "docs")],
    tasks: [],
  });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["A:start", "B:skip", "C:start", "D:skip"]);
  expect(d[1]!.reason).toContain("lock 'rules' is held by A");
  expect(d[3]!.reason).toContain("lock 'docs' is held by C");

  const busy = setup({ steps: [step("A", "none", "rules"), step("B", "none", "rules")], tasks: [{ id: "LIN-1", title: "A Title A", status: "work" }] });
  recordTaskSteps(busy.config, { "LIN-1": "A" });
  const e = busy.doTick();
  expect(e.map((x) => `${x.step}:${x.kind}`)).toEqual(["B:skip"]);
  expect(e[0]!.reason).toContain("held by A");
});

test("a full space starts nothing and says why; queued tasks count as full", () => {
  const full = setup({
    steps: [step("A", "none", "a"), step("B", "none", "b")],
    max: 2,
    tasks: [
      { title: "X x", status: "work" },
      { title: "Y y", status: "work" },
    ],
  });
  const d = full.doTick();
  expect(d.map((x) => x.kind)).toEqual(["skip", "skip"]);
  expect(d[0]!.reason).toContain("no free slot");
  expect(full.adds()).toHaveLength(0);

  const queued = setup({ steps: [step("A", "none")], max: 3, tasks: [{ title: "X x", status: "queued" }] });
  expect(queued.doTick()[0]!.kind).toBe("skip");

  const slot = setup({ steps: [step("A", "none")], max: 3, tasks: [{ title: "X x", status: "queued", sub: "Waiting for a free slot" }] });
  expect(slot.doTick()[0]!.kind).toBe("skip");

  const chained = setup({ steps: [step("A", "none")], max: 3, tasks: [{ title: "X x", status: "queued", sub: "After LIN-55" }] });
  expect(chained.doTick()[0]!.kind).toBe("start");

  const one = setup({ steps: [step("A", "none", "a"), step("B", "none", "b")], max: 1 });
  expect(one.doTick().map((x) => `${x.step}:${x.kind}`)).toEqual(["A:start", "B:skip"]);
});

test("a broken roadmap starts nothing and shows in status", async () => {
  const t = setup({ roadmap: "# Roadmap\n\n### A T\n- why: x\n- locks: r\n- after: none\n" });
  const d = t.doTick();
  expect(d).toHaveLength(1);
  expect(d[0]!.reason).toContain("roadmap is broken");
  expect(t.adds()).toHaveLength(0);
  expect(readState("demo", t.env).roadmapErrors[0]).toContain("ROADMAP.md:3:");
  expect(await status(t)).toContain("roadmap broken, nothing starts");
});

test("a failing health command starts one fix task; a second failure in a row stops starts", async () => {
  const t = setup({ steps: [step("A", "none")], health: "echo boom-output; exit 1", max: 5 });
  const first = t.doTick();
  expect(first.map((x) => `${x.step ?? "-"}:${x.kind}`)).toEqual(["-:start", "A:start"]);
  const fix = t.adds()[0]!;
  expect(fix[2]).toStartWith("Fix health");
  expect(fix[fix.indexOf("--brief") + 1]).toContain("boom-output");

  // Same head: the command is not run again and no second fix starts.
  writeFileSync(
    join(t.fake, "tasks.json"),
    JSON.stringify([
      { title: "A Title A", status: "work" },
      { title: "Fix health x", status: "work" },
    ]),
  );
  expect(t.doTick().filter((x) => x.step === undefined)).toHaveLength(0);
  expect(t.adds()).toHaveLength(2);

  // Main moves and the command fails again: stopped.
  t.git("commit", "-q", "--allow-empty", "-m", "merge two");
  t.git("update-ref", "refs/remotes/origin/main", "HEAD");
  const second = t.doTick();
  expect(second.some((x) => x.reason.includes("failed twice in a row"))).toBe(true);
  expect(second.some((x) => x.kind === "start")).toBe(false);
  expect(readState("demo", t.env).stopped).toBe(true);
  expect(await status(t)).toContain("failed twice in a row");

  // A passing result clears it.
  writeFileSync(
    join(t.dir, "config", "projects", "demo", "settings.json"),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(t.dir, "config", "projects", "demo", "settings.json"), "utf8")),
      health: "true",
    }),
  );
  t.git("commit", "-q", "--allow-empty", "-m", "merge three");
  t.git("update-ref", "refs/remotes/origin/main", "HEAD");
  t.doTick();
  expect(readState("demo", t.env).stopped).toBe(false);
});

test("two failed health commands in a row revert the last merge, push the revert, and the Inbox says so", () => {
  const t = setup({ steps: [step("A", "none")], health: "exit 1", max: 5 });
  // A bare remote that main is pushed to, as a real project has.
  const remote = join(t.dir, "remote.git");
  Bun.spawnSync(["git", "init", "-q", "--bare", "-b", "main", remote]);
  t.git("remote", "add", "origin", remote);
  t.git("config", "user.name", "t");
  t.git("config", "user.email", "t@t");
  t.git("push", "-q", "origin", "HEAD:main");
  t.doTick(); // first failure: a fix task starts
  writeFileSync(join(t.repo, "broken.txt"), "x\n");
  t.git("add", "-A");
  t.git("commit", "-q", "-m", "LIN-9: A breaks main");
  t.git("push", "-q", "origin", "HEAD:main");
  t.git("update-ref", "refs/remotes/origin/main", "HEAD");
  const second = t.doTick();
  expect(second.some((x) => x.reason.includes("failed twice in a row") && x.reason.includes("the merge was reverted"))).toBe(true);
  const log = Bun.spawnSync(["git", "-C", remote, "log", "--format=%s", "-n", "2", "main"]).stdout.toString().trim().split("\n");
  expect(log).toEqual(['Revert "LIN-9: A breaks main"', "LIN-9: A breaks main"]);
  expect(Bun.spawnSync(["git", "-C", remote, "ls-tree", "--name-only", "main"]).stdout.toString()).not.toContain("broken.txt");
  const [item] = readItems(t.env).filter((i) => i.kind === "stuck");
  expect(item!.question).toContain("was reverted");
  expect(item!.question).toContain("LIN-9: A breaks main");
  expect(item!.alert).toBe("Main is red");
  expect(t.calls().some((c) => c.startsWith("alert"))).toBe(false);
});

test("a last commit that is not a task's merge is not reverted, and the Inbox says so", () => {
  const t = setup({ steps: [], health: "exit 1" });
  t.doTick();
  t.git("commit", "-q", "--allow-empty", "-m", "by hand");
  t.git("update-ref", "refs/remotes/origin/main", "HEAD");
  const second = t.doTick();
  expect(second.some((x) => x.reason.includes("not a task's merge"))).toBe(true);
  expect(readItems(t.env).find((i) => i.kind === "stuck")!.question).toContain("so it was not reverted");
});

test("a reviewer from the worker's company, or one pi does not offer, is skipped", () => {
  expect(company("claude-bridge-c/claude-sonnet-5-5")).toBe("anthropic");
  expect(company("openai-codex/gpt-6.1-sol")).toBe("openai");
  expect(pickReviewer("anthropic/claude-sonnet-5-5", ["anthropic/claude-opus-5-5", "openai/gpt-6.1-sol"], undefined)).toBe("openai/gpt-6.1-sol");
  expect(pickReviewer("a/claude-x", ["openai/gone", "openai/gpt-6.1-sol"], new Set(["openai/gpt-6.1-sol"]))).toBe("openai/gpt-6.1-sol");

  const t = setup({
    steps: [step("A", "none")],
    reviewer: ["anthropic/claude-opus-5-5", "openai/retired-model", "openai-codex/gpt-6.1-sol"],
  });
  t.doTick();
  const add = t.adds()[0]!;
  expect(add[add.indexOf("--reviewer-model") + 1]).toBe("openai-codex/gpt-6.1-sol");

  // No other company has room: a different model of the worker's own company reviews, and the start is noted.
  expect(pickReviewer("anthropic/claude-sonnet-5-5", ["anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5"], undefined)).toBe(
    "anthropic/claude-opus-5-5",
  );
  const same = setup({ steps: [step("A", "none")], reviewer: ["anthropic/claude-opus-5-5"] });
  const d = same.doTick();
  expect(d[0]!.kind).toBe("start");
  expect(d[0]!.reason).toContain("same company");
  const sameAdd = same.adds()[0]!;
  expect(sameAdd[sameAdd.indexOf("--reviewer-model") + 1]).toBe("anthropic/claude-opus-5-5");
  expect(sameAdd.join(" ")).toContain("fresh context");

  const none = setup({ steps: [step("A", "none")], reviewer: [] });
  expect(none.doTick()[0]!.kind).toBe("skip");
  expect(none.adds()).toHaveLength(0);
});

test("each decision goes to decisions.jsonl once, with its reason", () => {
  const t = setup({ steps: [step("A", "none", "a"), step("B", "none", "a")] });
  t.doTick();
  const after = t.decisions();
  expect(after.map((d) => `${d.step}:${d.kind}`)).toEqual(["A:start", "B:skip"]);
  expect(after.every((d) => typeof d.reason === "string" && d.reason !== "")).toBe(true);
  // A is now in work and B's reason stays the same: nothing new is written.
  writeFileSync(join(t.fake, "tasks.json"), JSON.stringify([{ id: "LIN-1", title: "A Title A", status: "work" }]));
  const stateFile = join(t.config, "projects", "demo", "state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  writeFileSync(stateFile, JSON.stringify({ ...state, taskSteps: { "LIN-1": "A" } }));
  t.doTick();
  t.doTick();
  expect(t.decisions().map((d) => `${d.step}:${d.kind}`)).toEqual(["A:start", "B:skip"]);
  // A new reason is written.
  writeFileSync(join(t.fake, "max"), "0");
  writeFileSync(join(t.fake, "tasks.json"), "[]");
  t.doTick();
  expect(
    t
      .decisions()
      .map((d) => d.reason)
      .at(-1),
  ).toContain("no free slot");
});

const skipLines = (reasons: string[]) => {
  const last: Record<string, string> = {};
  return reasons.flatMap((reason) => freshDecisions([{ time: "t", project: "p", step: "S", kind: "skip", reason }], last)).length;
};

test("a skip is written when it starts and when it ends, not while only its numbers move", () => {
  const t = setup({ steps: [step("B", "none", "a")] });
  writeFileSync(join(t.fake, "max"), "0");
  t.doTick();
  expect(t.decisions().map((d) => d.kind)).toEqual(["skip"]);
  // the same reason with other numbers is the same skip
  writeFileSync(join(t.fake, "max"), "1");
  writeFileSync(join(t.fake, "tasks.json"), JSON.stringify([{ title: "C Title C", status: "work" }]));
  t.doTick();
  t.doTick();
  expect(t.decisions().map((d) => d.kind)).toEqual(["skip"]);
  // only the clauses after the first change: still the same skip
  expect(skipLines(["no free slot (1 of 1 working); box: load average 3.2", "no free slot (1 of 1 working); box: all 2 check slots are in use"])).toBe(1);
  // a slot frees up: the end of the skip is told, then the start
  writeFileSync(join(t.fake, "tasks.json"), "[]");
  t.doTick();
  expect(t.decisions().map((d) => d.kind)).toEqual(["skip", "wake", "start"]);
  expect(t.decisions()[1]?.reason).toStartWith("no longer skipped: no free slot");
});

test("--once --dry-run prints the decisions and changes nothing", async () => {
  const t = setup({ steps: [step("A", "none")], health: "exit 1" });
  const lines: string[] = [];
  // runMain ticks with the process env, so the test's world is put there for the call: nothing reaches the real projects
  const saved = { ...process.env };
  Object.assign(process.env, t.env);
  let code: number;
  try {
    code = await runMain(["--once", "--dry-run"], (l) => lines.push(l), realWorld(t.env));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  expect(code).toBe(0);
  expect(lines.some((l) => l.startsWith("demo  A  start"))).toBe(true);
  const d = t.doTick(true);
  expect(d.some((x) => x.step === "A" && x.kind === "start")).toBe(true);
  expect(t.adds()).toHaveLength(0);
  expect(existsSync(decisionsPath(t.env))).toBe(false);
  expect(existsSync(join(t.dir, "config", "projects", "demo", "state.json"))).toBe(false);
  expect(await runMain(["--dry-run"], () => {}, realWorld(t.env))).toBe(2);
});

test("steps start whatever the hour", () => {
  const t = setup({ steps: [step("A", "none")] });
  const world = realWorld(t.env);
  for (const hour of [3, 14]) {
    const d = tick({ ...world, now: () => new Date(2026, 0, 1, hour) }, true, t.env);
    expect(d[0]!.kind).toBe("start");
  }
});

test("the brief lists each done-when line once", () => {
  const t = setup({ steps: [step("A", "none")] });
  t.doTick();
  const add = t.adds()[0]!;
  const brief = add[add.indexOf("--brief") + 1]!;
  expect(brief.split("first A")).toHaveLength(2);
  expect(brief.split("second A")).toHaveLength(2);
});

test("the health command is not run while the repo folder is behind origin/main", () => {
  const t = setup({ steps: [], health: "exit 1" });
  t.git("commit", "-q", "--allow-empty", "-m", "newer");
  t.git("update-ref", "refs/remotes/origin/main", "HEAD");
  t.git("reset", "-q", "--hard", "HEAD~1");
  // a change in the folder keeps it from following main, whatever branch git init named
  writeFileSync(join(t.repo, "local-change"), "");
  const d = t.doTick();
  expect(d).toHaveLength(1);
  expect(d[0]?.reason).toContain("not at origin/main");
  expect(t.adds()).toHaveLength(0);
});

test("the roadmap is read from origin/main, and the folder follows main when it can", () => {
  const t = setup({ roadmap: "broken" });
  // Main fixes the roadmap; the folder is on the old commit.
  writeFileSync(join(t.repo, "docs", "ROADMAP.md"), `# Roadmap\n\n## Phase 0\n\n${step("A", "none")}`);
  t.git("add", "-A");
  t.git("commit", "-q", "-m", "fix roadmap");
  t.git("update-ref", "refs/remotes/origin/main", "HEAD");
  t.git("reset", "-q", "--hard", "HEAD~1");
  expect(readFileSync(join(t.repo, "docs", "ROADMAP.md"), "utf8")).toBe("broken");
  // Dry run reads origin/main without touching the folder.
  expect(t.doTick(true).map((x) => `${x.step}:${x.kind}`)).toEqual(["A:start"]);
  expect(readFileSync(join(t.repo, "docs", "ROADMAP.md"), "utf8")).toBe("broken");
  // Fetch fails here (no remote); the folder stays, the start still happens from origin/main.
  expect(t.doTick().map((x) => `${x.step}:${x.kind}`)).toEqual(["A:start"]);
});

test("above the load limit nothing starts, and it is said once", () => {
  const t = setup({ steps: [step("A", "none")], load: 9, machine: { loadPerCore: 4 / cpus().length } });
  const first = t.doTick();
  expect(first).toHaveLength(1);
  expect(first[0]!.reason).toContain("above the limit of 4");
  expect(t.adds()).toHaveLength(0);
  expect(t.doTick()).toHaveLength(0);
  expect(t.decisions()).toHaveLength(1);
  const calm = setup({ steps: [step("A", "none")], load: 3, machine: { loadPerCore: 4 / cpus().length } });
  expect(calm.doTick().map((d) => d.kind)).toEqual(["start"]);
});

test("the brief tells workers about lineclear check, wait and ask", () => {
  const t = setup({ steps: [step("A", "none")] });
  t.doTick();
  const brief = t.adds()[0]![t.adds()[0]!.indexOf("--brief") + 1]!;
  expect(brief).toContain("lineclear check");
  expect(brief).toContain("lineclear wait");
  expect(brief).toContain("lineclear ask");
  expect(brief).toContain("lineclear secrets env");
  expect(brief).toContain("lineclear wait task");
});

test("run ticks in its own process, ends on SIGTERM with a logged reason, and crashes loudly when a tick throws", async () => {
  const { EventEmitter } = await import("node:events");
  const logged: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((m: string) => void logged.push(String(m)));
  try {
    const signals = new EventEmitter();
    let calls = 0;
    let ended: number | undefined;
    const done = runMain([], () => {}, realWorld(), { tick: () => (calls++, []), tickMs: 5, signals }).then((c) => (ended = c));
    // wait on the ticks, not on the clock: a loaded machine runs them late
    while (calls <= 3) await Bun.sleep(5);
    expect(ended).toBeUndefined();
    signals.emit("SIGTERM");
    await done;
    expect(ended).toBe(0);
    expect(logged.filter((l) => l.includes("stopping: SIGTERM"))).toHaveLength(1);

    const crash = await runMain([], () => {}, realWorld(), {
      tick: () => {
        throw new Error("boom");
      },
      tickMs: 5,
      signals: new EventEmitter(),
    });
    expect(crash).toBe(1);
    expect(logged.some((l) => l.includes("tick failed, stopping") && l.includes("boom"))).toBe(true);
  } finally {
    spy.mockRestore();
  }
  const source = readFileSync(join(import.meta.dir, "..", "src", "rules.ts"), "utf8");
  expect(source).not.toMatch(/uncaughtException|unhandledRejection|SIGHUP/);
});

test("a state file that is not JSON stops its project with an Inbox item that names it, and is left as it was", () => {
  const t = setup({ steps: [step("A", "none")] });
  const file = join(t.config, "projects", "demo", "state.json");
  writeFileSync(file, "{");
  for (let i = 0; i < 2; i++) {
    const d = t.doTick();
    expect(d.map((x) => `${x.kind}`)).toEqual(["stop"]);
    expect(d[0]?.reason).toContain(file);
  }
  expect(readFileSync(file, "utf8")).toBe("{");
  expect(t.adds()).toEqual([]);
  const items = readItems(t.env).filter((i) => i.question.includes(file));
  expect(items).toHaveLength(1);
});

test("a tick writes state.json only when the state changed", () => {
  const t = setup({ steps: [step("A", "none")] });
  const file = join(t.config, "projects", "demo", "state.json");
  t.doTick();
  t.doTick();
  const before = statSync(file);
  const text = readFileSync(file, "utf8");
  // a rewrite makes a new file (writeAtomic renames), so the inode tells
  t.doTick();
  expect(readFileSync(file, "utf8")).toBe(text);
  expect(statSync(file).ino).toBe(before.ino);
});

test("a tick of the loop starts no process of its own", async () => {
  const source = readFileSync(join(import.meta.dir, "..", "src", "rules.ts"), "utf8");
  expect(source).not.toContain("Bun.spawn(");
  expect(source).not.toContain('"--once"], {');
});

test("locks: a step's own locks replace its parts, and one with no locks line holds each part whole", () => {
  const part = (id: string, locks: string) =>
    `### ${id} Title ${id}\n- why: because ${id}\n- done when:\n  - first ${id}\n- parts: ui\n${locks}- after: none\n`;
  const t = setup({
    steps: [part("A", "- locks: data, shell\n"), part("B", "- locks: roadmap, status\n"), part("C", "")],
    tasks: [{ id: "LIN-1", title: "A Title A", status: "work" }],
  });
  recordTaskSteps(t.config, { "LIN-1": "A" });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["B:start", "C:skip"]);
  expect(d[1]?.reason).toContain("lock 'ui' is held by");
});

test("locks: a running step with no locks line holds its part whole against a step with its own locks", () => {
  const part = (id: string, locks: string) =>
    `### ${id} Title ${id}\n- why: because ${id}\n- done when:\n  - first ${id}\n- parts: ui\n${locks}- after: none\n`;
  const t = setup({ steps: [part("A", ""), part("B", "- locks: roadmap\n")], tasks: [{ id: "LIN-1", title: "A Title A", status: "work" }] });
  recordTaskSteps(t.config, { "LIN-1": "A" });
  const d = t.doTick();
  expect(d.map((x) => `${x.step}:${x.kind}`)).toEqual(["B:skip"]);
  expect(d[0]?.reason).toContain("lock 'ui' is held by A");
});

test("locks: a part held by a merged task is free in the next tick, so the next step on it starts", () => {
  const part = (id: string) => `### ${id} Title ${id}\n- why: because ${id}\n- done when:\n  - first ${id}\n- parts: ui\n- after: none\n`;
  const running = setup({ steps: [part("A"), part("B")], tasks: [{ id: "LIN-1", title: "A Title A", status: "work" }] });
  recordTaskSteps(running.config, { "LIN-1": "A" });
  expect(running.doTick().map((x) => `${x.step}:${x.kind}`)).toEqual(["B:skip"]);

  const merged = setup({ steps: [part("A"), part("B")], commits: ["LIN-1: A Title A"], tasks: [{ id: "LIN-1", title: "A Title A", status: "done" }] });
  recordTaskSteps(merged.config, { "LIN-1": "A" });
  expect(merged.doTick().map((x) => `${x.step}:${x.kind}`)).toEqual(["B:start"]);
});

test("run ticks every 30 s by default, and the user service runs `lineclear run`", async () => {
  const { EventEmitter } = await import("node:events");
  expect(TICK_MS).toBe(30_000);
  const intervals: number[] = [];
  const spy = spyOn(globalThis, "setInterval").mockImplementation(((_f: unknown, ms: number) => {
    intervals.push(ms);
    return 0;
  }) as never);
  const clear = spyOn(globalThis, "clearInterval").mockImplementation((() => {}) as never);
  const signals = new EventEmitter();
  try {
    const done = runMain([], () => {}, realWorld(), { tick: () => [], signals });
    while (intervals.length === 0) await Bun.sleep(1);
    expect(intervals).toEqual([30_000]);
    signals.emit("SIGTERM");
    expect(await done).toBe(0);
  } finally {
    spy.mockRestore();
    clear.mockRestore();
  }
  expect(readFileSync(join(import.meta.dir, "..", "install.sh"), "utf8")).toContain(
    'write_unit "$unit" Lineclear "$(command -v bun) $code/bin/lineclear run --port $(board_port)"',
  );
});

test("locks: a task whose worktree is gone and whose agent is dead holds none, so a step with the same lock starts", () => {
  const steps = [step("A", "none", "worker"), step("B", "none", "worker")];
  const live = setup({ steps, tasks: [{ id: "LIN-1", title: "A Title A", status: "need" }] });
  recordTaskSteps(live.config, { "LIN-1": "A" });
  expect(live.doTick().map((x) => `${x.step}:${x.kind}`)).toEqual(["B:skip"]);

  const dead = setup({ steps, tasks: [{ id: "LIN-1", title: "A Title A", status: "need", orphaned: true }] });
  recordTaskSteps(dead.config, { "LIN-1": "A" });
  expect(dead.doTick().map((x) => `${x.step}:${x.kind}`)).toEqual(["B:start"]);
});

test("stepStatuses is called only where its inputs come from stepInputs", () => {
  const dir = join(import.meta.dir, "..", "src");
  const callers = new Bun.Glob("*.ts").scanSync(dir);
  const found: string[] = [];
  for (const file of callers) {
    const text = readFileSync(join(dir, file), "utf8");
    if (/\bstepStatuses\(/.test(text) && file !== "roadmap.ts") found.push(file);
  }
  expect(found).toEqual(["task-steps.ts"]);
});

test("the same step added twice gets one start and one refusal", () => {
  const t = setup({ steps: [step("A", "none")] });
  expect(t.doTick().filter((x) => x.kind === "start").length).toBe(1);
  // the task list still lacks the new task: the step must not start again
  const again = t.doTick();
  expect(again.some((x) => x.kind === "start")).toBe(false);
  expect(again.some((x) => x.step === "A" && x.reason.includes("does not start twice"))).toBe(true);
  expect(t.adds().length).toBe(1);
});

test("a landed step starts no agent even when it reads ready", () => {
  const t = setup({ steps: [step("A", "none")] });
  writeFileSync(join(t.config, "projects", "demo", "state.json"), JSON.stringify({ closedSteps: { A: "LIN-1" } }));
  expect(t.doTick().some((x) => x.kind === "start")).toBe(false);
  expect(t.adds()).toEqual([]);
});
