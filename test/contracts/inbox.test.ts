// The contract of inbox: items as rules, dispatcher, planner, measure and ui add, read and close them.
import { expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { addItem, closeItem, isOpen, itemPath, readAllItems, readItems } from "../../src/inbox.ts";
import { tmp } from "../helpers.ts";

const item = { kind: "outward" as const, task: "T-1", question: "Go?", choices: ["Go", "Not yet"], since: "2026-01-01T00:00:00Z" };

test("addItem numbers items from 1 and never repeats a number; readItems gives them in order", () => {
  const vars = { LINECLEAR_CONFIG: tmp("contract-inbox") };
  const a = addItem(item, vars);
  const b = addItem(item, vars);
  expect([a.n, b.n]).toEqual([1, 2]);
  expect(readItems(vars).map((i) => i.n)).toEqual([1, 2]);
});

test("closeItem keeps the item, closed with its reason, and isOpen says no", () => {
  const vars = { LINECLEAR_CONFIG: tmp("contract-inbox") };
  const a = addItem(item, vars);
  expect(isOpen(a)).toBe(true);
  closeItem(a, "its task is over", new Date("2026-01-02T00:00:00Z"), vars);
  const closed = readAllItems(vars)[0];
  expect(readItems(vars)).toEqual([]);
  expect(closed?.closed).toBe("its task is over");
  expect(closed && isOpen(closed)).toBe(false);
  expect(addItem(item, vars).n).toBe(2);
});

test("a closed plan stays in the folder for its tries, and an item closed in the old way moves to closed/", () => {
  const vars = { LINECLEAR_CONFIG: tmp("contract-inbox-plan") };
  const plan = addItem({ ...item, kind: "plan" }, vars);
  closeItem(plan, "the branch changed", new Date(), vars);
  expect(readItems(vars).map((i) => i.closed)).toEqual(["the branch changed"]);
  const old = addItem(item, vars);
  writeFileSync(itemPath(old.n, vars), JSON.stringify({ ...old, closed: "old way" }));
  expect(readItems(vars).map((i) => i.n)).toEqual([plan.n]);
  expect(existsSync(itemPath(old.n, vars))).toBe(false);
  expect(readAllItems(vars).map((i) => i.n)).toEqual([plan.n, old.n]);
  expect(addItem(item, vars).n).toBe(old.n + 1);
});

test("every link the Inbox and the CLI give opens the Lineclear UI: no old port, no old page path", async () => {
  const { waitBlocker } = await import("../../src/home-waits.ts");
  const { publishedAddress } = await import("../../src/published.ts");
  const links = (["owner", "login", "browser"] as const).map((kind) => waitBlocker({ kind, reason: "r" } as never).href ?? "");
  links.push(publishedAddress({}) ?? "/");
  expect(links.slice(0, 3)).toEqual(["/inbox", "/browsers", "/browsers"]);
  for (const link of links) {
    expect(link).not.toMatch(/:7421\b/);
    expect(link).not.toMatch(/\?place=|[?&]focus=|^\.\/|#\//);
  }
});
