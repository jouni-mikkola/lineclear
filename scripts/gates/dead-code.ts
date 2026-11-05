// knip over the root and server/ (knip.jsonc): unused files, exports, types and dependencies, one fault per name.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Fault, Gate } from "./ratchet.ts";
import { parseReport, runTool } from "./tools.ts";

type Named = { name: string; line?: number };
interface Report {
  issues: ({ file: string } & Record<string, Named[] | Named[][] | string>)[];
}

export const deadCode: Gate = {
  name: "dead-code",
  // the cache (one per worktree) follows each file's change time: 3 s of CPU warm, 15 s cold
  cold: (root) => !existsSync(join(root, "node_modules", ".cache", "knip")),
  async find(root) {
    const r = await runTool(root, "knip", ["--reporter", "json", "--no-progress", "--no-exit-code", "--cache"]);
    const faults: Fault[] = [];
    for (const issue of parseReport<Report>("knip", r).issues) {
      for (const [kind, list] of Object.entries(issue)) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          const name = Array.isArray(item) ? item.map((i) => i.name).join(" = ") : item.name;
          const line = Array.isArray(item) ? undefined : item.line;
          faults.push({ key: `${issue.file} ${kind} ${name}`, text: `${issue.file}${line ? `:${line}` : ""} unused ${kind}: ${name}` });
        }
      }
    }
    return faults;
  },
};
