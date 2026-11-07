import { addedSteps, type PlanView } from "./requests.ts";
import { isOpen, type Item, readAllItems } from "./inbox.ts";
import type { WaitingTask } from "./waiting.ts";
import type { Env } from "./web-guard.ts";

/** An open Inbox item as the Inbox view draws it: its answers as buttons, the rest as details. */
export interface InboxView {
  id: string;
  project: string;
  question: string;
  choices: string[];
  details: string;
  /** The answer that needs a reason: the result of an owner step. */
  needsNote?: string;
  /** For a login or a code: the agent's browser session, opened on the Agent browsers view. */
  session?: string;
  /** The task that asked or waits, and its title and the sentence of what it gives once it lands. */
  task: string;
  title?: string;
  result?: string;
  /** Since when it waits (ISO time). */
  since?: string;
  /** The kind of question, such as "plan": the Inbox card shows its role's icon. */
  kind?: string;
  /** The machine that holds it, when it is not this one. */
  machine?: string;
  /** A task that waits with no item: no answers here, it is answered in its chat, `/task/<id>`. */
  waiting?: true;
}

/** A waiting task with no Inbox item. */
export function waitingView(w: WaitingTask): InboxView {
  const { task, project, text, title, result, since, machine } = w;
  const extras = Object.entries({ title, result, since, machine }).filter(([, v]) => v);
  return { id: `task:${task}`, project, question: text, choices: [], details: "", task, ...Object.fromEntries(extras), waiting: true };
}

/** A plan from a request, as the chat and the roadmap view draw it: its open Inbox item is the same one the Inbox shows. */
export interface PlanCard extends Omit<PlanView, "item"> {
  item?: InboxView;
  /** Your answer, once given. */
  answer?: string;
  /** The plan applied by itself: the change to undo from the card, and whether it was undone. */
  applied?: { id: number; undone: boolean };
}

export function planCard(v: PlanView): PlanCard {
  const { item, ...rest } = v;
  return {
    ...rest,
    ...(item && isOpen(item) ? { item: inboxView(item) } : {}),
    ...(item?.answer ? { answer: item.answer } : {}),
    ...(item?.auto && item.commit ? { applied: { id: item.n, undone: !!item.undone } } : {}),
  };
}

/** A plan or roadmap change that applied by itself, as the Roadmap lists it with its undo. */
export interface AppliedChange {
  id: number;
  question: string;
  since: string;
  /** The steps it added. */
  steps: string[];
  undone: boolean;
}

/** The latest ten changes that applied by themselves in a project, newest first. */
export function appliedChanges(project: string, env: Env): AppliedChange[] {
  return readAllItems(env as NodeJS.ProcessEnv)
    .filter((i) => i.auto && i.commit && i.project === project)
    .reverse()
    .slice(0, 10)
    .map((i) => ({ id: i.n, question: i.question, since: i.answeredAt ?? i.since, steps: addedSteps(i.diff ?? ""), undone: !!i.undone }));
}

export function inboxView(i: Item, machine?: string, title?: string, result?: string): InboxView {
  const lines: string[] = [];
  if (i.move) lines.push(`${i.move.step} comes after ${i.move.after.join(", ")}.`);
  if (i.session) lines.push(`Take over its browser: playwright-cli -s=${i.session} show`);
  if (i.diff) lines.push("", i.diff.trimEnd());
  return {
    id: machine ? `${i.n}@${machine}` : String(i.n),
    ...(machine ? { machine } : {}),
    task: i.task,
    ...(title ? { title } : {}),
    ...(result ? { result } : {}),
    since: i.since,
    kind: i.kind,
    project: `${i.project ?? i.task}${machine ? ` on ${machine}` : ""}`,
    question: i.question,
    choices: i.choices,
    details: lines.join("\n"),
    ...(i.ownerStep !== undefined ? { needsNote: "Done" } : {}),
    ...(i.kind === "login" && i.session ? { session: i.session } : {}),
  };
}
