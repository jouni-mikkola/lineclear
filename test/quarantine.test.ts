import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { QUARANTINE_LIMIT, settleFailures } from "../scripts/failures.ts";

const fail = (test: string) => ({ file: "test/a.test.ts", test });

test("a flake is quarantined, a break fails, a 6th flake fails", async () => {
  const flakes = ["f1", "f2", "f3", "f4", "f5", "f6"];
  const alone = async (f: { test: string }) => flakes.includes(f.test);
  const quarantine = [{ file: "test/a.test.ts", test: "old", task: "VEL-1" }];

  const one = await settleFailures([fail("f1")], [], alone);
  expect(one.fatal).toEqual([]);
  expect(one.added).toEqual([{ file: "test/a.test.ts", test: "f1", task: "unfiled" }]);

  const broken = await settleFailures([fail("broken")], [], alone);
  expect(broken.fatal).toEqual([fail("broken")]);
  expect(broken.added).toEqual([]);

  const listed = await settleFailures([fail("old")], quarantine, async () => false);
  expect(listed.fatal).toEqual([]);
  expect(listed.quarantined).toEqual([fail("old")]);

  const six = await settleFailures(flakes.map(fail), quarantine, alone);
  expect(QUARANTINE_LIMIT).toBe(5);
  expect(six.added.map((a) => a.test)).toEqual(["f1", "f2", "f3", "f4"]);
  expect(six.fatal.map((f) => f.test)).toEqual(["f5", "f6"]);
});

test("the committed quarantine holds at most the limit, each with a task", () => {
  const path = new URL("./quarantine.json", import.meta.url);
  expect(existsSync(path)).toBe(true);
  const list = JSON.parse(readFileSync(path, "utf8")) as { task: string }[];
  expect(list.length).toBeLessThanOrEqual(QUARANTINE_LIMIT);
  for (const q of list) expect(q.task).toMatch(/\S/);
});
