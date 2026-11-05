// Line coverage of the root tests per module of docs/architecture.md, against the floors in
// baseline/coverage.json. Too slow for `bun run check`: the nightly job and a release run it (L90).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { moduleOf, readModules } from "./borders.ts";

export type Floors = Record<string, number>;
export interface Lines {
  hit: number;
  found: number;
}

const FLOORS = "scripts/gates/baseline/coverage.json";

/** Hit and found lines per module from an lcov report. A module no covered file belongs to is absent. */
export function linesPerModule(lcov: string, architecture: string): Record<string, Lines> {
  const modules = readModules(architecture);
  const out: Record<string, Lines> = {};
  for (const record of lcov.split("end_of_record")) {
    const file = /^SF:(.+)$/m.exec(record)?.[1];
    const name = file ? moduleOf(file, modules)?.name : undefined;
    if (!name) continue;
    const found = Number(/^LF:(\d+)$/m.exec(record)?.[1] ?? 0);
    const hit = Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0);
    const sum = out[name] ?? { hit: 0, found: 0 };
    out[name] = { hit: sum.hit + hit, found: sum.found + found };
  }
  return out;
}

/**
 * The lcov report plus a record with no hit line for each source file no test loaded: bun leaves such a file out,
 * so a module of untested files would otherwise look fully covered or absent. A line is any non-blank one.
 */
export function withUnloaded(lcov: string, files: Record<string, string>): string {
  const seen = new Set([...lcov.matchAll(/^SF:(.+)$/gm)].map((m) => m[1]));
  const records = Object.entries(files)
    .filter(([file]) => !seen.has(file))
    .map(([file, text]) => `SF:${file}\nLF:${text.split("\n").filter((l) => l.trim() !== "").length}\nLH:0\nend_of_record\n`);
  return lcov + records.join("");
}

/** Each covered file's hit and found lines with the floor of its module, for part health (`src/part-health.ts`). */
export function fileCoverage(lcov: string, architecture: string, floors: Floors): Record<string, Lines & { floor: number }> {
  const modules = readModules(architecture);
  const out: Record<string, Lines & { floor: number }> = {};
  for (const record of lcov.split("end_of_record")) {
    const file = /^SF:(.+)$/m.exec(record)?.[1];
    const name = file ? moduleOf(file, modules)?.name : undefined;
    if (!file || !name || floors[name] === undefined) continue;
    out[file] = { hit: Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0), found: Number(/^LF:(\d+)$/m.exec(record)?.[1] ?? 0), floor: floors[name] };
  }
  return out;
}

const percent = ({ hit, found }: Lines): number => (found === 0 ? 100 : Math.floor((hit / found) * 1000) / 10);

/** The modules whose coverage fell below their floor, as sentences. A module with a floor and no measure fails too. */
export function belowFloor(lines: Record<string, Lines>, floors: Floors): string[] {
  const faults: string[] = [];
  for (const [name, floor] of Object.entries(floors)) {
    const measured = lines[name];
    if (!measured) faults.push(`${name}: no coverage measured, floor ${floor} %`);
    else if (percent(measured) < floor) faults.push(`${name}: ${percent(measured)} % is below its floor of ${floor} %`);
  }
  return faults;
}

/** The floors raised to what is measured. It never lowers a floor; a module new to the report gets its measure. */
export function raise(lines: Record<string, Lines>, floors: Floors): Floors {
  const out: Floors = { ...floors };
  for (const [name, measured] of Object.entries(lines)) out[name] = Math.max(floors[name] ?? 0, percent(measured));
  return out;
}

export function readFloors(root: string): Floors {
  const file = join(root, FLOORS);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Floors) : {};
}

export function writeFloors(root: string, floors: Floors): void {
  const sorted = Object.fromEntries(Object.entries(floors).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(join(root, FLOORS), `${JSON.stringify(sorted, null, 2)}\n`);
}
