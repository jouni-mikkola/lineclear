import { zonedInstant } from "./zone.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { join } from "node:path";
import { addItem, type InboxKind, type Item, readItems, stepRule } from "./inbox.ts";
import { chatFiles, findSpace, lineclearDir, spaceTasks } from "./measure.ts";
import { projectsDir } from "./project.ts";
import { loadableTotps, secretNames, storedLogin, totpAdvice, totpAnswers } from "./secrets.ts";
import { writeWait } from "./waits.ts";
import { IDLE_NUDGE, PROMISE_NUDGE, promisesNext } from "../pi/nudge.ts";
import { type AskKind, askKind, askKinds, type Card, IDLE_TEXT, isIdle, lineOf, questionIn, replyText } from "./cards.ts";
import { HOUR_MS } from "./time.ts";

const title = (c: Card) => c.ask?.questions?.[0]?.title ?? "";

/** Where a kind goes: a rule answers it, or it becomes this kind of Inbox item. A login a rule cannot answer (no stored login) is the Inbox's. */
const askRoute: Record<AskKind, InboxKind | "rule"> = {
  allowance: "rule",
  "merge-chat": "rule",
  login: "login",
  permission: "outward",
  plan: "rule",
  question: "rule",
  report: "step",
};

/** What the owner is asked: a login code or captcha, money beyond the budget, something that leaves the machine. */
const ownerMatter = (question: string) =>
  /\b(captcha|verification code|login code|one-time code|2fa|totp|log ?in|sign ?in|password|budget|pay(ing|ment)?|purchase|billing|release|publish|deploy|send (a|the) (message|email|mail)|message to|post (it |this )?(to|on))\b/i.test(
    question,
  );

/** The answer to an ordinary question an agent ended its turn with. */
const DECIDE_TEXT =
  "Decide yourself by the brief: the owner is not asked this. Take the safer choice, list the decision in your facts, and carry on. Only a login code, money beyond the budget, or something that leaves the machine goes to the owner.";

/** Its last message says the work is finished. */
export const saysDone = (reply: string) =>
  !promisesNext(reply) &&
  !/\b(not|n't|never|yet|still|but|however)\b/i.test(reply.split(/(?<=[.!?])\s+/).at(-1) ?? "") &&
  /\b(done|finished|complete[d]?|released|merged|nothing (more )?to (change|merge|do)|no changes?( needed)?)\b/i.test(reply);

/** Nudges one task gets in an hour; its next quiet turn after that is left alone. */
const NUDGES_PER_HOUR = 3;
/** Nudges a task in Merging gets in an hour. */
const MERGE_NUDGES = 1;

/** The nudge for a quiet turn in Merging: a merge left running holds every merge behind it in the lane. */
const mergeNudge = (task: string) =>
  `Your turn ended while your merge is still in progress, and it holds every merge behind it. Run \`lineclear merge ${task}\` again, in the foreground, and wait for its answer until the task is through.`;

/** What the rule loop can do about an idle task: whether its worktree has no changes, and closing it as Done. */
export interface IdleHooks {
  clean(task: string): boolean;
  close(task: string): string | undefined;
}

type Posted = { at: number; card: Card };

/** The slice of Lineclear's chat log file these rules read. */
interface ChatLog {
  posted?: { at?: number; question?: { id?: string; title?: string; kind?: string; sent?: number; choices?: { label?: string }[] } }[];
  answers?: Record<string, number>;
}

/** Every need card, once per card id. */
function allNeedCards(files: any[]): Posted[] {
  const need = new Map<string, Posted>();
  for (const f of files) {
    for (const p of f.posted ?? []) {
      if (p?.card?.status === "need" && typeof p.at === "number") need.set(String(p.card.id ?? p.id), { at: p.at, card: p.card });
    }
  }
  return [...need.values()].sort((a, b) => a.at - b.at);
}

/** The need cards still open: none whose task posted anything after it. */
export function openNeedCards(files: any[]): Posted[] {
  const latest = new Map<string, number>();
  for (const f of files) {
    for (const p of f.posted ?? []) {
      if (typeof p?.at === "number" && p?.card?.task) latest.set(p.card.task, Math.max(latest.get(p.card.task) ?? 0, p.at));
    }
  }
  return allNeedCards(files).filter((n) => n.card.task === undefined || (latest.get(n.card.task) ?? 0) <= n.at);
}

/** A coordinator chat's choice card that names a task and waits: its task is named in the question. */
interface CoordinatorCard extends Card {
  id: string;
  task: string;
}

/** The coordinator chat's files of a space: the logs of the chat Lineclear names for the place, not a task's own chat. */
function coordinatorLogs(dir: string, space: { name: string }): ChatLog[] {
  const log = join(dir, "chatlog");
  if (!existsSync(log)) return [];
  return readdirSync(log)
    .filter((f) => f.startsWith("p_") && f.endsWith(`_${space.name}.json`))
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(log, f), "utf8")) as ChatLog];
      } catch {
        return [];
      }
    });
}

/** The choice cards of a space's coordinator chat that name one of its tasks and wait for an answer. */
function coordinatorCards(files: ChatLog[], taskIds: string[]): CoordinatorCard[] {
  const out: (CoordinatorCard & { at: number })[] = [];
  for (const f of files) {
    for (const p of f.posted ?? []) {
      const q = p.question;
      if (typeof q?.id !== "string" || !q.id.startsWith("ask:") || q.sent !== undefined || f.answers?.[q.id] !== undefined) continue;
      const text = String(q.title ?? "");
      const task = taskIds.find((id) => new RegExp(`(^|[^A-Za-z0-9-])${id}($|[^A-Za-z0-9-])`).test(text));
      if (task === undefined || typeof p.at !== "number") continue;
      const choices = (q.choices ?? []).flatMap((c) => (typeof c?.label === "string" ? [c.label] : []));
      out.push({ at: p.at, id: q.id, task, status: "need", text, ask: { questions: [{ title: text, kind: q.kind }], choices } });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A report whose task has since posted a done card: nothing is left to answer, so a rule closes it. */
export function closedReports(files: any[]): Posted[] {
  const doneAt = new Map<string, number>();
  for (const f of files) {
    for (const p of f.posted ?? []) {
      if (p?.card?.status === "done" && p.card.task && typeof p.at === "number") doneAt.set(p.card.task, Math.min(doneAt.get(p.card.task) ?? Infinity, p.at));
    }
  }
  return allNeedCards(files).filter((n) => askKind(n.card) === "report" && n.card.task !== undefined && (doneAt.get(n.card.task) ?? -Infinity) >= n.at);
}

export function countKinds(cards: Posted[]): Record<AskKind, number> {
  const counts = Object.fromEntries(askKinds.map((k) => [k, 0])) as Record<AskKind, number>;
  for (const c of cards) counts[askKind(c.card)]++;
  return counts;
}

/**
 * When an allowance runs out: the first "8pm", "8:30 PM" or "8:00:00 PM" after `now`, in the zone the text names
 * in brackets, else this machine's. Undefined when the text names no time.
 */
export function allowanceReset(text: string, now: Date): Date | undefined {
  const m = /(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)(?:\s*\(([A-Za-z_]+\/[A-Za-z_/+-]+)\))?/i.exec(text);
  if (m === null) return undefined;
  const hour = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0);
  const minute = Number(m[2] ?? 0);
  if (Number(m[1]) > 12 || Number(m[1]) < 1 || minute > 59) return undefined;
  const zone = m[4];
  if (zone === undefined) {
    const at = new Date(now);
    at.setHours(hour, minute, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    return at;
  }
  try {
    const onDay = (plus: number) => {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(
        new Date(now.getTime() + plus * 86_400_000),
      );
      const n = (t: string) => Number(p.find((x) => x.type === t)!.value);
      return zonedInstant(zone, n("year"), n("month") - 1, n("day"), hour, minute);
    };
    const today = onDay(0);
    return today > now ? today : onDay(1);
  } catch {
    return undefined;
  }
}

export type Action = { kind: "wait"; until: Date; reason: string } | { kind: "tell"; text: string };

/** The rule for a card, or undefined when it goes to the Inbox. */
export function ruleFor(card: Card, project: string, now: Date, env = process.env): Action | undefined {
  switch (askKind(card)) {
    case "allowance": {
      const until = allowanceReset(`${card.text ?? ""} ${replyText(card)}`, now);
      return until && { kind: "wait", until, reason: "out of allowance" };
    }
    case "merge-chat":
      return { kind: "tell", text: "A new message waits in your chat. Read it, handle it, then run `lineclear merge` again." };
    case "plan":
      return { kind: "tell", text: "Your plan needs no approval. Go on with it, and list your decisions in your facts." };
    case "question":
      return { kind: "tell", text: `The owner is not asked a step question. ${stepRule(title(card))}` };
    case "login": {
      const names = secretNames(project, env);
      const name = storedLogin(title(card), names);
      if (name === undefined) {
        const stored = totpAnswers(title(card), loadableTotps(project, env));
        return stored.length > 0 ? { kind: "tell", text: totpAdvice(stored) } : undefined;
      }
      const code = loadableTotps(project, env).includes(name)
        ? `If the site asks for a code, \`lineclear totp ${name}\` prints it; pick the code option over a push. A captcha goes to the Inbox.`
        : "If the site then asks for a code or a captcha, ask in the Inbox.";
      return {
        kind: "tell",
        text: `A stored login ${name} exists for this project. Load it with \`lineclear secrets env\` (it gives ${name}_USER and ${name}_PASSWORD), use it without printing it, and go on. ${code}`,
      };
    }
  }
  return undefined;
}

const routedPath = (project: string, env = process.env) => join(projectsDir(env), project, "asks-routed.json");

function readRouted(project: string, env = process.env): string[] {
  try {
    return JSON.parse(readFileSync(routedPath(project, env), "utf8"));
  } catch {
    return [];
  }
}

/** Closes a card of a space's coordinator chat with an answer. Returns an error text, or undefined. */
export type CardCloser = (space: string, id: string, answer: string) => string | undefined;

/** The task's brief keeps its merge for the owner: its Settings say "ask me first". */
const keepsMerge = (desc: unknown) => /^- Merge: ask me first/m.test(String(desc ?? ""));

/** The card asks for a go to merge ("Merge T-3?", "Approve T-3's merge?"), not why a merge has not happened. */
const asksToMerge = (question: string) => /\bmerge\b/i.test(question) && !/\b(why|how come|what|not|never|stuck|fail(ed|s)?|refus\w*|n't)\b/i.test(question);

/** Puts a card no rule answers in the Inbox, as the kind its ask falls in. */
function toInbox(card: CoordinatorCard, project: string, space: string, now: Date, env: NodeJS.ProcessEnv): string {
  const route = askRoute[askKind(card)];
  const choices = card.ask?.choices ?? [];
  addItem(
    {
      kind: route === "rule" ? (ownerMatter(title(card)) ? "outward" : "step") : route,
      task: card.task,
      project,
      question: title(card),
      choices: choices.length ? choices : ["Ok"],
      card: { space, id: card.id },
      since: now.toISOString(),
    },
    env,
  );
  return `${card.task}'s coordinator card is in the Inbox: ${title(card)}`;
}

/** Tells the task and closes the card with the same words. The task is told once, whatever the close does. */
function answerByRule(
  card: CoordinatorCard,
  text: string,
  space: string,
  done: Set<string>,
  tell: (task: string, text: string) => string | undefined,
  close: CardCloser,
): string | undefined {
  const told = `told:${card.id}`;
  const err = done.has(told) ? undefined : tell(card.task, text);
  if (err) return err;
  done.add(told);
  return close(space, card.id, text);
}

/**
 * The cards a task asks in its space's coordinator chat go the same way as in its own chat: a rule answers and the
 * card closes with that answer, else the card is an Inbox item the same tick. A merge the task keeps for the owner
 * has no rule.
 */
function routeCoordinator(
  project: string,
  space: { name: string; key: string },
  done: Set<string>,
  tell: (task: string, text: string) => string | undefined,
  close: CardCloser,
  now: Date,
  dryRun: boolean,
  env: NodeJS.ProcessEnv,
  out: string[],
): void {
  const tasks = spaceTasks(lineclearDir(env), space);
  for (const card of coordinatorCards(
    coordinatorLogs(lineclearDir(env), space),
    tasks.map((t) => String(t.id)),
  )) {
    const task = tasks.find((t) => t.id === card.task);
    if (done.has(card.id) || task === undefined) continue;
    const keptByOwner = ownerMatter(title(card)) || (asksToMerge(title(card)) && keepsMerge(task.desc));
    const action = keptByOwner ? undefined : ruleFor(card, project, now, env);
    if (action?.kind === "wait") continue;
    if (dryRun) {
      out.push(`would ${action ? "answer" : "put in the Inbox"} ${card.task}'s coordinator card: ${title(card)}`);
      continue;
    }
    const err = action && answerByRule(card, action.text, space.name, done, tell, close);
    out.push(
      err
        ? `could not answer ${card.task}: ${err}`
        : action
          ? `${card.task}'s coordinator card was answered by a rule (${askKind(card)})`
          : toInbox(card, project, space.name, now, env),
    );
    if (!err) done.add(card.id);
  }
}

/** What answering a task's cards needs: the way to tell a task, the ids already answered, the time and where to report. */
interface Round {
  tell: (task: string, text: string) => string | undefined;
  done: Set<string>;
  now: Date;
  dryRun: boolean;
  out: string[];
}

/** A finished task with nothing to merge goes to Done; true when this card was dealt with. */
function closeFinished(task: string, id: string, idle: IdleHooks, r: Round): boolean {
  if (!idle.clean(task)) return false;
  if (r.dryRun) r.out.push(`would close ${task}: its agent is done and its worktree has no changes`);
  else {
    const err = idle.close(task);
    r.out.push(err ? `could not close ${task}: ${err}` : `${task} is Done, nothing to merge: its agent finished with no changes`);
    if (!err) r.done.add(id);
  }
  return true;
}

/** Answers a quiet turn: Done when the work is finished, else a nudge, until the hour's nudges are spent. */
function answerQuietTurn(card: Card, id: string, inMerge: boolean, idle: IdleHooks, r: Round): void {
  const task = String(card.task);
  const reply = replyText(card);
  if (!inMerge && saysDone(reply) && closeFinished(task, id, idle, r)) return;
  // Merging nudges are kept apart, so a nudge from Work does not spend a merge's
  const prefix = `nudge:${inMerge ? "merge:" : ""}${task}@`;
  const recent = [...r.done].filter((k) => k.startsWith(prefix) && r.now.getTime() - Number(k.split("@")[1]) < HOUR_MS);
  const limit = inMerge ? MERGE_NUDGES : NUDGES_PER_HOUR;
  if (recent.length >= limit) return void r.done.add(id);
  const quiet = inMerge
    ? "its turn ended while its merge was in progress"
    : promisesNext(reply)
      ? "its reply promised its next action and declared no wait"
      : "its turn ended with no question and no wait";
  if (r.dryRun) return void r.out.push(`would nudge ${task}: ${quiet}`);
  const nudge = inMerge ? mergeNudge(task) : promisesNext(reply) ? PROMISE_NUDGE : IDLE_NUDGE;
  const err = r.tell(task, nudge);
  if (err) return void r.out.push(`could not nudge ${task}: ${err}`);
  r.out.push(`${task} was nudged (${recent.length + 1} of ${limit} in an hour): ${quiet} at ${r.now.toISOString()}`);
  r.done.add(`${prefix}${r.now.getTime()}`);
  r.done.add(id);
}

/** Applies the rules to one open need card. */
function routeCard(card: Card, at: number, id: string, inMerge: boolean, project: string, idle: IdleHooks | undefined, env: NodeJS.ProcessEnv, r: Round): void {
  const { tell, done, now, dryRun, out } = r;
  const task = String(card.task);
  // a plain-text question of an ordinary kind is bounced back once, and never reaches the Inbox
  const asked = idle && askKind(card) === "report" && lineOf(card.text ?? "") === IDLE_TEXT ? questionIn(replyText(card)) : undefined;
  if (asked !== undefined && !ownerMatter(replyText(card))) {
    if (dryRun) {
      out.push(`would tell ${task} to decide it: ${asked}`);
      return;
    }
    const err = tell(task, DECIDE_TEXT);
    if (err) {
      out.push(`could not answer ${task}: ${err}`);
      return;
    }
    out.push(`${task} was told to decide itself: ${asked}`);
    done.add(id);
    return;
  }
  if (idle && isIdle(card)) {
    answerQuietTurn(card, id, inMerge, idle, r);
    return;
  }
  // a reset is read against when the card was posted: read later, "resets 1am" would mean the next day's
  const action = ruleFor(card, project, new Date(Math.min(at, now.getTime())), env);
  if (action === undefined) return;
  if (action.kind === "wait" && action.until <= now) {
    // the limit is over already, and Lineclear itself tells the agent to carry on
    done.add(id);
    return;
  }
  if (dryRun) {
    out.push(`would answer ${task} (${askKind(card)}) by a rule`);
    return;
  }
  if (action.kind === "wait") {
    // the rule loop stops the task and wakes it at this time
    writeWait({ task, project, kind: "until", reason: action.reason, since: now.toISOString(), until: action.until.toISOString() }, env);
    out.push(`${task} waits until ${action.until.toISOString()}: ${action.reason}`);
  } else {
    const err = tell(task, action.text);
    if (err) {
      out.push(`could not answer ${task}: ${err}`);
      return;
    }
    out.push(`${task} was told how to go on (${askKind(card)})`);
  }
  done.add(id);
}

/** Applies the rules to the open need cards of a project's space, once per card. Returns what it did. */
export function routeAsks(
  project: string,
  space: string,
  tell: (task: string, text: string) => string | undefined,
  now: Date,
  dryRun: boolean,
  env = process.env,
  idle?: IdleHooks,
  closeCard?: CardCloser,
): string[] {
  const dir = lineclearDir(env);
  const s = findSpace(dir, space, "");
  if (s === undefined) return [];
  const done = new Set(readRouted(project, env));
  const out: string[] = [];
  const round: Round = { tell, done, now, dryRun, out };
  const files = chatFiles(dir, s);
  const merging = new Set(
    spaceTasks(dir, s)
      .filter((t) => t.status === "merging")
      .map((t) => String(t.id)),
  );
  for (const { card } of closedReports(files)) {
    const id = String(card.id ?? "");
    if (!id || done.has(id)) continue;
    out.push(`${dryRun ? "would close" : "closed"} the report of ${card.task}: its task is done`);
    if (!dryRun) done.add(id);
  }
  for (const { at, card } of openNeedCards(files)) {
    const id = String(card.id ?? "");
    if (!id || !card.task || done.has(id)) continue;
    routeCard(card, at, id, merging.has(card.task), project, idle, env, round);
  }
  if (closeCard) routeCoordinator(project, s, done, tell, closeCard, now, dryRun, env, out);
  for (const k of done) if (k.startsWith("nudge:") && now.getTime() - Number(k.split("@")[1]) >= HOUR_MS) done.delete(k);
  if (!dryRun && done.size > 0) {
    mkdirSync(join(projectsDir(env), project), { recursive: true });
    writeAtomic(routedPath(project, env), `${JSON.stringify([...done], null, 2)}\n`);
  }
  return out;
}

/** One ask: a need card of a chat, or an Inbox item that no card stands for. */
interface AskLine {
  at: number;
  task: string;
  kind: string;
  question: string;
  /** What should have answered it: a rule, or the Inbox kind it is. */
  answer: string;
}

const RULE_ANSWER = "a rule answers it";
/** The number of the rule that answers a kind. */
const ruleNumber: Partial<Record<AskKind, number>> = { allowance: 1, "merge-chat": 2, plan: 6, question: 5 };
const answerOf = (kind: AskKind) => (askRoute[kind] === "rule" ? `rule ${ruleNumber[kind]}` : `Inbox: ${askRoute[kind]}`);

/** Every ask since `since`: the need cards of the chat files (reports are not asks), and each Inbox item that is not also one of those cards. */
function askLines(files: any[], items: Item[], since: number): AskLine[] {
  const cards = allNeedCards(files).filter((n) => n.at >= since && askKind(n.card) !== "report");
  const same = new Set(allNeedCards(files).map((n) => `${n.card.task}\0${title(n.card)}`));
  const fromCards = cards.map(({ at, card }) => {
    const kind = askKind(card);
    return { at, task: card.task ?? "", kind, question: title(card), answer: answerOf(kind) };
  });
  const fromInbox = items
    .filter((i) => !same.has(`${i.task}\0${i.question}`) && Date.parse(i.since) >= since)
    .map((i) => ({ at: Date.parse(i.since), task: i.task, kind: `inbox ${i.kind}`, question: i.question, answer: `Inbox: ${i.kind}` }));
  return [...fromCards, ...fromInbox].sort((a, b) => a.at - b.at);
}

/** The chat files of every board, live and archived. */
function allChatFiles(env: NodeJS.ProcessEnv): any[] {
  const dir = lineclearDir(env);
  return [join(dir, "chatlog"), join(dir, "archive", "chatlog")]
    .filter((log) => existsSync(log))
    .flatMap((log) =>
      readdirSync(log)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          try {
            return JSON.parse(readFileSync(join(log, f), "utf8"));
          } catch {
            return {};
          }
        }),
    );
}

/** `lineclear asks [--days N]`: counts the asks of the last days by kind, then lists each with the kind and what should have answered it. */
export function asksMain(args: string[], out: (l: string) => void, env = process.env, now = new Date()): number {
  let days = 7;
  if (args.length === 2 && args[0] === "--days" && /^[1-9]\d*$/.test(args[1]!)) days = Number(args[1]);
  else if (args.length > 0) return (out("usage: lineclear asks [--days N]"), 2);
  const files = allChatFiles(env);
  const since = now.getTime() - days * 86_400_000;
  const cards = allNeedCards(files).filter((n) => n.at >= since);
  const counts = countKinds(cards);
  const asks = askLines(files, readItems(env), since);
  out(`Asks in the last ${days} days: ${asks.length}`);
  for (const k of askKinds.filter((k) => k !== "report"))
    out(`${String(counts[k]).padStart(4)}  ${k.padEnd(11)}${askRoute[k] === "rule" ? RULE_ANSWER : `Inbox: ${askRoute[k]}`}`);
  const inboxOnly = asks.filter((a) => a.kind.startsWith("inbox ")).length;
  if (inboxOnly > 0) out(`${String(inboxOnly).padStart(4)}  ${"inbox".padEnd(11)}items with no card`);
  out(`Reports, not asks: ${counts.report} (${closedReports(files).filter((n) => n.at >= since).length} closed, their task is done)`);
  for (const a of asks) out(`${new Date(a.at).toISOString().slice(0, 16).replace("T", " ")}  ${a.task}  ${a.kind}  ${a.answer}  ${a.question}`);
  return 0;
}
