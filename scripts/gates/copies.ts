// jscpd: a block of MIN_TOKENS or more found in two places. The baseline counts copied lines per pair of files, so a
// copy that grows or a new pair fails.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fault, Gate } from "./ratchet.ts";
import { runTool } from "./tools.ts";

const MIN_TOKENS = 100;
const IGNORE = ["**/node_modules/**", "**/generated/**", "**/dist/**", "server/plugins/reactions/emoji-data.ts"];

interface Clone {
  lines: number;
  firstFile: { name: string; start: number };
  secondFile: { name: string; start: number };
}

export const copies: Gate = {
  name: "copies",
  async find(root) {
    const out = mkdtempSync(join(tmpdir(), "lineclear-copies-"));
    try {
      const args = ["--min-tokens", String(MIN_TOKENS), "--format", "typescript,tsx", "--ignore", IGNORE.join(","), "--reporters", "json", "--output", out];
      const r = await runTool(root, "jscpd", [...args, "."]);
      let clones: Clone[];
      try {
        clones = (JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8")) as { duplicates: Clone[] }).duplicates;
      } catch {
        throw new Error(`jscpd gave no report (exit ${r.code}): ${(r.err || r.out).trim().slice(0, 800)}`);
      }
      const faults: Fault[] = [];
      for (const c of clones) {
        const [a, b] = [c.firstFile, c.secondFile].sort((x, y) => (x.name < y.name ? -1 : 1)) as [Clone["firstFile"], Clone["firstFile"]];
        faults.push({ key: `${a.name} = ${b.name}`, text: `${a.name}:${a.start} = ${b.name}:${b.start}`, count: c.lines });
      }
      return faults;
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  },
};
