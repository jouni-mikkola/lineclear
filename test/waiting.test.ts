import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { status } from "../src/status.ts";
import { countWaiting, waitingForYou } from "../src/waiting.ts";
import { projectsData } from "../src/home-data.ts";
import { webApi } from "../src/web.ts";
import { tmp } from "./helpers.ts";

// WEB-1 asked in the Inbox and has a card, WEB-2 waits with a card only, WEB-3 works.
function setup() {
  const dir = tmp("waiting");
  const shepherdr = join(dir, "shepherdr");
  mkdirSync(join(dir, "config", "inbox"), { recursive: true });
  mkdirSync(join(shepherdr, "chatlog"), { recursive: true });
  writeFileSync(join(shepherdr, "spaces.json"), JSON.stringify([{ key: "WEB", name: "web-shop", path: join(dir, "none") }]));
  const ids = [1, 2, 3];
  writeFileSync(
    join(shepherdr, "tasks.json"),
    JSON.stringify({ tasks: ids.map((n) => ({ id: `WEB-${n}`, title: `Task ${n}`, told: "work", created: n })), red: {} }),
  );
  const cards = [1, 2].map((n) => ({ at: n, card: { task: `WEB-${n}`, status: "need", text: `Card of WEB-${n}` } }));
  writeFileSync(join(shepherdr, "chatlog", "cards.json"), JSON.stringify({ posted: cards }));
  writeFileSync(
    join(dir, "config", "inbox", "1.json"),
    JSON.stringify({ n: 1, kind: "step", task: "WEB-1", project: "web-shop", question: "Which one?", choices: ["A", "B"], since: "2026-01-05T09:12:00.000Z" }),
  );
  const list = [
    { id: "WEB-1", title: "Task 1", status: "need" },
    { id: "WEB-2", title: "Task 2", status: "need" },
    { id: "WEB-3", title: "Task 3", status: "work" },
  ];
  const bin = join(dir, "shepherdr-bin");
  writeFileSync(bin, `#!/bin/sh\necho '${JSON.stringify(list)}'\n`);
  chmodSync(bin, 0o755);
  const world = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: shepherdr,
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    SHEPHERDR_BIN: bin,
    HOME: dir,
  };
  return { dir, world };
}

const planter = (dir: string) => (n: number, w: object) =>
  writeFileSync(
    join(dir, "config", "waits", `WEB-${n}.json`),
    JSON.stringify({ task: `WEB-${n}`, project: "web-shop", since: "2026-01-05T09:12:00.000Z", ...w }),
  );

const homeText = (world: Record<string, string>) => (id: string) =>
  projectsData(world, Date.now(), [])
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
  const shepherdr = join(dir, "shepherdr");
  const card = (n: number, text: string) => ({ at: n, card: { task: `WEB-${n}`, status: "need", text } });
  writeFileSync(
    join(shepherdr, "chatlog", "cards.json"),
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
  writeFileSync(join(shepherdr, "chatlog", "cards.json"), JSON.stringify({ posted: [card(2, "needs you: Pick A or B")] }));
  rmSync(join(dir, "config", "waits", "WEB-2.json"));
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
