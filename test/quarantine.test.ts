import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Failure } from "../scripts/failures.ts";
import { judge, MAX_QUARANTINED, quarantineKey, readQuarantine, writeQuarantine } from "../scripts/quarantine.ts";
import { tmp } from "./helpers.ts";

const fail = (n: number): Failure => ({ file: "test/a.test.ts", test: `t${n}` });

test("a flake is added, a break fails, a 6th flake fails, a quarantined flake is tolerated, a quarantined break still fails", () => {
  const flaky = (f: Failure) => f.test !== "break";
  const some = judge(".", [fail(1), { ...fail(0), test: "break" }], flaky, []);
  expect(some.added).toEqual([fail(1)]);
  expect(some.broken.map((f) => f.test)).toEqual(["break"]);

  const full = Array.from({ length: MAX_QUARANTINED }, (_, i) => ({ test: quarantineKey(".", fail(i)), fix: "VEL-1" }));
  const sixth = judge(".", [fail(MAX_QUARANTINED)], flaky, full);
  expect(sixth.broken).toEqual([fail(MAX_QUARANTINED)]);
  expect(sixth.added).toEqual([]);

  expect(judge(".", [fail(0)], flaky, full).tolerated).toEqual([fail(0)]);
  expect(judge(".", [fail(0)], () => false, full).broken).toEqual([fail(0)]);
});

test("the quarantine is a json list, empty when the file is missing", () => {
  const path = join(tmp("quarantine"), "q.json");
  expect(readQuarantine(path)).toEqual([]);
  writeQuarantine([{ test: "./test/a.test.ts > x", fix: "VEL-2" }], path);
  expect(readQuarantine(path)).toEqual([{ test: "./test/a.test.ts > x", fix: "VEL-2" }]);
  expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
  expect(readQuarantine("test/quarantine.json").length).toBeLessThanOrEqual(MAX_QUARANTINED);
});
