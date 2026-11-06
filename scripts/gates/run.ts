// The gates of `bun run check`, side by side, each against its baseline (scripts/gates/baseline/).
// `bun scripts/gates/run.ts [--root <dir>] [--full] [--lower] [--limit <s>] [gate ...]`: --lower writes each baseline
// down to what is found, --limit fails a run that takes longer. A gate whose faults in a file follow from that file alone (perFile) looks only at the files changed since
// main, which keeps a merge's check fast; --full, --lower, a change to its config or no main to compare with run it
// over the whole repo. The heavy run and a release run --full.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { borders } from "./borders.ts";
import { codeRules } from "./code-rules.ts";
import { comments } from "./comments.ts";
import { copies } from "./copies.ts";
import { deadCode } from "./dead-code.ts";
import { lint } from "./lint.ts";
import { oldName } from "./old-name.ts";
import { type Gate, judge, lower, readBaseline, within, writeBaseline } from "./ratchet.ts";
import { size } from "./size.ts";
import { changedSince } from "./tools.ts";

export const GATES: Gate[] = [lint, deadCode, copies, borders, size, comments, codeRules, oldName];
const SHOWN = 5;

const args = process.argv.slice(2);
const at = args.indexOf("--root");
const root = at >= 0 ? (args[at + 1] ?? ".") : ".";
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : undefined;
const lowering = args.includes("--lower");
const changed = args.includes("--full") || lowering ? undefined : changedSince(root, "main");
const named = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--root" && args[i - 1] !== "--limit");
const unknown = named.filter((n) => !GATES.some((g) => g.name === n));
if (unknown.length > 0) {
  console.error(`gates: no gate named ${unknown.join(", ")} (gates: ${GATES.map((g) => g.name).join(", ")})`);
  process.exit(2);
}
const chosen = named.length > 0 ? GATES.filter((g) => named.includes(g.name)) : GATES;

/** The files a gate looks at, or undefined for the whole repo. */
function scopeOf(gate: Gate): string[] | undefined {
  if (!gate.perFile || !changed || changed.some((f) => gate.perFile?.config.includes(f))) return undefined;
  return changed;
}

const runStarted = performance.now();
// a cold cache or a whole-repo lint is not the usual run the limit is about
const unusual = chosen.filter((g) => g.cold?.(root) || (g.perFile && !scopeOf(g))).map((g) => g.name);
const results = await Promise.all(
  chosen.map(async (gate) => {
    const started = performance.now();
    const scope = scopeOf(gate);
    try {
      const faults = await gate.find(
        root,
        scope?.filter((f) => existsSync(join(root, f))),
      );
      return { gate, scope, faults, seconds: (performance.now() - started) / 1000 };
    } catch (e) {
      return { gate, scope, error: e instanceof Error ? e.message : String(e), seconds: (performance.now() - started) / 1000 };
    }
  }),
);

let failed = false;
const failedNames: string[] = [];
for (const r of results) {
  const name = r.gate.name;
  if (r.error !== undefined || !r.faults) {
    console.error(`gates: ${name} could not run: ${r.error}`);
    failed = true;
    failedNames.push(r.gate.name);
    continue;
  }
  const full = readBaseline(root, name);
  if (lowering) writeBaseline(root, name, lower(r.faults, full));
  // a deleted file stays in the scope, so its faults left in the baseline show as stale
  const baseline = r.scope ? within(full, new Set(r.scope)) : full;
  const { over, stale } = judge(r.faults, lowering ? lower(r.faults, baseline) : baseline);
  for (const o of over) {
    console.error(`${name}: ${o.key}: ${o.found} found, the baseline allows ${o.allowed}`);
    for (const text of [...new Set(o.faults.map((f) => f.text))].slice(0, SHOWN)) console.error(`  ${text}`);
  }
  if (stale.length > 0) {
    console.error(
      `${name}: ${stale.length} fault${stale.length === 1 ? " is" : "s are"} fixed but still in the baseline: lower it with bun scripts/gates/run.ts --lower ${name}`,
    );
    for (const s of stale.slice(0, SHOWN)) console.error(`  ${s.key}: ${s.found} found, the baseline has ${s.allowed}`);
  }
  if (over.length > 0 || stale.length > 0) {
    failed = true;
    failedNames.push(name);
  } else {
    const where = r.scope ? ` in ${r.scope.length} changed file${r.scope.length === 1 ? "" : "s"}` : "";
    console.log(`${name}: ok (${r.faults.length} known${where}, ${r.seconds.toFixed(1)} s)`);
  }
}
const took = (performance.now() - runStarted) / 1000;
if (limit !== undefined && took > limit) {
  if (unusual.length > 0) console.log(`gates: ${took.toFixed(0)} s, over the limit of ${limit} s, not counted: ${unusual.join(", ")} ran cold or whole`);
  else {
    console.error(`gates: ${took.toFixed(0)} s, over the limit of ${limit} s: move the slow part to the heavy run (L90)`);
    failed = true;
  }
}
// the last line of a failed run: it is what the check logs as the failure, and `lineclear measure` counts each gate's catches from it (src/catches.ts)
if (failedNames.length > 0) console.error(`gates failed: ${failedNames.join(", ")}`);
process.exit(failed ? 1 : 0);
