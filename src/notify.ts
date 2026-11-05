import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { isOpen, type Item, KIND_LABEL, readItems } from "./inbox.ts";
import { configDir } from "../pi/config.ts";

/** The part of the fork's `Alert` a new Inbox item fills. */
export interface Alert {
  id: string;
  from: string;
  title: string;
  body: string;
  go: { place: string; focus?: string };
  tag: string;
}

/** What the web server needs of the fork's `Push` (`server/server/push.ts`): the part that keeps devices and sends. */
export interface Pusher {
  publicKey: string;
  subscribe(sub: unknown, device: string): void;
  send(alert: Alert, skip?: Set<string>, waits?: { count: number; tags: string[] }): Promise<void>;
}

/** The fork's push code, with its keys and devices kept where the fork keeps them. */
export async function realPush(): Promise<Pusher> {
  // its keys and devices live in a folder of Lineclear's own, apart from the fork's server, so the two never overwrite each other's devices (unless LINECLEAR_HOME is set already)
  // the fork reads LINECLEAR_HOME once, as it loads; set only while it loads (callers wait for it before they copy the environment), so the rest of this process still finds the board's spaces in the default folder
  const set = process.env.LINECLEAR_HOME === undefined;
  if (set) process.env.LINECLEAR_HOME = join(configDir(process.env), "push");
  try {
    // named in a variable, so the fork keeps its own type checking
    const file = "../server/server/push.ts";
    const { Push } = (await import(file)) as { Push: new () => Pusher };
    return new Push();
  } finally {
    if (set) delete process.env.LINECLEAR_HOME;
  }
}

const markPath = (env: NodeJS.ProcessEnv) => join(configDir(env), "push-mark");

/** The newest Inbox item the phone has been told of, or undefined before the first look. */
function readMark(env: NodeJS.ProcessEnv): number | undefined {
  try {
    const n = Number(readFileSync(markPath(env), "utf8"));
    return Number.isInteger(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

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
  const mark = readMark(env);
  if (mark === undefined) {
    writeAtomic(markPath(env), `${newest}\n`);
    return 0;
  }
  const fresh = items.filter((i) => i.n > mark && isOpen(i));
  if (newest > mark) writeAtomic(markPath(env), `${newest}\n`);
  const count = items.filter(isOpen).length;
  for (const item of fresh) await push.send(alertOf(item), new Set(), { count, tags: [] });
  return fresh.length;
}

/** Looks for new items every `ms` and pushes them. Returns a function that stops it. */
export function watchInbox(push: Pusher, env: NodeJS.ProcessEnv = process.env, ms = 2_000): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await notifyNew(push, env);
    } catch (e) {
      console.error(`lineclear: a push failed: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, ms);
  return () => clearInterval(timer);
}
