// The check on a busy machine: `bun run check` several times in a row while every core is at work, like
// stress-ng --cpu N. Every run must pass: no test may hang on how fast the machine is. Busy loops fill only the cores
// the machine's own work leaves free (none on a busy machine: its real load is the test), at the lowest priority.
// Run: bun scripts/under-load.ts [runs, 3] [at most this many busy loops, 16]
import { spawn } from "bun";
import { cpus, loadavg } from "node:os";

const runs = Number(process.argv[2] ?? 3);
const most = Number(process.argv[3] ?? 16);
const free = Math.max(0, Math.floor(cpus().length - (loadavg()[0] ?? 0)));
const threads = Math.min(most, free);
const busy = Array.from({ length: threads }, () =>
  spawn(["nice", "-n", "19", process.execPath, "-e", "while (true) {}"], { stdout: "ignore", stderr: "ignore" }),
);
const stop = () => {
  for (const b of busy) b.kill();
};
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(143);
});

let failed = 0;
try {
  for (let i = 1; i <= runs; i++) {
    const t0 = Date.now();
    const run = spawn(["bun", "run", "check"], { stdout: "inherit", stderr: "inherit" });
    const code = await run.exited;
    console.log(
      `under-load: run ${i} of ${runs}: ${code === 0 ? "passed" : `failed (${code})`} in ${Math.round((Date.now() - t0) / 1000)} s, load ${loadavg()[0]?.toFixed(1)} on ${cpus().length} cores, ${threads} busy loops`,
    );
    if (code !== 0) failed++;
  }
} finally {
  stop();
}
console.log(`under-load: ${runs - failed} of ${runs} passed`);
process.exit(failed ? 1 : 0);
