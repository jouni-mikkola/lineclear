// A stand-in for Lineclear's server, for the chat's tests: its snapshot names the Dispatcher's space, its WebSocket
// sends the Dispatcher's chat to a watcher, its upload saves a file in its own inbox folder and serves it back for that
// chat only, and its send action keeps what came and answers as the Dispatcher would.
// `bun ui/test/fake-lineclear-server.ts <lineclear dir>` runs it on its own and writes server.json there, as Lineclear
// does; `POST /fake/chat` sets the chat, `POST /fake/stop` takes it down, and `GET /fake/actions` lists what was sent.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { exitWhenParentGone } from "../../src/reaper.ts";

/** A parsed file or event read as it is: its shape is not ours to promise. */
type Raw = any;

export const DISPATCHER_KEY = "p:box:dispatcher";
export const TASK_KEY = "t:box:WEB-3";

/** What the snapshot adds with `task: true`: a task with an agent chat. */
const TASK_SNAPSHOT = {
  tasks: [{ id: "WEB-3", agent: { chat: TASK_KEY } }],
};

/** Lineclear's snapshot: the home space, the Dispatcher's unless `dispatcher` is false, and a task for `task`. */
const snapshotOf = (o: { dispatcher?: boolean; task?: boolean }) => ({
  host: "box",
  places: [
    { id: "p:box:~", name: "home", machine: "box", home: true, chat: "p:box:~" },
    ...(o.dispatcher !== false ? [{ id: DISPATCHER_KEY, name: "dispatcher", machine: "box", home: false, chat: DISPATCHER_KEY }] : []),
  ],
  ...(o.task ? TASK_SNAPSHOT : {}),
});

/** The screen the fake terminal sends a watcher. */
const TERMINAL_FRAME = JSON.stringify({ type: "terminal", chat: TASK_KEY, ansi: "\x1b[32m$\x1b[0m ready", cols: 80, rows: 24 });

/** What the fake Dispatcher says: words, or a card with choices. */
export type Reply = string | { question: { title: string; choices: string[] } };

export interface FakeLineclear {
  url: string;
  port: number;
  actions: Raw[];
  /** Where it saves what is uploaded, as Lineclear's inbox. */
  inbox: string;
  setChat(chat: Raw): void;
  stop(): void;
}

function stopAndClean(server: { stop(force: boolean): void }, inbox: string) {
  server.stop(true);
  rmSync(inbox, { recursive: true, force: true });
}

/** What the routes of the fake share: its options, the actions it saw, a counter for ids and the chat it shows. */
interface Fake {
  o: NonNullable<Parameters<typeof startFakeLineclear>[0]>;
  inbox: string;
  actions: Raw[];
  n: number;
  chat(): Raw;
  setChat(c: Raw): void;
}

async function upload(f: Fake, req: Request): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return Response.json({ error: "No file" }, { status: 400 });
  const dir = join(f.inbox, String(form.get("chat")).replace(/[^a-z0-9]+/gi, "_"));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${Date.now().toString(36)}${++f.n}-${file.name.replace(/[^a-zA-Z0-9_. -]+/g, "_")}`);
  writeFileSync(path, new Uint8Array(await file.arrayBuffer()));
  return Response.json({ path });
}

/** Only a file in this chat's own inbox folder. */
function fileReply(inbox: string, url: URL): Response {
  const path = url.searchParams.get("path") ?? "";
  const ok = url.searchParams.get("chat") === DISPATCHER_KEY && dirname(path) === join(inbox, DISPATCHER_KEY.replace(/[^a-z0-9]+/gi, "_")) && existsSync(path);
  return ok ? new Response(readFileSync(path)) : new Response("no such file", { status: 404 });
}

/** The Dispatcher's reply to a send or an answer, as the `reply` option plays it. */
async function say(f: Fake, text: string, answer?: boolean): Promise<void> {
  const r = await f.o.reply?.(text, answer);
  if (r === undefined) return;
  const m =
    typeof r === "string"
      ? { text: r }
      : { question: { id: `q${++f.n}`, kind: "Question", to: "agent", title: r.question.title, choices: r.question.choices.map((label) => ({ label })) } };
  f.setChat({ ...f.chat(), messages: [...f.chat().messages, { id: `a${++f.n}`, who: "agent", at: Date.now(), ...m }], working: false, live: undefined });
}

async function answerCard(f: Fake, a: Raw): Promise<Response> {
  const chat = f.chat();
  const card = chat.messages.find((m: Raw) => m.question?.id === a.question);
  if (!card || card.question.sent !== undefined) return Response.json({ ok: false, error: "This card no longer waits on you." });
  const label = card.question.choices[a.choice]?.label;
  if (label === undefined) return Response.json({ ok: false, error: "Choose one of the options on the card." });
  f.setChat({ ...chat, messages: chat.messages.map((m: Raw) => (m === card ? { ...m, question: { ...m.question, sent: a.choice } } : m)) });
  if (f.o.reply) await say(f, label, true);
  return Response.json({ ok: true });
}

async function send(f: Fake, a: Raw): Promise<Response> {
  // a slash command goes into the CLI, not the chat (the web chat sends /new before each Dispatcher request)
  if (typeof a.text === "string" && a.text.startsWith("/")) return Response.json({ waiting: false, at: Date.now() });
  if (a.text === "fail please") return Response.json({ ok: false, error: "The Dispatcher could not take it." });
  const mine = [
    ...(a.text ? [{ id: `y${++f.n}`, who: "you", text: a.text, cid: a.cid, at: Date.now() }] : []),
    ...(a.attachments ?? []).map((p: string) => ({
      id: `y${++f.n}`,
      who: "you",
      file: { name: (p.split("/").pop() ?? "").replace(/^[a-z0-9]+-/, ""), path: p },
      cid: a.cid,
      at: Date.now(),
    })),
  ];
  f.setChat({
    ...f.chat(),
    messages: [...f.chat().messages, ...mine],
    working: true,
    live: { id: "t", at: Date.now(), rows: [], steps: 1, now: { doing: "Checking the task list" } },
  });
  if (f.o.reply) await say(f, a.text ?? "");
  else if (f.o.answer !== false) {
    const agent = { id: `a${++f.n}`, who: "agent", text: "Line clear.\n\n- **web-shop**: 2 tasks at work", at: Date.now() };
    setTimeout(() => f.setChat({ ...f.chat(), messages: [...f.chat().messages, agent], working: false, live: undefined }), 400);
  }
  return Response.json({ waiting: false, at: Date.now() });
}

async function act(f: Fake, a: Raw): Promise<Response> {
  f.actions.push(a);
  if (f.o.slowMs) await Bun.sleep(f.o.slowMs);
  if ((a.type === "keys" || a.type === "text") && a.chat === TASK_KEY) return Response.json({ ok: true });
  if (a.type === "answer" && a.chat === DISPATCHER_KEY) return answerCard(f, a);
  if (a.type !== "send" || a.chat !== DISPATCHER_KEY) return Response.json({ ok: false, error: "No such chat." });
  return send(f, a);
}

/**
 * Starts the fake. With `dispatcher: false` the snapshot has no Dispatcher's space. `answer` replies to each send.
 * `reply` plays the Dispatcher: the text it gives is the answer to each send, or a card with choices it asks with. An
 * answer to a card comes to `reply` as the chosen choice's words, with `answer` set. `slowMs` holds each send that long before it answers, as Lineclear does while the Dispatcher starts.
 */
export function startFakeLineclear(
  o: {
    task?: boolean;
    dispatcher?: boolean;
    answer?: boolean;
    port?: number;
    slowMs?: number;
    reply?: (text: string, answer?: boolean) => Reply | Promise<Reply>;
  } = {},
): FakeLineclear {
  const actions: Raw[] = [];
  const inbox = mkdtempSync(join(tmpdir(), "fake-lineclear-inbox-"));
  let chat: Raw = { key: DISPATCHER_KEY, messages: [], cli: "pi" };
  const socks = new Set<Raw>();
  const push = () => {
    for (const s of socks) if (s.data.watch) s.send(JSON.stringify({ type: "chat", chat }));
  };
  const setChat = (c: Raw) => {
    chat = { key: DISPATCHER_KEY, cli: "pi", ...c };
    push();
  };
  const fake: Fake = { o, inbox, actions, n: 0, chat: () => chat, setChat };
  const server = Bun.serve<{ watch: boolean }>({
    port: o.port ?? 0,
    hostname: "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/api/ws") return srv.upgrade(req, { data: { watch: false } }) ? undefined : new Response("no", { status: 400 });
      if (url.pathname === "/api/snapshot") return Response.json(snapshotOf(o));
      if (url.pathname === "/api/upload" && req.method === "POST") return upload(fake, req);
      if (url.pathname === "/api/file") return fileReply(inbox, url);
      if (url.pathname === "/api/action" && req.method === "POST") return act(fake, (await req.json()) as Raw);
      if (url.pathname === "/fake/chat" && req.method === "POST") {
        setChat(await req.json());
        return Response.json({});
      }
      if (url.pathname === "/fake/actions") return Response.json(actions);
      if (url.pathname === "/fake/stop" && req.method === "POST") {
        setTimeout(() => process.exit(0), 50);
        return Response.json({});
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
    websocket: {
      open(ws) {
        socks.add(ws);
      },
      message(ws, msg) {
        const m = JSON.parse(String(msg));
        if (m.type === "watch" && m.term === TASK_KEY) ws.send(TERMINAL_FRAME);
        if (m.type === "watch" && m.chats.includes(DISPATCHER_KEY)) {
          ws.data.watch = true;
          ws.send(JSON.stringify({ type: "chat", chat }));
        }
      },
      close(ws) {
        socks.delete(ws);
      },
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, port: server.port!, actions, inbox, setChat, stop: () => stopAndClean(server, inbox) };
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: bun ui/test/fake-lineclear-server.ts <lineclear dir>");
  const fake = startFakeLineclear({ port: Number(process.argv[3] ?? 0) });
  mkdirSync(dir, { recursive: true });
  // a stopped or killed fake leaves no inbox folder behind
  process.on("exit", fake.stop);
  process.on("SIGTERM", () => process.exit(0));
  // a run that is killed cannot stop its server, so the server ends itself once its parent is gone
  exitWhenParentGone(process.ppid, Number(process.env.LINECLEAR_REAPER_MS ?? 5000));
  writeFileSync(join(dir, "server.json"), JSON.stringify({ port: fake.port, pid: process.pid }));
}
