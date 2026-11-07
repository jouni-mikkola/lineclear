import { SESSION_NAME } from "./browser-cli.ts";
import { type browsers, Busy, parseInput } from "./browsers.ts";
import { chatEvents, type dispatcherChat, MAX_FILE_BYTES, namedImageResponse, parseSend, sizeText } from "./chat.ts";
import { type Env, fail, json, ownPage } from "./web-guard.ts";

type Chat = ReturnType<typeof dispatcherChat>;
type Live = ReturnType<typeof browsers>;

const bodyOf = (req: Request) => req.json().catch(() => ({}));
const settle = (failed: { error: string; status: number } | undefined, ok: Response) => (failed ? fail(failed.error, failed.status) : ok);

async function uploadFile(req: Request, chat: Chat): Promise<Response> {
  // base64 is a third bigger than the file; with no length the body is not read at all
  const length = req.headers.get("content-length");
  if (length === null) return fail("Send a file with its length.", 411);
  if (Number(length) > Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4096) return fail(`A file can be at most ${sizeText(MAX_FILE_BYTES)}.`, 413);
  const body = (await bodyOf(req)) as { name?: unknown; data?: unknown };
  if (typeof body.name !== "string" || !body.name.trim() || typeof body.data !== "string") return fail("Send a file's name and its data.");
  const saved = await chat.upload(body.name, Buffer.from(body.data, "base64"));
  return "error" in saved ? fail(saved.error, saved.status) : json(saved, 201);
}

async function answerCard(body: unknown, chat: Chat): Promise<Response> {
  const { question, choice } = body as { question?: unknown; choice?: unknown };
  if (typeof question !== "string" || !question || typeof choice !== "number" || !Number.isInteger(choice) || choice < 0)
    return fail("Send the card's id and the number of a choice.");
  return settle(await chat.answer(question, choice), json({ answered: true }));
}

async function sendMessage(body: unknown, chat: Chat): Promise<Response> {
  const m = parseSend(body);
  if (typeof m === "string") return fail(m);
  return settle(await chat.send(m.text, m.files, m.cid, m.reply), json({ sent: true }, 202));
}

const POSTS = new Set(["/", "/files", "/answer"]);

/** One chat under `root` (the Dispatcher's or a task's): its live view, a message to it, and the files that go with one. */
export async function chatApi(req: Request, url: URL, chat: () => Chat, env: Env, root: string): Promise<Response> {
  const p = url.pathname.slice(root.length) || "/";
  if (req.method === "GET") {
    if (p === "/") return json(chat().view());
    if (p === "/events") return chatEvents(chat(), req.signal);
    if (p === "/image" || p === "/file") {
      // another site may not even learn whether a file is there
      if (req.headers.get("sec-fetch-site") === "cross-site") return fail("Only Lineclear's own pages show these files.", 403);
      const path = url.searchParams.get("path") ?? "";
      return p === "/image" ? namedImageResponse(path, env) : chat().file(path);
    }
  }
  if (req.method !== "POST" || !POSTS.has(p)) return fail("Not found", 404);
  if (!ownPage(req, url, env)) return fail("The Dispatcher takes messages only from Lineclear's own pages.", 403);
  if (p === "/files") return uploadFile(req, chat());
  return (p === "/answer" ? answerCard : sendMessage)(await bodyOf(req), chat());
}

async function drive(live: Live, name: string, action: string, body: { take?: unknown }): Promise<Response> {
  const closed = fail(`The browser ${name} is not open.`, 404);
  if (action === "take") {
    if (typeof body.take !== "boolean") return fail("Say take: true or false.");
    return (await live.take(name, body.take)) ? json({ taken: body.take }) : closed;
  }
  const input = parseInput(body);
  if (typeof input === "string") return fail(input);
  const r = await live.input(name, input);
  return r === "ok" ? json({ sent: input.do }) : r === "closed" ? closed : fail("Take the browser over first.", 409);
}

/** The Agent browsers view's data. A browser that cannot be read answers 502 with playwright-cli's own words. */
export async function browserApi(req: Request, url: URL, live: Live, env: Env): Promise<Response> {
  try {
    if (req.method === "GET" && url.pathname === "/api/browsers") return json(await live.list(url.searchParams.has("live")));
    const m = /^\/api\/browsers\/([^/]+)\/(picture|take|input)$/.exec(url.pathname);
    const name = m ? decodeURIComponent(m[1] ?? "") : "";
    if (!m || !SESSION_NAME.test(name)) return fail("Not found", 404);
    if (req.method === "GET" && m[2] === "picture") {
      const jpeg = await live.picture(name, url.searchParams.get("size") === "thumb" ? "thumb" : "full");
      return jpeg
        ? new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } })
        : fail(`The browser ${name} is not open.`, 404);
    }
    if (req.method !== "POST" || m[2] === "picture") return fail("Not found", 404);
    if (!ownPage(req, url, env)) return fail("A browser is driven only from Lineclear's own pages.", 403);
    return await drive(live, name, m[2] ?? "", (await bodyOf(req)) as { take?: unknown });
  } catch (e) {
    if (e instanceof Busy) return fail("Too many pictures wait. Ask again in a moment.", 503);
    return fail(`playwright-cli: ${(e as Error).message}`, 502);
  }
}
