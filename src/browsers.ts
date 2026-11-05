import { readJson } from "../pi/config.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOpen, readItems } from "./inbox.ts";
import { readTasksKept } from "./kept-read.ts";
import { shepherdrDir } from "./measure.ts";

// The agents' live browsers: each open playwright-cli session, its task's plain title, a live picture, and the
// owner's clicks and keys when they take one over. Everything goes through the `playwright-cli` command, so
// Lineclear needs nothing of its own in the browser.

type Env = Record<string, string | undefined>;

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
  page?: { title: string; url: string };
  /** The owner took it over here. */
  taken: boolean;
  /** The machine it runs on, when it is not this one: it is listed under `<session>@<machine>`, and its picture and take-over stay on that machine. */
  machine?: string;
}

export type BrowserInput = { do: "click"; x: number; y: number } | { do: "type"; text: string } | { do: "key"; key: string } | { do: "scroll"; dy: number };

const KEYS = ["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
/** How many reads may wait for one of the two slots. */
const QUEUE = 8;

/** Too many pictures wait already: the page asks again on its next tick. */
export class Busy extends Error {}

export const SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const cli = (env: Env) => env.LINECLEAR_PLAYWRIGHT_CLI ?? "playwright-cli";

/** Runs playwright-cli with a time limit and returns its output, or throws with its own words. */
async function run(env: Env, args: string[], cwd: string, ms = 15_000): Promise<string> {
  const p = Bun.spawn([cli(env), ...args], { cwd, env: env as Record<string, string>, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill("SIGKILL"), ms);
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error((err || out).trim().split("\n")[0] || `playwright-cli failed (${code})`);
  return out;
}

/** The open sessions of every workspace, with the folder each one's commands must run in. */
export async function openSessions(env: Env): Promise<{ name: string; cwd: string }[]> {
  const out = await run(env, ["list", "--all", "--json"], "/");
  const all = (JSON.parse(out).browsers ?? []) as { name?: unknown; workspace?: unknown; status?: unknown }[];
  return (
    all
      .filter((b) => b.status === "open" && typeof b.name === "string" && SESSION_NAME.test(b.name))
      // a workspace is a folder, or a hash for sessions opened outside any; those answer from the root
      .map((b) => ({ name: b.name as string, cwd: typeof b.workspace === "string" && b.workspace.startsWith("/") ? b.workspace : "/" }))
  );
}

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

/** Each Shepherdr task's plain title and project, from this machine's Shepherdr files. */
function tasks(env: Env): Map<string, { title: string; project?: string; done: boolean }> {
  const dir = shepherdrDir(env);
  const spaces: any[] = readJson(join(dir, "spaces.json")) ?? [];
  const list: any[] = readTasksKept(dir).tasks;
  const by = new Map<string, { title: string; project?: string; done: boolean }>();
  for (const t of list) {
    if (typeof t?.id !== "string" || typeof t.title !== "string") continue;
    const space = spaces.find((s) => typeof s?.key === "string" && t.id.startsWith(`${s.key}-`));
    by.set(t.id, { title: t.title, done: t.merged === true || t.told === "done", ...(space ? { project: String(space.name) } : {}) });
  }
  return by;
}

/** The sessions as the view draws them, none of a task that is done: those waiting for a login or a code first, then by title. */
export function describeSessions(names: string[], env: Env, pages: Map<string, { title: string; url: string }>, taken: Set<string>): BrowserSession[] {
  const known = tasks(env);
  const asks = readItems(env).filter((i) => isOpen(i) && i.kind === "login" && i.session);
  return names
    .filter((session) => {
      const of = taskOfSession(session, [...known.keys()]);
      return !(of && known.get(of.task)?.done);
    })
    .map((session): BrowserSession => {
      const of = taskOfSession(session, [...known.keys()]);
      const t = of && known.get(of.task);
      const ask = asks.filter((i) => i.session === session).at(-1);
      return {
        session,
        title: t?.title ?? session,
        ...(of ? { task: of.task } : {}),
        ...(t?.project ? { project: t.project } : {}),
        ...(of?.note ? { note: of.note } : {}),
        ...(ask ? { waits: { item: String(ask.n), question: ask.question } } : {}),
        ...(pages.has(session) ? { page: pages.get(session) } : {}),
        taken: taken.has(session),
      };
    })
    .sort((a, b) => Number(!!b.waits) - Number(!!a.waits) || a.title.localeCompare(b.title) || a.session.localeCompare(b.session));
}

/** The width of a card's thumbnail, in pixels. The whole view of one session is the page at its own size. */
const THUMB_WIDTH = 480;

/**
 * The playwright code of a picture. A thumbnail is the screenshot drawn smaller in the page, as a JPEG; if the
 * page cannot do that, the screenshot itself is the answer.
 */
const pictureCode = (thumb: boolean) =>
  `async page => { const shot = await page.screenshot({ type: "jpeg", quality: ${thumb ? 60 : 70}, scale: "css" }); let picture = shot.toString("base64");` +
  (thumb
    ? ` try { picture = await page.evaluate(async ([b64, w]) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" })); if (bmp.width <= w) return b64; const c = new OffscreenCanvas(w, Math.round(bmp.height * w / bmp.width)); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); const out = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality: 0.6 })).arrayBuffer()); let s = ""; for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode(...out.subarray(i, i + 8192)); return btoa(s); }, [picture, ${THUMB_WIDTH}]); } catch {}`
    : "") +
  ` return JSON.stringify({ url: page.url(), title: await page.title(), picture }); }`;

/** The playwright code of one input. It never holds anything but numbers, a listed key and JSON text. */
export function inputCode(i: BrowserInput): string {
  switch (i.do) {
    case "click":
      return `async page => { await page.mouse.click(${i.x}, ${i.y}); }`;
    case "type":
      return `async page => { await page.keyboard.type(${JSON.stringify(i.text)}); }`;
    case "key":
      return `async page => { await page.keyboard.press(${JSON.stringify(i.key)}); }`;
    case "scroll":
      return `async page => { await page.mouse.wheel(0, ${i.dy}); }`;
  }
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

type Open = { name: string; cwd: string };
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
/** How many playwright-cli runs go at once. */
const SLOTS = 3;

/** Runs at most `size` works at once; the rest wait in `waiting`, in order. */
function limiter(size: number) {
  let busy = 0;
  const waiting: (() => void)[] = [];
  const slot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy >= size) await new Promise<void>((r) => waiting.push(r));
    busy += 1;
    try {
      return await work();
    } finally {
      busy -= 1;
      waiting.shift()?.();
    }
  };
  return { slot, waiting };
}

/** The list of open sessions, kept and read again once it is older than `listLive`. */
function sessionCache(env: Env, now: () => number, listLive: number) {
  let listed: { at: number; read: Promise<Open[]> } | undefined;
  let known: Open[] | undefined;
  /** The sessions, read again when the last read is older than `age`. */
  const sessions = (age = listLive) => {
    const t = now();
    if (!listed || t - listed.at > age) {
      const read = openSessions(env);
      listed = { at: t, read };
      read.then(
        (v) => listed?.read === read && (known = v),
        // a failed read is not kept
        () => listed?.read === read && (listed = undefined),
      );
    }
    return listed.read;
  };
  // the first list is read as soon as the server starts
  sessions().catch(() => {});
  return {
    /** The sessions as last read, at once; a read for the next ask starts in the background. Only the first waits. */
    async latest(age = listLive): Promise<Open[]> {
      const fresh = sessions(age);
      if (known) {
        fresh.catch(() => {});
        return known;
      }
      return fresh;
    },
    find: async (name: string) => (await sessions()).find((s) => s.name === name),
    forget() {
      listed = undefined;
    },
  };
}

/** Runs one piece of playwright code in a session, from a file only this user can read, as it may hold typed text. */
async function runInSession(env: Env, slot: <T>(work: () => Promise<T>) => Promise<T>, s: Open, code: string) {
  const dir = mkdtempSync(join(tmpdir(), "lineclear-browser-"));
  const file = join(dir, "code.js");
  writeFileSync(file, code, { mode: 0o600 });
  try {
    return await slot(() => run(env, [`-s=${s.name}`, "--raw", "run-code", `--filename=${file}`], s.cwd));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The JPEG and the page of what `pictureCode` printed. */
function readShot(out: string) {
  let v: any = JSON.parse(out);
  if (typeof v === "string") v = JSON.parse(v);
  const jpeg = Buffer.from(typeof v?.picture === "string" ? v.picture : "", "base64");
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("the picture is not a JPEG");
  return { jpeg, page: { title: String(v.title ?? ""), url: String(v.url ?? "") } };
}

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
  const pages = new Map<string, { title: string; url: string }>();
  const taken = new Set<string>();
  const key = (name: string, kind: Kind) => `${name}\0${kind}`;
  const { slot, waiting } = limiter(SLOTS);

  const { latest, find, forget } = sessionCache(env, now, listLive);
  /** After a failed run: whether the session closed since the list was read. */
  const closedNow = async (name: string) => {
    forget();
    return !(await find(name).catch(() => true));
  };

  const runCode = (s: Open, code: string) => runInSession(env, slot, s, code);

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
      for (const k of [...taken]) if (!names.has(k)) taken.delete(k);
      for (const k of [...pages.keys()]) if (!names.has(k)) pages.delete(k);
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
      if (kind === "thumb" && (!full || now() - full.at > WARM) && !waiting.length && !inflight.has(key(name, "full"))) capture(s, "full").catch(() => {});
      const hit = shots.get(key(name, kind));
      const stale = !hit || now() - hit.at > FRESH[kind];
      if (hit) {
        if (stale && waiting.length < QUEUE) capture(s, kind).catch(() => {});
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
