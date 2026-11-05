// What a task's view reads besides its chat: the agent's live terminal, which you read and type into, and the
// artifacts its agent made. Both come from Shepherdr's server: the terminal over its WebSocket and its actions, the
// artifacts from its snapshot, with each page passed on sealed as Shepherdr sends it.
import { keepLinks, postAction, readSnapshot, shepherdrServer, taskChatKey, watchSocket } from "./shepherdr-client.ts";

type Env = Record<string, string | undefined>;

export interface TerminalView {
  state: "loading" | "ready" | "offline" | "none";
  /** The recent lines as herdr draws them, with ANSI colours. */
  ansi: string;
  /** The pane's size in cells, when Shepherdr knows it. */
  cols?: number;
  rows?: number;
  reason?: string;
}

export interface TaskArtifact {
  id: string;
  title: string;
  /** The newest version. */
  v: number;
  when: string;
  by: string;
  /** Shepherdr's check made a picture of it. */
  checked: boolean;
  /** Newest first. */
  versions: { n: number; when: string; by: string; note?: string }[];
}

const OFFLINE = "The board server is not running on this machine, so the terminal cannot be reached.";
const NONE = "This task has no terminal.";
/** The keys the page may press; herdr names them. */
const KEYS = ["enter", "esc", "up", "down", "left", "right", "tab", "backspace", "ctrl-c"] as const;
const MAX_INPUT = 4000;

/** The live link to one task's terminal: one WebSocket to Shepherdr, opened when a page first asks and again once it drops. */
function taskTerminal(id: string, env: Env = process.env, retryMs = 3000) {
  let view: TerminalView = { state: "loading", ansi: "" };
  let ws: WebSocket | undefined;
  let target: { base: string; key: string } | undefined;
  let tried = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(v: TerminalView) => void>();
  const set = (v: TerminalView) => {
    view = v;
    for (const f of listeners) f(view);
  };
  const retry = () => {
    timer = undefined;
    void connect();
  };
  const down = (state: "offline" | "none", reason: string) => {
    ws = undefined;
    set({ state, ansi: "", reason });
    if (listeners.size && !timer) timer = setTimeout(retry, retryMs);
  };

  async function connect() {
    if (ws) return;
    tried = Date.now();
    const base = shepherdrServer(env);
    const snap = base ? ((await readSnapshot(base)) as Parameters<typeof taskChatKey>[0]) : undefined;
    if (!base || !snap) return down("offline", OFFLINE);
    const key = taskChatKey(snap, id);
    if (!key) return down("none", NONE);
    if (ws) return;
    target = { base, key };
    ws = watchSocket(
      base,
      { chats: [key], term: key, visible: true },
      (m) => {
        if (m?.type === "terminal" && m.chat === key && typeof m.ansi === "string") {
          set({
            state: "ready",
            ansi: m.ansi,
            ...(typeof m.cols === "number" ? { cols: m.cols } : {}),
            ...(typeof m.rows === "number" ? { rows: m.rows } : {}),
          });
        }
      },
      (sock) => {
        if (ws === sock) down("offline", OFFLINE);
      },
    );
  }

  const ensure = () => {
    if (!ws && !timer && Date.now() - tried > 1000) void connect();
  };
  const act = async (action: Record<string, unknown>) =>
    view.state === "ready" && target
      ? postAction(target.base, { ...action, chat: target.key }, 10_000, OFFLINE, OFFLINE)
      : { error: view.reason ?? "The terminal is not connected yet.", status: 503 };

  return {
    view: () => {
      ensure();
      return view;
    },
    listen(f: (v: TerminalView) => void) {
      listeners.add(f);
      ensure();
      return () => void listeners.delete(f);
    },
    /** Types words into the terminal; `enter` presses Enter after them. */
    async type(text: string, enter: boolean) {
      if (!text.length || text.length > MAX_INPUT) return { error: `Type 1 to ${MAX_INPUT} characters.`, status: 400 };
      return (await act({ type: "text", text })) ?? (enter ? await act({ type: "keys", keys: ["enter"] }) : undefined);
    },
    press: (keys: string[]) => act({ type: "keys", keys }),
    close() {
      clearTimeout(timer);
      timer = undefined;
      const s = ws;
      ws = undefined;
      s?.close();
      listeners.clear();
    },
  };
}

/** Terminal links, one per task, the eight last asked for kept. */
export const taskTerminalLinks = (env: Env = process.env, keep = 8) => keepLinks((id) => taskTerminal(id, env), keep);

/** The terminal as server-sent events: the whole screen at once, then again at each change. */
function terminalEvents(term: ReturnType<typeof taskTerminal>, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const push = (v: TerminalView) => {
        try {
          c.enqueue(enc.encode(`data: ${JSON.stringify(v)}\n\n`));
        } catch {
          stop();
        }
      };
      const off = term.listen(push);
      push(term.view());
      stop = () => {
        off();
        try {
          c.close();
        } catch {
          // already closed
        }
      };
      signal.addEventListener("abort", stop);
    },
    cancel: () => stop(),
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}

interface SnapArtifact {
  id?: string;
  title?: string;
  v?: number;
  at?: number;
  when?: string;
  by?: string;
  thumb?: boolean;
  chats?: string[];
  versions?: { n?: number; when?: string; by?: string; note?: string }[];
}

/** Whether an artifact of Shepherdr's snapshot is the task's: made in its agent's chat. */
const isTasks = (a: SnapArtifact, key: string) => Array.isArray(a.chats) && a.chats.includes(key);

/** The artifacts of a task, newest first, or the reason Shepherdr cannot be read. */
const OWNED_MS = 2000;
const owned = new Map<string, { at: number; list: Promise<TaskArtifact[] | { error: string }> }>();

/** The artifacts of a task, read from Shepherdr's snapshot at most every two seconds, so each picture of a long list does not read it again. */
function taskArtifacts(id: string, env: Env = process.env) {
  const k = `${shepherdrServer(env)}|${id}`;
  const kept = owned.get(k);
  if (kept && Date.now() - kept.at < OWNED_MS) return kept.list;
  const list = readArtifacts(id, env);
  owned.set(k, { at: Date.now(), list });
  if (owned.size > 64) owned.delete(owned.keys().next().value as string);
  return list;
}

async function readArtifacts(id: string, env: Env): Promise<TaskArtifact[] | { error: string }> {
  const base = shepherdrServer(env);
  const snap = base ? ((await readSnapshot(base)) as (Parameters<typeof taskChatKey>[0] & { artifacts?: SnapArtifact[] }) | undefined) : undefined;
  if (!snap) return { error: OFFLINE };
  const key = taskChatKey(snap, id) ?? "";
  return (Array.isArray(snap.artifacts) ? snap.artifacts : [])
    .filter((a) => typeof a?.id === "string" && isTasks(a, key))
    .sort((a, b) => Number(b.at) - Number(a.at))
    .map((a) => ({
      id: String(a.id),
      title: String(a.title ?? a.id),
      v: Number(a.v) || 1,
      when: String(a.when ?? ""),
      by: String(a.by ?? ""),
      checked: !!a.thumb,
      versions: (Array.isArray(a.versions) ? a.versions : []).map((v) => ({
        n: Number(v.n),
        when: String(v.when ?? ""),
        by: String(v.by ?? ""),
        ...(v.note ? { note: v.note } : {}),
      })),
    }));
}

const FRAME_POLICY = "sandbox allow-scripts allow-forms; frame-ancestors 'self'";
const PASSED = ["content-type", "content-security-policy", "x-content-type-options", "cache-control"];

/** One page or picture of a task's artifact, passed on as Shepherdr sends it, under a sandbox policy of Lineclear's own. */
async function artifactPart(id: string, artifact: string, part: "frame" | "thumb", query: URLSearchParams, env: Env = process.env): Promise<Response> {
  const list = await taskArtifacts(id, env);
  if ("error" in list) return Response.json({ error: list.error }, { status: 503 });
  if (!list.some((a) => a.id === artifact)) return Response.json({ error: "This task has no such artifact." }, { status: 404 });
  const base = shepherdrServer(env);
  const q = new URLSearchParams();
  const v = Number(query.get("v"));
  if (Number.isInteger(v) && v > 0) q.set("v", String(v));
  if (part === "frame") {
    q.set("theme", "dark");
    if (query.has("full")) q.set("full", "1");
  } else q.set("dark", "1");
  try {
    const r = await fetch(`${base}/api/artifacts/${encodeURIComponent(artifact)}${part === "thumb" ? "/thumb" : ""}?${q}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const headers = new Headers();
    for (const h of PASSED) {
      const value = r.headers.get(h);
      if (value !== null) headers.set(h, value);
    }
    // Lineclear's own seal comes with Shepherdr's (both hold), so a reply without Shepherdr's still cannot run with this address's rights
    headers.set("x-content-type-options", "nosniff");
    if (part === "frame") headers.append("content-security-policy", FRAME_POLICY);
    else if (!(headers.get("content-type") ?? "").startsWith("image/")) return Response.json({ error: "Shepherdr sent no picture." }, { status: 502 });
    return new Response(r.body, { status: r.status, headers });
  } catch {
    return Response.json({ error: OFFLINE }, { status: 503 });
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * A task's terminal (`/terminal`, its `/events`, and `POST /terminal/input` with `{text, enter}` or `{keys}`) and its
 * artifacts (`/artifacts`, and each page or picture at `/artifacts/<id>/frame|thumb`). `own` is whether the request
 * came from Lineclear's own page, which only input needs.
 */
export async function taskLiveApi(
  req: Request,
  url: URL,
  id: string,
  rest: string,
  links: ReturnType<typeof taskTerminalLinks>,
  own: boolean,
  env: Env,
): Promise<Response> {
  const [, what, tail = ""] = /^\/(terminal|artifacts)(\/.*)?$/.exec(rest) ?? [];
  if (what === "artifacts") {
    if (req.method !== "GET") return json({ error: "Not found" }, 404);
    if (!tail) {
      const list = await taskArtifacts(id, env);
      return "error" in list ? json(list, 503) : json(list);
    }
    const part = /^\/([a-z0-9]{1,16})\/(frame|thumb)$/.exec(tail);
    // a page of another site may not even learn whether an artifact is there
    if (!part || req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Not found" }, 404);
    return artifactPart(id, part[1] ?? "", part[2] as "frame" | "thumb", url.searchParams, env);
  }
  const term = links(id);
  if (req.method === "GET" && !tail) return json(term.view());
  if (req.method === "GET" && tail === "/events") return terminalEvents(term, req.signal);
  if (what !== "terminal" || req.method !== "POST" || tail !== "/input") return json({ error: "Not found" }, 404);
  if (!own) return json({ error: "A terminal takes input only from Lineclear's own pages." }, 403);
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; enter?: unknown; keys?: unknown };
  const keys = body.keys;
  const failed =
    typeof body.text === "string"
      ? await term.type(body.text, body.enter === true)
      : Array.isArray(keys) && keys.length > 0 && keys.length <= 8 && keys.every((k) => (KEYS as readonly unknown[]).includes(k))
        ? await term.press(keys as string[])
        : { error: `Send text, or keys from: ${KEYS.join(", ")}.`, status: 400 };
  return failed ? json({ error: failed.error }, failed.status) : json({ sent: true }, 202);
}
