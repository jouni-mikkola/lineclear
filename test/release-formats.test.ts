import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatsOf } from "../src/release.ts";
import { unreadable } from "../scripts/formats.ts";
import { sh, tmp } from "./helpers.ts";

let root: string;

beforeEach(() => {
  root = tmp("release-formats");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeStore(server: string, store: string): number {
  // the check builds the registries once before its shards; every test building them again is a write all shards share
  const built = existsSync(join(server, "generated", "server-plugins.ts")) ? 0 : sh(["bun", join(server, "scripts", "build-plugins.ts")], { cwd: server }).code;
  return built !== 0 ? built : sh(["bun", join(server, "scripts", "store-formats.ts"), "write", store], { cwd: server }).code;
}

test("the format check reads the store this build writes and names what it would drop", () => {
  const store = join(root, "store");
  const server = join(import.meta.dir, "..", "server");
  expect(writeStore(server, store)).toBe(0);
  expect(unreadable(join(import.meta.dir, ".."), store)).toEqual([]);
  writeFileSync(join(store, "settings.json"), JSON.stringify({ everywhere: { "made.up": "x" } }));
  writeFileSync(join(store, "tasks.json"), JSON.stringify({ tasks: {} }));
  writeFileSync(join(store, "modes.json"), JSON.stringify({ "p:m:a": "turbo" }));
  expect(unreadable(root, store)).toEqual([
    "settings.json: this build would drop everywhere made.up",
    "tasks.json: no next or tasks list",
    "modes.json: this build would drop the mode of p:m:a",
    expect.stringMatching(/^task-ids\.sqlite: /),
  ]);
  // a newer build reading an older one's store: values it drops are its own upgrades, only a failure to read counts
  expect(unreadable(root, store, true)).toEqual(["tasks.json: no next or tasks list", expect.stringMatching(/^task-ids\.sqlite: /)]);
}, 180_000);

const storeCount = (server: string, store: string) => JSON.parse(sh(["bun", join(server, "scripts", "store-formats.ts"), "count", store], { cwd: server }).out);

test("a store the candidate wrote is read whole after a rollback: no task, chat or Inbox item lost", () => {
  const store = join(root, "store");
  const server = join(import.meta.dir, "..", "server");
  expect(writeStore(server, store)).toBe(0);
  const wrote = storeCount(server, store);
  expect(wrote).toEqual({ tasks: 1, chats: 1, inbox: 1 });
  // the previous build reads the same files: nothing unreadable, and the same counts
  expect(unreadable(root, store)).toEqual([]);
  expect(storeCount(server, store)).toEqual(wrote);
}, 180_000);

test("a planted format change with no migration fails the check", () => {
  const store = join(root, "store");
  const server = join(import.meta.dir, "..", "server");
  expect(writeStore(server, store)).toBe(0);
  writeFileSync(join(store, "chatlog", "SAM-1_Agent.json"), JSON.stringify({ messages: [] }));
  expect(unreadable(root, store)).toEqual([expect.stringContaining("chatlog: SAM-1_Agent.json")]);
  writeFileSync(join(store, "chatlog", "SAM-1_Agent.json"), "{}");
  const tasks = JSON.parse(readFileSync(join(store, "tasks.json"), "utf8"));
  writeFileSync(join(store, "tasks.json"), JSON.stringify({ ...tasks, tasks: tasks.tasks.map(({ id, ...t }: { id: string }) => ({ ...t, key: id })) }));
  expect(unreadable(root, store, true)).toEqual(expect.arrayContaining([expect.stringContaining("tasks.json")]));
}, 180_000);

test("the format check reads the task id database with the server's code, and names one it cannot read", () => {
  const store = join(root, "store");
  const server = join(import.meta.dir, "..", "server");
  expect(writeStore(server, store)).toBe(0);
  expect(existsSync(join(store, "task-ids.sqlite"))).toBe(true);
  const db = new Database(join(store, "task-ids.sqlite"));
  db.exec("DROP TABLE sequences; CREATE TABLE sequences (space TEXT PRIMARY KEY, code TEXT);");
  db.close();
  expect(unreadable(root, store, true)).toEqual([expect.stringMatching(/^task-ids\.sqlite: /)]);
}, 180_000);

// Before a merge: the build this machine runs (stable) must read this tree's roadmap and a store this tree's server
// wrote. Skipped where Lineclear is not installed; until stable has scripts/formats.ts it reads the roadmap only.
const installed = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "lineclear");
test.skipIf(!existsSync(join(installed, "bin", "lineclear")))(
  "the stable build reads this tree's roadmap and store files",
  () => {
    const store = join(root, "store");
    const server = join(import.meta.dir, "..", "server");
    expect(writeStore(server, store)).toBe(0);
    expect(formatsOf(installed, join(import.meta.dir, ".."), store, { ...process.env, HOME: root, LINECLEAR_HOME: join(root, "data") })).toBe("");
    // rolled back to stable: its own code finds every task, chat and Inbox item the candidate wrote
    const stableServer = join(installed, "server");
    const stableCount = join(stableServer, "scripts", "store-formats.ts");
    // a stable build that predates the count verb has nothing to lose items with: the fixture test below stands for it
    if (existsSync(stableCount) && readFileSync(stableCount, "utf8").includes('"count"')) {
      const r = sh(["bun", stableCount, "count", store], { cwd: stableServer });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.out)).toEqual(storeCount(server, store));
    }
  },
  180_000,
);

// test/fixtures/stable-store holds the files the last stable build wrote. A format change must update it in the same
// change as its migration, so the candidate keeps reading the old files and this test names the change.
const fixture = join(import.meta.dir, "fixtures", "stable-store");
const shapeOf = (v: unknown): unknown =>
  Array.isArray(v)
    ? [v[0] === undefined ? null : shapeOf(v[0])]
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)]))
      : typeof v;
const FORMATS = ["tasks.json", "spaces.json", "settings.json", join("chatlog", "SAM-1_Agent.json")];
const shapes = (store: string) => FORMATS.map((f) => shapeOf(JSON.parse(readFileSync(join(store, f), "utf8"))));

test("the candidate reads the store stable wrote: no task, chat or Inbox item lost", () => {
  const server = join(import.meta.dir, "..", "server");
  expect(unreadable(root, fixture, true)).toEqual([]);
  expect(storeCount(server, fixture)).toEqual({ tasks: 1, chats: 1, inbox: 1 });
}, 180_000);

test("a stored format changed with no migration fails: the candidate writes what the stable store holds", () => {
  const store = join(root, "store");
  const server = join(import.meta.dir, "..", "server");
  expect(writeStore(server, store)).toBe(0);
  expect(shapes(store)).toEqual(shapes(fixture));
  const tasks = JSON.parse(readFileSync(join(store, "tasks.json"), "utf8"));
  writeFileSync(join(store, "tasks.json"), JSON.stringify({ ...tasks, tasks: tasks.tasks.map((t: object) => ({ ...t, renamed: 1 })) }));
  expect(shapes(store)).not.toEqual(shapes(fixture));
}, 180_000);
