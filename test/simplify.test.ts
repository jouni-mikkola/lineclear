import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simplifyParts } from "../scripts/simplify-count.ts";

const page = readFileSync(join(import.meta.dir, "..", "docs", "simplify.md"), "utf8");
const NUMBER = /^\d+(\.\d+)?$/;

/** Each table row: the part as `kind `id``, its three numbers and the line on what breaks. */
const rows = page
  .split("\n")
  .map((l) => l.split("|").map((c) => c.trim()))
  .filter((c) => /^[a-z]+ `.+`$/.test(c[1] ?? ""))
  .map((c) => ({ part: c[1] as string, numbers: c.slice(2, 5), breaks: c[5] ?? "" }));

test("every process, timer, store, loop and gate has a row", () => {
  const parts = simplifyParts();
  expect(parts.length).toBeGreaterThan(20);
  const missing = parts.filter((p) => !rows.some((r) => r.part === `${p.kind} \`${p.id}\``)).map((p) => `${p.kind} ${p.id}`);
  expect(missing).toEqual([]);
});

test("every row has seconds, tokens and restarts as numbers and a line on what breaks", () => {
  const bad = rows.filter((r) => r.numbers.length !== 3 || !r.numbers.every((n) => NUMBER.test(n)) || r.breaks === "").map((r) => r.part);
  expect(bad).toEqual([]);
});

test("the page names the command that recounts", () => {
  expect(page).toContain("bun scripts/simplify-count.ts");
});
