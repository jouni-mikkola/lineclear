import { expect, test } from "bun:test";
import { belowFloor, linesPerModule, raise, withUnloaded } from "../scripts/gates/coverage.ts";

const architecture = "| Module | Folder | Owns | May import |\n| `pi` | `pi/` | the extension | none |\n| `cli` | `src/` | the CLI | `pi` |\n";
const lcov = [
  "SF:pi/a.ts",
  "LF:10",
  "LH:9",
  "end_of_record",
  "SF:src/b.ts",
  "LF:10",
  "LH:3",
  "end_of_record",
  "SF:src/c.ts",
  "LF:10",
  "LH:3",
  "end_of_record",
  "",
].join("\n");

test("lines add up per module of the architecture", () => {
  expect(linesPerModule(lcov, architecture)).toEqual({ pi: { hit: 9, found: 10 }, cli: { hit: 6, found: 20 } });
});

test("a module under its floor fails, one at or above passes", () => {
  const lines = linesPerModule(lcov, architecture);
  expect(belowFloor(lines, { pi: 90, cli: 30 })).toEqual([]);
  expect(belowFloor(lines, { pi: 90, cli: 31 })).toEqual(["cli: 30 % is below its floor of 31 %"]);
  expect(belowFloor(lines, { gone: 10 })).toEqual(["gone: no coverage measured, floor 10 %"]);
});

test("a floor only rises", () => {
  const lines = linesPerModule(lcov, architecture);
  expect(raise(lines, { pi: 95, cli: 10 })).toEqual({ pi: 95, cli: 30 });
});

test("a source file no test loaded counts as found lines with none hit", () => {
  const withBin = withUnloaded(lcov, { "src/b.ts": "x\n", "bin/lineclear": "a\n\nb\nc\n" });
  const lines = linesPerModule(withBin, "| `cli` | `src/` | the CLI | none |\n| `bin` | `bin/` | the command | `cli` |\n");
  expect(lines.bin).toEqual({ hit: 0, found: 3 });
  expect(lines.cli).toEqual({ hit: 6, found: 20 });
});
