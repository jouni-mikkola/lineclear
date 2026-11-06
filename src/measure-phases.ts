import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { piHarness } from "./harness-pi.ts";
import { type Call, reviewerRound, sessionCalls } from "./session-text.ts";

// Where a task's tokens and minutes went, by phase. The calls come from pi's session logs, the CPU from the server's
// cpu/<task>.jsonl (one line per tick: a time, a kind and the ticks used since the last tick).

export const PHASES = ["start", "reading", "coding", "tests", "review", "check wait", "finishing"] as const;
type Phase = (typeof PHASES)[number];

/** A session's calls. A reviewer's session counts tokens in review and no wall time: its author's session waits on it. */
export interface SessionCalls {
  reviewer: boolean;
  calls: Call[];
}

interface Numbers {
  calls: number;
  /** tokens sent to the model: fresh input and cache reads */
  input: number;
  cacheWrite: number;
  output: number;
  wallMs: number;
  cpuTicks: number;
}

export interface CpuLine {
  at: number;
  kind: string;
  ticks: number;
}

export interface TaskPhases {
  id: string;
  phases: Record<Phase, Numbers>;
  cpuByKind: Record<string, number>;
  medianCallInput: number;
  largestCallInput: number;
  /** from the first call to `lineclear ready`, or to the last call when the task never reported */
  readyMs: number;
}

const FINISHING = /lineclear (ready|merge|pr)\b|git (commit|rebase|push)|lineclear checkpoint\b/;
const REVIEW = /\/Reviewer|review round|^subagent/;
const CHECK_WAIT = /lineclear (check|checks|wait)\b/;
const TESTS = /\b(bun (run )?(test|check|types|gates|ui:\w+)|tsc|biome|knip|playwright|vitest|jest|pytest)\b/;
const CODING = /^(edit|write)\b|sed -i|\bcat >|\btee\b|python3? - <<|apply_patch|git apply/;
const ORIENTING = /\/skill\/|AGENTS\.md|CLAUDE\.md|docs\/idea\.md|lineclear (roadmap|task) show/;

/** The phase of each call, in order. The leading calls that only read the rules and the brief are `start`; a call with no tool continues the phase before it. */
function phasesOf(calls: Call[], reviewer: boolean): Phase[] {
  let started = false;
  let last: Phase = "start";
  return calls.map((c) => {
    if (reviewer) return "review";
    if (c.tools.length === 0) return last;
    const any = (re: RegExp) => c.tools.some((t) => re.test(t));
    let phase: Phase;
    if (any(FINISHING)) phase = "finishing";
    else if (any(REVIEW)) phase = "review";
    else if (any(CHECK_WAIT)) phase = "check wait";
    else if (any(TESTS)) phase = "tests";
    else if (c.tools.some((t) => CODING.test(t))) phase = "coding";
    else if (!started && c.tools.some((t) => ORIENTING.test(t))) phase = "start";
    else phase = "reading";
    if (phase !== "start") started = true;
    last = phase;
    return phase;
  });
}

const empty = (): Numbers => ({ calls: 0, input: 0, cacheWrite: 0, output: 0, wallMs: 0, cpuTicks: 0 });

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] ?? 0) : Math.round(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
};

/**
 * One task's phases from its sessions and CPU lines. A call's wall time runs from its end to the next call's end (the
 * model's answer and the tool it asked for), the first call's from its start, the last one's is its own time. A CPU
 * line belongs to the phase of the call running at its time.
 */
export function taskPhases(id: string, sessions: SessionCalls[], cpu: CpuLine[]): TaskPhases {
  const phases = Object.fromEntries(PHASES.map((p) => [p, empty()])) as Record<Phase, Numbers>;
  const slices: { from: number; to: number; phase: Phase }[] = [];
  const inputs: number[] = [];
  let first = Infinity;
  let ready: number | undefined;
  let lastAt = 0;
  for (const s of sessions) {
    const names = phasesOf(s.calls, s.reviewer);
    s.calls.forEach((c, i) => {
      const phase = names[i] ?? "reading";
      const n = phases[phase];
      n.calls++;
      n.input += c.input + c.cacheRead;
      n.cacheWrite += c.cacheWrite;
      n.output += c.output;
      inputs.push(c.input + c.cacheRead);
      first = Math.min(first, c.at - c.ms);
      lastAt = Math.max(lastAt, c.at);
      if (!s.reviewer && c.tools.some((t) => /lineclear ready\b/.test(t))) ready = Math.min(ready ?? c.at, c.at);
      if (s.reviewer) return;
      const next = s.calls[i + 1];
      const from = i === 0 ? c.at - c.ms : c.at;
      const to = next ? next.at : c.at + c.ms;
      n.wallMs += to - from;
      slices.push({ from, to, phase });
    });
  }
  slices.sort((a, b) => a.from - b.from);
  const cpuByKind: Record<string, number> = {};
  for (const l of cpu) {
    const hit = slices.find((s) => l.at >= s.from && l.at < s.to) ?? (l.at < (slices[0]?.from ?? 0) ? slices[0] : slices[slices.length - 1]);
    if (hit) phases[hit.phase].cpuTicks += l.ticks;
    cpuByKind[l.kind] = (cpuByKind[l.kind] ?? 0) + l.ticks;
  }
  return {
    id,
    phases,
    cpuByKind,
    medianCallInput: median(inputs),
    largestCallInput: Math.max(0, ...inputs),
    readyMs: first === Infinity ? 0 : (ready ?? lastAt) - first,
  };
}

/** The sessions of a working folder, parsed. */
export function worktreeCalls(worktree: string, env: Record<string, string | undefined>): SessionCalls[] {
  return piHarness.readSessions(worktree, env).map((t) => ({ reviewer: reviewerRound(t) !== undefined, calls: sessionCalls(t) }));
}

/** A task's CPU lines from the server's cpu folder; none when it has none. */
export function readCpu(dir: string, id: string): CpuLine[] {
  const file = join(dir, "cpu", `${id}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l) => {
      try {
        return l ? [JSON.parse(l) as CpuLine] : [];
      } catch {
        return [];
      }
    });
}

const minutes = (ms: number) => (ms / 60_000).toFixed(1);
const cpuMinutes = (ticks: number) => (ticks / 6000).toFixed(1);

function table(head: string[], rows: string[][]): string[] {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0))).join("  ");
  return [line(head), ...rows.map(line)];
}

/** The one table: each phase over the tasks, then each task. */
export function phaseTable(tasks: TaskPhases[]): string[] {
  const keys = Object.keys(empty()) as (keyof Numbers)[];
  const sum = (of: Numbers[]) => {
    const total = empty();
    for (const n of of) for (const k of keys) total[k] += n[k];
    return total;
  };
  const perPhase = PHASES.map((p) => sum(tasks.map((t) => t.phases[p])));
  const row = (name: string, n: Numbers) => [
    name,
    String(n.calls),
    String(n.input),
    String(n.cacheWrite),
    String(n.output),
    minutes(n.wallMs),
    cpuMinutes(n.cpuTicks),
  ];
  const byPhase = table(
    ["phase", "calls", "input", "cache writes", "output", "wall min", "cpu min"],
    [...PHASES.map((p, i) => row(p, perPhase[i] ?? empty())), row("all", sum(perPhase))],
  );
  const byTask = table(
    ["task", "median call", "largest call", "input", "min to ready"],
    tasks.map((t) => [t.id, String(t.medianCallInput), String(t.largestCallInput), String(sum(PHASES.map((p) => t.phases[p])).input), minutes(t.readyMs)]),
  );
  const kinds: Record<string, number> = {};
  for (const t of tasks) for (const [k, v] of Object.entries(t.cpuByKind)) kinds[k] = (kinds[k] ?? 0) + v;
  const kindLine = `cpu min by kind: ${
    Object.entries(kinds)
      .map(([k, v]) => `${k} ${cpuMinutes(v)}`)
      .join(", ") || "none"
  }`;
  return [
    `${tasks.length} tasks. Input is tokens sent to the model, fresh and read from cache. Wall time is a call and the tool it ran; a reviewer's calls add tokens and no wall time.`,
    "",
    ...byPhase,
    "",
    kindLine,
    "",
    ...byTask,
  ];
}
