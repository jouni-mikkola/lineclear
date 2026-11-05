import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { retireOldNotes } from "../pi/parts/compaction-notes.ts";
import { cut, plan } from "../pi/parts/cut-output.ts";
import { tmp } from "./helpers.ts";

function oldNotes(defaults: string) {
  const home = tmp("pi-parts");
  const dir = join(home, ".pi", "agent", "extensions", "state-file");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "defaults.json"), defaults);
  return { HOME: home, PI_CODING_AGENT_DIR: undefined, CC_STATE_FILE_CONFIG: undefined };
}

test("the older notes extension is left alone when its defaults are unreadable or name no settings file", () => {
  expect(retireOldNotes(oldNotes("{not json"))).toBe(false);
  expect(retireOldNotes(oldNotes(JSON.stringify({ override: "" })))).toBe(false);
  expect(retireOldNotes(oldNotes(JSON.stringify({ enabled: true })))).toBe(false);
});

test("an older notes extension with no settings of its own yet is turned off with a file of its own", () => {
  const env = oldNotes(JSON.stringify({ override: "~/notes/state-file.json" }));
  expect(retireOldNotes(env)).toBe(true);
  expect(JSON.parse(readFileSync(join(env.HOME, "notes", "state-file.json"), "utf8"))).toEqual({ enabled: false });
});

test("a long output is cut at line ends when they are near, and the note names the lines left out", () => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i}`.padEnd(49, "x")).join("\n");
  const p = plan(text, 2000);
  expect(p).not.toBeNull();
  const cutText = cut(text, p as NonNullable<typeof p>, "/tmp/whole.txt");
  expect(cutText).toContain("Output cut by the token pack");
  expect(cutText).toContain("/tmp/whole.txt");
  expect(cutText.length).toBeLessThan(text.length);
  expect(plan("short", 2000)).toBeNull();
});

test("a cut never splits a surrogate pair at either end", () => {
  const text = "😀".repeat(3000);
  const p = plan(text, 1000);
  expect(p).not.toBeNull();
  const { headEnd, tailStart } = p as NonNullable<typeof p>;
  expect(/[\ud800-\udbff]$/.test(text.slice(0, headEnd))).toBe(false);
  expect(/^[\udc00-\udfff]/.test(text.slice(tailStart))).toBe(false);
});
