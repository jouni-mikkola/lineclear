import { expect, test } from "bun:test";
import { join } from "node:path";
import { exportMain, inboxAll } from "../src/export.ts";
import { tmp } from "./helpers.ts";

/** Empty Lineclear folders and no other machines. */
function world() {
  const root = tmp("export");
  return { ...process.env, HOME: root, LINECLEAR_HOME: join(root, "data"), LINECLEAR_CONFIG: join(root, "config"), LINECLEAR_OLD_DIR: join(root, "old") };
}

test("export gives one JSON line with what this machine holds", async () => {
  const lines: string[] = [];
  expect(await exportMain((l) => lines.push(l), world())).toBe(0);
  expect(lines).toHaveLength(1);
  const data = JSON.parse(lines[0] as string);
  expect(data.projects).toEqual([]);
  expect(data.inbox).toEqual([]);
  expect(Array.isArray(data.status)).toBe(true);
  expect(Array.isArray(data.browsers)).toBe(true);
});

test("inbox for every machine, with no other machine, is this machine's inbox", () => {
  const lines: string[] = [];
  expect(inboxAll((l) => lines.push(l), world())).toBe(0);
  expect(lines.length).toBeGreaterThan(0);
});
