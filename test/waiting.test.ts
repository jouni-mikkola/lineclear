import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { status } from "../src/status.ts";
import { countWaiting, waitingForYou } from "../src/waiting.ts";
import { projectsData } from "../src/home-data.ts";
import { askMachines, type MachineRead, type Room, SILENT_DROP_MS } from "../src/spread.ts";
import { webApi } from "../src/web.ts";
import { clearWait, writeWait } from "../src/waits.ts";
import { tmp } from "./helpers.ts";

// WEB-1 asked in the Inbox and has a card, WEB-2 waits with a card only, WEB-3 works.
function setup() {
  const dir = tmp("waiting");
  const lineclear = join(dir, "lineclear");
  mkdirSync(join(dir, "config", "inbox"), { recursive: true });
  mkdirSync(join(lineclear, "chatlog"), { recursive: true });
  writeFileSync(join(lineclear, "spaces.json"), JSON.stringify([{ key: "WEB", name: "web-shop", path: join(dir, "none") }]));
  const ids = [1, 2, 3];
  writeFileSync(
    join(lineclear, "tasks.json"),
    JSON.stringify({ tasks: ids.map((n) => ({ id: `WEB-${n}`, title: `Task ${n}`, told: "work", created: n })), red: {} }),
  );
  const cards = [1, 2].map((n) => ({ at: n, card: { task: `WEB-${n}`, status: "need", text: `Card of WEB-${n}` } }));
  writeFileSync(join(lineclear, "chatlog", "cards.json"), JSON.stringify({ posted: cards }));
  writeFileSync(
    join(dir, "config", "inbox", "1.json"),
    JSON.stringify({
      n: 1,
      kind: "choice",
      task: "WEB-1",
      project: "web-shop",
      question: "Which one?",
      choices: ["A", "B"],
      since: "2026-01-05T09:12:00.000Z",
    }),
  );
  const list = [
    { id: "WEB-1", title: "Task 1", status: "need" },
    { id: "WEB-2", title: "Task 2", status: "need" },
    { id: "WEB-3", title: "Task 3", status: "work" },
  ];
  const bin = join(dir, "lineclear-bin");
  writeFileSync(bin, `#!/bin/sh\necho '${JSON.stringify(list)}'\n`);
  chmodSync(bin, 0o755);
  const world = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_HOME: lineclear,
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    LINECLEAR_SERVER_BIN: bin,
    HOME: dir,
  };
  return { dir, world };
}

const planter = (dir: string) => (n: number, w: object) =>
  writeWait(
    { task: `WEB-${n}`, project: "web-shop", kind: "owner", reason: "", since: "2026-01-05T09:12:00.000Z", ...w },
    { LINECLEAR_CONFIG: join(dir, "config") },
  );

const homeText = (world: Record<string, string>) => (id: string) =>
  projectsData(world, Date.now())
    .flatMap((p) => p.tasks)
    .find((t) => t.id === id)?.text;

const inbox = async (world: Record<string, string>) => (await (await webApi(world)(new Request("http://127.0.0.1:7420/api/inbox"))).json()) as any[];

test("an Inbox item, a card of the same task and a waiting task with no item count 2", () => {
  const { dir, world } = setup();
  const w = waitingForYou(world);
  expect(countWaiting(w)).toBe(2);
  expect(w.items.map((i) => i.task)).toEqual(["WEB-1"]);
  expect(w.tasks).toEqual([{ task: "WEB-2", title: "Task 2", since: new Date(2).toISOString(), project: "web-shop", text: "Card of WEB-2" }]);
  rmSync(dir, { recursive: true, force: true });
});

test("the Inbox view and lineclear status give that count", async () => {
  const { dir, world } = setup();
  const entries = await inbox(world);
  expect(entries.map((e) => [e.id, e.task, e.choices.length > 0])).toEqual([
    ["1", "WEB-1", true],
    ["task:WEB-2", "WEB-2", false],
  ]);
  expect(entries[1]).toMatchObject({ project: "web-shop", question: "Card of WEB-2", waiting: true });
  const lines: string[] = [];
  status((l) => lines.push(l), world);
  expect(lines).toContain("2 things wait for you");
  rmSync(dir, { recursive: true, force: true });
});

test("an idle agent stays out of the Inbox, a declared wait shows its reason, and no card says 'needs you:'", async () => {
  const { dir, world } = setup();
  const lineclear = join(dir, "lineclear");
  const card = (n: number, text: string) => ({ at: n, card: { task: `WEB-${n}`, status: "need", text } });
  writeFileSync(
    join(lineclear, "chatlog", "cards.json"),
    JSON.stringify({ posted: [card(1, "needs you: Which one?"), card(2, "needs you: Waits for your reply")] }),
  );
  expect(waitingForYou(world).tasks).toEqual([]);
  expect(countWaiting(waitingForYou(world))).toBe(1);
  mkdirSync(join(dir, "config", "waits"), { recursive: true });
  writeFileSync(
    join(dir, "config", "waits", "WEB-2.json"),
    JSON.stringify({ task: "WEB-2", project: "web-shop", kind: "login", reason: "Log in to Ledger", since: "2026-01-05T09:12:00.000Z" }),
  );
  expect(waitingForYou(world).tasks.map((t) => [t.task, t.text])).toEqual([["WEB-2", "Log in to Ledger"]]);
  writeFileSync(join(lineclear, "chatlog", "cards.json"), JSON.stringify({ posted: [card(2, "needs you: Pick A or B")] }));
  clearWait("WEB-2", { LINECLEAR_CONFIG: join(dir, "config") });
  expect(waitingForYou(world).tasks.map((t) => t.text)).toEqual(["Pick A or B"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a failed start and a wait for another task say so, and neither waits for the owner", () => {
  const { dir, world } = setup();
  mkdirSync(join(dir, "config", "waits"), { recursive: true });
  const wait = planter(dir);
  // the planted fault: WEB-2's start failed, and its last card still reads like a question
  wait(2, { kind: "start", reason: "start failed: herdr has no agent for it after two tries" });
  expect(waitingForYou(world).tasks).toEqual([]);
  const text = homeText(world);
  expect(text("WEB-2")).toBe("start failed");
  wait(2, { kind: "task", for: "WEB-1", reason: "needs WEB-1's API" });
  expect(waitingForYou(world).tasks).toEqual([]);
  expect(text("WEB-2")).toBe("waits for WEB-1");
  rmSync(dir, { recursive: true, force: true });
});

test("a wait for a time or a check slot shows on Home as that wait, not as a question, and a wait for the owner keeps its card", () => {
  const { dir, world } = setup();
  mkdirSync(join(dir, "config", "waits"), { recursive: true });
  const wait = planter(dir);
  const text = homeText(world);
  wait(2, { kind: "checks", reason: "full check" });
  expect(text("WEB-2")).toBe("waits for a check slot");
  expect(countWaiting(waitingForYou(world))).toBe(1);
  wait(2, { kind: "until", until: "2026-01-06T09:11:00.000Z", reason: "retry" });
  expect(text("WEB-2")).toMatch(/^waits until /);
  wait(2, { kind: "owner", ownerKind: "question", reason: "Which one?" });
  expect(text("WEB-2")).toBe("Card of WEB-2");
  expect(waitingForYou(world).tasks.map((t) => [t.task, t.text])).toEqual([["WEB-2", "Which one?"]]);
  rmSync(dir, { recursive: true, force: true });
});

function plantAndCount(registered: boolean) {
  const { dir, world } = setup();
  mkdirSync(join(dir, "config", "waits"), { recursive: true });
  if (registered) {
    mkdirSync(join(dir, "config", "projects", "web-shop"), { recursive: true });
    writeFileSync(join(dir, "config", "projects", "web-shop", "settings.json"), JSON.stringify({ repo: dir, space: "WEB", check: "true", models: {} }));
  }
  const wait = planter(dir);
  wait(2, { kind: "owner", ownerKind: "login", reason: "Log in to Ledger" });
  wait(3, { kind: "task", for: "WEB-1", reason: "needs WEB-1's API" });
  wait(4, { kind: "until", until: "2026-01-06T09:00:00.000Z", reason: "retry after the limit" });
  const lines: string[] = [];
  status((l) => lines.push(l), world);
  rmSync(dir, { recursive: true, force: true });
  return lines;
}

test.each([false, true])(
  "status counts the Inbox item and the owner wait, and prints a task wait and a timed wait as paused (registered project: %p)",
  (registered) => {
    const lines = plantAndCount(registered);
    expect(lines).toContain("2 things wait for you");
    const paused = lines.filter((l) => l.includes("paused"));
    expect(paused).toHaveLength(2);
    expect(paused.join("\n")).toContain("WEB-3 paused, waits for task WEB-1: needs WEB-1's API");
    expect(paused.join("\n")).toContain("WEB-4 paused, waits for 2026-01-06T09:00:00.000Z: retry after the limit");
  },
);

// a project on this machine and on "box": box's tasks reach Home through the project's state, with the tail spread adds
function plantBox(dir: string, tasks: { id: string; sub: string }[]) {
  const project = join(dir, "config", "projects", "web");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "settings.json"), JSON.stringify({ repo: join(dir, "none"), space: "web-shop", machines: ["box"] }));
  const seen = tasks.map((t) => ({ id: `${t.id}@box`, title: t.id, status: "need", sub: `${t.sub} · on box` }));
  writeFileSync(join(project, "state.json"), JSON.stringify({ remoteSeen: { box: seen } }));
}

test("an idle task of another machine counts in none of Home, the Inbox badge and status; a question counts with its line", () => {
  const { dir, world } = setup();
  const before = countWaiting(waitingForYou(world));
  plantBox(dir, [{ id: "WEB-8", sub: "Waits for your reply" }]);
  const home = projectsData(world, Date.now()).flatMap((p) => p.tasks);
  expect(home.find((t) => t.id === "WEB-8@box")).toMatchObject({ state: "need", stage: "work" });
  expect(waitingForYou(world).tasks.map((t) => t.task)).not.toContain("WEB-8@box");
  expect(countWaiting(waitingForYou(world))).toBe(before);
  const lines: string[] = [];
  status((l) => lines.push(l), world);
  expect(lines.join("\n")).not.toContain("WEB-8@box");
  expect(lines).toContain(`${before} things wait for you`);

  plantBox(dir, [{ id: "WEB-9", sub: "Which one?" }]);
  expect(waitingForYou(world).tasks.find((t) => t.task === "WEB-9@box")).toMatchObject({ text: "Which one?" });
  expect(countWaiting(waitingForYou(world))).toBe(before + 1);
  const again: string[] = [];
  status((l) => again.push(l), world);
  expect(again).toContain(`${before + 1} things wait for you`);
  rmSync(dir, { recursive: true, force: true });
});

// a machine "box" over four reads: it answers, misses one, is silent for a day, then answers again
test("a silent machine's tasks are not waiting, drop after a day with one note, and return when it answers", () => {
  const { dir, world } = setup();
  const T0 = Date.parse("2026-01-05T09:00:00Z");
  const task = { id: "WEB-9@box", title: "WEB-9", status: "need", sub: "Which one? · on box" };
  const memory: { remoteSeen?: Record<string, (typeof task)[]>; machineReads?: Record<string, MachineRead> } = {};
  const notes: string[] = [];
  const ask = (now: number, answer: Room | string) =>
    askMachines(
      ["box"],
      memory,
      now,
      () => answer,
      (_h, why) => notes.push(why),
    );
  const save = () => {
    const project = join(dir, "config", "projects", "web");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "settings.json"), JSON.stringify({ repo: join(dir, "none"), space: "web-shop", machines: ["box"] }));
    writeFileSync(join(project, "state.json"), JSON.stringify(memory));
  };
  const row = () =>
    projectsData(world, Date.now())
      .flatMap((p) => p.tasks)
      .find((t) => t.id === "WEB-9@box");
  const room = { host: "box", tasks: [task], working: 1, max: 4, load: 0, loadLimit: 4 } satisfies Room;
  const before = countWaiting(waitingForYou(world));

  ask(T0, room);
  save();
  expect(row()).toMatchObject({ state: "need" });
  expect(row()?.silentSince).toBeUndefined();
  expect(countWaiting(waitingForYou(world))).toBe(before + 1);

  // one missed read: still known, holds its slot (in remote), no longer waiting, says since when
  expect(ask(T0 + 60_000, "unreachable").remote).toHaveLength(1);
  save();
  expect(row()).toMatchObject({ state: "work", silentSince: T0 });
  expect(row()?.last?.text).toBe("box not reached since 2026-01-05 09:00 UTC");
  expect(countWaiting(waitingForYou(world))).toBe(before);
  const lines: string[] = [];
  status((l) => lines.push(l), world);
  expect(lines.filter((l) => l.includes("box"))).toEqual(["-  box not reached since 2026-01-05 09:00 UTC"]);

  // a day without an answer: gone from the views, noted once, locks kept
  expect(ask(T0 + SILENT_DROP_MS, "unreachable").remote).toHaveLength(1);
  ask(T0 + SILENT_DROP_MS + 60_000, "unreachable");
  save();
  expect(row()).toBeUndefined();
  const dropNotes = notes.filter((n) => n.includes("leave the views"));
  expect(dropNotes).toHaveLength(1);
  expect(dropNotes[0]).toContain("WEB-9@box");

  // it answers again
  ask(T0 + SILENT_DROP_MS + 120_000, room);
  save();
  expect(row()).toMatchObject({ state: "need" });
  expect(row()?.silentSince).toBeUndefined();
  expect(countWaiting(waitingForYou(world))).toBe(before + 1);
  rmSync(dir, { recursive: true, force: true });
});
