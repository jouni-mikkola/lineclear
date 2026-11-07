import { readJson } from "../pi/config.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isOpen, readItems } from "./inbox.ts";
import { readTasksKept } from "./kept-read.ts";
import { lineclearDir } from "./measure.ts";

// The agents' live browsers, all through the `playwright-cli` command: each open session, its task's title, a live picture, and the owner's input.

type Env = Record<string, string | undefined>;

/** One open session as the Agent browsers view draws it. */
export interface BrowserSession {
  session: string;
  title: string;
  task?: string;
  project?: string;
  note?: string;
  waits?: { item: string; question: string };
  page?: { title: string; url: string };
  taken: boolean;
  /** The machine it runs on, when it is not this one: its picture and take-over stay there. */
  machine?: string;
}

export type BrowserInput = { do: "click"; x: number; y: number } | { do: "type"; text: string } | { do: "key"; key: string } | { do: "scroll"; dy: number };

const KEYS = ["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;
/** How many reads may wait for a slot. */
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

/** The open sessions of every workspace, with the folder each one's commands must run in (the root for one opened outside any). */
async function openSessions(env: Env): Promise<Open[]> {
  const all = (JSON.parse(await run(env, ["list", "--all", "--json"], "/")).browsers ?? []) as { name?: unknown; workspace?: unknown; status?: unknown }[];
  return all
    .filter((b) => b.status === "open" && typeof b.name === "string" && SESSION_NAME.test(b.name))
    .map((b) => ({ name: b.name as string, cwd: typeof b.workspace === "string" && b.workspace.startsWith("/") ? b.workspace : "/" }));
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

/** The sessions as the view draws them, none of a task that is done: those waiting for a login or a code first, then by title. */
function describeSessions(names: string[], env: Env, pages: Map<string, { title: string; url: string }>, taken: Set<string>): BrowserSession[] {
  const dir = lineclearDir(env);
  const spaces: { key?: string; name?: string }[] = readJson(join(dir, "spaces.json")) ?? [];
  const tasks = new Map(readTasksKept(dir).tasks.map((t) => [t.id, t] as const));
  const asks = readItems(env).filter((i) => isOpen(i) && i.kind === "login" && i.session);
  return names
    .flatMap((session): BrowserSession[] => {
      const of = taskOfSession(session, [...tasks.keys()]);
      const t = of && tasks.get(of.task);
      if (t && (t.merged === true || t.told === "done")) return [];
      const project = of && spaces.find((s) => s.key && of.task.startsWith(`${s.key}-`))?.name;
      const ask = asks.filter((i) => i.session === session).at(-1);
      return [
        {
          session,
          title: typeof t?.title === "string" ? t.title : session,
          ...(of ? { task: of.task } : {}),
          ...(project ? { project: String(project) } : {}),
          ...(of?.note ? { note: of.note } : {}),
          ...(ask ? { waits: { item: String(ask.n), question: ask.question } } : {}),
          ...(pages.has(session) ? { page: pages.get(session) } : {}),
          taken: taken.has(session),
        },
      ];
    })
    .sort((a, b) => Number(!!b.waits) - Number(!!a.waits) || a.title.localeCompare(b.title) || a.session.localeCompare(b.session));
}

/** The playwright code of a picture: a JPEG of the page, smaller in quality for a card's thumbnail. */
const pictureCode = (thumb: boolean) =>
  `async page => { const shot = await page.screenshot({ type: "jpeg", quality: ${thumb ? 40 : 70}, scale: "css" }); return JSON.stringify({ url: page.url(), title: await page.title(), picture: shot.toString("base64") }); }`;

/** The playwright code of one input. It never holds anything but numbers, a listed key and JSON text. */
export const inputCode = (i: BrowserInput): string =>
  i.do === "click"
    ? `async page => { await page.mouse.click(${i.x}, ${i.y}); }`
    : i.do === "type"
      ? `async page => { await page.keyboard.type(${JSON.stringify(i.text)}); }`
      : i.do === "key"
        ? `async page => { await page.keyboard.press(${JSON.stringify(i.key)}); }`
        : `async page => { await page.mouse.wheel(0, ${i.dy}); }`;

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
/** How long the session list is served as it is: each read costs about two seconds of CPU. The Browsers view asks for the short time, other pages the long one. */
const LIST_LIVE = 10_000;
const LIST_IDLE = 300_000;
/** How old the full picture behind a card may get before the card's next ask takes it again. */
const WARM = 10_000;
const SLOTS = 3;

/** The list of open sessions, kept and read again once it is older than `listLive`. */
function sessionCache(env: Env, now: () => number, listLive: number) {
  let listed: { at: number; read: Promise<Open[]> } | undefined;
  let known: Open[] | undefined;
  const sessions = (age = listLive) => {
    if (!listed || now() - listed.at > age) {
      const read = openSessions(env);
      listed = { at: now(), read };
      read.then(
        (v) => listed?.read === read && (known = v),
        () => listed?.read === read && (listed = undefined),
      );
    }
    return listed.read;
  };
  sessions().catch(() => {});
  return {
    /** The sessions as last read, at once, while a read for the next ask starts. Only the first waits. */
    async latest(age = listLive): Promise<Open[]> {
      const fresh = sessions(age);
      if (!known) return fresh;
      fresh.catch(() => {});
      return known;
    },
    find: async (name: string, age = listLive) => (await sessions(age)).find((s) => s.name === name),
  };
}

/** The JPEG and the page of what `pictureCode` printed. */
function readShot(out: string) {
  let v: any = JSON.parse(out);
  if (typeof v === "string") v = JSON.parse(v);
  const jpeg = Buffer.from(typeof v?.picture === "string" ? v.picture : "", "base64");
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("the picture is not a JPEG");
  return { jpeg, page: { title: String(v.title ?? ""), url: String(v.url ?? "") } };
}

/** The browsers' state for the web server. The session list and each picture are kept and served at once, and a stale one is read again in the background. Only the first answer waits. */
export function browsers(env: Env, now = () => Date.now()) {
  const listLive = Number(env.LINECLEAR_BROWSER_LIST_MS) || LIST_LIVE;
  const shots = new Map<string, { at: number; jpeg: Buffer }>();
  const inflight = new Map<string, Promise<Buffer>>();
  const pages = new Map<string, { title: string; url: string }>();
  const taken = new Set<string>();
  const key = (name: string, kind: Kind) => `${name}\0${kind}`;
  let busy = 0;
  const waiting: (() => void)[] = [];
  /** Runs at most `SLOTS` works at once; the rest wait in order. */
  const slot = async <T>(work: () => Promise<T>): Promise<T> => {
    if (busy >= SLOTS) await new Promise<void>((r) => waiting.push(r));
    busy += 1;
    try {
      return await work();
    } finally {
      busy -= 1;
      waiting.shift()?.();
    }
  };
  const { latest, find } = sessionCache(env, now, listLive);
  /** After a failed run: whether the session closed since the list was read. */
  const closedNow = async (name: string) => !(await find(name, -1).catch(() => true));

  /** Runs playwright code in a session, from a file only this user can read, as it may hold typed text. */
  const runCode = async (s: Open, code: string) => {
    const dir = mkdtempSync(join(tmpdir(), "lineclear-browser-"));
    const file = join(dir, "code.js");
    writeFileSync(file, code, { mode: 0o600 });
    try {
      return await slot(() => run(env, [`-s=${s.name}`, "--raw", "run-code", `--filename=${file}`], s.cwd));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      for (const k of [...taken, ...pages.keys()]) if (!names.has(k)) taken.delete(k), pages.delete(k);
      for (const k of [...shots.keys()]) if (!names.has(k.split("\0")[0] ?? "")) shots.delete(k);
      // a session with no thumbnail yet gets one now, so the cards fill as soon as the page asks
      for (const s of open) if (!shots.has(key(s.name, "thumb")) && waiting.length < QUEUE) capture(s, "thumb").catch(() => {});
      return describeSessions([...names], env, pages, taken);
    },

    /** A JPEG of what the session showed lately, or undefined when it is not open. */
    async picture(name: string, kind: Kind = "full"): Promise<Buffer | undefined> {
      const s = (await latest()).find((x) => x.name === name) ?? (await find(name));
      if (!s) return undefined;
      // a card in view may be opened next: its full picture is kept near fresh, only on an empty queue
      const full = shots.get(key(name, "full"));
      if (kind === "thumb" && (!full || now() - full.at > WARM) && !waiting.length && !inflight.has(key(name, "full"))) capture(s, "full").catch(() => {});
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
