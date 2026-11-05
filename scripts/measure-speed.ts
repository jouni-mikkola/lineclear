// How fast the parts that once had a time limit in a test are. A test says only that they work; how fast they are
// depends on how busy the machine is, so the numbers live here and in docs/numbers.md. Run: bun scripts/measure-speed.ts
import { mkdtempSync, rmSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { piSpendAndUsage } from "../src/home-data.ts";
import { checkRoadmap } from "../src/roadmap.ts";
import { writeSessions } from "./fake-sessions.ts";

const median = (f: () => void, n = 5) => {
  const times = Array.from({ length: n }, () => {
    const t = performance.now();
    f();
    return performance.now() - t;
  }).sort((a, b) => a - b);
  return times[Math.floor(n / 2)] ?? 0;
};

// 400 steps over 12 phases, as test/roadmap.test.ts checks them
let text = "# Roadmap\n";
for (let i = 0; i < 400; i++) {
  if (i % 34 === 0) text += `\n## Phase ${i / 34}\n\n`;
  text += `### S${i} Title S${i}\n- why: because\n- done when:\n  - it works\n- locks: repo\n- after: ${i === 0 ? "none" : `S${i - 1}`}\n\n`;
}
const roadmap = median(() => checkRoadmap(text));

// 500 pi session files of 20 lines, read once and then again from the cache, as test/home-data.test.ts reads them
const root = mkdtempSync(join(tmpdir(), "lineclear-speed-"));
const now = Date.parse("2026-10-31T12:00:00Z");
const pi = join(root, "pi");
writeSessions(pi, now, 500);
const env = { PI_CODING_AGENT_DIR: pi, XDG_CACHE_HOME: join(root, "cache") };
const coldStart = performance.now();
piSpendAndUsage(env, now);
const cold = performance.now() - coldStart;
const warm = median(() => piSpendAndUsage(env, now));
rmSync(root, { recursive: true, force: true });

console.log(`load average ${(loadavg()[0] ?? 0).toFixed(1)}`);
console.log(`roadmap check, 400 steps      ${roadmap.toFixed(0)} ms (median of 5)`);
console.log(`spend, 500 files, first read  ${cold.toFixed(0)} ms`);
console.log(`spend, 500 files, warm read   ${warm.toFixed(0)} ms (median of 5)`);
