import { chatFiles, findSpace, lineclearDir } from "./measure.ts";
import { herdrArgv } from "./herdr.ts";
import { addItem, isOpen, readItems } from "./inbox.ts";
import { type Step, stepOfTask, type Task } from "./roadmap.ts";
import { company } from "./company.ts";
import type { Settings } from "./project.ts";
import type { Wait } from "./waits.ts";
import { configDir } from "../pi/config.ts";
import { type Account, markDead, markFull, readDead, providerOf, readAccounts, readLimit } from "./full.ts";
import { join } from "node:path";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { agentName } from "./starts.ts";
import { namesUsageLimit } from "./harness-pi.ts";
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
    if (state.limitSeen.includes(card.id) || card.at < (state.stallSince ?? 0) || !namesUsageLimit(card.text) || OUR_TELL.test(card.text)) continue;
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

// ---- accounts in a tick ----

/** What the task list shows for a task in Needs you that asks nothing (the server's `NEED.reply`). */
const SILENT_SUB = "Waits for your reply";
/** A task on a provider error shows one of these while it works or sits on a refused account. */
const runs = (t: Task) => t.status === "work" || (t.status === "need" && (t.sub === SILENT_SUB || /^(provider error|provider refused)/i.test(t.sub ?? "")));

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

/** What one pass over the stalled tasks shares. */
interface Pass {
  a: Args;
  waiting: Set<string>;
  now: Date;
  stepOf: (t: Task) => Step | undefined;
  currentModel: (s: Step) => string;
}

/**
 * A model call that failed because its account's session or week is full marks the account at once, so the handover
 * pass hands the task on in this tick, before any stall rung.
 */
function markFullAccounts(p: Pass): void {
  const { world, dryRun, note, env } = p.a;
  for (const t of p.a.tasks) {
    const step = p.stepOf(t);
    if (t.id === undefined || !runs(t) || step === undefined || p.waiting.has(t.id)) continue;
    const failed = world.lastError(t.id);
    // An error older than this is one the task already got past, or waited out.
    const fresh = failed === undefined || p.now.getTime() - failed.at > FAILED_FRESH_MS ? undefined : failed;
    if (fresh === undefined) continue;
    const provider = providerOf(p.currentModel(step));
    if (availability(p.currentModel(step), env, p.now) === "out") continue;
    const dead = readDead(fresh.text);
    if (dead !== undefined) {
      if (dryRun) note("stall", `would mark ${provider} unusable: ${t.id} got "${dead}"`, t.id);
      else {
        markDead(provider, dead, env);
        note("stall", `${provider} is unusable: ${t.id} got "${dead}"`, t.id);
      }
      continue;
    }
    // The reset is read from the time of the error. One that has passed is no mark.
    const limit = readLimit(fresh.text, new Date(fresh.at));
    if (limit === undefined || limit.until <= p.now) continue;
    if (dryRun) {
      note("stall", `would mark ${provider} full until ${limit.until.toISOString()}: ${t.id} hit its ${limit.window} limit`, t.id);
      continue;
    }
    markFull(provider, limit.until, limit.window, env);
    note("stall", `${provider} is full until ${limit.until.toISOString()}: ${t.id} hit its ${limit.window} limit`, t.id);
  }
}

const NUDGE = "The board saw no sign of life from you. Carry on with your task, and report with lineclear status when you have something to say.";
const RESTART = "You were restarted because nothing changed after a nudge. Carry on with your task from where it stands.";

/**
 * The stall ladder. The server alone judges which task is quiet or late and posts one "may be stuck" card for it;
 * each new card for a running task is one rung: a nudge, then a restart, then the Inbox. No limit is read here.
 */
export function climbStalls(a: Args): void {
  const { settings, world, state, dryRun, note, env } = a;
  const running = new Set(a.tasks.filter((t) => t.status === "work").map((t) => t.id));
  for (const id of Object.keys(state.ladder)) if (!running.has(id)) delete state.ladder[id];
  for (const card of world.stallCards(settings.space, settings.repo)) {
    const id = card.task;
    const entry = state.ladder[id] ?? { rung: 0, seen: [] };
    if (entry.seen.includes(card.id) || card.at < (state.stallSince ?? 0) || !running.has(id)) continue;
    const rung = entry.rung + 1;
    const what = card.late ? "past its time left" : "no sign of life";
    if (dryRun) {
      note("stall", `rung ${Math.min(rung, 3)}: would ${rung === 1 ? "nudge" : rung === 2 ? "restart" : "ask you about"} ${id}: ${what}`, id);
      continue;
    }
    state.ladder[id] = { rung, seen: [...entry.seen, card.id] };
    if (rung === 1) {
      const err = world.tellTask(id, NUDGE, "resume");
      note("stall", err ? `rung 1: could not nudge ${id}: ${err}` : `rung 1: nudged ${id}: ${what}`, id);
    } else if (rung === 2) {
      const err = world.stopTask(id) ?? world.tellTask(id, RESTART, "resume");
      note("stall", err ? `rung 2: could not restart ${id}: ${err}` : `rung 2: restarted ${id}: ${what}`, id);
    } else if (rung === 3) {
      addItem(
        {
          kind: "stuck",
          task: id,
          project: a.project,
          question: `${id} is stuck (${what}) after a nudge and a restart.`,
          choices: ["Ok"],
          since: world.now().toISOString(),
        },
        env,
      );
      note("stall", `rung 3: asked you about ${id} in the Inbox: ${what}`, id);
    }
  }
}

/** Marks the accounts that ran out and brings back those whose reset passed. Nobody is told: it shows on Usage. */
export function serviceAccounts(a: Args): void {
  const { settings, world, state } = a;
  const now = world.now();
  state.stallSince ??= now.getTime();
  const worker = settings.models.worker;
  const p: Pass = {
    a,
    waiting: new Set(a.waits.map((w) => w.task)),
    now,
    stepOf: (t) => stepOfTask(a.steps, t, state.taskSteps ?? {}),
    currentModel: (s) => state.models[s.id] ?? worker[0] ?? "",
  };
  markFullAccounts(p);
  restoreAccounts(a);
  markLimitedReviewers(a);
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
  return pickReviewer(worker, [...list, ...settings.models.worker], offered, (m) => availability(m, env, now) !== "out");
}
