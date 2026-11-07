// What a task's view reads besides its chat: the agent's live terminal, which you read and type into. It comes from
// Lineclear's server over its WebSocket and its actions.
import { keepLinks, postAction, readSnapshot, lineclearServer, taskChatKey, watchSocket } from "./lineclear-client.ts";

type Env = Record<string, string | undefined>;

interface TerminalView {
  state: "loading" | "ready" | "offline" | "none";
  /** The recent lines as herdr draws them, with ANSI colours. */
  ansi: string;
  /** The pane's size in cells, when Lineclear knows it. */
  cols?: number;
  rows?: number;
  reason?: string;
}

const OFFLINE = "The board server is not running on this machine, so the terminal cannot be reached.";
const NONE = "This task has no terminal.";
/** The keys the page may press; herdr names them. */
const KEYS = ["enter", "esc", "up", "down", "left", "right", "tab", "backspace", "ctrl-c"] as const;
const MAX_INPUT = 4000;

/** The live link to one task's terminal: one WebSocket to Lineclear, opened when a page first asks and again once it drops. */
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
    const base = lineclearServer(env);
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

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * A task's terminal (`/terminal`, its `/events`, and `POST /terminal/input` with `{text, enter}` or `{keys}`). `own` is
 * whether the request came from Lineclear's own page, which only input needs.
 */
export async function taskLiveApi(req: Request, id: string, rest: string, links: ReturnType<typeof taskTerminalLinks>, own: boolean): Promise<Response> {
  const [, what, tail = ""] = /^\/(terminal)(\/.*)?$/.exec(rest) ?? [];
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
