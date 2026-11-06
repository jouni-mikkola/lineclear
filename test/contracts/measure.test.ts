// The contract of measure: the readers rules, inbox, the planner and ui use for Lineclear's and pi's files.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatFiles, costOf, findSpace } from "../../src/measure.ts";
import { sessionUsage } from "../../src/session-text.ts";
import { healthLines, partHealth, taskSignals, worstParts } from "../../src/part-health.ts";
import { parsePart } from "../../src/parts.ts";
import type { Step } from "../../src/roadmap.ts";
import { tmp } from "../helpers.ts";

test("findSpace finds a space by name, key or folder; chatFiles reads only its own chats", () => {
  const dir = tmp("contract-measure");
  writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "app", key: "APP", path: "/r" }]));
  mkdirSync(join(dir, "chatlog"));
  writeFileSync(join(dir, "chatlog", "APP-1.json"), JSON.stringify({ posted: [] }));
  writeFileSync(join(dir, "chatlog", "OTHER-1.json"), JSON.stringify({ posted: [] }));
  for (const by of ["app", "APP"]) expect(findSpace(dir, by, "/x")).toEqual({ name: "app", key: "APP" });
  expect(findSpace(dir, "nope", "/r")?.key).toBe("APP");
  expect(chatFiles(dir, { name: "app", key: "APP" })).toHaveLength(1);
});

test("costOf prices per million tokens; sessionUsage of an empty file is none", () => {
  const u = { model: "m", provider: "p", input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0 };
  expect(costOf(u, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 })).toBe(3);
  expect(sessionUsage("")).toEqual([]);
});

test("partHealth gives every part a score, worst first, and worstParts names the top ones", () => {
  const page = (n: string, debts: string) => parsePart(n, `# ${n}\n\nx\n\n## Files\n\n- \`src/${n}/\`\n\n## Debts\n\n${debts}\n`);
  const h = partHealth(tmp("contract-measure"), [page("a", "- none"), page("b", "- one\n- two")], [], [], taskSignals([]));
  expect(h.map((x) => [x.part, x.score])).toEqual([
    ["b", 2],
    ["a", 0],
  ]);
  expect(worstParts(h)).toEqual(["b"]);
});

test("partHealth adds oversize files, copied lines and the signals of the tasks of steps that touched the part", () => {
  const repo = tmp("contract-measure");
  const base = join(repo, "scripts", "gates", "baseline");
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "size.json"), JSON.stringify({ "src/a/x.ts": 700 }));
  writeFileSync(join(base, "copies.json"), JSON.stringify({ "src/a/x.ts:1 = src/b/y.ts:1": 100 }));
  const page = (n: string) => parsePart(n, `# ${n}\n\nx\n\n## Files\n\n- \`src/${n}/\`\n\n## Debts\n\n- one\n`);
  const step = { id: "L1", fields: { parts: { value: "a", line: 1, more: [] } } } as unknown as Step;
  const signals = new Map([["T-1", { stalls: 1, findings: 3, flaky: 1 }]]);
  const h = partHealth(repo, [page("a"), page("b")], [step], [{ id: "T-1", title: "L1 Something" }], signals);
  // a: 3 size + 2 copied + 1 debt + 2 stall + 3 findings + 2 flaky; b: 2 copied + 1 debt
  expect(h.map((x) => [x.part, x.score])).toEqual([
    ["a", 13],
    ["b", 3],
  ]);
  expect(healthLines(h)).toHaveLength(3);
});
