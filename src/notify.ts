import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { isOpen, type Item, KIND_LABEL, readItems } from "./inbox.ts";
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
 * only sets the mark: items from before are not announced. Returns how many were sent.
 */
export async function notifyNew(push: Pusher, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const items = readItems(env);
  const newest = items.reduce((m, i) => Math.max(m, i.n), 0);
  const mark = existsSync(markPath(env)) ? Number(readFileSync(markPath(env), "utf8")) : Number.NaN;
  if (!Number.isInteger(mark) || newest > mark) writeAtomic(markPath(env), `${newest}\n`);
  if (!Number.isInteger(mark)) return 0;
  const fresh = items.filter((i) => i.n > mark && isOpen(i));
  const count = items.filter(isOpen).length;
  for (const item of fresh) await push.send(alertOf(item), new Set(), { count, tags: [] });
  return fresh.length;
}

/** Looks for new items every `ms` and pushes them. Returns a function that stops it. */
export function watchInbox(push: Pusher, env: NodeJS.ProcessEnv = process.env, ms = 2_000): () => void {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    notifyNew(push, env)
      .catch((e) => console.error(`lineclear: a push failed: ${(e as Error).message}`))
      .finally(() => {
        busy = false;
      });
  };
  tick();
  const timer = setInterval(tick, ms);
  return () => clearInterval(timer);
}

/**
 * Calls `onChange` once a second at most when the Inbox folder changes: an item written or closed replaces a file, which
 * moves the folder's time. One stat of the folder is the whole cost, and a folder removed and made again is noticed too.
 * Returns a function that stops it.
 */
export function watchInboxFolder(env: Record<string, string | undefined>, onChange: () => void): () => void {
  const dir = join(configDir(env as NodeJS.ProcessEnv), "inbox");
  const stamp = () => {
    try {
      const s = statSync(dir);
      return `${s.ino}:${s.mtimeMs}`;
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
