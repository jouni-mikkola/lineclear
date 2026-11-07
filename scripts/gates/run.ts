// The code gates of `bun run check`: Biome (lint and format), knip (dead code) and the module borders of docs/architecture.md and the parallel-safe rule.
// `bun scripts/gates/run.ts [--root <dir>] [gate ...]`. Any fault fails.
import { borders } from "./borders.ts";
import { deadCode } from "./dead-code.ts";
import { lint } from "./lint.ts";
import { parallelSafe } from "./parallel-safe.ts";

const GATES: Record<string, (root: string) => Promise<string[]>> = { lint, "dead-code": deadCode, borders, "parallel-safe": parallelSafe };
const SHOWN = 20;

const args = process.argv.slice(2);
const at = args.indexOf("--root");
const root = at >= 0 ? (args[at + 1] ?? ".") : ".";
const named = args.filter((a, i) => !a.startsWith("--") && i !== at + 1);
const unknown = named.filter((n) => !(n in GATES));
if (unknown.length > 0) {
  console.error(`gates: no gate named ${unknown.join(", ")} (gates: ${Object.keys(GATES).join(", ")})`);
  process.exit(2);
}
const chosen = named.length > 0 ? named : Object.keys(GATES);

const results = await Promise.all(
  chosen.map(async (name) => {
    try {
      return { name, faults: await (GATES[name] as (root: string) => Promise<string[]>)(root) };
    } catch (e) {
      return { name, faults: [`could not run: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }),
);

const failed = results.filter((r) => r.faults.length > 0);
for (const r of results) {
  if (r.faults.length === 0) console.log(`${r.name}: ok`);
  else {
    console.error(`${r.name}: ${r.faults.length} fault${r.faults.length === 1 ? "" : "s"}`);
    for (const f of r.faults.slice(0, SHOWN)) console.error(`  ${f}`);
  }
}
if (failed.length > 0) console.error(`gates failed: ${failed.map((r) => r.name).join(", ")}`);
process.exit(failed.length > 0 ? 1 : 0);
