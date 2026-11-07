import { expect, test } from "bun:test";
import { type Failure, QUARANTINE_MAX, type Quarantined, settle } from "../scripts/failures.ts";

const failure = (test: string): Failure => ({ file: "./test/a.test.ts", test });
const file = (f: Failure) => `server/${f.file}`;
const entry = (test: string): Quarantined => ({ file: "server/./test/a.test.ts", test, fix: "VEL-1" });

test("a flake goes to quarantine, a break stays broken, a 6th flake fails", async () => {
  const flakes = ["f1", "f2", "f3", "f4", "f5", "f6"];
  const alone = async (f: Failure) => f.test !== "broken";
  const first = await settle([failure("f1"), failure("broken")], file, alone, [], "VEL-9");
  expect(first.added).toEqual([{ file: "server/./test/a.test.ts", test: "f1", fix: "VEL-9" }]);
  expect(first.broken.map((f) => f.test)).toEqual(["broken"]);

  const held = flakes.slice(0, QUARANTINE_MAX).map(entry);
  const sixth = await settle([failure("f6")], file, alone, held, "VEL-9");
  expect(sixth.broken.map((f) => f.test)).toEqual(["f6"]);
  expect(sixth.added).toEqual([]);
});

test("a quarantined test is let through only while it passes alone", async () => {
  const held = [entry("f1")];
  const pass = await settle([failure("f1")], file, async () => true, held, "VEL-9");
  expect(pass.broken).toEqual([]);
  expect(pass.added).toEqual([]);
  const fail = await settle([failure("f1")], file, async () => false, held, "VEL-9");
  expect(fail.broken).toHaveLength(1);
});
