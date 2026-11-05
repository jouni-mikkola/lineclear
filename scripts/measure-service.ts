// The live service's load: bun scripts/measure-service.ts [minutes, default 60] [unit, default lineclear.service]
// It reads systemd's own counters for the whole unit (the server and the processes it starts) every 30 s, so it adds
// almost no load itself. Run it while no task is due to start. The memory peak is the unit's own since its last start, so it can only be higher than the hour's. It samples every 30 s until `minutes` of
// running time are counted. Exit 0 when the average CPU is under 2 % of one core and the memory peak is under 300 MB.
import { $ } from "bun";

export const CPU_LIMIT_PERCENT = 2;
export const MEMORY_LIMIT_MB = 300;

export type Sample = { invocation: string; cpuNs: number; peakBytes: number; atMs: number };

// Sums the steps between two samples of one run of the service. A restart (a new InvocationID) drops that one step, so
// a merge that restarts the service does not spoil the hour.
export function judge(samples: Sample[]) {
  let seconds = 0;
  let cpuNs = 0;
  let restarts = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1] as Sample;
    const b = samples[i] as Sample;
    if (a.invocation !== b.invocation) {
      restarts++;
      continue;
    }
    seconds += (b.atMs - a.atMs) / 1000;
    cpuNs += b.cpuNs - a.cpuNs;
  }
  const cpuPercent = seconds > 0 ? (cpuNs / 1e9 / seconds) * 100 : 0;
  const peakMb = Math.max(...samples.map((s) => s.peakBytes)) / 1024 / 1024;
  return { restarts, seconds, cpuPercent, peakMb, ok: seconds > 0 && cpuPercent < CPU_LIMIT_PERCENT && peakMb < MEMORY_LIMIT_MB };
}

async function sample(unit: string): Promise<Sample> {
  const text = await $`systemctl --user show ${unit} -p InvocationID -p CPUUsageNSec -p MemoryPeak`.text();
  const v = Object.fromEntries(
    text
      .trim()
      .split("\n")
      .map((l) => l.split("=") as [string, string]),
  );
  return { invocation: v.InvocationID ?? "", cpuNs: Number(v.CPUUsageNSec), peakBytes: Number(v.MemoryPeak), atMs: Date.now() };
}

if (import.meta.main) {
  const minutes = Number(process.argv[2] ?? 60);
  if (!(minutes > 0)) {
    console.log("usage: bun scripts/measure-service.ts [minutes, default 60] [unit]");
    process.exit(2);
  }
  const unit = process.argv[3] ?? "lineclear.service";
  const samples = [await sample(unit)];
  if (!Number.isFinite(samples[0]!.cpuNs) || !Number.isFinite(samples[0]!.peakBytes)) {
    console.log(`${unit} has no CPU or memory counters: is it running, with accounting on?`);
    process.exit(2);
  }
  while (judge(samples).seconds < minutes * 60) {
    await Bun.sleep(30_000);
    samples.push(await sample(unit));
  }
  const r = judge(samples);
  console.log(`${Math.round(r.seconds / 60)} min of ${unit}, ${r.restarts} restarts skipped`);
  console.log(`average CPU ${r.cpuPercent.toFixed(2)} % of a core (limit ${CPU_LIMIT_PERCENT} %)`);
  console.log(`memory peak ${r.peakMb.toFixed(0)} MB (limit ${MEMORY_LIMIT_MB} MB)`);
  console.log(r.ok ? "light" : "too heavy");
  process.exit(r.ok ? 0 : 1);
}
