// Biome's lint and format check over the whole repo (biome.json).
import { parseReport, runTool } from "./tools.ts";

interface Report {
  diagnostics: { category: string; message: string; location: { path: string; start: { line: number; column: number } } }[];
}

export async function lint(root: string): Promise<string[]> {
  const r = await runTool(root, "biome", ["check", "--reporter=json", "--max-diagnostics=none", "--colors=off", "--no-errors-on-unmatched", "."]);
  return parseReport<Report>("biome", r).diagnostics.map(
    (d) => `${d.location.path}:${d.location.start.line}:${d.location.start.column} ${d.category}: ${d.message.replace(/\s+/g, " ")}`,
  );
}
