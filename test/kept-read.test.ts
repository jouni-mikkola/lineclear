import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { readRetiredKept, readTasksKept, retiredCounts } from "../src/tasks-kept.ts";

test("Lineclear's tasks are tasks.json with the old ones of its append log; tasks.json wins, a gone line drops one", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-kept-"));
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify({
      next: { A: 4 },
      tasks: [
        { id: "A-3", title: "new" },
        { id: "A-2", title: "at work again" },
      ],
    }),
  );
  const cold = [{ id: "A-1", title: "old" }, { id: "A-2", title: "was cold" }, { id: "A-4", title: "deleted" }, { gone: "A-4" }];
  writeFileSync(join(dir, "tasks-cold.jsonl"), `${cold.map((l) => JSON.stringify(l)).join("\n")}\n{"id": "A-5", "tit`);
  const read = readTasksKept(dir);
  expect(read.next).toEqual({ A: 4 });
  expect(read.tasks.map((t) => `${t.id} ${t.title}`)).toEqual(["A-1 old", "A-3 new", "A-2 at work again"]);
  // a line added to the log is read at once
  appendFileSync(join(dir, "tasks-cold.jsonl"), `\n${JSON.stringify({ id: "A-1", title: "old, pinned" })}\n`);
  expect(readTasksKept(dir).tasks[0]?.title).toBe("old, pinned");
  expect(readTasksKept(mkdtempSync(join(tmpdir(), "lc-kept-"))).tasks).toEqual([]);
});

test("a folder with the tasks table reads rows: live tasks with their briefs, the retired ones counted by space", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-rows-"));
  const db = new Database(join(dir, "store.sqlite"), { create: true });
  db.exec(`create table tasks (id text primary key, json text not null, retired integer not null default 0);
    create table task_briefs (id text primary key, brief text not null);
    create table task_meta (key text primary key, value text not null);
    insert into tasks (id, json, retired) values ('A-1', '{"id":"A-1","title":"live"}', 0), ('A-2', '{"id":"A-2","merged":true}', 1), ('A-3', '{"id":"A-3"}', 1);
    insert into task_briefs values ('A-1', 'the brief');
    insert into task_meta values ('meta', '{"next":{"A":4}}')`);
  db.close();
  expect(readTasksKept(dir)).toEqual({ next: { A: 4 }, tasks: [{ id: "A-1", title: "live", desc: "the brief" }] });
  expect(readRetiredKept(dir).map((t) => t.id)).toEqual(["A-2", "A-3"]);
  expect(retiredCounts(dir)).toEqual({ A: { merged: 1, closed: 1 } });
});
