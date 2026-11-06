import { pathsFor, serverBin } from "./paths.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createAtomic, writeAtomic } from "../pi/atomic.ts";
import { join } from "node:path";
import { askBefore, readSettings } from "./project.ts";
import type { StepCheck } from "./stepcheck.ts";
import { clearWait, findProject, findTask, readWaits, writeWait } from "./waits.ts";
import { configDir } from "../pi/config.ts";
import { storedLoginAdvice } from "./secrets.ts";
import { git, gitText } from "./git.ts";

/** The five kinds of item the Inbox holds. */
const inboxKinds = ["plan", "step", "login", "outward", "stuck", "release"] as const;
export type InboxKind = (typeof inboxKinds)[number];

export const KIND_LABEL: Record<InboxKind, string> = {
  plan: "plan to approve",
  step: "step waits for you",
  login: "login or code",
  outward: "outward action",
  stuck: "task stuck",
  release: "build to read",
};

export interface Item {
  n: number;
  kind: InboxKind;
  task: string;
  project?: string;
  question: string;
  choices: string[];
  /** For a login or a code: the task's live playwright-cli browser session, to take over. */
  session?: string;
  /** For a question asked in a space's coordinator chat: its card, answered with the item. */
  card?: { space: string; id: string };
  /** For a plan: the roadmap diff to approve, and which try this is (1, or 2 after a rejection). */
  diff?: string;
  round?: number;
  /** For a plan: the commit the owner saw. Approving merges only that. */
  head?: string;
  /** For a plan change from the Dispatcher: one step gets a new `after`. */
  move?: { step: string; after: string[] };
  since: string;
  /** The title the phone shows for this item, when "Inbox 3: step waits for you" is not it. */
  alert?: string;
  answer?: string;
  /** The owner's note with a rejection. */
  note?: string;
  answeredAt?: string;
  /** Why the Inbox closed the item with no answer: its task is over, or the owner wrote to the task. */
  closed?: string;
  closedAt?: string;
  /** A change that applied by itself under the rules: main before and after it, and when the owner undid it. */
  auto?: boolean;
  base?: string;
  commit?: string;
  /** The main commits of this change alone, when other merges landed between base and commit. */
  commits?: string[];
  undone?: string;
  /** For a plan that waits from before its project let plans apply by themselves: the commit the rules refused. */
  tried?: string;
  /** For a release item: the version and the one tap it offers, to roll the build back or to promote it. */
  release?: { version: string; action: "rollback" | "promote" };
  /** For an owner-only step: its id. The owner answers Done with the result as the note. */
  ownerStep?: string;
  /** For a plan: the go answers of the fresh model that read each new or changed step. */
  checks?: StepCheck[];
}

/** The step, the model and its words for each go of a plan's step check. A no-go is for the planner only. */
export type GoChecks = { step: string; model: string; said: string }[];

/** What a plan adds to its Inbox card: the answer that needs a reason (rejecting the first try) and the go lines of its step check. */
export function cardExtras(i: Item): { needsNote?: string; stepChecks?: GoChecks } {
  if (i.ownerStep !== undefined) return { needsNote: "Done" };
  if (i.kind !== "plan") return {};
  const go = (i.checks ?? []).filter((c) => c.go);
  return {
    ...(!i.move && (i.round ?? 1) < 2 && i.choices.includes("Reject") ? { needsNote: "Reject" } : {}),
    ...(go.length ? { stepChecks: go.map(({ step, model, said }) => ({ step, model, said })) } : {}),
  };
}

/** An item still waiting for the owner. */
export const isOpen = (i: Item) => i.answer === undefined && i.closed === undefined;

const inboxDir = (env = process.env) => join(configDir(env), "inbox");
export const itemPath = (n: number, env = process.env) => join(inboxDir(env), `${n}.json`);
const writeItem = (item: Item, env = process.env) => writeAtomic(itemPath(item.n, env), `${JSON.stringify(item, null, 2)}\n`);
export const waitReason = (task: string, env = process.env) => readWaits(env).find((w) => w.task === task)?.reason;
export const lineclear = serverBin;

/** A project's open asks, newest first, each with the title of the step its task works on (the Roadmap lists them). */
export function projectDecisions(project: string, steps: { title: string; task?: { id?: string } }[], env = process.env) {
  return readItems(env)
    .filter((i) => isOpen(i) && (i.project === project || steps.some((s) => s.task?.id === i.task)))
    .reverse()
    .map((i) => {
      const step = steps.find((s) => s.task?.id === i.task);
      return { n: i.n, question: i.question, ...(step ? { step: step.title } : {}) };
    });
}

export function readItems(env = process.env): Item[] {
  if (!existsSync(inboxDir(env))) return [];
  const items: Item[] = [];
  for (const f of readdirSync(inboxDir(env))) {
    if (!f.endsWith(".json")) continue;
    try {
      items.push(JSON.parse(readFileSync(join(inboxDir(env), f), "utf8")) as Item);
    } catch {
      // a half-written file is read again next time
    }
  }
  return items.sort((a, b) => a.n - b.n);
}

/** Adds an item under the next free number. The numbers never repeat, answered items stay. */
export function addItem(item: Omit<Item, "n">, env = process.env): Item {
  mkdirSync(inboxDir(env), { recursive: true });
  for (let n = Math.max(0, ...readItems(env).map((i) => i.n)) + 1; ; n++) {
    try {
      const full = { n, ...item };
      createAtomic(itemPath(n, env), `${JSON.stringify(full, null, 2)}\n`);
      return full;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}

/** A space on a timer the rules do not allow shows in the Inbox once; heal never changes a mode itself. */
export function noticeTimers(spaces: string[], env = process.env): void {
  const question = `Coordinator timer is on for ${spaces.join(", ")}, but Lineclear runs no coordinator on a timer. Nothing was changed. Turn it off with lineclear mode <space> regular.`;
  const open = readItems(env).filter((i) => isOpen(i) && i.question.startsWith("Coordinator timer is on for "));
  if (open.some((i) => i.question === question)) return;
  for (const old of open) closeItem(old, "the spaces on a timer changed", new Date(), env);
  addItem({ kind: "stuck", task: "-", question, choices: ["Ok"], alert: "Coordinator timer is on", since: new Date().toISOString() }, env);
}

/** Answers a card of a space's coordinator chat in words, which closes it. Returns an error text, or undefined. */
export function answerCard(card: NonNullable<Item["card"]>, answer: string, env = process.env): string | undefined {
  const r = Bun.spawnSync([lineclear(env), "answer", card.id, answer, "--space", card.space], { stdin: "ignore" });
  return r.exitCode === 0 ? undefined : (r.stderr.toString() || r.stdout.toString()).trim() || `exit ${r.exitCode}`;
}

/** Closes an item with a reason and no answer. The wait it declared and the coordinator card it stands for go with it. */
export function closeItem(item: Item, reason: string, now: Date, env = process.env): void {
  writeItem({ ...item, closed: reason, closedAt: now.toISOString() }, env);
  if (item.card) answerCard(item.card, `Closed: ${reason}.`, env);
  if (waitReason(item.task, env) === `asked: ${item.question}`) clearWait(item.task, env);
}

/** The commit a rolled-back update notice names ("The update to 8946737 failed: ..."), or undefined for any other item. */
const failedUpdateCommit = (i: Item) => (i.kind === "stuck" && i.task === "-" ? /^The update to ([0-9a-f]{7,40}) failed:/.exec(i.question)?.[1] : undefined);

/**
 * Whether the app runs `commit` or a newer version. An install fetches one commit with no history, so the commit is
 * often not behind HEAD to see: a HEAD committed after the notice was made is newer as well.
 */
function runsOrPast(app: string, commit: string, since: string): boolean {
  const head = gitText(app, "rev-parse", "HEAD") ?? "";
  if (head.startsWith(commit) || git(app, "merge-base", "--is-ancestor", commit, "HEAD").ok) return true;
  const committed = Number(gitText(app, "log", "-1", "--format=%ct", "HEAD")) * 1000;
  return committed > Date.parse(since);
}

/**
 * Closes the notices of an update that failed, once this machine runs that commit or a newer one: the notice is
 * about a version that is no longer in the way. Returns one reason per closed item.
 */
export function closeSettledUpdates(now: Date, env = process.env): string[] {
  const app = pathsFor(env).app;
  const reasons: string[] = [];
  for (const item of readItems(env)) {
    const commit = isOpen(item) ? failedUpdateCommit(item) : undefined;
    if (commit === undefined || !runsOrPast(app, commit, item.since)) continue;
    const reason = `this machine runs ${commit} or a newer version`;
    closeItem(item, reason, now, env);
    reasons.push(`closed inbox item ${item.n}: ${reason}`);
  }
  return reasons;
}

export function usage(name: string): string {
  return name === "ask"
    ? `usage: lineclear ask "<question>" --choice <a> --choice <b> [--choice <c> ...] --kind ${askableKinds.join("|")} [--login <NAME of the login, for a login>] [--about release|spending] [--session <browser session>]`
    : "usage: lineclear inbox [--all] | lineclear inbox answer <n> <choice> [--note <text>] | lineclear inbox undo <n>";
}

/** The kinds an agent may ask the owner. Plans, step questions and stuck tasks never wait for the owner. */
export const askableKinds = ["login", "outward"] as const;

/** The written rule for a step question, or the Dispatcher's way when no rule fits. An agent decides and goes on. */
export function stepRule(question: string): string {
  if (/merge (now|or wait)|wait (to|for) merge/i.test(question)) return "Merge now when your check and your review passed. Wait only for a wait you declared.";
  if (/reviewer/i.test(question))
    return "The rules pick the reviewer: the first model of another company than yours, from the project's list. Use the one the brief names.";
  if (/flak|intermittent/i.test(question))
    return "Run the test once more. If it passes, go on and note it in your facts. If it fails again it is a real failure: fix it.";
  return "Decide it from your brief and the roadmap, take the safer choice, and list the decision in your facts.";
}

/** An action on this machine alone (a power cut, a reboot, a recording): it sends nothing out, so it is not an outward ask. */
const staysOnMachine = (question: string) =>
  /\b(power cuts?|reboot|restart (this|the) machine|unplug|record(ing)? the boot)\b/i.test(question) &&
  !/\b(release|publish|deploy|send|message|email|post|pay|budget|login|captcha)\b/i.test(question);

interface ParsedAsk {
  question: string;
  choices: string[];
  kind: InboxKind | undefined;
  about: "release" | "spending" | undefined;
  session: string | undefined;
  login: string | undefined;
}

/** Takes one flag with its value into `found`; false when the flag or its value is not one `lineclear ask` knows. */
function askFlag(flag: string, value: string, found: Omit<ParsedAsk, "question" | "choices">): boolean {
  if (flag === "--kind" && (inboxKinds as readonly string[]).includes(value)) found.kind = value as InboxKind;
  else if (flag === "--about" && (value === "release" || value === "spending")) found.about = value;
  else if (flag === "--login" && /^[A-Za-z0-9_]+$/.test(value)) found.login = value.toUpperCase().replace(/_TOTP$/, "");
  else if (flag === "--session" && value.trim()) found.session = value.trim();
  else return false;
  return true;
}

/** The words of `lineclear ask`, or undefined when they do not make a question with two choices. */
function parseAsk(args: string[]): ParsedAsk | undefined {
  let question: string | undefined;
  const choices: string[] = [];
  const found: Omit<ParsedAsk, "question" | "choices"> = { kind: undefined, about: undefined, session: undefined, login: undefined };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!flag.startsWith("--")) {
      if (question !== undefined) return undefined;
      question = flag;
      continue;
    }
    const value = args[++i];
    if (value === undefined) return undefined;
    if (flag === "--choice") choices.push(value);
    else if (!askFlag(flag, value, found)) return undefined;
  }
  const { kind, about, session, login } = found;
  if (!question?.trim() || choices.length < 2) return undefined;
  return { question, choices, kind, about, session, login };
}

/** Records an outward ask the owner pre-approved in Settings, and says whether it did. Only a call that says what it is can be pre-approved. */
function preApproved(
  ask: { project: string; task: string; question: string; choices: string[]; about: ParsedAsk["about"]; now: () => Date },
  env: NodeJS.ProcessEnv,
): boolean {
  const s = readSettings(ask.project, env);
  const key = ask.about === "spending" ? "spending" : "releases";
  if (ask.about === undefined || typeof s !== "object" || askBefore(s)[key]) return false;
  addItem(
    {
      kind: "outward",
      task: ask.task,
      project: ask.project,
      question: ask.question.trim(),
      choices: ask.choices,
      since: ask.now().toISOString(),
      answer: ask.choices[0]!,
      answeredAt: ask.now().toISOString(),
      auto: true,
    },
    env,
  );
  return true;
}

/** `lineclear ask`: puts a question in the Inbox and declares an owner wait. The phone hears of the new item from the web server (`src/notify.ts`). */
export function askMain(args: string[], out: (l: string) => void, env = process.env, cwd = process.cwd(), now: () => Date = () => new Date()): number {
  const fail = (message: string, code = 1) => {
    out(`lineclear ask: ${message}`);
    return code;
  };
  const parsed = parseAsk(args);
  if (parsed === undefined) return (out(usage("ask")), 2);
  const { question, choices, kind, about, login } = parsed;
  let { session } = parsed;
  if (kind === undefined || !(askableKinds as readonly string[]).includes(kind)) {
    out(`lineclear ask: the owner is not asked this. ${stepRule(question)}`);
    out(
      "Only a login code or captcha with no stored TOTP, money beyond the budget, and what leaves the machine for the public go to the owner (--kind login, --kind outward).",
    );
    return 1;
  }
  if (kind === "outward" && staysOnMachine(question)) {
    out("lineclear ask: this sends nothing off the machine, so it is not an outward ask and the owner is not asked.");
    out("Do it yourself if you can. If only a person can (a real power cut), file it as a task with the time it needs and carry on without waiting.");
    return 1;
  }
  const task = findTask(cwd, env);
  if (task === undefined) return fail("cannot tell which task this is, run it inside a task's worktree");
  const project = findProject(cwd, env);
  if (kind === "login") {
    const stored = storedLoginAdvice(question, project, env, login);
    if (stored !== undefined) return fail(stored);
    if (login === undefined) return fail("a login ask names the login whose NAME_TOTP is missing: add --login <NAME>", 2);
  }
  if (kind === "outward" && project !== undefined && preApproved({ project, task, question, choices, about, now }, env)) {
    out(`pre-approved by ${project}'s settings (ask me before ${about === "spending" ? "spending" : "releases"} is off): ${choices[0]}. Go on.`);
    return 0;
  }
  // The agent's browser session is named after its task.
  if (kind === "login") session ??= task;
  const since = now().toISOString();
  const item = addItem(
    {
      kind,
      task,
      project,
      question: kind === "login" ? `${login}_TOTP is not stored. ${question.trim()}` : question.trim(),
      choices,
      ...(session ? { session } : {}),
      since,
    },
    env,
  );
  writeWait(
    {
      task,
      project,
      kind: kind === "login" ? "login" : "owner",
      ...(kind === "outward" ? { ownerKind: about === "spending" ? "money" : "outward" } : {}),
      reason: `asked: ${item.question}`,
      since,
    },
    env,
  );
  out(`inbox ${item.n}: ${item.question}. End your turn; the answer comes as a message.`);
  return 0;
}
