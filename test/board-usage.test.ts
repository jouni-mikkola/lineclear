import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { frames } from "./board-frames.ts";

// The board's Usage frames state facts and give no verdict (U51). The board builds its frames in a script; run it on a
// stub page and read what it puts in each frame.

const USAGE = ["usage-d", "usage-p", "usage-p2", "usage-p3"];

// The verdict phrases docs/design.md lists.
const VERDICTS = ["Work can start now", "Work can wait", "Nothing can start", "You are good", "All good", "Plenty of room", "Running low"];

test("every Usage frame is built", () => {
  const f = frames();
  for (const id of USAGE) expect(f[id], id).toBeTruthy();
});

test("no Usage frame holds a verdict phrase", () => {
  const f = frames();
  for (const id of USAGE) {
    for (const p of VERDICTS) expect((f[id] ?? "").toLowerCase(), `${id}: ${p}`).not.toContain(p.toLowerCase());
  }
});

test("the phrases the test rejects are the ones design.md lists", () => {
  const doc = readFileSync(new URL("../docs/design.md", import.meta.url), "utf8");
  for (const p of VERDICTS) expect(doc, p).toContain(`"${p}"`);
});

test("the agents at work show their facts, and a frame shows none", () => {
  const f = frames();
  for (const id of ["usage-d", "usage-p"]) {
    expect(f[id], id).toContain("Agents at work");
    expect(f[id], id).toContain("claude-opus-5-5");
    expect(f[id], id).toMatch(/\$\d/);
    expect(f[id], id).toMatch(/\d+%/);
  }
  expect(f["usage-p3"]).toContain("No agent at work");
});
