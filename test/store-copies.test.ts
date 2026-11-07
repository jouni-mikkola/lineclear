import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copiesProblem, copyStore, copyStoreQuietly, listCopies, restoreCopy, storeMain, taskCount } from "../src/store-copies.ts";
import { tmp } from "./helpers.ts";

function world() {
  const root = tmp("store-copies");
  const data = join(root, "data");
  mkdirSync(data, { recursive: true });
  const env = { LINECLEAR_HOME: data, LINECLEAR_STORE_COPIES: join(root, "copies"), HOME: root };
  const fill = (n: number) => {
    writeFileSync(join(data, "tasks.json"), JSON.stringify({ tasks: Array.from({ length: n }, (_, i) => ({ id: i })) }));
    writeFileSync(join(data, "tasks-cold.jsonl"), n ? '{"id":"c"}\n' : "");
  };
  return { data, env, fill };
}
const at = (h: number) => new Date(Date.UTC(2026, 10, 3, 0, 0, 0) + h * 3_600_000);

test("a copy holds the store files and names its source; the count is hot plus cold", () => {
  const { data, env, fill } = world();
  fill(2);
  expect(taskCount(data)).toBe(3);
  const name = copyStore("hourly", at(0), env);
  expect(listCopies(env)[0]).toMatchObject({ name, tasks: 3, source: data });
});

test("hourly copies keep the last 48 and none is taken within the hour", () => {
  const { env, fill } = world();
  fill(1);
  for (let h = 0; h < 60; h++) copyStore("hourly", at(h), env);
  expect(copyStore("hourly", at(59.5), env)).toBe("");
  expect(listCopies(env)).toHaveLength(48);
});

test("an emptied store does not push the good copies out, and restore puts them back", () => {
  const { data, env, fill } = world();
  fill(4);
  const good = copyStore("hourly", at(0), env);
  fill(0);
  expect(copyStore("hourly", at(5), env)).toBe("");
  expect(restoreCopy(good, env)).toBe(5);
  expect(taskCount(data)).toBe(5);
  expect(() => restoreCopy("nope", env)).toThrow();
});

test("copiesProblem names no copy and a stale copy, and is quiet for a fresh one", () => {
  const { env, fill } = world();
  fill(1);
  expect(copiesProblem(env, at(0))).toContain("no copy");
  copyStore("hourly", at(0), env);
  expect(copiesProblem(env, at(1))).toBe("");
  expect(copiesProblem(env, at(4))).toContain("over 3 hours");
});

test("lineclear store lists, copies and restores", () => {
  const { env, fill } = world();
  fill(1);
  const out: string[] = [];
  expect(storeMain(["copy"], (l) => out.push(l), env, at(0))).toBe(0);
  expect(storeMain(["list"], (l) => out.push(l), env)).toBe(0);
  expect(out.join("\n")).toContain("2 tasks");
  expect(storeMain(["restore", "x"], (l) => out.push(l), env)).toBe(1);
  expect(storeMain(["bogus"], (l) => out.push(l), env)).toBe(2);
  expect(readdirSync(env.LINECLEAR_STORE_COPIES)).toEqual(["hourly-2026-11-03T00-00-00.sqlite"]);
});

test("the cold log counts one task per id, and a gone line drops it", () => {
  const { data, fill } = world();
  fill(0);
  writeFileSync(join(data, "tasks-cold.jsonl"), '{"id":"A-1","n":1}\n{"id":"A-1","n":1,"x":2}\n{"id":"A-2"}\n{"gone":"A-2"}\n\n');
  expect(taskCount(data)).toBe(1);
});

test("a copy is one small file, holds the store at one moment, and leaves out secrets and push keys", () => {
  const { data, env, fill } = world();
  fill(1);
  const store = new Database(join(data, "store.sqlite"));
  store.exec("PRAGMA journal_mode=WAL; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('one')");
  writeFileSync(join(data, "agents-cold.jsonl"), '{"id":"a","note":"x"}\n'.repeat(200_000));
  writeFileSync(join(data, "vault.json"), "TOPSECRET");
  writeFileSync(join(data, "vapid.json"), "TOPSECRET");
  writeFileSync(join(data, "push.json"), "TOPSECRET");
  const name = copyStore("hourly", at(0), env);
  const file = join(env.LINECLEAR_STORE_COPIES, `${name}.sqlite`);
  expect(statSync(file).size).toBeLessThan(5_000_000);
  expect(readFileSync(file).includes("TOPSECRET")).toBe(false);
  store.exec("INSERT INTO t VALUES ('two')");
  restoreCopy(name, env);
  const back = new Database(join(data, "store.sqlite"));
  expect(back.query("SELECT v FROM t").all()).toEqual([{ v: "one" }]);
  expect(back.query("SELECT name FROM sqlite_master WHERE name LIKE 'copy_%'").all()).toEqual([]);
  expect(readFileSync(join(data, "vault.json"), "utf8")).toBe("TOPSECRET");
});

test("a failed copy is not swallowed: doctor names it, and a good copy clears it", () => {
  const { data, env, fill } = world();
  fill(1);
  writeFileSync(join(data, "blocker"), "a file where the folder should be");
  const broken = { ...env, LINECLEAR_STORE_COPIES: join(data, "blocker", "copies") };
  copyStoreQuietly(broken, at(0));
  expect(copiesProblem(broken, at(0))).toContain("the last copy of the store failed");
  copyStoreQuietly(env, at(0));
  expect(copiesProblem(env, at(0))).toBe("");
});

test("a copy holds the task briefs tasks.json points at, and restore puts them back", () => {
  const { data, env, fill } = world();
  fill(1);
  mkdirSync(join(data, "tasks", "T-1"), { recursive: true });
  writeFileSync(join(data, "tasks", "T-1", "brief.md"), "the brief");
  const name = copyStore("hourly", at(0), env);
  rmSync(join(data, "tasks"), { recursive: true });
  restoreCopy(name, env);
  expect(readFileSync(join(data, "tasks", "T-1", "brief.md"), "utf8")).toBe("the brief");
});
