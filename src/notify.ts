import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { inboxStamp, isOpen, type Item, KIND_LABEL, newestItem, readItems } from "./inbox.ts";
import { configDir } from "../pi/config.ts";

export type Alert = { id: string; from: string; title: string; body: string; go: { place: string; focus?: string }; tag: string };

/** What the web server needs of the fork's `Push` (`server/server/push.ts`): the part that keeps devices and sends. */
export interface Pusher {
  publicKey: string;
  subscribe(sub: unknown, device: string): void;
  send(alert: Alert, skip?: Set<string>, waits?: { count: number; tags: string[] }): Promise<void>;
}

/** The fork's push code. It reads LINECLEAR_HOME once, as it loads, so keys and devices go to a folder of Lineclear's own, set only while it loads. */
export async function realPush(): Promise<Pusher> {
  const set = process.env.LINECLEAR_HOME === undefined;
  if (set) process.env.LINECLEAR_HOME = join(configDir(process.env), "push");
  try {
    const file = "../server/server/push.ts"; // in a variable, so the fork keeps its own type checking
    const { Push } = (await import(file)) as { Push: new () => Pusher };
    return new Push();
  } finally {
    if (set) delete process.env.LINECLEAR_HOME;
  }
}

const markPath = (env: NodeJS.ProcessEnv) => join(configDir(env), "push-mark");

/** What the phone shows for a new item: "Main is red", or "Inbox 3: step waits for you" over the task and the question. */
export function alertOf(item: Item): Alert {
  const title = item.alert ?? `Inbox ${item.n}: ${KIND_LABEL[item.kind]}`;
  const body = item.task === "-" ? item.question : `${item.task}: ${item.question}`;
  return { id: `inbox-${item.n}`, from: "Lineclear", title, body, go: { place: "inbox", focus: `inbox-${item.n}` }, tag: `inbox-${item.n}` };
}

/**
 * Sends one push for each open Inbox item newer than the last one told, and remembers the newest. The first look
 * only sets the mark: items from before are not announced. The file names say whether anything is newer, so when
 * nothing is, no item is read. Returns how many were sent.
 */
export async function notifyNew(push: Pusher, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const newest = newestItem(env);
  const mark = existsSync(markPath(env)) ? Number(readFileSync(markPath(env), "utf8")) : Number.NaN;
  if (!Number.isInteger(mark) || newest > mark) writeAtomic(markPath(env), `${newest}\n`);
  if (!Number.isInteger(mark) || newest <= mark) return 0;
  const items = readItems(env);
  const fresh = items.filter((i) => i.n > mark && isOpen(i));
  const count = items.filter(isOpen).length;
  for (const item of fresh) await push.send(alertOf(item), new Set(), { count, tags: [] });
  return fresh.length;
}

/** Pushes the new items. Returns what to call when the Inbox folder changes: a call while one runs is run once more after it. */
export function pushOnChange(push: Pusher, env: NodeJS.ProcessEnv = process.env): () => void {
  let busy = false;
  let again = false;
  const tick = (): void => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    notifyNew(push, env)
      .catch((e) => console.error(`lineclear: a push failed: ${(e as Error).message}`))
      .finally(() => {
        busy = false;
        if (again) {
          again = false;
          tick();
        }
      });
  };
  tick();
  return tick;
}

/**
 * Calls `onChange` once a second at most when the Inbox changes: an item added, answered or closed moves the stamp.
 * One aggregate query is the whole cost. Returns a function that stops it.
 */
export function watchInboxFolder(env: Record<string, string | undefined>, onChange: () => void): () => void {
  const stamp = () => {
    try {
      return inboxStamp(env);
    } catch {
      return "";
    }
  };
  let seen = stamp();
  const timer = setInterval(() => {
    const now = stamp();
    if (now === seen) return;
    seen = now;
    onChange();
  }, 1000);
  return () => clearInterval(timer);
}
