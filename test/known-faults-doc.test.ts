import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const doc = readFileSync(join(root, "docs/known-faults.md"), "utf8");
const table = doc.split("## ")[0] ?? "";
const rows = table
  .split("\n")
  .filter((line) => line.startsWith("|"))
  .slice(2)
  .map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );

test("every fault row has a fault, how it shows, a workaround, the fork's answer and a test", () => {
  expect(rows.length).toBeGreaterThanOrEqual(5);
  for (const row of rows) {
    expect(row).toHaveLength(5);
    for (const cell of row) expect(cell.length).toBeGreaterThan(0);
  }
});

test("the faults the step names are listed", () => {
  const faults = rows.map((row) => (row[0] ?? "").toLowerCase());
  for (const part of ["loses its herdr name", "without an id crashes", "already merged", "conflict markers", "typed while pi is still starting"]) {
    expect(faults.some((fault) => fault.includes(part))).toBe(true);
  }
});

test("every test a row names exists", () => {
  for (const row of rows) {
    const files = [...(row[4] ?? "").matchAll(/`([^`]+\.test\.ts)`/g)].map((m) => m[1] ?? "");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const found = [file, `test/${file}`, `server/test/${file}`].some((p) => existsSync(join(root, p)));
      expect(found).toBe(true);
    }
  }
});

test("the list says where it comes from and that nothing is left in the backlog", () => {
  expect(doc).toContain("## Where the list comes from");
  expect(doc).toContain("`ebb17d5`");
  expect(doc).toContain("`docs/backlog.md`");
});
