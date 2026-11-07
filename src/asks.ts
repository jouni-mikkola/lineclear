import { allowanceReset } from "./zone.ts";
import { mkdirSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { readChatLogs } from "./chat-kept.ts";
import { readJsonKept } from "./kept-read.ts";
import { join } from "node:path";
import { addItem, type InboxKind, stepRule } from "./inbox.ts";
import { findSpace, lineclearDir, spaceTasks } from "./measure.ts";
import { projectsDir, toldPath } from "./project.ts";
import { loadableTotps, secretNames, storedLogin, totpAdvice, totpAnswers } from "../server/server/live/secrets.ts";
import { readWaits, waitsForOwner, writeWait } from "./waits.ts";
import { DECIDE_TEXT, IDLE_NUDGE, mergeNudge, PROMISE_NUDGE, promisesNext } from "../pi/nudge.ts";
import { type AskKind, askKind, type Card, IDLE_TEXT, isIdle, lineOf, questionIn, replyText } from "./cards.ts";
import { HOUR_MS } from "./time.ts";

const title = (c: Card) => c.ask?.questions?.[0]?.title ?? "";

/** Where a kind goes when no rule answers it: this kind of Inbox item. A login without a stored login is the Inbox's. */
const askRoute: Partial<Record<AskKind, InboxKind>> = { login: "login", permission: "outward", report: "step" };

/** What the owner is asked: a login code or captcha, money beyond the budget, something that leaves the machine. */
const ownerMatter = (question: string) =>
  /\b(captcha|verification code|login code|one-time code|2fa|totp|log ?in|sign ?in|password|budget|pay(ing|ment)?|purchase|billing|release|publish|deploy|send (a|the) (message|email|mail)|message to|post (it |this )?(to|on))\b/i.test(
    question,
  );

/** Its last message says the work is finished. */
export const saysDone = (reply: string) =>
  !promisesNext(reply) &&
  !/\b(not|n't|never|yet|still|but|however)\b/i.test(reply.split(/(?<=[.!?])\s+/).at(-1) ?? "") &&
  /\b(done|finished|complete[d]?|released|merged|nothing (more )?to (change|merge|do)|no changes?( needed)?)\b/i.test(reply);

/** Nudges one task gets in an hour, and one in Merging (a merge left running holds every merge behind it in the lane). */
const NUDGES_PER_HOUR = 3;
const MERGE_NUDGES = 1;

/** What the rule loop can do about an idle task: whether its worktree has no changes, and closing it as Done. */
export type IdleHooks = { clean(task: string): boolean; close(task: string): string | undefined };

type Posted = { at: number; card: Card };
type Say = (task: string, text: string) => string | undefined;

const postsOf = (files: any[]): any[] => files.flatMap((f) => f.posted ?? []);

function allNeedCards(files: any[]): Posted[] {
  const need = new Map<string, Posted>();
  for (const p of postsOf(files)) if (p?.card?.status === "need" && typeof p.at === "number") need.set(String(p.card.id ?? p.id), { at: p.at, card: p.card });
  return [...need.values()].sort((a, b) => a.at - b.at);
}

/** The need cards still open: none whose task posted anything after it. */
export function openNeedCards(files: any[]): Posted[] {
  const latest = new Map<string, number>();
  for (const p of postsOf(files)) if (typeof p?.at === "number" && p?.card?.task) latest.set(p.card.task, Math.max(latest.get(p.card.task) ?? 0, p.at));
  return allNeedCards(files).filter((n) => n.card.task === undefined || (latest.get(n.card.task) ?? 0) <= n.at);
}

/** A coordinator chat's choice card that names a task and waits: its task is named in the question. */
type CoordinatorCard = Card & { id: string; task: string };

/** The choice cards of a space's coordinator chat that name one of its tasks and wait for an answer. */
function coordinatorCards(files: any[], taskIds: string[]): CoordinatorCard[] {
  const out: (CoordinatorCard & { at: number })[] = [];
  for (const f of files) {
    for (const p of f.posted ?? []) {
      const q = p.question;
      if (typeof q?.id !== "string" || !q.id.startsWith("ask:") || q.sent !== undefined || f.answers?.[q.id] !== undefined) continue;
      const text = String(q.title ?? "");
      const task = taskIds.find((id) => new RegExp(`(^|[^A-Za-z0-9-])${id}($|[^A-Za-z0-9-])`).test(text));
      if (task === undefined || typeof p.at !== "number") continue;
      const choices = (q.choices ?? []).flatMap((c: any) => (typeof c?.label === "string" ? [c.label] : []));
      out.push({ at: p.at, id: q.id, task, status: "need", text, ask: { questions: [{ title: text, kind: q.kind }], choices } });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** A report whose task has since posted a done card: nothing is left to answer, so a rule closes it. */
export function closedReports(files: any[]): Posted[] {
  const doneAt = new Map<string, number>();
  for (const p of postsOf(files)) {
    if (p?.card?.status === "done" && p.card.task && typeof p.at === "number") doneAt.set(p.card.task, Math.min(doneAt.get(p.card.task) ?? Infinity, p.at));
  }
  return allNeedCards(files).filter((n) => askKind(n.card) === "report" && n.card.task !== undefined && (doneAt.get(n.card.task) ?? -Infinity) >= n.at);
}

export type Action = { kind: "wait"; until: Date; reason: string } | { kind: "tell"; text: string };

/** The rule for a card, or undefined when it goes to the Inbox. */
export function ruleFor(card: Card, project: string, now: Date, env = process.env): Action | undefined {
  const kind = askKind(card);
  const tell = (text: string): Action => ({ kind: "tell", text });
  if (kind === "allowance") {
    const until = allowanceReset(`${card.text ?? ""} ${replyText(card)}`, now);
    return until && { kind: "wait", until, reason: "out of allowance" };
  }
  if (kind === "merge-chat") return tell("A new message waits in your chat. Read it, handle it, then run `lineclear merge` again.");
  if (kind === "plan") return tell("Your plan needs no approval. Go on with it, and list your decisions in your facts.");
  if (kind === "question") return tell(`The owner is not asked a step question. ${stepRule(title(card))}`);
  if (kind !== "login") return undefined;
  const totps = loadableTotps(project, env);
  const name = storedLogin(title(card), secretNames(project, env));
  if (name === undefined) {
    const stored = totpAnswers(title(card), totps);
    return stored.length > 0 ? tell(totpAdvice(stored)) : undefined;
  }
  const code = totps.includes(name)
    ? `If the site asks for a code, \`lineclear totp ${name}\` prints it; pick the code option over a push. A captcha goes to the Inbox.`
    : "If the site then asks for a code or a captcha, ask in the Inbox.";
  return tell(
    `A stored login ${name} exists for this project. Load it with \`lineclear secrets env\` (it gives ${name}_USER and ${name}_PASSWORD), use it without printing it, and go on. ${code}`,
  );
}

/**
 * The chat logs of a space's live tasks (`coordinatorOnly`: just the space's coordinator chat), each parsed again only
 * when its file changed. A retired task's chat is in archive/chatlog and asks nothing, so it is not read.
 */
function liveChats(dir: string, space: { name: string; key: string }, coordinatorOnly = false): any[] {
  const own = (f: string) => (!coordinatorOnly && f.startsWith(`${space.key}-`)) || (f.startsWith("p_") && f.endsWith(`_${space.name}`));
  return readChatLogs(dir)
    .filter((c) => own(c.name))
    .map((c) => c.log);
}

/** The ids of every card the live chats hold: a record of a card that left them has nothing to say any more. */
const cardIds = (files: any[]): Set<string> =>
  new Set(postsOf(files).flatMap((p) => [p?.card?.id, p?.id, p?.question?.id].filter((x): x is string => typeof x === "string")));

/** Closes a card of a space's coordinator chat with an answer. Returns an error text, or undefined. */
export type CardCloser = (space: string, id: string, answer: string) => string | undefined;

/** The card asks for a go to merge ("Merge T-3?", "Approve T-3's merge?"), not why a merge has not happened. */
const asksToMerge = (question: string) => /\bmerge\b/i.test(question) && !/\b(why|how come|what|not|never|stuck|fail(ed|s)?|refus\w*|n't)\b/i.test(question);

/** What answering a task's cards needs: the way to tell a task, the ids already answered, the time and where to report. */
type Round = { tell: Say; done: Set<string>; now: Date; dryRun: boolean; out: string[] };

/** Tells a task, or says it would. True when the task was told. */
function say(r: Round, task: string, text: string, would: string, did: string, verb = "answer"): boolean {
  if (r.dryRun) {
    r.out.push(`would ${would}`);
    return false;
  }
  const err = r.tell(task, text);
  r.out.push(err ? `could not ${verb} ${task}: ${err}` : did);
  return !err;
}

/**
 * The cards a task asks in its space's coordinator chat go the same way as in its own chat: a rule answers and the
 * card closes with that answer, else the card is an Inbox item the same tick. A merge the task keeps for the owner
 * has no rule. The task is told once, whatever the close does.
 */
function routeCoordinator(project: string, space: { name: string; key: string }, r: Round, close: CardCloser, env: NodeJS.ProcessEnv): void {
  const dir = lineclearDir(env);
  const tasks = spaceTasks(dir, space);
  const ids = tasks.map((t) => String(t.id));
  // a task that declared an owner wait (`lineclear ask`, `wait owner`) asked for the owner, whatever the card's words
  const ownerWaits = new Map(
    readWaits(env)
      .filter(waitsForOwner)
      .map((w) => [w.task, w] as const),
  );
  for (const card of coordinatorCards(liveChats(dir, space, true), ids)) {
    const task = tasks.find((t) => t.id === card.task);
    if (r.done.has(card.id) || task === undefined) continue;
    const keptByOwner =
      ownerMatter(title(card)) || ownerWaits.has(card.task) || (asksToMerge(title(card)) && /^- Merge: ask me first/m.test(String(task.desc ?? "")));
    const action = keptByOwner ? undefined : ruleFor(card, project, r.now, env);
    if (action?.kind === "wait") continue;
    if (r.dryRun) {
      r.out.push(`would ${action ? "answer" : "put in the Inbox"} ${card.task}'s coordinator card: ${title(card)}`);
      continue;
    }
    let err: string | undefined;
    if (action) {
      const told = `told:${card.id}`;
      err = r.done.has(told) ? undefined : r.tell(card.task, action.text);
      if (!err) r.done.add(told);
      err ??= close(space.name, card.id, action.text);
    } else {
      const owned = ownerWaits.get(card.task);
      const route = askRoute[askKind(card)] ?? (owned?.ownerKind === "login" || owned?.kind === "login" ? "login" : undefined);
      const choices = card.ask?.choices ?? [];
      addItem(
        {
          kind: route ?? (ownerMatter(title(card)) || ownerWaits.has(card.task) ? "outward" : "step"),
          ...(route === "login" ? { session: card.task } : {}),
          task: card.task,
          project,
          question: title(card),
          choices: choices.length ? choices : ["Ok"],
          card: { space: space.name, id: card.id },
          since: r.now.toISOString(),
        },
        env,
      );
    }
    r.out.push(
      err
        ? `could not answer ${card.task}: ${err}`
        : action
          ? `${card.task}'s coordinator card was answered by a rule (${askKind(card)})`
          : `${card.task}'s coordinator card is in the Inbox: ${title(card)}`,
    );
    if (!err) r.done.add(card.id);
  }
}

/** Answers a quiet turn: Done when the work is finished, else a nudge, until the hour's nudges are spent. */
function answerQuietTurn(card: Card, id: string, inMerge: boolean, idle: IdleHooks, r: Round): void {
  const task = String(card.task);
  const reply = replyText(card);
  // a finished task with nothing to merge goes to Done
  if (!inMerge && saysDone(reply) && idle.clean(task)) {
    const err = r.dryRun ? undefined : idle.close(task);
    r.out.push(
      r.dryRun
        ? `would close ${task}: its agent is done and its worktree has no changes`
        : err
          ? `could not close ${task}: ${err}`
          : `${task} is Done, nothing to merge: its agent finished with no changes`,
    );
    if (!r.dryRun && !err) r.done.add(id);
    return;
  }
  // Merging nudges are kept apart, so a nudge from Work does not spend a merge's
  const prefix = `nudge:${inMerge ? "merge:" : ""}${task}@`;
  const recent = [...r.done].filter((k) => k.startsWith(prefix) && r.now.getTime() - Number(k.split("@")[1]) < HOUR_MS);
  const limit = inMerge ? MERGE_NUDGES : NUDGES_PER_HOUR;
  if (recent.length >= limit) return void r.done.add(id);
  const promised = !inMerge && promisesNext(reply);
  const quiet = inMerge
    ? "its turn ended while its merge was in progress"
    : promised
      ? "its reply promised its next action and declared no wait"
      : "its turn ended with no question and no wait";
  const nudge = inMerge ? mergeNudge(task) : promised ? PROMISE_NUDGE : IDLE_NUDGE;
  const did = `${task} was nudged (${recent.length + 1} of ${limit} in an hour): ${quiet} at ${r.now.toISOString()}`;
  if (!say(r, task, nudge, `nudge ${task}: ${quiet}`, did, "nudge")) return;
  r.done.add(`${prefix}${r.now.getTime()}`);
  r.done.add(id);
}

/** Applies the rules to one open need card. */
function routeCard(card: Card, at: number, id: string, inMerge: boolean, project: string, idle: IdleHooks | undefined, env: NodeJS.ProcessEnv, r: Round): void {
  const task = String(card.task);
  // a plain-text question of an ordinary kind is bounced back once, and never reaches the Inbox
  const asked = idle && askKind(card) === "report" && lineOf(card.text ?? "") === IDLE_TEXT ? questionIn(replyText(card)) : undefined;
  if (asked !== undefined && !ownerMatter(replyText(card))) {
    if (say(r, task, DECIDE_TEXT, `tell ${task} to decide it: ${asked}`, `${task} was told to decide itself: ${asked}`)) r.done.add(id);
    return;
  }
  if (idle && isIdle(card)) return void answerQuietTurn(card, id, inMerge, idle, r);
  // a reset is read against when the card was posted: read later, "resets 1am" would mean the next day's
  const action = ruleFor(card, project, new Date(Math.min(at, r.now.getTime())), env);
  if (action === undefined) return;
  // a limit that is over already needs no wait: Lineclear itself tells the agent to carry on
  if (action.kind === "wait" && action.until <= r.now) return void r.done.add(id);
  if (action.kind === "wait" && !r.dryRun) {
    // the rule loop stops the task and wakes it at this time
    writeWait({ task, project, kind: "until", reason: action.reason, since: r.now.toISOString(), until: action.until.toISOString() }, env);
    r.out.push(`${task} waits until ${action.until.toISOString()}: ${action.reason}`);
  } else if (
    !say(r, task, action.kind === "tell" ? action.text : "", `answer ${task} (${askKind(card)}) by a rule`, `${task} was told how to go on (${askKind(card)})`)
  )
    return;
  r.done.add(id);
}

/** Applies the rules to the open need cards of a project's space, once per card. Returns what it did. */
export function routeAsks(project: string, space: string, tell: Say, now: Date, dryRun: boolean, env = process.env, idle?: IdleHooks, closeCard?: CardCloser) {
  const dir = lineclearDir(env);
  const s = findSpace(dir, space, "");
  if (s === undefined) return [];
  const saved = new Set(readJsonKept<string[]>(toldPath(project, env)) ?? []);
  const round: Round = { tell, done: new Set(saved), now, dryRun, out: [] };
  const { done, out } = round;
  const files = liveChats(dir, s);
  const merging = new Set(spaceTasks(dir, s).flatMap((t) => (t.status === "merging" ? [String(t.id)] : [])));
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
  if (closeCard) routeCoordinator(project, s, round, closeCard, env);
  const live = cardIds([...files, ...liveChats(dir, s, true)]);
  for (const k of done) {
    const stale = k.startsWith("nudge:") ? now.getTime() - Number(k.split("@")[1]) >= HOUR_MS : !live.has(k.replace(/^told:/, ""));
    if (stale) done.delete(k);
  }
  if (!dryRun && (done.size !== saved.size || [...done].some((k) => !saved.has(k)))) {
    mkdirSync(join(projectsDir(env), project), { recursive: true });
    writeAtomic(toldPath(project, env), `${JSON.stringify([...done], null, 2)}\n`);
  }
  return out;
}
