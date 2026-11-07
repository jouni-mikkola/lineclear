// The contract of inbox: items as rules, dispatcher, planner, measure and ui add, read and close them.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addItem, closeItem, isOpen, readAllItems, readItems } from "../../src/inbox.ts";
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

test("50 items added from 5 processes get 50 distinct numbers", async () => {
  const config = tmp("contract-inbox-race");
  const code = `import { addItem } from ${JSON.stringify(join(import.meta.dir, "../../src/inbox.ts"))};
    for (let i = 0; i < 10; i++) addItem({ kind: "outward", task: "T-1", question: "Go?", choices: ["Go", "No"], since: "2026-01-01T00:00:00Z" });`;
  const env = { ...process.env, LINECLEAR_CONFIG: config };
  const runs = Array.from({ length: 5 }, () => Bun.spawn([process.execPath, "-e", code], { env, stdout: "ignore", stderr: "pipe" }));
  for (const r of runs) expect([await r.exited, await new Response(r.stderr).text()]).toEqual([0, ""]);
  const numbers = readItems({ LINECLEAR_CONFIG: config }).map((i) => i.n);
  expect(new Set(numbers).size).toBe(50);
  expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
});

test("a closed plan stays in the list for its tries, and the folders of an older version are imported once", () => {
  const vars = { LINECLEAR_CONFIG: tmp("contract-inbox-plan") };
  const plan = addItem({ ...item, kind: "plan" }, vars);
  closeItem(plan, "the branch changed", new Date(), vars);
  expect(readItems(vars).map((i) => i.closed)).toEqual(["the branch changed"]);
  const old = addItem(item, vars);
  closeItem(old, "old way", new Date(), vars);
  expect(readItems(vars).map((i) => i.n)).toEqual([plan.n]);
  expect(readAllItems(vars).map((i) => i.n)).toEqual([plan.n, old.n]);
  expect(addItem(item, vars).n).toBe(old.n + 1);

  const older = { LINECLEAR_CONFIG: tmp("contract-inbox-old") };
  mkdirSync(join(older.LINECLEAR_CONFIG, "inbox", "closed"), { recursive: true });
  writeFileSync(join(older.LINECLEAR_CONFIG, "inbox", "3.json"), JSON.stringify({ n: 3, ...item }));
  writeFileSync(join(older.LINECLEAR_CONFIG, "inbox", "closed", "2.json"), JSON.stringify({ n: 2, ...item, closed: "old way" }));
  expect(readItems(older).map((i) => i.n)).toEqual([3]);
  expect(readAllItems(older).map((i) => i.n)).toEqual([2, 3]);
  expect(existsSync(join(older.LINECLEAR_CONFIG, "inbox"))).toBe(false);
  expect(addItem(item, older).n).toBe(4);
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
