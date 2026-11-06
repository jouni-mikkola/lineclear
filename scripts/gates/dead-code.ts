// knip over the root and server/ (knip.jsonc): unused files, exports, types and dependencies, one fault per name.
import { parseReport, runTool } from "./tools.ts";

type Named = { name: string; line?: number };
interface Report {
  issues: ({ file: string } & Record<string, Named[] | Named[][] | string>)[];
}

export async function deadCode(root: string): Promise<string[]> {
  const r = await runTool(root, "knip", ["--reporter", "json", "--no-progress", "--no-exit-code", "--cache"]);
  const faults: string[] = [];
  for (const issue of parseReport<Report>("knip", r).issues) {
    for (const [kind, list] of Object.entries(issue)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const name = Array.isArray(item) ? item.map((i) => i.name).join(" = ") : item.name;
        const line = Array.isArray(item) ? undefined : item.line;
        faults.push(`${issue.file}${line ? `:${line}` : ""} unused ${kind}: ${name}`);
      }
    }
  }
  return faults;
}
