// Biome's lint and format check over the whole repo (biome.json), counted per file and rule. Function size and
// complexity are Biome rules too, so they count here.
import type { Fault, Gate } from "./ratchet.ts";
import { parseReport, runTool } from "./tools.ts";

interface Report {
  diagnostics: { category: string; message: string; location: { path: string; start: { line: number; column: number } } }[];
}

export const lint: Gate = {
  name: "lint",
  // a new Biome, a new rule or a file no longer ignored can bring faults to any file
  perFile: { config: ["biome.json", "package.json", "bun.lock", ".gitignore"] },
  async find(root, files) {
    if (files?.length === 0) return [];
    const r = await runTool(root, "biome", [
      "check",
      "--reporter=json",
      "--max-diagnostics=none",
      "--colors=off",
      "--no-errors-on-unmatched",
      ...(files ?? ["."]),
    ]);
    const report = parseReport<Report>("biome", r);
    return report.diagnostics.map(
      (d): Fault => ({
        key: `${d.location.path} ${d.category}`,
        text: `${d.location.path}:${d.location.start.line}:${d.location.start.column} ${d.category}: ${d.message.replace(/\s+/g, " ")}`,
      }),
    );
  },
};
