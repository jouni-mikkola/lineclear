import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PROSE_RULE, proseFaults } from "../src/prose.ts";

test("plain text has no fault", () => {
  expect(proseFaults("Fix the merge lane\nOne point per line.")).toEqual([]);
});

test("dashes, semicolons and filler words are faults", () => {
  expect(proseFaults("a \u2014 b")).toEqual(["an en or em dash"]);
  expect(proseFaults("a; b")).toEqual(["a semicolon"]);
  expect(proseFaults("Leverages a robust and seamless way to ensure it")).toHaveLength(4);
  expect(proseFaults("Across the board")).toEqual(['the word "across"']);
  expect(proseFaults("a crossing")).toEqual([]);
});

test("every prompt that writes git or pull request text carries the rule", () => {
  for (const f of ["brief", "brief-review", "fix-brief", "dispatcher"]) {
    expect(readFileSync(`templates/${f}.md`, "utf8")).toContain(PROSE_RULE);
  }
});
