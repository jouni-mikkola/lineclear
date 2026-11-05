// `bun scripts/simplify-count.ts [--days 7]` recounts the numbers of docs/simplify.md, one row per part:
// `<kind> | <id> | seconds per merged step | tokens per merged step | restarts`. Rows are found by `simplifyParts`, which the
// test of docs/simplify.md uses too, so the page and the count cannot drift from the repo.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The same folder as pi/config.ts: scripts may not import pi.
const configDir = () => process.env.LINECLEAR_CONFIG || join(homedir(), ".config", "lineclear");

const REPO = join(import.meta.dir, "..");
export type Kind = "process" | "timer" | "store" | "loop" | "gate";
export interface Part {
  kind: Kind;
  id: string;
}

const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");
const matches = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1] as string);
const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir)).flatMap((f) => (statSync(join(REPO, dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

/** What the repo starts, schedules, stores, loops and gates: the parts docs/simplify.md must have a row for. */
export function simplifyParts(): Part[] {
  const units = [...new Set(matches(read("install.sh"), /\b(lineclear(?:-[a-z0-9]+)*\.(?:service|timer))/g))];
  const parts: Part[] = units.map((id) => ({ kind: id.endsWith(".timer") ? "timer" : "process", id }));
  const srcs = walk("src").filter((f) => f.endsWith(".ts"));
  const text = [...srcs, "pi/config.ts"].map(read).join("\n");
  const stores = matches(text, /"((?:tasks|task-ids|check-[a-z]+|decisions)[\w-]*\.(?:jsonl|json|sqlite))"/g);
  for (const id of new Set(stores)) parts.push({ kind: "store", id });
  for (const id of new Set(matches(srcs.map(read).join("\n"), /\bconst (\w*(?:TICK|EVERY|REFRESH)\w*_MS)\b/g))) parts.push({ kind: "loop", id });
  for (const f of walk("scripts/gates")) if (f.endsWith(".ts")) for (const id of matches(read(f), /^\s+name: "([a-z-]+)",/gm)) parts.push({ kind: "gate", id });
  return parts;
}

const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: REPO, encoding: "utf8" }).stdout ?? "";
const lines = (file: string): Record<string, unknown>[] => {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
};

const unitProp = (unit: string, prop: string) => Number(sh("systemctl", ["--user", "show", unit, "-p", prop, "--value"]).trim()) || 0;
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

function main(): void {
  const days = Number(process.argv[process.argv.indexOf("--days") + 1]) || 7;
  const since = Date.now() - days * 86_400_000;
  const dir = configDir();
  const steps = lines(join(dir, "check-steps.jsonl")).filter((s) => Number(s.at) >= since);
  const merged = Math.max(1, steps.filter((s) => s.mode === "lane" && s.step === "wall" && s.ok === true).length);
  const runs = lines(join(dir, "check-runs.jsonl")).filter((r) => Number(r.at) >= since);
  const gateRuns = steps.filter((s) => s.step === "gates").length / merged;
  const gateFails = runs.filter((r) => (r.gate as { step?: string } | undefined)?.step === "gates").length;
  const decisions = lines(join(dir, "decisions.jsonl")).filter((d) => Date.parse(String(d.time)) >= since);
  const taskDir = join(homedir(), ".lineclear");
  console.log(`merged steps in ${days} days: ${merged}`);
  for (const p of simplifyParts()) {
    let seconds = 0;
    let restarts = 0;
    if (p.kind === "process" || p.kind === "timer") {
      const unit = p.id.replace(/\.timer$/, ".service");
      seconds = unitProp(unit, "CPUUsageNSec") / 1e9 / merged;
      restarts = unitProp(unit, "NRestarts");
    } else if (p.kind === "store") {
      const file = [dir, taskDir].map((d) => join(d, p.id)).find(existsSync);
      const t = Date.now();
      if (file) readFileSync(file);
      seconds = (Date.now() - t) / 1000;
    } else if (p.kind === "loop") {
      // a loop runs inside lineclear.service: its time is counted there, its restarts are the stalls its rules answered
      restarts = p.id === "TICK_MS" ? decisions.filter((d) => d.kind === "stall").length : 0;
    } else {
      const t = Date.now();
      spawnSync("bun", [join("scripts", "gates", "run.ts"), p.id], { cwd: REPO });
      seconds = ((Date.now() - t) / 1000) * gateRuns;
      restarts = gateFails;
    }
    console.log(`${p.kind} | ${p.id} | ${fmt(seconds)} | 0 | ${restarts}`);
  }
}

if (import.meta.main) main();
