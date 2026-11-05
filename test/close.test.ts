import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inboxMain } from "../src/inbox-answer.ts";
import { addItem, readItems } from "../src/inbox.ts";
import { sessionFolder } from "../src/measure.ts";
import { decisionsPath } from "../pi/config.ts";
import { realWorld, tick } from "../src/rules.ts";
import { status } from "../src/status.ts";
import { readWaits, waitPath, writeWait } from "../src/waits.ts";
import { demoConfig, idleWorld } from "./demo-world.ts";
import { tmp } from "./helpers.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(tasks: { id: string; title: string; status: string }[]) {
  const dir = tmp("close");
  dirs.push(dir);
  const config = demoConfig(dir, { loadPerCore: 1e6 });
  // A stub that fails at once: the real Shepherdr command can take seconds to start on a busy machine, and a test blocked on it makes the next test time out.
  const env = {
    ...process.env,
    SHEPHERDR_BIN: "/bin/false",
    LINECLEAR_CONFIG: config,
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shep"),
    PI_CODING_AGENT_DIR: join(dir, "pi"),
  };
  const wrote = new Set<string>();
  const world = idleWorld(env, { tasks: () => tasks, maxTasks: () => 0, ownerWrote: (task) => wrote.has(task) });
  const ask = (task: string) => {
    addItem({ kind: "step", task, project: "demo", question: `Q of ${task}?`, choices: ["Yes", "No"], since: "2026-06-01T09:00:00Z" }, env);
    writeWait({ task, project: "demo", kind: "owner", reason: `asked: Q of ${task}?`, since: "2026-06-01T09:00:00Z" }, env);
  };
  return { dir, env, world, wrote, ask, tick: () => tick(world, false, env) };
}

test("an item of a done or gone task closes with its reason and its wait goes", () => {
  const t = setup([
    { id: "LIN-1", title: "A", status: "done" },
    { id: "LIN-2", title: "B", status: "work" },
  ]);
  t.ask("LIN-1");
  t.ask("LIN-2");
  t.ask("LIN-3"); // archived, so gone from the task list
  t.tick();
  expect(readItems(t.env).map((i) => [i.task, i.closed])).toEqual([
    ["LIN-1", "its task is done"],
    ["LIN-2", undefined],
    ["LIN-3", "its task is gone"],
  ]);
  expect(readWaits(t.env).map((w) => w.task)).toEqual(["LIN-2"]);
  const log = readFileSync(decisionsPath(t.env), "utf8");
  expect(log).toContain("closed inbox item 1: its task is done");
});

test("an item asked with no project closes with its done task, and one of another space stays", () => {
  const t = setup([{ id: "LIN-1", title: "A", status: "done" }]);
  addItem({ kind: "step", task: "LIN-1", question: "Look at the new UI?", choices: ["Got it"], since: "2026-06-01T09:00:00Z" }, t.env);
  addItem({ kind: "step", task: "OTHER-1", question: "Elsewhere?", choices: ["Yes"], since: "2026-06-01T09:00:00Z" }, t.env);
  t.tick();
  expect(readItems(t.env).map((i) => [i.task, i.closed])).toEqual([
    ["LIN-1", "its task is done"],
    ["OTHER-1", undefined],
  ]);
});

test("a stuck item and its wait close with a done task", () => {
  const t = setup([{ id: "LIN-1", title: "A", status: "done" }]);
  addItem(
    {
      kind: "stuck",
      task: "LIN-1",
      project: "demo",
      question: "LIN-1 is stuck. What now?",
      choices: ["Keep waiting", "I will look"],
      since: "2026-06-01T09:00:00Z",
    },
    t.env,
  );
  t.tick();
  expect(readItems(t.env)[0]!.closed).toBe("its task is done");
});

test("an item closes when the owner wrote to its task after it was made", () => {
  const t = setup([{ id: "LIN-2", title: "B", status: "work" }]);
  t.ask("LIN-2");
  t.wrote.add("LIN-2");
  t.tick();
  expect(readItems(t.env)[0]!.closed).toBe("you wrote to its task after the item was made");
  expect(existsSync(waitPath("LIN-2", t.env))).toBe(false);
  expect(readFileSync(decisionsPath(t.env), "utf8")).toContain("closed inbox item 1");
});

test("a wait of a done task is removed and no longer in status", () => {
  const t = setup([{ id: "LIN-1", title: "A", status: "done" }]);
  writeWait({ task: "LIN-1", project: "demo", kind: "checks", reason: "waiting for a check slot", since: "2026-06-01T09:00:00Z" }, t.env);
  const lines: string[] = [];
  status((l) => lines.push(l), t.env);
  expect(lines.join("\n")).toContain("LIN-1 paused, waits");
  t.tick();
  expect(readFileSync(decisionsPath(t.env), "utf8")).toContain("removed its wait: its task is done");
  lines.length = 0;
  status((l) => lines.push(l), t.env);
  expect(lines.join("\n")).not.toContain("LIN-1");
});

test("inbox lists open items only, --all adds the closed ones with their reason, and a closed one cannot be answered", () => {
  const t = setup([
    { id: "LIN-1", title: "A", status: "done" },
    { id: "LIN-2", title: "B", status: "work" },
  ]);
  t.ask("LIN-1");
  t.ask("LIN-2");
  t.tick();
  const run = (...a: string[]) => {
    const out: string[] = [];
    const code = inboxMain(a, (l) => out.push(l), t.env);
    return { code, text: out.join("\n") };
  };
  expect(run().text).not.toContain("Q of LIN-1");
  expect(run().text).toContain("Q of LIN-2");
  expect(run("--all").text).toContain("closed: its task is done");
  expect(run("answer", "1", "Yes")).toEqual({ code: 1, text: "lineclear inbox: item 1 was closed: its task is done" });
});

test("the owner's message is read from the task's agent log, not Shepherdr's own lines", () => {
  const t = setup([]);
  const worktree = join(t.dir, "wt");
  mkdirSync(t.env.LINECLEAR_SHEPHERDR_DIR, { recursive: true });
  writeFileSync(join(t.env.LINECLEAR_SHEPHERDR_DIR, "tasks.json"), JSON.stringify({ tasks: [{ id: "LIN-2", worktree }] }));
  const folder = join(t.env.PI_CODING_AGENT_DIR, "sessions", sessionFolder(worktree));
  mkdirSync(folder, { recursive: true });
  const line = (timestamp: string, text: string) => JSON.stringify({ timestamp, message: { role: "user", content: [{ type: "text", text }] } });
  const file = join(folder, "s.jsonl");
  writeFileSync(file, [line("2026-06-01T08:00:00Z", "before"), line("2026-06-01T09:30:00Z", "<shepherdr><news>x</news></shepherdr>")].join("\n"));
  const real = realWorld(t.env);
  expect(real.ownerWrote("LIN-2", "2026-06-01T09:00:00Z")).toBe(false);
  writeFileSync(file, `${readFileSync(file, "utf8")}\n${line("2026-06-01T09:35:00Z", "[lineclear] You may be stuck: nothing has moved")}`);
  expect(real.ownerWrote("LIN-2", "2026-06-01T09:00:00Z")).toBe(false);
  writeFileSync(file, `${readFileSync(file, "utf8")}\n${line("2026-06-01T09:40:00Z", "Skip it")}`);
  expect(real.ownerWrote("LIN-2", "2026-06-01T09:00:00Z")).toBe(true);
  expect(real.ownerWrote("LIN-9", "2026-06-01T09:00:00Z")).toBe(false);
});
