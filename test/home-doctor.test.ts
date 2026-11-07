import { expect, test } from "bun:test";
import { parseDoctor } from "../src/home-doctor.ts";

test("a FAILED line and its fix line become one problem", () => {
  const out = ["ok     herdr", "FAILED service: the unit is missing", "       fix: install again", "All well."].join("\n");
  expect(parseDoctor(out)).toEqual([{ name: "service", problem: "the unit is missing", fix: "install again" }]);
});
