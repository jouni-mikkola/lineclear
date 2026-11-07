import { serverBin } from "./paths.ts";
import { inboxFlags, tables } from "./tables.ts";
import type { StepCheck } from "./stepcheck.ts";
import { clearWait, readWaits } from "./waits.ts";

/** The kinds of item the Inbox holds: what only the owner can settle. */
const inboxKinds = ["login", "outward", "choice"] as const;
export type InboxKind = (typeof inboxKinds)[number];

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
  /** For a plan that applied by itself: the roadmap diff. */
  diff?: string;
  /** For a plan change from the Dispatcher: one step gets a new `after`. */
  move?: { step: string; after: string[] };
  since: string;
  answer?: string;
  /** The owner's note: the result of an owner step. */
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
  /** For an owner-only step: its id. The owner answers Done with the result as the note. */
  ownerStep?: string;
  /** For a plan that applied: the go answers of the fresh model that read each new or changed step. */
  checks?: StepCheck[];
}

/** An item still waiting for the owner. */
export const isOpen = (i: Item) => i.answer === undefined && i.closed === undefined;

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

/** Reads rows into items. An item of a kind that is gone (plan, step, stuck, release): an open one closes, except an owner step; the rest are kept as choices. */
function itemRows(rows: unknown[], env: NodeJS.ProcessEnv): Item[] {
  return (rows as { item: string }[]).flatMap((r) => {
    const item = JSON.parse(r.item) as Item;
    if ((inboxKinds as readonly string[]).includes(item.kind)) return [item];
    if (isOpen(item) && item.ownerStep === undefined) return (closeItem(item, "the Inbox no longer holds this kind", new Date(), env), []);
    return [{ ...item, kind: "choice" as const }];
  });
}

/** The items of the Inbox, never the ones that left the list when they closed or applied by themselves. */
export function readItems(env = process.env): Item[] {
  return itemRows(tables(env).query("select item from inbox where shelved = 0 order by n").all(), env);
}

/** Every item, the closed and applied ones too: for the CLI's `--all`, an answer to a closed item and an undo. */
export function readAllItems(env = process.env): Item[] {
  return itemRows(tables(env).query("select item from inbox order by n").all(), env);
}

/** The newest item number and the count of changes made to items: the pair changes whenever the Inbox does. */
export function inboxStamp(env = process.env): string {
  const r = tables(env).query("select coalesce(max(n), 0) as newest, coalesce(sum(rev), 0) as rev from inbox").get() as { newest: number; rev: number };
  return `${r.newest}:${r.rev}`;
}

/** The number of the newest item, 0 for an empty Inbox. */
export const newestItem = (env = process.env): number =>
  (tables(env).query("select coalesce(max(n), 0) as newest from inbox").get() as { newest: number }).newest;

/** Adds an item under the next number, which the store gives. The numbers never repeat, answered items stay. */
export function addItem(item: Omit<Item, "n">, env = process.env): Item {
  const store = tables(env);
  const { open, shelved } = inboxFlags(item);
  return store
    .transaction(() => {
      const { n } = store.query("insert into inbox (open, shelved, item) values (?, ?, '') returning n").get(open, shelved) as { n: number };
      const full = { n, ...item };
      store.query("update inbox set item = ? where n = ?").run(JSON.stringify(full), n);
      return full;
    })
    .immediate();
}

/** Writes an item's new state under its number. */
export function saveItem(item: Item, env = process.env): void {
  const { open, shelved } = inboxFlags(item);
  tables(env).query("update inbox set open = ?, shelved = ?, item = ?, rev = rev + 1 where n = ?").run(open, shelved, JSON.stringify(item), item.n);
}

/** Answers a card of a space's coordinator chat in words, which closes it. Returns an error text, or undefined. */
export function answerCard(card: NonNullable<Item["card"]>, answer: string, env = process.env): string | undefined {
  const r = Bun.spawnSync([lineclear(env), "answer", card.id, answer, "--space", card.space], { stdin: "ignore" });
  return r.exitCode === 0 ? undefined : (r.stderr.toString() || r.stdout.toString()).trim() || `exit ${r.exitCode}`;
}

/** Closes an item with a reason and no answer. The wait it declared and the coordinator card it stands for go with it. */
export function closeItem(item: Item, reason: string, now: Date, env = process.env): void {
  saveItem({ ...item, closed: reason, closedAt: now.toISOString() }, env);
  if (item.card) answerCard(item.card, `Closed: ${reason}.`, env);
  if (waitReason(item.task, env) === `asked: ${item.question}`) clearWait(item.task, env);
}
