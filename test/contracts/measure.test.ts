// The contract of measure: the readers rules, inbox, the planner and ui use for Lineclear's and pi's files.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatFiles, costOf, findSpace } from "../../src/measure.ts";
import { sessionUsage } from "../../src/session-text.ts";
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
