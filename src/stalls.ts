import { closeWithReport, limitWallTime } from "./stall-close.ts";
import { chatFiles, findSpace, lineclearDir } from "./measure.ts";
import { herdrArgv } from "./herdr.ts";
import { addItem, isOpen, readItems } from "./inbox.ts";
import { resultFlag, type Step, stepOfTask, type Task } from "./roadmap.ts";
import { company } from "./company.ts";
import type { Settings } from "./project.ts";
import { type Wait, writeWait } from "./waits.ts";
import { configDir } from "../pi/config.ts";
import { type Account, markFull, providerOf, readAccounts, readLimit, recordMove } from "./full.ts";
import { join } from "node:path";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { agentName, recordStart, serviceStarts } from "./starts.ts";
import { piHarness } from "./harness-pi.ts";
import { stepBrief } from "./brief.ts";
import { rankByRoom } from "./pace.ts";
import { failedChecks } from "./routine.ts";
import type { Decision, State, World } from "./rules.ts";
import { DAY } from "./time.ts";
export interface StallCard {
  id: string;
  task: string;
  at: number;
  /** "may be stuck: past its time left": busy but late, not silent. */
  late?: boolean;
}

/** The "may be stuck" cards Lineclear's `checkStalls` posted, oldest first. */
export function stallCards(files: any[]): StallCard[] {
  const seen = new Map<string, StallCard>();
  for (const f of files) {
    for (const p of f.posted ?? []) {
      const c = p?.card;
      if (typeof c?.task !== "string" || typeof p.at !== "number" || !/^may be stuck/.test(String(c.text ?? ""))) continue;
      seen.set(String(c.id ?? p.id), {
        id: String(c.id ?? p.id),
        task: c.task,
        at: p.at,
        ...(/^may be stuck: past its time left/.test(String(c.text)) && { late: true }),
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

export function realStallCards(space: string, repo: string, env = process.env): StallCard[] {
  const dir = lineclearDir(env);
  const s = findSpace(dir, space, repo);
  return s ? stallCards(chatFiles(dir, s)) : [];
}

/** A card of a space's chat with its text, ready facts included. */
export interface ChatCard {
  id: string;
  task: string;
  at: number;
  text: string;
}

function chatCards(files: any[]): ChatCard[] {
  const seen = new Map<string, ChatCard>();
  for (const f of files) {
    for (const p of f.posted ?? []) {
      const c = p?.card;
      if (typeof c?.task !== "string" || typeof p.at !== "number") continue;
      const text = [c.text, c.summary, c.facts].filter((x) => typeof x === "string").join("\n");
      seen.set(String(c.id ?? p.id), { id: String(c.id ?? p.id), task: c.task, at: p.at, text });
    }
  }
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

export function realChatCards(space: string, repo: string, env = process.env): ChatCard[] {
  const dir = lineclearDir(env);
  const s = findSpace(dir, space, repo);
  return s ? chatCards(chatFiles(dir, s)) : [];
}

const FAILED_FRESH_MS = 15 * 60_000;

/** The error of the agent's last model call, read from the tail of its pi session file. */
export function agentLastError(id: string, run: (cmd: string[]) => { code: number; out: string }): { text: string; at: number } | undefined {
  const r = run(herdrArgv(["agent", "get", agentName(id)]));
  if (r.code !== 0) return undefined;
  try {
    const file = JSON.parse(r.out).result?.agent?.agent_session?.value;
    if (typeof file !== "string" || !existsSync(file)) return undefined;
    const size = statSync(file).size;
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(Math.min(size, 65_536));
    readSync(fd, buf, 0, buf.length, size - buf.length);
    closeSync(fd);
    const lines = buf
      .toString("utf8")
      .split("\n")
      .filter((l) => l.includes('"role":"assistant"'));
    const m = JSON.parse(lines[lines.length - 1] ?? "null")?.message;
    if (m?.stopReason !== "error" || typeof m.errorMessage !== "string") return undefined;
    return { text: m.errorMessage, at: typeof m.timestamp === "number" ? m.timestamp : 0 };
  } catch {
    return undefined;
  }
}

// ---- accounts ----

export { readAccounts };

const resetPassed = (account: Account, now: Date) => account.resetAt !== undefined && new Date(account.resetAt).getTime() <= now.getTime();

const keyQuestion = (provider: string) => `Use the paid API key of ${provider}?`;

/** Your answer to the key question of a provider: the latest answered item. */
function keyAnswer(provider: string, env: NodeJS.ProcessEnv) {
  return readItems(env)
    .filter((i) => i.kind === "outward" && i.task === "-" && i.question === keyQuestion(provider) && i.answer !== undefined)
    .pop();
}

/** `ok` runs now, `out` has no room, `key` is a paid API key you have not allowed yet. An allow holds for that key. */
export function availability(model: string, env = process.env, now = new Date()): "ok" | "out" | "key" {
  const account = readAccounts(env)[providerOf(model)];
  if (account === undefined) return "ok";
  if (account.out && !resetPassed(account, now)) return "out";
  if (account.kind === "key" && keyAnswer(providerOf(model), env)?.answer !== "Allow") return "key";
  return "ok";
}

/** Puts the key question in the Inbox once. It is not asked again while open, or for a day after "Not now". */
export function askKey(model: string, _world: World, now: Date, env = process.env): string | undefined {
  const provider = providerOf(model);
  const question = keyQuestion(provider);
  if (readItems(env).some((i) => i.question === question && isOpen(i))) return undefined;
  const last = keyAnswer(provider, env);
  if (last?.answer === "Not now" && now.getTime() - new Date(last.answeredAt ?? 0).getTime() < DAY) return undefined;
  addItem({ kind: "outward", task: "-", question, choices: ["Allow", "Not now"], since: now.toISOString() }, env);
  return `asked in the Inbox before using the paid key of ${provider}`;
}

/** The tell below: a card that repeats it is not a new limit. */
const OUR_TELL = /has hit its usage limit\. Do not ask/; // older versions told the task; their cards are still skipped
/** How long an account stays out when its message gives no reset time. */
const DEFAULT_OUT_MS = 5 * 3_600_000;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** When a limit message says it ends: an ISO time after "reset", or "resets in 3 hours". Undefined when it says neither. */
export function parseReset(text: string, now: Date): string | undefined {
  const iso = /resets?(?: at)?\s+(\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:?\d\d)?)/i.exec(text);
  if (iso) {
    const t = new Date(iso[1]!.replace(" ", "T"));
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  const rel = /(?:resets?|try again|retry)(?: after)?\s+in\s+(\d+)\s*(min\w*|m|hours?|hrs?|h|days?|d)\b/i.exec(text);
  if (rel) return new Date(now.getTime() + Number(rel[1]) * UNIT_MS[rel[2]![0]!.toLowerCase()]!).toISOString();
  const clock = readLimit(text, now);
  return clock && /resets\s+(?:[A-Za-z]{3}[a-z]*\s+\d{1,2},?\s+)?\d{1,2}(?::\d{2})?\s*[ap]m/i.test(text) ? clock.until.toISOString() : undefined;
}

/** An account whose reset time has passed is back: its mark is removed and the decision logged. */
function restoreAccounts(a: Args): void {
  const { world, dryRun, note, env } = a;
  const now = world.now();
  const accounts = readAccounts(env);
  const back = Object.keys(accounts).filter((p) => accounts[p]!.out && resetPassed(accounts[p]!, now));
  if (back.length === 0 || dryRun) return;
  for (const p of back) {
    delete accounts[p]!.out;
    delete accounts[p]!.resetAt;
    delete accounts[p]!.window;
    note("stall", `${p} is back: its limit has reset`);
  }
  writeAtomic(join(configDir(env), "accounts.json"), `${JSON.stringify(accounts, null, 2)}\n`);
}

/** The step the rules started task `id` for. */
function stepOfId(a: Args, id: string): Step | undefined {
  const t = a.tasks.find((x) => id !== "" && x.id === id);
  return t && stepOfTask(a.steps, t, a.state.taskSteps ?? {});
}

/**
 * A reviewer provider that a task reported a usage limit of is out until its reset time (when the message gives one):
 * its account is marked and the decision logged. Nobody is asked and nobody is told: a provider cut-off is a rule's
 * business and shows on Usage, never a message to an agent (the brief tells the worker to pick another reviewer).
 */
function markLimitedReviewers(a: Args): void {
  const { settings, world, state, dryRun, note, env } = a;
  const providers = new Set([world.reviewerSetting(settings.space), ...settings.models.reviewer].filter((m) => m !== undefined).map((m) => providerOf(m!)));
  state.limitSeen ??= [];
  const now = world.now();
  for (const card of world.chatCards(settings.space, settings.repo)) {
    if (state.limitSeen.includes(card.id) || card.at < (state.stallSince ?? 0) || !piHarness.stallSignal(card.text) || OUR_TELL.test(card.text)) continue;
    // A provider that is already out is not blamed again: a card that repeats its limit is the worker's report of the fallback.
    const provider = [...providers].find((p) => p !== "" && card.text.toLowerCase().includes(p.toLowerCase()) && availability(`${p}/x`, env, now) !== "out");
    if (provider === undefined) continue;
    if (dryRun) {
      note("stall", `would mark ${provider} out: ${card.task} reported a usage limit`, card.task);
      continue;
    }
    state.limitSeen.push(card.id);
    const accounts = readAccounts(env);
    const resetAt = parseReset(card.text, now);
    const until = resetAt ?? new Date(now.getTime() + DEFAULT_OUT_MS).toISOString();
    const known = accounts[provider];
    if (!known?.out || resetPassed(known, now) || (resetAt !== undefined && resetAt > (known.resetAt ?? ""))) {
      accounts[provider] = { ...known, kind: known?.kind ?? "subscription", out: true, resetAt: until };
      writeAtomic(join(configDir(env), "accounts.json"), `${JSON.stringify(accounts, null, 2)}\n`);
    }
    const step = stepOfId(a, card.task);
    const worker = (step && state.models[step.id]) ?? settings.models.worker[0] ?? "";
    const next = reviewerFor(worker, settings, world, a.offered(), env, now);
    note(
      "stall",
      `${provider} is out until ${accounts[provider]?.resetAt ?? until}: ${card.task} reported a usage limit, so ${next ? `the review goes to ${next}${company(next) === company(worker) ? " (same company as the worker, a different model with a fresh context)" : ""}` : "no other reviewer has room"}`,
      card.task,
    );
  }
}

// ---- the ladder ----

const MAX_RUNG = 4;
const LEFT_WAITING = /^signed out/i;

/** What the task list shows for a task in Needs you that asks nothing (the server's `NEED.reply`). */
const SILENT_SUB = "Waits for your reply";
const REMINDER =
  "You may be stuck: nothing has moved for a while. Say where you are with `lineclear status`, then carry on. If you wait for the owner, a login or a browser, declare it with `lineclear wait`.";
const ESTIMATE = "You are past your time left. Say where you are with `lineclear status` and give a new estimate, then carry on.";
const RESUME = "Your agent was restarted because it went quiet. Read your brief and your branch, then carry on from where you were.";

interface Args {
  project: string;
  settings: Settings;
  world: World;
  state: State;
  dryRun: boolean;
  waits: Wait[];
  tasks: Task[];
  steps: Step[];
  offered: () => Set<string> | undefined;
  note: (kind: Decision["kind"], reason: string, step?: string) => void;
  env: NodeJS.ProcessEnv;
}

/** The restart rung: stops the task, then tells it to read its brief and go on. */
export const restartTask = (world: World, id: string) => world.stopTask(id) ?? world.tellTask(id, RESUME, "resume");

/** What one pass over the stalled tasks shares. */
interface Pass {
  a: Args;
  restarted: Set<string>;
  gone: Set<string>;
  waiting: Set<string>;
  now: Date;
  stepOf: (t: Task) => Step | undefined;
  ladderOf: (id: string) => { rung: number; seen: string[]; asked?: number };
  currentModel: (s: Step) => string;
}

/** Rung 4: the Inbox. */
function ask(p: Pass, t: Task, why: string): boolean {
  const { project, dryRun, note, env } = p.a;
  const id = t.id!;
  if (dryRun) {
    note("stall", `rung 4: would put ${id} in the Inbox (${why})`, id);
    return true;
  }
  const item = addItem(
    {
      kind: "stuck",
      task: id,
      project,
      question: `${id} is stuck: ${why}. What now?`,
      choices: ["Keep waiting", "I will look"],
      since: p.now.toISOString(),
    },
    env,
  );
  writeWait({ task: id, project, kind: "owner", reason: `asked: ${item.question}`, since: p.now.toISOString() }, env);
  p.ladderOf(id).rung = 4;
  note("stall", `rung 4: ${id} is in the Inbox as item ${item.n} (${why})`, id);
  return true;
}

/** The next worker model of a step, or why there is none: a paid key not allowed, or a full last model. */
function nextModel(p: Pass, current: string, step: Step): { next?: string; blocked?: string } {
  const { settings, world, dryRun, env } = p.a;
  const offered = p.a.offered();
  // A step on the cheap model may fall back to the normal worker, which comes before it in the list.
  const pool = p.a.state.cheap?.includes(step.id)
    ? settings.models.worker.filter((m) => m !== current)
    : settings.models.worker.slice(settings.models.worker.indexOf(current) + 1);
  const later = pool.filter((m) => offered === undefined || offered.has(m));
  let blocked: string | undefined;
  for (const m of later) {
    const av = availability(m, env, p.now);
    if (av === "key") {
      if (!dryRun) askKey(m, world, p.now, env);
      blocked = `${m} is on a paid key you have not allowed`;
    } else if (av === "ok" && reviewerFor(m, settings, world, offered, env, p.now) !== undefined) {
      return { next: m };
    }
  }
  return { blocked };
}

/** The role's last model is full: the task waits for the reset, not for you. Undefined when that is not the case. */
function waitForReset(p: Pass, t: Task, current: string): boolean | undefined {
  const { project, dryRun, note, env } = p.a;
  const id = t.id!;
  const until = readAccounts(env)[providerOf(current)]?.resetAt;
  if (availability(current, env, p.now) !== "out" || until === undefined) return undefined;
  if (dryRun) {
    note("stall", `would let ${id} wait until ${until}: ${current} is full and no model is next`, id);
    return true;
  }
  writeWait({ task: id, project, kind: "until", until, reason: `${current} is full and no model is next`, since: p.now.toISOString() }, env);
  p.ladderOf(id).rung = 3;
  note("stall", `${id} waits until ${until}: ${current} is full and no model is next`, id);
  return true;
}

/** Rung 3: closes the task and starts its step again on the next model, from the old branch. */
function handover(p: Pass, t: Task, why: string, to?: string): boolean {
  const { settings, world, state, dryRun, note, env } = p.a;
  const id = t.id!;
  const step = p.stepOf(t);
  if (step === undefined) return ask(p, t, `${why}; it is not a roadmap step, so it has no next model`);
  // A full account may hand a step on again, to a model later in the list; any other stop gets one handover.
  if (to === undefined && state.handed.includes(step.id) && availability(p.currentModel(step), env, p.now) !== "out")
    return ask(p, t, `${why}; the next model already had its turn`);
  const current = p.currentModel(step);
  const { next, blocked } = to === undefined ? nextModel(p, current, step) : { next: to, blocked: undefined };
  if (next === undefined && blocked !== undefined) {
    // The Inbox has the question: this rung is tried again once you answered it.
    note("skip", `${id}: ${why}; ${blocked}, so the handover waits for your answer`, id);
    return false;
  }
  if (next === undefined) return waitForReset(p, t, current) ?? ask(p, t, `${why}; there is no next worker model to hand it to`);
  const reviewer = reviewerFor(next, settings, world, p.a.offered(), env, p.now)!;
  if (dryRun) {
    note("stall", `rung 3: would hand ${id} over to ${next} (${why})`, id);
    return true;
  }
  const branch = world.branchOf(settings.repo, id);
  const err = world.closeTask(id);
  if (err) {
    note("skip", `could not close ${id}: ${err}`, id);
    return false;
  }
  const goOn = branch
    ? `An earlier agent (${current}) stopped on this step. Go on from its branch ${branch}: check it out and carry on from its commits. Do not start over.`
    : `An earlier agent (${current}) stopped on this step and left no branch. Start from main.`;
  const started = world.addTask(
    settings.space,
    `${step.id} ${step.title}`,
    `${stepBrief(step, settings, reviewer, next, { repo: settings.repo, roadmap: world.roadmap(settings.repo) ?? "" })}\n\n${goOn}\n`,
    [
      "--agent",
      "pi",
      "--model",
      next,
      "--reviewer",
      "pi",
      "--reviewer-model",
      reviewer,
      "--set",
      `review.rounds=${settings.reviewRounds ?? 2}`,
      ...resultFlag(step),
    ],
  );
  // The step is the loop's again, on its next tick, when the start failed.
  if (started) {
    note("skip", `closed ${id}, but the next start failed: ${started}`, step.id);
    return true;
  }
  state.models[step.id] = next;
  recordStart(state, `${step.id} ${step.title}`, step.id);
  // The move back from the cheap model is no stall handover: the step keeps its one turn on a later model.
  if (to === undefined) state.handed.push(step.id);
  recordMove({ time: p.now.toISOString(), task: id, step: step.id, from: current, to: next, why }, env);
  p.restarted.add(step.id);
  p.ladderOf(id).rung = 3;
  p.gone.add(id);
  note("stall", `rung 3: closed ${id} (${why}) and started ${step.id} again on ${next}${branch ? `, from ${branch}` : ""}`, step.id);
  return true;
}

/** Rungs 1 and 2 remind and restart; 3 hands the task on; 4 asks. */
function climb(p: Pass, t: Task, rung: number, why: string): boolean {
  const { world, dryRun, note } = p.a;
  const id = t.id!;
  if (rung !== 1 && rung !== 2) return rung === 3 ? handover(p, t, why) : ask(p, t, why);
  if (rung === 1 && t.status === "work" && why.startsWith("no sign")) return closeWithReport(p.a, p.now, p.ladderOf(id), p.gone, t, why);
  if (dryRun) return (note("stall", `rung ${rung}: would ${rung === 1 ? "remind" : "restart"} ${id} (${why})`, id), true);
  const err = rung === 1 ? world.tellTask(id, REMINDER, "resume") : restartTask(world, id);
  if (err) {
    note("skip", `rung ${rung} for ${id} failed: ${err}`, id);
    return false;
  }
  p.ladderOf(id).rung = rung;
  note("stall", `rung ${rung}: ${rung === 1 ? "reminded" : "restarted and resumed"} ${id} (${why})`, id);
  return true;
}

/**
 * A model call that failed because its account's session or week is full marks the account at once, so the handover
 * pass hands the task on in this tick, before any stall rung.
 */
function markFullAccounts(p: Pass): void {
  const { world, dryRun, note, env } = p.a;
  for (const t of p.a.tasks) {
    const step = p.stepOf(t);
    if (t.id === undefined || t.status !== "work" || step === undefined || p.waiting.has(t.id)) continue;
    const failed = world.lastError(t.id);
    // An error older than this is one the task already got past, or waited out.
    const limit = failed === undefined || p.now.getTime() - failed.at > FAILED_FRESH_MS ? undefined : readLimit(failed.text, new Date(failed.at));
    // The reset is read from the time of the error. One that has passed is no mark.
    if (limit === undefined || limit.until <= p.now) continue;
    const provider = providerOf(p.currentModel(step));
    if (availability(p.currentModel(step), env, p.now) === "out") continue;
    if (dryRun) {
      note("stall", `would mark ${provider} full until ${limit.until.toISOString()}: ${t.id} hit its ${limit.window} limit`, t.id);
      continue;
    }
    markFull(provider, limit.until, limit.window, env);
    note("stall", `${provider} is full until ${limit.until.toISOString()}: ${t.id} hit its ${limit.window} limit`, t.id);
  }
}

/** A routine step on the cheap model whose check failed twice goes to the worker model of Settings, with a line in the decision log. */
function escalateRoutine(p: Pass): void {
  const { settings, world, state, env } = p.a;
  for (const t of p.a.tasks) {
    const step = t.id === undefined || t.status !== "work" || p.waiting.has(t.id) || p.gone.has(t.id) ? undefined : p.stepOf(t);
    if (step === undefined || !state.cheap?.includes(step.id)) continue;
    const failed = failedChecks(step, settings.repo, env);
    if (failed < 2) continue;
    const current = p.currentModel(step);
    const offered = p.a.offered();
    const to = settings.models.worker.find(
      (m) =>
        m !== current &&
        (offered === undefined || offered.has(m)) &&
        availability(m, env, p.now) === "ok" &&
        reviewerFor(m, settings, world, offered, env, p.now) !== undefined,
    );
    if (to === undefined) continue;
    if (handover(p, t, `routine step: its check failed ${failed} times on the cheap model ${current}`, to) && !p.a.dryRun)
      state.cheap = state.cheap.filter((id) => id !== step.id);
  }
}

/** Tasks that cannot go on: a full account, or Lineclear left them waiting for you. Straight to rung 3, no waiting. */
function handOverStuck(p: Pass): void {
  const { env } = p.a;
  for (const t of p.a.tasks) {
    if (t.id === undefined || p.waiting.has(t.id) || p.gone.has(t.id) || p.ladderOf(t.id).rung >= 3) continue;
    const step = p.stepOf(t);
    if (t.status === "work" && step !== undefined && availability(p.currentModel(step), env, p.now) === "out") {
      climb(p, t, 3, `the account of ${p.currentModel(step)} is out`);
    } else if (t.status === "need" && LEFT_WAITING.test(t.sub ?? "")) {
      climb(p, t, 3, `it cannot go on: ${t.sub}`);
    }
  }
}

/** The late remedy: asks for a new estimate, once per task. */
function askEstimate(p: Pass, id: string): boolean {
  const { world, dryRun, note } = p.a;
  if (dryRun) {
    note("stall", `would ask ${id} for a new estimate: may be stuck, past its time left`, id);
    return true;
  }
  const err = world.tellTask(id, ESTIMATE, "resume");
  if (err) {
    note("skip", `asking ${id} for a new estimate failed: ${err}`, id);
    return false;
  }
  p.ladderOf(id).asked = p.now.getTime();
  note("stall", `asked ${id} for a new estimate: may be stuck, past its time left`, id);
  return true;
}

/** The task posted a card of its own (a status) after it was asked for a new estimate. */
function gotStatus(chat: ChatCard[], id: string, since: number): boolean {
  return chat.some((c) => c.task === id && c.at > since && !/^may be stuck/.test(c.text));
}

/** A late task is busy, not silent: it is asked for a new estimate, and climbs only if a late card comes with no status since. */
function climbReason(t: Task, card: StallCard): string {
  if (card.late) return "late, and no status after the new estimate was asked for";
  return t.status === "need" ? "it showed Needs you with no question" : "no sign of life for 20 minutes";
}

/** Each new stall card moves its task one rung up. */
function climbStalled(p: Pass): void {
  const { world, settings, state, dryRun, note } = p.a;
  const live = new Map(p.a.tasks.flatMap((t): [string, Task][] => (t.id === undefined ? [] : [[t.id, t]])));
  for (const card of world.stallCards(settings.space, settings.repo)) {
    const l = p.ladderOf(card.task);
    if (l.seen.includes(card.id) || card.at < (state.stallSince ?? 0)) continue;
    const t = live.get(card.task);
    const mark = () => {
      if (!dryRun) l.seen.push(card.id);
    };
    // Needs you counts only while it still shows no question: a plan, a login or a real question was added since the card.
    const moves = t?.status === "work" || (t?.status === "need" && t.sub === SILENT_SUB);
    if (t === undefined || !moves || p.gone.has(card.task)) {
      mark();
      continue;
    }
    if (p.waiting.has(card.task)) {
      note("skip", `${card.task} may be stuck, but it has a declared wait, so it is not moved up`, card.task);
      mark();
      continue;
    }
    if (card.late && (l.asked === undefined || gotStatus(world.chatCards(settings.space, settings.repo), card.task, l.asked))) {
      if (askEstimate(p, card.task)) mark();
    } else if (climb(p, t, Math.min(l.rung + 1, MAX_RUNG), climbReason(t, card))) mark();
  }
}

/**
 * Moves each stalled task one rung up: a reminder, a restart, the next model, an Inbox item. A task with a declared
 * wait is not touched. Returns the steps it started again, so the same tick does not start them a second time.
 */
export function serviceStalls(a: Args): Set<string> {
  const { project, settings, world, state, dryRun, note, env } = a;
  const now = world.now();
  state.stallSince ??= now.getTime();
  const worker = settings.models.worker;
  const p: Pass = {
    a,
    restarted: new Set(),
    gone: new Set(),
    waiting: new Set(a.waits.map((w) => w.task)),
    now,
    stepOf: (t) => stepOfTask(a.steps, t, state.taskSteps ?? {}),
    ladderOf: (id) => (state.ladder[id] ??= { rung: 0, seen: [] }),
    currentModel: (s) => state.models[s.id] ?? worker[0] ?? "",
  };
  markFullAccounts(p);
  handOverStuck(p);
  escalateRoutine(p);
  restoreAccounts(a);
  markLimitedReviewers(a);

  // A start whose agent never answered its brief: its own ladder (starts.ts).
  // A task marked start failed is still looked at, so its wait ends once its agent answers.
  const failed = new Set(a.waits.filter((w) => w.kind === "start").map((w) => w.task));
  const skip = new Set([...[...p.waiting].filter((id) => !failed.has(id)), ...p.gone]);
  serviceStarts({ project, world, state, dryRun, tasks: a.tasks, skip, failed, note, env });

  limitWallTime(p.a, p.now, p.ladderOf, p.gone, p.waiting);
  climbStalled(p);
  return p.restarted;
}

/**
 * The merge lane's last rule: main failed its health command twice in a row, so the last merge is reverted and the
 * Inbox says so. Only a task's merge (a subject `<TASK>: ...`) is reverted, never a commit made by hand. Returns what happened.
 */
export function revertLast(project: string, settings: Settings, world: World, head: string, subject: string, env = process.env): string {
  const short = head.slice(0, 7);
  const merge = /^[A-Za-z][A-Za-z0-9]*-\d+: /.test(subject);
  const error = merge ? world.revert(settings.repo, head) : undefined;
  const result = !merge ? "it is not a task's merge, so it was not reverted" : error ? `the revert failed: ${error.split("\n")[0]}` : "the merge was reverted";
  const question =
    merge && !error
      ? `${project}: main failed its health command twice in a row, so the merge that first broke it, ${subject} (${short}), was reverted. New starts are stopped until main is healthy.`
      : `${project}: main failed its health command twice in a row at ${short} (${subject}), and ${result}. New starts are stopped until main is healthy.`;
  addItem({ kind: "stuck", task: "-", project, question, choices: ["Ok"], alert: "Main is red", since: world.now().toISOString() }, env);
  return result;
}

/**
 * The first reviewer that pi offers, that has room, and that is from another company than the worker. When none is,
 * a different model of the worker's own company: it never blocks a start.
 */
export function pickReviewer(
  worker: string,
  reviewers: string[],
  offered: Set<string> | undefined,
  usable: (model: string) => boolean = () => true,
): string | undefined {
  const ok = (m: string) => (offered === undefined || offered.has(m)) && usable(m);
  return reviewers.find((m) => ok(m) && company(m) !== company(worker)) ?? reviewers.find((m) => ok(m) && m !== worker);
}

/** The reviewer of a started task: Lineclear's Settings first, then the project's list. */
export function reviewerFor(worker: string, settings: Settings, world: World, offered: Set<string> | undefined, env = process.env, now = world.now()) {
  const first = world.reviewerSetting(settings.space);
  const list = first === undefined ? settings.models.reviewer : [first, ...settings.models.reviewer.filter((m) => m !== first)];
  // Models of the worker list come last: a different model of the worker's company is the fallback.
  return pickReviewer(worker, rankByRoom([...list, ...settings.models.worker], env, now).order, offered, (m) => availability(m, env, now) !== "out");
}
