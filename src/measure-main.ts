import { decisionsPath, readJson } from "../pi/config.ts";
import { logLines as notesLogLines, notesStats } from "../pi/parts/compaction-notes.ts";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { bandLines } from "./measure-bands.ts";
import { allNeedCards } from "./asks.ts";
import { DEFAULT_ROUNDS } from "./brief.ts";
import { askKind } from "./cards.ts";
import { laneDays, readRuns, redByCause, refusedMergeBranches } from "./check-runs.ts";
import { health, healthLines, writeHealth } from "./health-numbers.ts";
import { type Item, readItems } from "./inbox.ts";
import type { Raw } from "./measure-remote.ts";
import { piHarness } from "./harness-pi.ts";
import { tasksFromSessions } from "./measure-sessions.ts";
import { withMachines } from "./measure-remote.ts";
import { measureServer } from "./measure-server.ts";
import { mainRefs } from "./main-branch.ts";
import {
  chatFiles,
  costOf,
  DAY,
  findSpace,
  type Measured,
  measure,
  type Numbers,
  type PartSplit,
  type Price,
  priceFinder,
  shepherdrDir,
  spaceTasks,
  type TaskInfo,
  taskStart,
  worktreeUsage,
} from "./measure.ts";
import { healthLines as partHealthLines, partHealth, taskSignals } from "./part-health.ts";
import { type FixInput, refileLines, refiles } from "./measure-refiles.ts";
import { readParts } from "./parts.ts";
import { piDir } from "./paths.ts";
import { readSettings } from "./project.ts";
import { doneIds, parseRoadmap } from "./roadmap.ts";
import { roadmapReads, sessionParts, turnTimes, type Usage } from "./session-text.ts";
import { TICK_MS } from "./rules.ts";
import { causeLine, causeTotals, unexplainedWaits } from "./wait-causes.ts";
import { readDecisionsSince } from "./stall-class.ts";
import { allChecks, reviewRoundLines, type StepCheckNumbers, stepCheckLines, stepCheckNumbers } from "./step-check-cost.ts";
import type { TaskLine } from "./kept-read.ts";

type Out = (line: string) => void;
type Env = Record<string, string | undefined>;

/** Each need card (a card that says it needs you), once per card: its time, task and question. */
function needCards(files: unknown[]): { at: number; task?: string; question: string }[] {
  return allNeedCards(files)
    .filter((n) => askKind(n.card) !== "report")
    .map((n) => ({ at: n.at, task: n.card.task, question: n.card.ask?.questions?.[0]?.title ?? "" }));
}

/** The time and task of the asks: each card, and each Inbox item of the space's tasks that is not also a card (same task and question). */
function asksOf(cards: ReturnType<typeof needCards>, items: Item[], key: string, project: string): { at: number; task?: string }[] {
  const same = new Set(cards.map((c) => `${c.task}\0${c.question}`));
  const inbox = items.filter(
    (i) => (i.task.startsWith(`${key}-`) || (i.project !== undefined && i.project === project)) && !same.has(`${i.task}\0${i.question}`),
  );
  return [
    ...cards.map((c) => ({ at: c.at, task: c.task })),
    ...inbox.map((i) => ({ at: Date.parse(i.since), task: i.task })).filter((a) => !Number.isNaN(a.at)),
  ];
}

/** The owner's taps on the Inbox since a day, per merged step. A change that applied by itself or a pre-approved action is no tap. Goal: near 0. */
function ownerTaps(items: Item[], key: string, project: string, merged: number, since: string): { taps: number; steps: number; perStep: number | null } {
  const from = Date.parse(`${since}T00:00:00Z`);
  const taps = items.filter(
    (i) => !i.auto && i.answer !== undefined && (i.task.startsWith(`${key}-`) || i.project === project) && Date.parse(i.answeredAt ?? i.since) >= from,
  ).length;
  return { taps, steps: merged, perStep: merged > 0 ? taps / merged : null };
}

/** The ready and merge times of a merged task, from the times Shepherdr keeps on it. */
function mergedTimes(task: TaskLine): { ready?: number; merged?: number } {
  return task.merged === true && typeof task.reportedAt === "number" && typeof task.doneAt === "number" ? { ready: task.reportedAt, merged: task.doneAt } : {};
}

/** When a task stopped running: done, or closed at its last change. Undefined while it runs. */
function taskEnd(task: TaskLine): number | undefined {
  if (typeof task.doneAt === "number") return task.doneAt;
  return task.closed ? Number(task.updated) || undefined : undefined;
}

function gitMerges(repo: string, ids: Set<string>): Map<string, number> | string {
  for (const ref of mainRefs(repo)) {
    const p = Bun.spawnSync(["git", "-C", repo, "log", ref, "-z", "--format=%ct%x01%s%x01%b"], { stderr: "ignore" });
    if (p.exitCode !== 0) continue;
    const merged = new Map<string, number>();
    for (const r of p.stdout.toString().split("\0")) {
      if (r.trim() === "") continue;
      const [ct = "", subject = "", body = ""] = r.split("\x01");
      for (const id of doneIds([{ subject: subject.trim(), body }], ids)) {
        merged.set(id, Math.min(merged.get(id) ?? Infinity, Number(ct) * 1000));
      }
    }
    return merged;
  }
  return `cannot read main in ${repo}`;
}

/** The subjects of the commits on main that start with Revert. */
function gitReverts(repo: string): string[] {
  for (const ref of mainRefs(repo)) {
    const p = Bun.spawnSync(["git", "-C", repo, "log", ref, "--format=%s", "-i", "--grep=^Revert"], { stderr: "ignore" });
    if (p.exitCode === 0)
      return p.stdout
        .toString()
        .split("\n")
        .filter((l) => /^Revert\b/i.test(l));
  }
  return [];
}

const USAGE =
  "usage: lineclear measure <project> --since <YYYY-MM-DD> [--json] [--health] [--local] (days are UTC days), or <project> --refiles [--since <YYYY-MM-DD>]";

/** `measure --refiles`: the fix tasks refiled in the period (default the last 7 days), with each one's cause. */
function refilesOut(tasks: FixInput[], steps: { id: string }[], since: string | undefined, env: Env, out: Out): number {
  const now = Number(env.LINECLEAR_NOW) || Date.now();
  const from = since === undefined ? now - 7 * DAY : Date.parse(`${since}T00:00:00Z`);
  for (const line of refileLines(
    refiles(
      tasks,
      steps.map((s) => s.id),
      from,
      now,
    ),
  ))
    out(line);
  return 0;
}

/** The share of compactions built from notes that fell back to pi's own summary, from the part's log. */
export function notesLine(env: Env): string {
  const x = notesStats(notesLogLines(env));
  return x.compactions === 0 ? "no compaction logged yet" : `${x.fellBack} of ${x.compactions} compactions fell back to pi's own summary`;
}

/** The jsonl session files of a task's working folder, read; none when it has no folder. */
function sessionTexts(t: TaskInfo, env: Env): string[] {
  return piHarness.readSessions(t.worktree, env);
}

/** The token pack's parts that were on for the whole of a task: a session file with no record is from before the pack, it says nothing. */
function partsOf(t: TaskInfo, env: Env): string[] {
  const lists = sessionTexts(t, env)
    .filter((text) => text.includes('"lineclear-pack"'))
    .map(sessionParts);
  return lists.length === 0 ? [] : lists.reduce((a, b) => a.filter((x) => b.includes(x)));
}

/** The dollars of a model's tokens at the prices of pi's model data; undefined with no price. */
function dollarsFor(priceOf: (u: Usage) => Price | undefined, model: string, input: number, output: number): number | undefined {
  const [provider, ...rest] = model.includes("/") ? model.split("/") : ["", model];
  const usage = { provider: provider as string, model: rest.join("/"), input, output, cacheRead: 0, cacheWrite: 0 };
  const price = priceOf(usage);
  return price ? costOf(usage, price) : undefined;
}

/** This machine's inputs for `measure`: its tasks, asks and turns, and how to read a task's usage and prices. */
function measuredHere(
  tasks: TaskInfo[],
  asks: { at: number }[],
  steps: { id: string; after: string[] }[],
  merges: Map<string, number>,
  priceOf: Measured["priceOf"],
  env: Env,
  causes: Pick<Measured, "decisions" | "partNames">,
): Measured {
  return {
    ...causes,
    turns: tasks.flatMap((t) => sessionTexts(t, env).flatMap(turnTimes)),
    asks: asks.map((a) => a.at),
    steps: steps.map((s) => ({ id: s.id, after: s.after, merged: merges.get(s.id) })),
    tasks,
    usageOf: (t) => worktreeUsage(t.worktree, env),
    partsOf: (t) => partsOf(t, env),
    priceOf,
  };
}

export function measureMain(args: string[], out: Out, env: Env = process.env): number | Promise<number> {
  if (args.includes("--server")) return measureServer(args, out, env);
  const sinceAt = args.indexOf("--since");
  const since = sinceAt >= 0 ? args[sinceAt + 1] : undefined;
  const flags = ["--json", "--since", "--health", "--raw", "--local", "--refiles"];
  const positional = args.filter((a, i) => !flags.includes(a) && (sinceAt < 0 || i !== sinceAt + 1));
  const bad = args.find((a) => a.startsWith("--") && !flags.includes(a));
  const refilesOnly = args.includes("--refiles");
  if (bad !== undefined || positional.length !== 1 || (since === undefined && !refilesOnly)) {
    out(USAGE);
    return 2;
  }
  if (since !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00Z`)))) {
    out(`lineclear measure: '${since}' is not a date, use YYYY-MM-DD`);
    return 2;
  }
  const fail = (message: string) => {
    out(`lineclear measure: ${message}`);
    return 1;
  };

  const project = positional[0] as string;
  const settings = readSettings(project, env);
  if (typeof settings === "string") return fail(settings);
  const roadmap = join(settings.repo, "docs", "ROADMAP.md");
  if (!existsSync(roadmap)) return fail(`${roadmap}: no such file`);
  const steps = parseRoadmap(readFileSync(roadmap, "utf8")).steps;
  const merges = gitMerges(settings.repo, new Set(steps.map((s) => s.id)));
  if (typeof merges === "string") return fail(merges);

  const dir = shepherdrDir(env);
  const space = findSpace(dir, settings.space, settings.repo);
  if (!space) return fail(`no space '${settings.space}' in ${join(dir, "spaces.json")}`);
  if (refilesOnly) return refilesOut(spaceTasks(dir, space), steps, since, env, out);
  if (since === undefined) return fail(USAGE);
  const files = chatFiles(dir, space);
  const stored: TaskInfo[] = spaceTasks(dir, space, true).map((t) => ({
    id: t.id,
    title: t.title ?? "",
    facts: t.facts,
    start: taskStart(t, files),
    end: taskEnd(t),
    worktree: t.worktree ?? "",
    ...mergedTimes(t),
  }));
  const tasks = [...stored, ...tasksFromSessions(env, basename(settings.repo), new Set(stored.map((t) => t.worktree)))];

  const from = Date.parse(`${since}T00:00:00Z`);
  const reads = roadmapReads(tasks.filter((t) => t.start !== undefined && t.start >= from).flatMap((t) => sessionTexts(t, env)));

  const asks = asksOf(needCards(files), readItems(env), space.key, project);
  const priceOf = priceFinder(readJson(join(piDir(env), "models-store.json")));
  const stepLines = readDecisionsSince(decisionsPath(env), from - 30 * DAY).filter(
    (d) => d.project === project && d.step !== undefined && d.event === undefined,
  );
  const causes = {
    decisions: stepLines.map((d) => ({ step: d.step as string, at: Date.parse(d.time), kind: d.kind, reason: d.reason })),
    partNames: readParts(settings.repo).map((p) => p.name),
  };
  const here = measuredHere(tasks, asks, steps, merges, priceOf, env, causes);
  if (args.includes("--raw")) {
    out(JSON.stringify(rawOf(here)));
    return 0;
  }
  const all = args.includes("--local") ? { measured: here, machines: [], notes: [] } : withMachines(here, project, since, env);
  const numbers = measure(all.measured, since);

  const mergedSteps = steps.filter((s) => (merges.get(s.id) ?? 0) >= from).map((s) => s.id);
  const stepCheck = stepCheckNumbers({
    steps: mergedSteps,
    tasks,
    checks: allChecks(env),
    askTasks: asks.map((a) => a.task),
    failedMerges: refusedMergeBranches(readRuns(settings.repo, from, env)),
    reverts: gitReverts(settings.repo),
    dollarsOf: (model, input, output) => dollarsFor(priceOf, model, input, output),
  });
  const roundLines = reviewRoundLines(mergedSteps, tasks, settings.reviewRounds ?? DEFAULT_ROUNDS);
  const taps = ownerTaps(readItems(env), space.key, project, mergedSteps.length, since);

  const healthy = health({
    project,
    decisions: readDecisionsSince(decisionsPath(env), from - 30 * DAY),
    tasks,
    merges: [...merges.values()],
    stepTokens: numbers.stepTokens,
    since: new Date(from),
    now: new Date(Number(env.LINECLEAR_NOW) || Date.now()),
  });
  if (args.includes("--health")) {
    const file = join(settings.repo, "docs", "numbers.md");
    writeHealth(file, project, healthy);
    out(`wrote the Health numbers to ${file}`);
  }

  const lane = laneDays(readRuns(settings.repo, 0, env), from);
  const red = redByCause(readRuns(settings.repo, from, env));
  const parts = partHealth(settings.repo, readParts(settings.repo), steps, tasks, taskSignals(files, tasks));
  if (args.includes("--json")) {
    out(
      JSON.stringify(
        { ...numbers, roadmapReads: reads, ownerTaps: taps, stepCheck, health: healthy, partHealth: parts, mergeLine: lane, redMerges: red },
        null,
        2,
      ),
    );
    return 0;
  }
  for (const note of all.notes) out(note);
  printNumbers(out, env, {
    machines: all.machines,
    numbers,
    taps,
    reads,
    healthy,
    parts,
    stepCheck,
    roundLines,
    lane,
    red,
    roundDollars: roundDollars(numbers),
  });
  return 0;
}

/** This machine's asks, turns and tasks with their usage and prices, for the machine that asks over SSH. */
function rawOf(m: Measured): Raw {
  return {
    asks: m.asks,
    turns: m.turns ?? [],
    tasks: m.tasks.map((t) => {
      const usage = m.usageOf(t);
      return { ...t, usage, prices: (usage ?? []).map((u) => m.priceOf(u) ?? null), parts: m.partsOf?.(t) ?? [] };
    }),
  };
}

/** The average dollars of a step over the days that have a cost. */
function roundDollars(numbers: Numbers): number {
  const costed = numbers.days.flatMap((d) => (d.cost ? [d.cost] : []));
  const steps = costed.reduce((a, c) => a + c.steps, 0);
  return steps === 0 ? 0 : costed.reduce((a, c) => a + c.perStep * c.steps, 0) / steps;
}

type Printed = {
  machines: string[];
  numbers: Numbers;
  taps: ReturnType<typeof ownerTaps>;
  reads: ReturnType<typeof roadmapReads>;
  healthy: ReturnType<typeof health>;
  parts: ReturnType<typeof partHealth>;
  stepCheck: StepCheckNumbers;
  roundLines: string[];
  lane: ReturnType<typeof laneDays>;
  red: ReturnType<typeof redByCause>;
  roundDollars: number;
};

/** The numbers of `lineclear measure` as text, one line each. */
function printNumbers(out: Out, env: Env, { machines, numbers, taps, reads, healthy, parts, stepCheck, roundLines, lane, red, roundDollars }: Printed): void {
  if (machines.length > 0) out(`counted on this machine and ${machines.join(", ")}`);
  out("date        asks  wait (median min)  cost ($ per merged step)  tokens per merged step  ready to merged (median min)  turns (goal 0)");
  for (const d of numbers.days) {
    const wait = d.wait ? `${d.wait.median.toFixed(1)} (${d.wait.tasks} tasks)` : "-";
    const cost = d.cost ? `${d.cost.perStep.toFixed(2)} (${d.cost.steps} steps)` : "-";
    const tokens = d.cost ? String(Math.round(d.cost.tokens)) : "-";
    const lane = d.lane ? `${d.lane.median.toFixed(1)} (${d.lane.tasks} tasks, longest ${d.lane.longest.toFixed(1)})` : "-";
    out(`${d.date}  ${String(d.asks).padStart(4)}  ${wait.padEnd(17)}  ${cost.padEnd(24)}  ${tokens.padEnd(22)}  ${lane.padEnd(40)}  ${d.turns}`);
  }
  for (const w of numbers.waitCauses) out(`wait causes ${w.step}: ${causeLine(w.minutes)}`);
  const totals = causeTotals(numbers.waitCauses);
  if (totals.length > 0) out(`wait causes, all steps: ${totals.map(([c, m]) => `${c} ${m.toFixed(1)} min`).join(", ")}`);
  const slow = unexplainedWaits(numbers.waitCauses, TICK_MS);
  if (numbers.waitCauses.length > 0)
    out(
      `waits over one tick (${TICK_MS / 1000} s) with no recorded cause (goal 0): ${slow.length === 0 ? "0" : slow.map((w) => `${w.step} ${w.minutes.toFixed(1)} min`).join(", ")}`,
    );
  const after = numbers.lockAfterEnd;
  out(`lock held after its task ended (median min, goal 0 within one tick): ${after === null ? "-" : `${after.median.toFixed(1)} (${after.locks} locks)`}`);
  if (red.total > 0)
    out(
      `red merge checks (goal under 15 %): ${red.red} of ${red.total}, ${((red.red / red.total) * 100).toFixed(1)} %${red.causes.length > 0 ? `; by cause: ${red.causes.map(([c, n]) => `${c} ${n}`).join(", ")}` : ""}`,
    );
  for (const d of lane) {
    const wait = d.longestWait === null ? "-" : `${d.longestWait.toFixed(1)} min`;
    out(`merge line ${d.date}: ${d.merges} merges, ${d.perHour.toFixed(2)} per hour, longest wait of a turn ${wait}`);
  }
  for (const x of numbers.parts) {
    const f = (v: PartSplit["on"]) => (v ? `$${v.perStep.toFixed(2)}, ${Math.round(v.tokens)} tokens (${v.steps} steps)` : "-");
    out(`token pack ${x.part}: on ${f(x.on)}, off ${f(x.off)} per merged step`);
  }
  for (const x of numbers.causes) out(`cost cause ${x.cause}: $${x.perStep.toFixed(2)} per merged step, ${(x.share * 100).toFixed(1)} %`);
  for (const l of bandLines(numbers.bands)) out(l);
  for (const r of numbers.reviews) out(`review ${r.task}: ${r.tokens} tokens, $${r.dollars.toFixed(2)} (${r.rounds} ${r.rounds === 1 ? "round" : "rounds"})`);
  out(`owner taps per merged step (goal near 0): ${taps.perStep === null ? "-" : taps.perStep.toFixed(2)} (${taps.taps} taps, ${taps.steps} merged steps)`);
  const r = (v: { sessions: number; whole: number }) => `${v.whole} of ${v.sessions} sessions`;
  out(`token pack small briefs: whole roadmap read before ${r(reads.before)}, after ${r(reads.after)}`);
  out(`token pack compaction notes: ${notesLine(env)}`);
  for (const l of healthLines(healthy)) out(`health, ${l}`);
  for (const l of partHealthLines(parts)) out(l);
  for (const l of roundLines) out(l);
  for (const l of stepCheckLines(stepCheck, roundDollars)) out(l);
  if (numbers.unpriced.length > 0) out(`no price in pi's model data, steps not counted: ${numbers.unpriced.join(", ")}`);
  if (numbers.noTask.length > 0)
    out(`${numbers.noTask.length} merged ${numbers.noTask.length === 1 ? "step" : "steps"} had no task, not counted: ${numbers.noTask.join(", ")}`);
  if (numbers.noSession.length > 0) out(`no session file found, steps not counted: ${numbers.noSession.join(", ")}`);
}
