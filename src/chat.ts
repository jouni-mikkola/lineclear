import { openSync, readSync, closeSync, realpathSync, statSync } from "node:fs";
import { basename, extname, sep } from "node:path";
import { DISPATCHER_SPACE, dispatcherDir } from "./dispatcher.ts";
import { keepLinks, postAction, readSnapshot, lineclearServer, taskChatKey, watchSocket } from "./lineclear-client.ts";
import { listProjectNames, readSettings } from "./project.ts";

// The web chat with the Dispatcher. The Dispatcher is the coordinator chat of its own Lineclear space, so
// Lineclear talks to it through Lineclear's own server on this machine: it watches that one chat over Lineclear's
// WebSocket and sends with Lineclear's send action, the same way Lineclear's own chat does. A file you attach goes to
// Lineclear's upload, which saves it in its inbox on the Dispatcher's machine, and its path goes with the message: the
// same as an attachment in Lineclear's own chat, so each chat shows the other's files.

import { ACCEPTED, IMAGE_TYPES, MAX_FILE_BYTES, MAX_FILES, MAX_TEXT, sizeText, TEXT_EXT } from "./chat-limits.ts";

/** A parsed file or event read as it is: its shape is not ours to promise. */
type Raw = any;

export { MAX_FILE_BYTES, MAX_FILES, sizeText } from "./chat-limits.ts";

type Env = Record<string, string | undefined>;

/** How many messages the page gets: the latest. */
const HISTORY = 200;

const starts = (b: Uint8Array, ...bytes: number[]) => bytes.every((x, i) => b[i] === x);
const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

/**
 * Whether a file may be attached: its size, and its type by its name and its first bytes, so a file is what its name
 * says. Gives the file's kind, or the reason it is refused.
 */
export function checkUpload(name: string, bytes: Uint8Array): { image: boolean; type: string } | { error: string } {
  if (bytes.length === 0) return { error: `${name} is empty.` };
  if (bytes.length > MAX_FILE_BYTES) return { error: `${name} is too big: a file can be at most ${sizeText(MAX_FILE_BYTES)}.` };
  const ext = extname(name).toLowerCase();
  const image = IMAGE_TYPES[ext];
  if (image) {
    const ok =
      ext === ".png"
        ? starts(bytes, 0x89, 0x50, 0x4e, 0x47)
        : ext === ".gif"
          ? ascii(bytes, 0, "GIF8")
          : ext === ".webp"
            ? ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")
            : starts(bytes, 0xff, 0xd8, 0xff);
    return ok ? { image: true, type: image } : { error: `${name} is not the image its name says.` };
  }
  if (ext === ".pdf") return ascii(bytes, 0, "%PDF-") ? { image: false, type: "application/pdf" } : { error: `${name} is not a PDF.` };
  if (TEXT_EXT.has(ext)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return { error: `${name} is not text.` };
    }
    return bytes.includes(0) ? { error: `${name} is not text.` } : { image: false, type: "text/plain; charset=utf-8" };
  }
  return { error: `${name} cannot be attached. ${ACCEPTED} can.` };
}

/** The image type of a file by its first bytes, or undefined when it is no image this chat shows. */
function imageType(bytes: Uint8Array): string | undefined {
  if (starts(bytes, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(bytes, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ascii(bytes, 0, "GIF8")) return "image/gif";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
  return undefined;
}

interface ChatFile {
  name: string;
  size?: number;
  image: boolean;
  /** Where the page reads it, when this server serves it. */
  url?: string;
}

/**
 * An image the Dispatcher names by its path, read only from the folders it works with: its own space and each
 * project's repo. Anything else is refused, so a page cannot read any file it names, and a file must be an image by
 * its own name and its first bytes, wherever a link to it points.
 */
export function namedImageResponse(path: string, env: Env = process.env): Response {
  const no = (why: string, status = 404) => Response.json({ error: why }, { status });
  if (!IMAGE_TYPES[extname(path).toLowerCase()] || !path.startsWith("/")) return no("Only an image by its full path can be shown.", 400);
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return no("There is no such image.");
  }
  const roots = [dispatcherDir(env as NodeJS.ProcessEnv)];
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s !== "string") roots.push(s.repo);
  }
  const inside = roots.some((r) => {
    try {
      const root = realpathSync(r);
      return real.startsWith(root + sep);
    } catch {
      return false;
    }
  });
  if (!inside) return no("That image is outside the Dispatcher's folders.", 403);
  const st = statSync(real);
  if (!st.isFile() || st.size > 4 * MAX_FILE_BYTES) return no("There is no such image.");
  const head = new Uint8Array(12);
  const fd = openSync(real, "r");
  try {
    readSync(fd, head, 0, 12, 0);
  } finally {
    closeSync(fd);
  }
  const type = imageType(head);
  if (!type || type !== IMAGE_TYPES[extname(real).toLowerCase()]) return no("That file is not an image.", 400);
  return new Response(Bun.file(real), { headers: { "content-type": type, "x-content-type-options": "nosniff", "cache-control": "no-cache" } });
}

/** One message as the page draws it. */
export interface ChatMessage {
  id: string;
  who: "you" | "dispatcher";
  /** Yours as you wrote it, the Dispatcher's as markdown. */
  text?: string;
  file?: ChatFile;
  at?: number;
  /** The page's own id for what it sent. */
  cid?: string;
  /** It waits to go in: the Dispatcher is starting or busy. */
  waiting?: boolean;
  /** A card the Dispatcher asks with: its choices as buttons, and the one sent once it is answered. A plan lists its steps. */
  question?: { id: string; choices: string[]; sent?: number; said?: string; words?: boolean; steps?: string[] };
  reactions?: { emoji: string; by: "me" | "them" | "both" }[];
  /** What it answers: the start of that message's words, and its id while the chat still has it. */
  reply?: { text: string; id?: string };
}

export interface ChatView {
  /** ready: talking. none: there is no Dispatcher yet. offline: Lineclear cannot be reached. loading: connecting. */
  state: "loading" | "ready" | "none" | "offline";
  reason?: string;
  messages: ChatMessage[];
  /** The Dispatcher works on an answer. */
  writing: boolean;
  /** What it does now, in plain words: "Checking the task list". */
  doing?: string;
  /** What the page sent that could not go in, by its id. */
  failed: { cid: string; error: string }[];
}

/** Where the page reads a file of the chat: through this server from Lineclear, which serves only the chat's own. */
const fileUrl = (path: string) => `/api/chat/file?path=${encodeURIComponent(path)}`;

/** A file in a message as the page shows it. Its size is known when it was attached here. */
function fileView(file: { name: string; path: string }, sizes: ReadonlyMap<string, number> = new Map()): ChatFile {
  const size = sizes.get(file.path);
  return { name: file.name, image: !!IMAGE_TYPES[extname(file.path).toLowerCase()], ...(size !== undefined ? { size } : {}), url: fileUrl(file.path) };
}

/** What every message of the page carries: id, side, time, waiting, reactions and the message it answers. */
function messageBase(m: Raw): ChatMessage {
  const reactions = (Array.isArray(m.reactions) ? m.reactions : []).filter(
    (r: { emoji?: unknown; by?: unknown }) => typeof r?.emoji === "string" && ["me", "them", "both"].includes(String(r.by)),
  );
  const reply = typeof m.reply?.text === "string" ? { text: m.reply.text, ...(typeof m.reply.id === "string" ? { id: m.reply.id } : {}) } : undefined;
  return {
    id: String(m.id),
    who: m.who === "you" ? "you" : "dispatcher",
    ...(typeof m.at === "number" ? { at: m.at } : {}),
    ...(typeof m.cid === "string" ? { cid: m.cid } : {}),
    ...(m.waiting ? { waiting: true } : {}),
    ...(reactions.length ? { reactions: reactions.map((r: { emoji: string; by: "me" | "them" | "both" }) => ({ emoji: r.emoji, by: r.by })) } : {}),
    ...(reply ? { reply } : {}),
  } as ChatMessage;
}

/** A question card as the page draws it. */
function questionView(q: Raw): NonNullable<ChatMessage["question"]> {
  const choices = (Array.isArray(q.choices) ? q.choices : [])
    .map((c: Raw) => (typeof c === "string" ? c : c?.label))
    .filter((c: unknown) => typeof c === "string");
  const answered = {
    ...(typeof q.sent === "number" && q.sent >= 0 ? { sent: q.sent } : {}),
    ...(typeof q.said === "string" ? { said: q.said } : q.sent === -1 ? { said: "" } : {}),
  };
  // a card with more than one pick, its own words or a note to send cannot be answered with one tap
  const words = !!(q.multi || q.other || q.noteRequiredFor !== undefined);
  const steps = q.kind === "Plan" && Array.isArray(q.steps) ? q.steps.filter((x: unknown) => typeof x === "string") : [];
  return { id: String(q.id), choices, ...answered, ...(words ? { words } : {}), ...(steps.length ? { steps } : {}) };
}

/** One message of Lineclear's chat as the page draws it, or undefined when it has nothing to show. */
function messageView(m: Raw, sizes: ReadonlyMap<string, number>): ChatMessage | undefined {
  const base = messageBase(m);
  if (m.file && typeof m.file.path === "string")
    return { ...base, file: fileView({ name: String(m.file.name ?? basename(m.file.path)), path: m.file.path }, sizes) };
  if (typeof m.text === "string" && m.text.trim()) return { ...base, text: m.text };
  if (m.question && typeof m.question.title === "string") return { ...base, text: m.question.title, question: questionView(m.question) };
  if (m.artifact && typeof m.artifact.title === "string") return { ...base, text: `Made **${m.artifact.title}**. It opens in the chat.` };
  return undefined;
}

/** Lineclear's chat (its `Chat`), as the page draws it. */
export function chatView(chat: Raw, sizes: ReadonlyMap<string, number> = new Map()): Omit<ChatView, "state"> {
  const messages: ChatMessage[] = [];
  for (const m of (Array.isArray(chat?.messages) ? chat.messages : []) as Raw[]) {
    const view = messageView(m, sizes);
    if (view) messages.push(view);
  }
  const now = chat?.live?.now;
  return {
    messages: messages.slice(-HISTORY),
    writing: !!chat?.working && !chat?.background,
    ...(typeof now?.doing === "string" && now.doing ? { doing: now.doing } : {}),
    failed: (Array.isArray(chat?.failed) ? chat.failed : [])
      .filter((f: Raw) => typeof f?.cid === "string")
      .map((f: Raw) => ({ cid: f.cid, error: String(f.error ?? "It could not go in.") })),
  };
}

const OFFLINE = "The board server is not running on this machine, so the Dispatcher cannot be reached.";
const NONE = "There is no Dispatcher yet.";
const NO_TASK_CHAT = "This task has no chat.";
const SLOW = "The board server has not said yet that the Dispatcher took it. Try again: it goes in only once.";
const GONE = "An attached file is gone. Attach it again.";

/** Which chat of Lineclear's snapshot a link follows, and what it says when there is none. */
/** The parts of Lineclear's snapshot a chat link reads. */
interface Snapshot {
  host?: string;
  places?: { name?: string; machine?: string; chat?: string; home?: boolean }[];
  tasks?: { id?: string; agent?: { chat?: string } }[];
}

interface ChatTarget {
  find: (snap: Snapshot | undefined) => string | undefined;
  none: string;
}

export const DISPATCHER: ChatTarget = {
  none: NONE,
  find: (snap) => {
    const places = Array.isArray(snap?.places) ? snap.places : [];
    const own = places.filter((p) => p.name === DISPATCHER_SPACE && !p.home && typeof p.chat === "string");
    return (own.find((p) => p.machine === snap?.host) ?? own[0])?.chat;
  },
};

const taskTarget = (id: string): ChatTarget => ({ none: NO_TASK_CHAT, find: (snap) => taskChatKey(snap, id) });

/** The live link to the Dispatcher's chat; see `lineclearChat`. */
export function dispatcherChat(env: Env = process.env, retryMs = 3000, sendMs = 120_000, makeDispatcher?: () => number | Promise<number>) {
  return lineclearChat(env, DISPATCHER, retryMs, sendMs, makeDispatcher);
}

/** The live link to one task's chat with its agent. */
function taskChat(id: string, env: Env = process.env) {
  return lineclearChat(env, taskTarget(id));
}

/** Gives a file to Lineclear for the chat. Returns the path it saved it at, or why it did not. */
async function saveToServer(base: string, key: string, name: string, type: string, bytes: Uint8Array): Promise<string | { error: string; status: number }> {
  try {
    const form = new FormData();
    form.append("chat", key);
    form.append("file", new File([new Uint8Array(bytes)], name, { type }));
    const r = await fetch(`${base}/api/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    const path = ((await r.json().catch(() => ({}))) as { path?: unknown }).path;
    if (!r.ok || typeof path !== "string") return { error: `The board server did not save ${name}.`, status: 502 };
    return path;
  } catch {
    return { error: OFFLINE, status: 503 };
  }
}

/** A file of the chat, read from Lineclear: an image shows inline, anything else downloads. */
async function fileResponse(base: string, key: string, path: string): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(`${base}/api/file?${new URLSearchParams({ chat: key, path })}`, { signal: AbortSignal.timeout(30_000) });
  } catch {
    return Response.json({ error: OFFLINE }, { status: 503 });
  }
  if (!r.ok) return Response.json({ error: "There is no such file." }, { status: 404 });
  const bytes = new Uint8Array(await r.arrayBuffer());
  // shown inline only when its bytes are the image its name says
  const named = IMAGE_TYPES[extname(path).toLowerCase()];
  const type = named && imageType(bytes) === named ? named : undefined;
  const name = basename(path)
    .replace(/^[a-z0-9]+-/, "")
    .replace(/["\\\r\n]/g, "");
  return new Response(bytes, {
    headers: {
      "content-type": type ?? "application/octet-stream",
      "content-disposition": `${type ? "inline" : "attachment"}; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=3600",
    },
  });
}

/**
 * The live link to one chat of Lineclear: one WebSocket to it, opened when a page first asks and opened again
 * when it drops. Each change of the chat goes to every listener at once, so a reply shows as Lineclear reads it.
 */
function chatLink(env: Env, target: ChatTarget, retryMs: number, sizes: Map<string, number>, makeDispatcher?: () => number | Promise<number>) {
  // a missing Dispatcher is made once, here, so no one is asked to run a command
  let madeAt = 0;
  let view: ChatView = { state: "loading", messages: [], writing: false, failed: [] };
  let ws: WebSocket | undefined;
  let key: string | undefined;
  let base: string | undefined;
  let tried = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(v: ChatView) => void>();
  const set = (v: ChatView) => {
    view = v;
    for (const f of listeners) f(view);
  };
  const down = (state: "offline" | "none", reason: string) => {
    ws = undefined;
    set({ ...view, state, reason, writing: false });
    // try again while someone listens
    if (listeners.size && !timer) timer = setTimeout(() => ((timer = undefined), void connect()), retryMs);
  };

  const lost = (sock: unknown) => {
    if (ws === sock) down("offline", OFFLINE);
  };

  async function connect() {
    if (ws) return;
    tried = Date.now();
    base = lineclearServer(env);
    if (!base) return down("offline", OFFLINE);
    const snap: Raw = await readSnapshot(base);
    if (snap === undefined) return down("offline", OFFLINE);
    const found = target.find(snap);
    // a failed setup is tried again after a minute, not on every retry
    if (!found && makeDispatcher && Date.now() - madeAt > 60_000) {
      madeAt = Date.now();
      if ((await makeDispatcher()) === 0) return void (await connect());
    }
    if (!found) return down("none", target.none);
    key = found;
    if (ws) return;
    ws = watchSocket(
      base,
      { chats: [key], term: null },
      (m) => {
        if (m?.type === "chat" && m.chat?.key === key) set({ state: "ready", ...chatView(m.chat, sizes) });
      },
      lost,
    );
  }

  const ensure = () => {
    if (!ws && !timer && Date.now() - tried > 1000) void connect();
  };

  return {
    ensure,
    view: () => view,
    base: () => base,
    key: () => key,
    listen(f: (v: ChatView) => void) {
      listeners.add(f);
      ensure();
      return () => void listeners.delete(f);
    },
    close() {
      if (timer) clearTimeout(timer);
      listeners.clear();
      const sock = ws;
      ws = undefined;
      sock?.close();
    },
  };
}

/** The chat of one target, with the actions a page takes on it. */
function lineclearChat(env: Env, target: ChatTarget, retryMs = 3000, sendMs = 120_000, makeDispatcher?: () => number | Promise<number>) {
  // what you attached here, by the id the page holds: its path in Lineclear's inbox
  const uploads = new Map<string, { path: string; at: number }>();
  const sizes = new Map<string, number>();
  const link = chatLink(env, target, retryMs, sizes, makeDispatcher);
  const { ensure } = link;
  // Lineclear answers once the Dispatcher took it, which waits for a stopped one to start
  const act = (action: Record<string, unknown>) => postAction(link.base() ?? "", action, sendMs, OFFLINE, SLOW);

  /** Why the chat cannot take an action now, or undefined when it can. */
  const notReady = () => {
    ensure();
    return !link.base() || !link.key() || link.view().state !== "ready" ? { error: link.view().reason ?? OFFLINE, status: 503 } : undefined;
  };

  return {
    view: () => (ensure(), link.view()),
    /** Calls `f` with each new view until the returned function is called. */
    listen: link.listen,
    /** Sends your words and the files you attached here, by their ids, to the Dispatcher. Gives the reason when it cannot. */
    async send(text: string, ids: string[], cid?: string, reply?: string): Promise<{ error: string; status: number } | undefined> {
      ensure();
      if (link.view().state === "none") return { error: target.none, status: 404 };
      const files = ids.map((id) => uploads.get(id)?.path);
      if (files.some((f) => !f)) return { error: GONE, status: 400 };
      return notReady() ?? act({ type: "send", chat: link.key(), text, attachments: files, ...(cid ? { cid } : {}), ...(reply ? { reply } : {}) });
    },
    /** Puts your reaction on a message, or takes it off when it is there already, as Lineclear's own chat does. */
    async react(message: string, emoji: string): Promise<{ error: string; status: number } | undefined> {
      return notReady() ?? act({ type: "react", chat: link.key(), message, emoji });
    },
    /** Answers a card the Dispatcher asked with, by the number of its choice, as Lineclear's own chat does. */
    async answer(question: string, choice: number): Promise<{ error: string; status: number } | undefined> {
      return notReady() ?? act({ type: "answer", chat: link.key(), question, choice });
    },
    /** Attaches a file: checked here, then saved by Lineclear for the Dispatcher. Gives its id, or why it is refused. */
    async upload(name: string, bytes: Uint8Array): Promise<({ id: string } & ChatFile) | { error: string; status: number }> {
      const plain = basename(name.replace(/\\/g, "/")).trim() || "file";
      const checked = checkUpload(plain, bytes);
      if ("error" in checked) return { error: checked.error, status: bytes.length > MAX_FILE_BYTES ? 413 : bytes.length === 0 ? 400 : 415 };
      ensure();
      if (link.view().state === "none") return { error: target.none, status: 404 };
      const base = link.base();
      const key = link.key();
      if (!base || !key || link.view().state !== "ready") return { error: link.view().reason ?? OFFLINE, status: 503 };
      const path = await saveToServer(base, key, plain, checked.type, bytes);
      if (typeof path !== "string") return path;
      const id = crypto.randomUUID();
      // the page sends a message soon after it attaches: an id it never sends is forgotten after a day
      const t = Date.now();
      for (const [k, u] of uploads) if (t - u.at > 86_400_000) uploads.delete(k);
      uploads.set(id, { path, at: t });
      sizes.set(path, bytes.length);
      return { id, name: plain, size: bytes.length, image: checked.image, url: fileUrl(path) };
    },
    /** A file of the chat, read from Lineclear: an image shows inline, anything else downloads. */
    async file(path: string): Promise<Response> {
      ensure();
      const base = link.base();
      const key = link.key();
      if (!base || !key) return Response.json({ error: link.view().reason ?? OFFLINE }, { status: 503 });
      return fileResponse(base, key, path);
    },
    close: link.close,
  };
}

export type DispatcherChat = ReturnType<typeof dispatcherChat>;

/** The chats of the tasks whose pages are open. */
export function taskChatLinks(env: Env = process.env, keep = 8) {
  return keepLinks((id) => taskChat(id, env), keep);
}

/** The body of one message the page sends, checked. Its files are the ids `upload` gave. */
export function parseSend(body: Raw): { text: string; files: string[]; cid?: string; reply?: string } | string {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const ids = Array.isArray(body?.files) ? body.files : [];
  if (!text && !ids.length) return "Write something or attach a file.";
  if (text.length > MAX_TEXT) return `A message can be at most ${MAX_TEXT.toLocaleString("en")} characters.`;
  if (ids.length > MAX_FILES) return `A message can carry at most ${MAX_FILES} files.`;
  if (ids.some((id: unknown) => typeof id !== "string")) return GONE;
  const cid = typeof body?.cid === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.cid) ? body.cid : undefined;
  const reply = typeof body?.reply === "string" && body.reply.length <= 200 ? body.reply : undefined;
  return { text, files: ids, ...(cid ? { cid } : {}), ...(reply ? { reply } : {}) };
}

/** The live chat as server-sent events: the whole view at once, then again at each change. */
export function chatEvents(chat: DispatcherChat, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const push = (v: ChatView) => {
        try {
          c.enqueue(enc.encode(`data: ${JSON.stringify(v)}\n\n`));
        } catch {
          stop();
        }
      };
      // a comment now and then, so no idle limit on the way cuts the stream
      const beat = setInterval(() => {
        try {
          c.enqueue(enc.encode(": beat\n\n"));
        } catch {
          stop();
        }
      }, 5000);
      const off = chat.listen(push);
      stop = () => {
        clearInterval(beat);
        off();
        try {
          c.close();
        } catch {
          // closed already
        }
      };
      signal.addEventListener("abort", () => stop());
      push(chat.view());
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
