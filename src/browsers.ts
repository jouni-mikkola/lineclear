import { readJson } from "../pi/config.ts";
import { join } from "node:path";
import { type Env, limiter, type Open, pictureCode, readShot, runInSession, sessionCache } from "./browser-cli.ts";
import { isOpen, readItems } from "./inbox.ts";
import { readTasksKept } from "./tasks-kept.ts";
import { lineclearDir } from "./measure.ts";

// The agents' live browsers: each open playwright-cli session, its task's plain title, a live picture, and the
// owner's clicks and keys when they take one over. Everything goes through the `playwright-cli` command, so
// Lineclear needs nothing of its own in the browser.

type Page = { title: string; url: string };

/** One open session as the Agent browsers view draws it. */
export interface BrowserSession {
  session: string;
  /** Its task's plain title, or the session's name when no task has it. */
  title: string;
  task?: string;
  project?: string;
  /** What the name adds after the task's id, such as "review". */
  note?: string;
  /** An open Inbox item for a login or a code that names this session. */
  waits?: { item: string; question: string };
  /** The page it showed in its last picture. */
  page?: Page;
  /** The owner took it over here. */
  taken: boolean;
  /** The machine it runs on, when it is not this one: its picture and take-over stay there. */
  machine?: string;
}

export type BrowserInput = { do: "click"; x: number; y: number } | { do: "type"; text: string } | { do: "key"; key: string } | { do: "scroll"; dy: number };

const KEYS = ["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
/** How many reads may wait for one of the slots. */
const QUEUE = 8;
/** How many playwright-cli runs go at once. */
const SLOTS = 3;

/** Too many pictures wait already: the page asks again on its next tick. */
export class Busy extends Error {}

/** The task a session belongs to: agents name their session after their task, with an optional suffix. */
export function taskOfSession(session: string, ids: string[]): { task: string; note?: string } | undefined {
  const s = session.toLowerCase();
  const hit = ids.filter((id) => s === id.toLowerCase() || s.startsWith(`${id.toLowerCase()}-`)).sort((a, b) => b.length - a.length)[0];
  if (!hit) return undefined;
  const note = session
    .slice(hit.length + 1)
    .replace(/[-_]+/g, " ")
    .trim();
  return note ? { task: hit, note } : { task: hit };
}

/** The sessions as the view draws them, none of a task that is done: those waiting for a login or a code first, then by title. */
function describeSessions(names: string[], env: Env, pages: Map<string, Page>, taken: Set<string>): BrowserSession[] {
  const dir = lineclearDir(env);
  const spaces: any[] = readJson(join(dir, "spaces.json")) ?? [];
  const known = new Map<string, { title: string; project?: string; done: boolean }>();
  for (const t of readTasksKept(dir).tasks as any[]) {
    if (typeof t?.id !== "string" || typeof t.title !== "string") continue;
    const space = spaces.find((s) => typeof s?.key === "string" && t.id.startsWith(`${s.key}-`));
    known.set(t.id, { title: t.title, done: t.merged === true || t.told === "done", ...(space ? { project: String(space.name) } : {}) });
  }
  const asks = readItems(env).filter((i) => isOpen(i) && i.kind === "login" && i.session);
  const out: BrowserSession[] = [];
  for (const session of names) {
    const of = taskOfSession(session, [...known.keys()]);
    const t = of && known.get(of.task);
    if (t?.done) continue;
    const ask = asks.filter((i) => i.session === session).at(-1);
    out.push({
      session,
      title: t?.title ?? session,
      ...(of ? { task: of.task } : {}),
      ...(t?.project ? { project: t.project } : {}),
      ...(of?.note ? { note: of.note } : {}),
      ...(ask ? { waits: { item: String(ask.n), question: ask.question } } : {}),
      ...(pages.has(session) ? { page: pages.get(session) } : {}),
      taken: taken.has(session),
    });
  }
  return out.sort((a, b) => Number(!!b.waits) - Number(!!a.waits) || a.title.localeCompare(b.title) || a.session.localeCompare(b.session));
}

/** The playwright code of one input. It never holds anything but numbers, a listed key and JSON text. */
export function inputCode(i: BrowserInput): string {
  const call =
    i.do === "click"
      ? `mouse.click(${i.x}, ${i.y})`
      : i.do === "scroll"
        ? `mouse.wheel(0, ${i.dy})`
        : `keyboard.${i.do === "type" ? "type" : "press"}(${JSON.stringify(i.do === "type" ? i.text : i.key)})`;
  return `async page => { await page.${call}; }`;
}

/** An input from the page, checked, or the reason it is not one. */
export function parseInput(body: any): BrowserInput | string {
  const n = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
  if (body?.do === "click" && n(body.x, 20_000) && n(body.y, 20_000) && body.x >= 0 && body.y >= 0)
    return { do: "click", x: Math.round(body.x), y: Math.round(body.y) };
  if (body?.do === "type" && typeof body.text === "string" && body.text.length > 0 && body.text.length <= 2000) return { do: "type", text: body.text };
  if (body?.do === "key" && (KEYS as readonly string[]).includes(body.key)) return { do: "key", key: body.key };
  if (body?.do === "scroll" && n(body.dy, 5000)) return { do: "scroll", dy: Math.round(body.dy) };
  return "Not an input: click at x and y, type text, press a key or scroll.";
}

type Kind = "thumb" | "full";
/** How long a picture is served as it is before the next one is taken in the background. */
const FRESH: Record<Kind, number> = { thumb: 5_000, full: 1_000 };
/**
 * How long the list of sessions is served as it is before it is read again: each read starts a node process that
 * costs about two seconds of CPU. The Browsers view asks for the short time, every other page for the long one.
 */
const LIST_LIVE = 10_000;
const LIST_IDLE = 300_000;
/** How old the full picture of a session shown as a card may get before the card's next ask takes it again. */
const WARM = 10_000;

/**
 * The browsers' state for the web server. Nothing the page asks for waits on playwright-cli once it has been
 * answered before: the list of sessions and each picture (a small thumbnail for a card, the page at its own size
 * for the one being watched) are kept and served at once, and a stale one is read again in the background. Only
 * the very first answer waits. At most three runs go at once, so watching adds little load.
 */
export function browsers(env: Env, now = () => Date.now()) {
  // the UI tests shorten it, as they cannot wait ten seconds for a list to go stale
  const listLive = Number(env.LINECLEAR_BROWSER_LIST_MS) || LIST_LIVE;
  const shots = new Map<string, { at: number; jpeg: Buffer }>();
  const inflight = new Map<string, Promise<Buffer>>();
  const pages = new Map<string, Page>();
  const taken = new Set<string>();
  const key = (name: string, kind: Kind) => `${name}\0${kind}`;
  const { slot, waiting } = limiter(SLOTS);
  const { latest, find, forget } = sessionCache(env, now, listLive);
  const runCode = (s: Open, code: string) => runInSession(env, slot, s, code);
  /** After a failed run: whether the session closed since the list was read. */
  const closedNow = async (name: string) => {
    forget();
    return !(await find(name).catch(() => true));
  };

  /** Takes one picture, keeps it, and notes the page it showed. One run per picture at a time. */
  const capture = (s: Open, kind: Kind): Promise<Buffer> => {
    const k = key(s.name, kind);
    const going = inflight.get(k);
    if (going) return going;
    const read = runCode(s, pictureCode(kind === "thumb")).then((out) => {
      const { jpeg, page } = readShot(out);
      pages.set(s.name, page);
      shots.set(k, { at: now(), jpeg });
      return jpeg;
    });
    inflight.set(k, read);
    const end = () => inflight.get(k) === read && inflight.delete(k);
    read.then(end, end);
    return read;
  };

  return {
    async list(live = true): Promise<BrowserSession[]> {
      const open = await latest(live ? listLive : LIST_IDLE);
      const names = new Set(open.map((s) => s.name));
      for (const k of [...taken, ...pages.keys()]) {
        if (names.has(k)) continue;
        taken.delete(k);
        pages.delete(k);
      }
      for (const k of [...shots.keys()]) if (!names.has(k.split("\0")[0] ?? "")) shots.delete(k);
      // a session with no thumbnail yet gets one now, so the cards fill as soon as the page asks
      for (const s of open) if (!shots.has(key(s.name, "thumb")) && waiting.length < QUEUE) capture(s, "thumb").catch(() => {});
      return describeSessions([...names], env, pages, taken);
    },

    /**
     * A JPEG of what the session showed lately, or undefined when it is not open. A kept one is served at once and
     * a stale one is taken again in the background; with none kept, this waits for the first.
     */
    async picture(name: string, kind: Kind = "full"): Promise<Buffer | undefined> {
      const s = (await latest()).find((x) => x.name === name) ?? (await find(name));
      if (!s) return undefined;
      // a card in view means its page may be opened next: the full picture is kept near fresh while the card asks,
      // only when the queue is empty, so these never crowd out a thumbnail
      const full = shots.get(key(name, "full"));
      if (kind === "thumb" && (!full || now() - full.at > WARM) && !waiting.length) capture(s, "full").catch(() => {});
      const hit = shots.get(key(name, kind));
      if (hit) {
        if (now() - hit.at > FRESH[kind] && waiting.length < QUEUE) capture(s, kind).catch(() => {});
        return hit.jpeg;
      }
      // a full queue is not made longer: the page asks again on its next tick
      if (waiting.length >= QUEUE && !inflight.has(key(name, kind))) throw new Busy();
      try {
        return await capture(s, kind);
      } catch (e) {
        if (await closedNow(name)) return undefined;
        throw e;
      }
    },

    async take(name: string, on: boolean): Promise<boolean> {
      if (!(await find(name))) return false;
      on ? taken.add(name) : taken.delete(name);
      return true;
    },

    /** Sends one input to a session the owner took over. */
    async input(name: string, i: BrowserInput): Promise<"ok" | "closed" | "not taken"> {
      const s = await find(name);
      if (!s) return "closed";
      if (!taken.has(name)) return "not taken";
      try {
        await runCode(s, inputCode(i));
      } catch (e) {
        if (await closedNow(name)) return "closed";
        throw e;
      }
      // the next picture shows what the input did
      shots.delete(key(name, "full"));
      return "ok";
    },
  };
}
