import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { migrateMain } from "../src/migrate.ts";
import type { Busy } from "../src/old-install.ts";
import { sh, tmp } from "./helpers.ts";

const root = tmp("migrate");
afterAll(() => sh(["rm", "-rf", root]));

const NOW = 2_000_000_000_000;
const HOUR = 3_600_000;
const put = (dir: string, name: string, value: unknown) => {
  mkdirSync(join(dir, name, ".."), { recursive: true });
  writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
};

/** A Shepherdr 2.0 folder: one space, one open task and one done task, each with a chat, one artifact each. */
function oldWorld(dir: string) {
  put(dir, "spaces.json", [{ name: "demo", path: "/x/demo", key: "DEM", base: "main" }]);
  put(dir, "settings.json", { everywhere: { "task.agent": "pi" }, spaces: { demo: { "task.model": "m" } } });
  put(dir, "tasks.json", {
    next: { DEM: 3 },
    tasks: [
      { id: "DEM-1", told: "done" },
      { id: "DEM-2", told: "work" },
    ],
    red: {},
  });
  put(dir, "chatlog/DEM-1_Agent.json", { posted: [] });
  put(dir, "chatlog/DEM-2_Agent.json", { posted: [{ at: 1, card: { id: "c1", status: "need" } }] });
  put(dir, "artifacts.json", {
    aaaa: { id: "aaaa", versions: [{ n: 1, chat: "DEM-1/Agent" }] },
    bbbb: { id: "bbbb", versions: [{ n: 1, chat: "DEM-2/Agent" }] },
  });
  put(dir, "agents.json", { "DEM-2": { kind: "pi" } });
  put(dir, "machines/box/server.json", { port: 1 });
  put(dir, "artifacts/aaaa/1.html", "done one");
  put(dir, "artifacts/bbbb/1.html", "open one");
}

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else out.push(`${relative(dir, join(d, e.name))} ${readFileSync(join(d, e.name), "utf8")}`);
    }
  };
  walk(dir);
  return out.sort();
}

const run = (args: string[], from: string, to: string, now = NOW, busy: Busy = () => false) => {
  const lines: string[] = [];
  const code = migrateMain(args, (l) => lines.push(l), { LINECLEAR_OLD_DIR: from, LINECLEAR_HOME: to }, now, busy);
  return { code, text: lines.join("\n") };
};

test("dry run lists the spaces and the open tasks, and copies nothing", () => {
  const from = join(root, "a-old");
  const to = join(root, "a-new");
  oldWorld(from);
  const r = run(["--dry-run"], from, to);
  expect(r.code).toBe(0);
  expect(r.text).toContain("demo");
  expect(r.text).toContain("DEM-2");
  expect(r.text).toContain("2 tasks, 1 open: DEM-2");
  expect(r.text).toContain("2 task chats, 0 space chats");
  expect(r.text).toContain("2 artifacts, 2 versions, 2 files");
  expect(existsSync(to)).toBe(false);
});

test("migrate copies spaces, settings, every task with its chat and artifacts, and leaves the old folder as it was", () => {
  const from = join(root, "b-old");
  const to = join(root, "b-new");
  oldWorld(from);
  const before = files(from);
  const r = run([], from, to);
  expect(r.code).toBe(0);
  expect(files(from)).toEqual(before);
  const tasks = JSON.parse(readFileSync(join(to, "tasks.json"), "utf8"));
  expect(tasks.tasks.map((t: any) => t.id)).toEqual(["DEM-1", "DEM-2"]);
  expect(tasks.next).toEqual({ DEM: 3 });
  expect(JSON.parse(readFileSync(join(to, "spaces.json"), "utf8"))[0].name).toBe("demo");
  expect(JSON.parse(readFileSync(join(to, "settings.json"), "utf8")).spaces.demo["task.model"]).toBe("m");
  expect(readdirSync(join(to, "chatlog")).sort()).toEqual(["DEM-1_Agent.json", "DEM-2_Agent.json"]);
  expect(Object.keys(JSON.parse(readFileSync(join(to, "artifacts.json"), "utf8")))).toEqual(["aaaa", "bbbb"]);
  expect(readFileSync(join(to, "artifacts/bbbb/1.html"), "utf8")).toBe("open one");
  expect(readFileSync(join(to, "artifacts/aaaa/1.html"), "utf8")).toBe("done one");
  expect(existsSync(join(to, "agents.json"))).toBe(true);
  expect(existsSync(join(to, "machines/box/server.json"))).toBe(true);
});

test("migrate again changes nothing in a folder that already has tasks", () => {
  const from = join(root, "c-old");
  const to = join(root, "c-new");
  oldWorld(from);
  expect(run([], from, to).code).toBe(0);
  const before = files(to);
  const r = run([], from, to);
  expect(r.code).toBe(1);
  expect(r.text).toContain("nothing was copied");
  expect(files(to)).toEqual(before);
});

test("check passes when the fork added no more cards, and fails when it added more", () => {
  const from = join(root, "d-old");
  const to = join(root, "d-new");
  oldWorld(from);
  // one needs-you card and one stall card in the span before the move
  put(from, "chatlog/DEM-2_Agent.json", {
    posted: [
      { at: NOW - 2 * HOUR, card: { id: "n1", task: "DEM-2", status: "need", ask: { questions: [{ title: "Which?" }] } } },
      { at: NOW - 3 * HOUR, card: { id: "s1", task: "DEM-2", text: "may be stuck: quiet" } },
    ],
  });
  expect(run([], from, to).code).toBe(0);
  const same = run(["--check"], from, to, NOW + 4 * HOUR);
  expect(same.code).toBe(0);
  expect(same.text).toContain("needsYou: 1 before on the old install, 0 on Lineclear");
  put(to, "chatlog/DEM-2_Agent.json", {
    posted: [
      { at: NOW + HOUR, card: { id: "s2", task: "DEM-2", text: "may be stuck: a" } },
      { at: NOW + 2 * HOUR, card: { id: "s3", task: "DEM-2", text: "may be stuck: b" } },
    ],
  });
  const worse = run(["--check"], from, to, NOW + 4 * HOUR);
  expect(worse.code).toBe(1);
  expect(worse.text).toContain("MORE   stalls");
});

test("migrate says what is wrong with no data or a wrong flag", () => {
  expect(run([], join(root, "none"), join(root, "e-new")).code).toBe(1);
  expect(run(["--now"], join(root, "none"), join(root, "e-new")).code).toBe(2);
});

test("to Lineclear, back and to Lineclear again loses no task, chat or artifact, and no timer comes along", () => {
  const from = join(root, "f-old");
  const to = join(root, "f-new");
  oldWorld(from);
  put(from, "modes.json", { "p:x:demo": "autopilot" });
  expect(run([], from, to).code).toBe(0);
  expect(JSON.parse(readFileSync(join(to, "modes.json"), "utf8"))).toEqual({ "p:x:demo": "regular" });
  expect(existsSync(join(to, "heartbeats.json"))).toBe(false);

  // work done on Lineclear: a new task with a chat and an artifact, and DEM-2 done
  put(to, "tasks.json", {
    next: { DEM: 4 },
    tasks: [
      { id: "DEM-2", told: "done" },
      { id: "DEM-3", told: "work" },
    ],
    red: {},
  });
  put(to, "chatlog/DEM-3_Agent.json", { posted: [{ at: 2, card: { id: "c3" } }] });
  const arts = JSON.parse(readFileSync(join(to, "artifacts.json"), "utf8"));
  arts.cccc = { id: "cccc", versions: [{ n: 1, chat: "DEM-3/Agent" }] };
  put(to, "artifacts.json", arts);
  put(to, "artifacts/cccc/1.html", "new one");
  put(to, "chatlog/p_x_demo.json", { posted: [{ at: 3, card: { id: "co" } }] });

  expect(run(["--back"], from, to, NOW, (side) => side === "lineclear").code).toBe(1);
  const back = run(["--back"], from, to);
  expect(back.code).toBe(0);
  const old = JSON.parse(readFileSync(join(from, "tasks.json"), "utf8"));
  expect(old.tasks.map((t: any) => [t.id, t.told]).sort()).toEqual([
    ["DEM-1", "done"],
    ["DEM-2", "done"],
    ["DEM-3", "work"],
  ]);
  expect(old.next).toEqual({ DEM: 4 });
  expect(readdirSync(join(from, "chatlog")).sort()).toEqual(["DEM-1_Agent.json", "DEM-2_Agent.json", "DEM-3_Agent.json", "p_x_demo.json"]);
  expect(readdirSync(from).some((f) => f.startsWith("before-back-"))).toBe(true);
  expect(Object.keys(JSON.parse(readFileSync(join(from, "artifacts.json"), "utf8"))).sort()).toEqual(["aaaa", "bbbb", "cccc"]);
  expect(readFileSync(join(from, "artifacts/cccc/1.html"), "utf8")).toBe("new one");

  // DEM-3 is finished on the Shepherdr 2.0 side meanwhile
  put(from, "tasks.json", { next: { DEM: 4 }, tasks: [...old.tasks.filter((t: any) => t.id !== "DEM-3"), { id: "DEM-3", told: "done" }], red: {} });
  const again = run([], from, to);
  expect(again.code).toBe(0);
  const now = JSON.parse(readFileSync(join(to, "tasks.json"), "utf8"));
  expect(now.tasks.map((t: any) => t.id).sort()).toEqual(["DEM-1", "DEM-2", "DEM-3"]);
  expect(now.tasks.find((t: any) => t.id === "DEM-3").told).toBe("done");
  expect(readdirSync(join(to, "chatlog")).sort()).toContain("DEM-3_Agent.json");
  expect(Object.keys(JSON.parse(readFileSync(join(to, "artifacts.json"), "utf8"))).sort()).toEqual(["aaaa", "bbbb", "cccc"]);
  expect(readFileSync(join(to, "artifacts/cccc/1.html"), "utf8")).toBe("new one");
  expect(existsSync(join(to, "migrated.json"))).toBe(true);
  expect(existsSync(join(to, "migrated.back.json"))).toBe(false);
});

test("back on a machine that never moved says so and copies nothing", () => {
  const from = join(root, "g-old");
  oldWorld(from);
  const before = files(from);
  const to = join(root, "g-none");
  put(to, "spaces.json", []);
  const r = run(["--back"], from, to);
  expect(r.code).toBe(1);
  expect(r.text).toContain("has not moved");
  expect(files(from)).toEqual(before);
});

test("a move that would be saved over by a running side is refused, and changes nothing", () => {
  const from = join(root, "h-old");
  const to = join(root, "h-new");
  oldWorld(from);
  expect(run([], from, to).code).toBe(0);
  const noShepherdr: Busy = (side) => side === "shepherdr";
  const before = files(from);
  expect(run(["--back"], from, to, NOW, noShepherdr).code).toBe(1);
  expect(files(from)).toEqual(before);
  expect(run(["--back"], from, to).code).toBe(0);
  const onlyLineclear: Busy = (side) => side === "lineclear";
  const beforeNew = files(to);
  const r = run([], from, to, NOW, onlyLineclear);
  expect(r.code).toBe(1);
  expect(r.text).toContain("Stop its server");
  expect(files(to)).toEqual(beforeNew);
});

/** A folder shaped like a real one: three spaces, a home space, artifacts on their places, chats, heartbeats, a remote machine. */
function realWorld(dir: string) {
  put(dir, "spaces.json", [
    { name: "alpha", path: "/x/alpha", key: "ALP", base: "main" },
    { name: "beta", path: "/x/beta", key: "BET", base: "main" },
  ]);
  put(dir, "modes.json", { "p:box:alpha": "autopilot", "p:box:": "autopilot" });
  put(dir, "settings.json", { everywhere: {}, spaces: {} });
  put(dir, "server.json", { port: 7787, pid: 1 });
  const tasks = [
    { id: "ALP-1", told: "done" },
    { id: "ALP-2", told: "done" },
    { id: "ALP-3", told: "work" },
    { id: "BET-1", told: "done" },
  ];
  put(dir, "tasks.json", { next: { ALP: 4, BET: 2 }, tasks, red: {} });
  for (const t of tasks) put(dir, `chatlog/${t.id}_Agent.json`, { posted: [{ at: 1, card: { id: t.id } }] });
  for (const place of ["p_box_alpha", "p_box_beta", "p_box_"]) put(dir, `chatlog/${place}.json`, { posted: [{ at: 2 }] });
  put(dir, "heartbeat/p-box-alpha.md", "# Heartbeat\n- check the queue");
  put(dir, "heartbeat/p-box-beta.md", "# Heartbeat\nrules run it");
  put(dir, "heartbeat/p-box-.md", "# Heartbeat\nhome");
  const arts: Record<string, any> = {};
  const art = (id: string, place: string, versions: number) => {
    arts[id] = { id, place, versions: Array.from({ length: versions }, (_, i) => ({ n: i + 1, chat: place, html: i + 1 })), thumb: true };
    for (let i = 1; i <= versions; i++) put(dir, `artifacts/${id}/${i}.html`, `${id} v${i}`);
    put(dir, `artifacts/${id}/thumb.png`, `thumb ${id}`);
  };
  art("a001", "p:box:alpha", 3);
  art("a002", "p:box:alpha", 1);
  art("b001", "p:box:beta", 2);
  art("h001", "p:box:", 1);
  put(dir, "artifacts.json", arts);
  put(dir, "machines/far/outbox.json", []);
  put(dir, "machines/far/mirror/home/u/.claude/sessions/1.json", { pid: 1 });
  put(dir, "machines/far/mirror/home/u/.claude/projects/p/s.jsonl", "line\n");
}

const everyFile = (dir: string) => files(dir).filter((f) => !f.startsWith("migrated"));

test("a folder shaped like a real one moves forward and back with every file counted", () => {
  const from = join(root, "r-old");
  const to = join(root, "r-new");
  realWorld(from);
  const dry = run(["--dry-run"], from, to);
  expect(dry.code).toBe(0);
  expect(dry.text).toContain("4 tasks, 1 open: ALP-3");
  expect(dry.text).toContain("4 task chats, 3 space chats");
  expect(dry.text).toContain("4 artifacts, 7 versions, 11 files");
  expect(dry.text).toContain("3 HEARTBEAT.md files");
  expect(dry.text).toContain("3 machine files");
  expect(dry.text).toContain("alpha: 3 tasks, 3 task chats, 1 space chats, 2 artifacts, 1 heartbeats");
  expect(dry.text).toContain("beta: 1 tasks, 1 task chats, 1 space chats, 1 artifacts, 1 heartbeats");
  expect(dry.text).toContain("(home): 0 tasks, 0 task chats, 1 space chats, 1 artifacts, 1 heartbeats");
  expect(existsSync(to)).toBe(false);

  const fwd = run([], from, to);
  expect(fwd.code).toBe(0);
  expect(fwd.text).toContain("lineclear serve --port 7787");
  const count = (dir: string, sub: string) => readdirSync(join(dir, sub), { recursive: true, withFileTypes: true }).filter((e) => !e.isDirectory()).length;
  for (const sub of ["chatlog", "heartbeat", "artifacts", "machines"]) expect(count(to, sub)).toBe(count(from, sub));
  // the text of every file is the same
  const copied = everyFile(to).filter((f) => /^(chatlog|heartbeat|artifacts|machines)\//.test(f));
  const source = everyFile(from).filter((f) => /^(chatlog|heartbeat|artifacts|machines)\//.test(f));
  expect(copied).toEqual(source);
  expect(JSON.parse(readFileSync(join(to, "tasks.json"), "utf8")).tasks).toHaveLength(4);
  expect(Object.keys(JSON.parse(readFileSync(join(to, "artifacts.json"), "utf8"))).sort()).toEqual(["a001", "a002", "b001", "h001"]);
  expect(JSON.parse(readFileSync(join(to, "modes.json"), "utf8"))).toEqual({ "p:box:alpha": "regular", "p:box:": "regular" });

  // back: into an emptied Shepherdr folder, everything returns
  const gone = join(root, "r-gone");
  expect(run(["--back"], gone, to).code).toBe(0);
  for (const sub of ["chatlog", "heartbeat", "artifacts", "machines"]) expect(count(gone, sub)).toBe(count(from, sub));
  expect(everyFile(gone).filter((f) => /^(chatlog|heartbeat|artifacts|machines)\//.test(f))).toEqual(source);
  expect(JSON.parse(readFileSync(join(gone, "tasks.json"), "utf8")).tasks).toHaveLength(4);
  expect(Object.keys(JSON.parse(readFileSync(join(gone, "artifacts.json"), "utf8"))).sort()).toEqual(["a001", "a002", "b001", "h001"]);
});

test("a move is refused while Shepherdr 2.0 runs, and copies nothing", () => {
  const from = join(root, "s-old");
  const to = join(root, "s-new");
  realWorld(from);
  const r = run([], from, to, NOW, (side) => side === "shepherdr");
  expect(r.code).toBe(1);
  expect(r.text).toContain("Stop its server first");
  expect(existsSync(to)).toBe(false);
  expect(run(["--dry-run"], from, to, NOW, (side) => side === "shepherdr").code).toBe(0);
});

test("per-space counts hold for a host name with a dash", () => {
  const from = join(root, "dash-old");
  put(from, "spaces.json", [{ name: "demo", path: "/x/demo", key: "DEM", base: "main" }]);
  put(from, "tasks.json", { next: {}, tasks: [], red: {} });
  put(from, "chatlog/p_my-laptop_demo.json", { posted: [] });
  put(from, "heartbeat/p-my-laptop-demo.md", "# Heartbeat");
  put(from, "artifacts.json", { zzzz: { id: "zzzz", place: "p:my-laptop:demo", versions: [{ n: 1, html: 1 }] } });
  put(from, "artifacts/zzzz/1.html", "x");
  const r = run(["--dry-run"], from, join(root, "dash-new"));
  expect(r.text).toContain("demo: 0 tasks, 0 task chats, 1 space chats, 1 artifacts, 1 heartbeats");
  expect(r.text).not.toContain("laptop");
});
