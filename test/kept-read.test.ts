import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTasksKept } from "../src/kept-read.ts";

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
