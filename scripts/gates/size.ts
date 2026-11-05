// A source file over MAX_LINES lines. The baseline holds each such file's lines, so a listed file may shrink but not grow.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fault, Gate } from "./ratchet.ts";
import { trackedFiles } from "./tools.ts";

export const MAX_LINES = 600;
// data, not code: a list nobody reads as a whole
const EXEMPT = new Set(["server/plugins/reactions/emoji-data.ts"]);

export const size: Gate = {
  name: "size",
  async find(root) {
    const faults: Fault[] = [];
    for (const file of trackedFiles(root)) {
      if (EXEMPT.has(file)) continue;
      const lines = readFileSync(join(root, file), "utf8").split("\n").length;
      if (lines > MAX_LINES) faults.push({ key: file, text: `${file}: ${lines} lines, over ${MAX_LINES}`, count: lines });
    }
    return faults;
  },
};
