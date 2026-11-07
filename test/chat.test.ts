import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkUpload, dispatcherChat, MAX_FILE_BYTES, MAX_FILES, parseSend, taskChatLinks } from "../src/chat.ts";
import { PAGE_TOKEN, type webApi } from "../src/web.ts";
import { DISPATCHER_KEY, startFakeLineclear } from "../ui/test/fake-lineclear-server.ts";
import { freshWebApi, waitFor } from "./helpers.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const b64 = (b: Uint8Array | string) => Buffer.from(b).toString("base64");

const api = freshWebApi;

const req = (path: string, body?: unknown, headers: Record<string, string> = { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN }) => {
  const json = JSON.stringify(body);
  return new Request(
    `http://127.0.0.1:7420${path}`,
    body === undefined ? { headers } : { method: "POST", headers: { "content-length": String(Buffer.byteLength(json)), ...headers }, body: json },
  );
};

/** The chat view once `ok` holds, read again until then. */
async function viewWhen(handle: ReturnType<typeof webApi>, ok: (v: any) => boolean) {
  let v: any;
  await waitFor(async () => ok((v = await (await handle(req("/api/chat"))).json())), "the chat view to match");
  return v;
}

test("an upload is refused when too big, empty, of a type not taken, or not what its name says", () => {
  expect(checkUpload("shot.png", PNG)).toEqual({ image: true, type: "image/png" });
  expect(checkUpload("notes.md", new TextEncoder().encode("# Notes"))).toMatchObject({ image: false });
  expect(checkUpload("spec.pdf", new TextEncoder().encode("%PDF-1.7 ..."))).toMatchObject({ image: false, type: "application/pdf" });
  const big = new Uint8Array(MAX_FILE_BYTES + 1);
  big.set(PNG);
  expect(checkUpload("big.png", big)).toEqual({ error: "big.png is too big: a file can be at most 10 MB." });
  expect(checkUpload("empty.txt", new Uint8Array())).toEqual({ error: "empty.txt is empty." });
  expect(checkUpload("tool.exe", PNG)).toMatchObject({ error: expect.stringContaining("cannot be attached") });
  expect(checkUpload("page.svg", new TextEncoder().encode("<svg/>"))).toMatchObject({ error: expect.stringContaining("cannot be attached") });
  expect(checkUpload("fake.png", new TextEncoder().encode("hello"))).toEqual({ error: "fake.png is not the image its name says." });
  expect(checkUpload("bin.txt", new Uint8Array([104, 0, 105]))).toEqual({ error: "bin.txt is not text." });
  expect(checkUpload("latin.txt", new Uint8Array([0xff, 0xfe, 0x41]))).toEqual({ error: "latin.txt is not text." });
});

test("POST /api/chat/files saves a file through Lineclear for the Dispatcher, checked, and only from its own pages", async () => {
  const fake = startFakeLineclear();
  try {
    const { handle } = api(fake.url);
    await viewWhen(handle, (v) => v.state === "ready");
    const r = await handle(req("/api/chat/files", { name: "../../screen shot.png", data: b64(PNG) }));
    expect(r.status).toBe(201);
    const saved = (await r.json()) as any;
    expect(saved).toMatchObject({ name: "screen shot.png", size: PNG.length, image: true });
    // Lineclear saved it in its inbox, for the Dispatcher's chat
    const path = decodeURIComponent(saved.url.replace("/api/chat/file?path=", ""));
    expect(path.startsWith(fake.inbox)).toBe(true);
    expect(readFileSync(path)).toEqual(Buffer.from(PNG));
    // read back from Lineclear: an image inline, never sniffed
    const back = await handle(req(saved.url));
    expect(back.status).toBe(200);
    expect(back.headers.get("content-type")).toBe("image/png");
    expect(back.headers.get("x-content-type-options")).toBe("nosniff");
    // only the chat's own files, and only for Lineclear's own pages
    expect((await handle(req(`/api/chat/file?path=${encodeURIComponent("/etc/passwd")}`))).status).toBe(404);
    expect((await handle(req(saved.url, undefined, { "sec-fetch-site": "cross-site" }))).status).toBe(403);

    expect((await handle(req("/api/chat/files", { name: "tool.exe", data: b64(PNG) }))).status).toBe(415);
    expect((await handle(req("/api/chat/files", { name: "empty.txt", data: "" }))).status).toBe(400);
    expect((await handle(req("/api/chat/files", { name: "a.png", data: b64(PNG) }, { "content-type": "text/plain" }))).status).toBe(403);
    expect(
      (
        await handle(
          req(
            "/api/chat/files",
            { name: "a.png", data: b64(PNG) },
            { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, origin: "https://evil.example" },
          ),
        )
      ).status,
    ).toBe(403);
    const tooBig = new Request("http://127.0.0.1:7420/api/chat/files", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, "content-length": String(MAX_FILE_BYTES * 2) },
      body: "{}",
    });
    expect((await handle(tooBig)).status).toBe(413);
    // a body with no length is not read at all
    const stream = new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode("{}")), c.close()) });
    expect(
      (
        await handle(
          new Request("http://127.0.0.1:7420/api/chat/files", {
            method: "POST",
            headers: { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN },
            body: stream,
          }),
        )
      ).status,
    ).toBe(411);
    const big = new Uint8Array(MAX_FILE_BYTES + 10);
    big.set(PNG);
    const r2 = await handle(req("/api/chat/files", { name: "big.png", data: b64(big) }));
    expect(r2.status).toBe(413);
    expect(((await r2.json()) as any).error).toContain("at most 10 MB");
  } finally {
    fake.stop();
  }
});

test("a reply to a card keeps the Dispatcher's session, a new request starts a new one", async () => {
  const fake = startFakeLineclear();
  try {
    const { handle } = api(fake.url);
    await viewWhen(handle, (v) => v.state === "ready");
    await handle(req("/api/chat", { text: "kauppa", reply: "Which project is this for?" }));
    expect(fake.actions.map((a: any) => a.text)).toEqual(["kauppa"]);
    await handle(req("/api/chat", { text: "add a login page" }));
    expect(fake.actions.map((a: any) => a.text)).toEqual(["kauppa", "/new", "add a login page"]);
  } finally {
    fake.stop();
  }
});

test("a message and its files reach the Dispatcher's chat in Lineclear, with each file's path", async () => {
  const fake = startFakeLineclear();
  try {
    const { handle } = api(fake.url);
    await viewWhen(handle, (v) => v.state === "ready");
    const up = (await (await handle(req("/api/chat/files", { name: "notes.md", data: b64("# Plan\n") }))).json()) as any;
    const r = await handle(req("/api/chat", { text: "  Read this, please  ", files: [up.id], cid: "c1" }));
    expect(r.status).toBe(202);
    const path = decodeURIComponent(up.url.replace("/api/chat/file?path=", ""));
    expect(fake.actions).toEqual([
      { type: "send", chat: DISPATCHER_KEY, text: "/new" },
      { type: "send", chat: DISPATCHER_KEY, text: "Read this, please", attachments: [path], cid: "c1" },
    ]);
    // the Dispatcher reads it where the path says, in Lineclear's inbox
    expect(readFileSync(fake.actions[1].attachments[0], "utf8")).toBe("# Plan\n");
    expect(dirname(dirname(path))).toBe(fake.inbox);

    // the chat comes back as the page draws it: yours, your file, then the answer
    const writing = await viewWhen(handle, (v) => v.writing);
    expect(writing.doing).toBe("Checking the task list");
    const v = await viewWhen(handle, (v) => !v.writing && v.messages.length === 3);
    expect(v.messages[0]).toMatchObject({ who: "you", text: "Read this, please", cid: "c1" });
    expect(v.messages[1]).toMatchObject({ who: "you", cid: "c1", file: { name: "notes.md", image: false, size: 7, url: up.url } });
    expect(v.messages[2]).toMatchObject({ who: "dispatcher", text: expect.stringContaining("Line clear.") });
    // a file attached in Lineclear's own chat shows here too, read through Lineclear
    fake.setChat({ messages: [{ id: "s1", who: "you", file: { name: "shot.png", path: join(dirname(path), "zz1-shot.png") } }] });
    const theirs = await viewWhen(handle, (v) => v.messages.length === 1);
    expect(theirs.messages[0].file).toEqual({
      name: "shot.png",
      image: true,
      url: `/api/chat/file?path=${encodeURIComponent(join(dirname(path), "zz1-shot.png"))}`,
    });

    // the server's events stream says the same
    const ac = new AbortController();
    const ev = await handle(new Request("http://127.0.0.1:7420/api/chat/events", { signal: ac.signal }));
    expect(ev.headers.get("content-type")).toBe("text/event-stream");
    const first = new TextDecoder().decode((await ev.body!.getReader().read()).value);
    expect(JSON.parse(first.replace(/^data: /, "")).messages).toHaveLength(1);
    ac.abort();
  } finally {
    fake.stop();
  }
});

test("a send Lineclear is slow to take says so, not offline", async () => {
  const fake = startFakeLineclear({ slowMs: 300 });
  const dir = mkdtempSync(join(tmpdir(), "lc-chat-"));
  dirs.push(dir);
  const chat = dispatcherChat({ LINECLEAR_CONFIG: dir, LINECLEAR_URL: fake.url, HOME: dir }, 3000, 100);
  try {
    chat.listen(() => {});
    await waitFor(() => !(chat.view().state !== "ready"), "the chat to be ready");
    const slow = await chat.send("hi", [], "c9");
    expect(slow?.status).toBe(504);
    expect(slow?.error.includes("goes in only once")).toBe(true);
    expect(slow?.error.includes("not running")).toBe(false);
  } finally {
    chat.close();
    fake.stop();
  }
});

test("a message is checked before it goes: words or files, limits, files that exist, own pages only", async () => {
  const fake = startFakeLineclear();
  try {
    const { handle } = api(fake.url);
    await viewWhen(handle, (v) => v.state === "ready");
    expect((await handle(req("/api/chat", { text: "  " }))).status).toBe(400);
    expect((await handle(req("/api/chat", { text: "x".repeat(20_001) }))).status).toBe(400);
    expect((await handle(req("/api/chat", { text: "hi", files: Array.from({ length: MAX_FILES + 1 }, (_, i) => `abcdef1-${i}.png`) }))).status).toBe(400);
    const gone = await handle(req("/api/chat", { text: "hi", files: ["4b1c2d3e-0000-4000-8000-000000000000"] }));
    expect(gone.status).toBe(400);
    expect(((await gone.json()) as any).error).toBe("An attached file is gone. Attach it again.");
    expect((await handle(req("/api/chat", { text: "hi", files: ["/etc/passwd"] }))).status).toBe(400);
    expect(
      (await handle(req("/api/chat", { text: "hi" }, { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, origin: "https://evil.example" })))
        .status,
    ).toBe(403);
    expect(fake.actions).toEqual([]);
    // Lineclear refuses it: the page hears why
    const r = await handle(req("/api/chat", { text: "fail please" }));
    expect(r.status).toBe(502);
    expect(((await r.json()) as any).error).toBe("The Dispatcher could not take it.");
  } finally {
    fake.stop();
  }
});

test("with no Dispatcher's space the chat is none, and with no Lineclear it is offline", async () => {
  const fake = startFakeLineclear({ dispatcher: false });
  try {
    const { handle } = api(fake.url);
    const v = await viewWhen(handle, (v) => v.state !== "loading");
    expect(v).toMatchObject({ state: "none", reason: "There is no Dispatcher yet." });
    expect((await handle(req("/api/chat", { text: "hi" }))).status).toBe(404);
  } finally {
    fake.stop();
  }
  const { handle } = api();
  const v = await viewWhen(handle, (v) => v.state !== "loading");
  expect(v).toMatchObject({ state: "offline", reason: expect.stringContaining("The board server is not running") });
  expect((await handle(req("/api/chat", { text: "hi" }))).status).toBe(503);
});

test("a missing Dispatcher is made once by the server itself", async () => {
  const fake = startFakeLineclear({ dispatcher: false });
  try {
    const { env } = api(fake.url);
    let made = 0;
    const chat = dispatcherChat(env, 50, 120_000, () => {
      made++;
      return 1;
    });
    chat.view();
    await waitFor(() => chat.view().state !== "loading", "the chat to stop loading");
    await Bun.sleep(200);
    expect(chat.view().state).toBe("none");
    expect(made).toBe(1);
  } finally {
    fake.stop();
  }
});

test("a dropped link to Lineclear shows offline, keeps the history, and comes back", async () => {
  const fake = startFakeLineclear();
  const port = fake.port;
  const { handle } = api(fake.url);
  fake.setChat({ messages: [{ id: "a1", who: "agent", text: "Hello" }] });
  await viewWhen(handle, (v) => v.messages.length === 1);
  fake.stop();
  const off = await viewWhen(handle, (v) => v.state === "offline");
  expect(off.messages).toHaveLength(1);
  const again = startFakeLineclear({ port });
  try {
    again.setChat({
      messages: [
        { id: "a1", who: "agent", text: "Hello" },
        { id: "a2", who: "agent", text: "Back" },
      ],
    });
    await Bun.sleep(1100);
    const v = await viewWhen(handle, (v) => v.state === "ready" && v.messages.length === 2);
    expect(v.messages[1].text).toBe("Back");
  } finally {
    again.stop();
  }
});

test("an image the Dispatcher names shows only from its own folders", async () => {
  const { dir, env, handle } = api();
  const own = join(env.LINECLEAR_CONFIG, "dispatcher");
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, "chart.png"), PNG);
  writeFileSync(join(dir, "elsewhere.png"), PNG);
  writeFileSync(join(own, "notes.txt"), "no");
  const at = (p: string) => handle(req(`/api/chat/image?path=${encodeURIComponent(p)}`));
  const ok = await at(join(own, "chart.png"));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/png");
  expect((await at(join(dir, "elsewhere.png"))).status).toBe(403);
  expect((await at(join(own, "..", "..", "elsewhere.png"))).status).toBe(403);
  expect((await at(join(own, "notes.txt"))).status).toBe(400);
  expect((await at(join(own, "missing.png"))).status).toBe(404);
  // a link named like an image to a file that is none, and another site asking
  writeFileSync(join(own, ".env"), "TOKEN=x");
  symlinkSync(join(own, ".env"), join(own, "x.png"));
  expect((await at(join(own, "x.png"))).status).toBe(400);
  expect((await handle(req(`/api/chat/image?path=${encodeURIComponent(join(own, "chart.png"))}`, undefined, { "sec-fetch-site": "cross-site" }))).status).toBe(
    403,
  );
  expect(existsSync(join(own, "chart.png"))).toBe(true);
});

test("a reply keeps the id it quotes, and a long one is dropped", () => {
  expect(parseSend({ text: "Yes", reply: "m4" })).toEqual({ text: "Yes", files: [], reply: "m4" });
  expect(parseSend({ text: "Yes", reply: "x".repeat(201) })).toEqual({ text: "Yes", files: [] });
});

test("a task's chat is served at its own address, says it has none, and the oldest of many is closed", async () => {
  const fake = startFakeLineclear();
  try {
    const { handle } = api(fake.url);
    let none: { state?: string } = {};
    await waitFor(async () => {
      none = await (await handle(req("/api/task/WEB-3/chat"))).json();
      return none.state === "none";
    }, "the task chat to be none");
    expect(none.state).toBe("none");
    const bad = await handle(req("/api/task/WEB-3/chat/react", { message: "", emoji: "x" }));
    expect(bad.status).toBe(400);
    expect((await handle(req("/api/task/bad id/chat"))).status).toBe(404);
  } finally {
    fake.stop();
  }
  const closed: string[] = [];
  const links = taskChatLinks({}, 2);
  const first = links("A-1");
  const spy = first.close;
  first.close = () => {
    closed.push("A-1");
    spy();
  };
  links("A-2");
  links("A-3");
  expect(closed).toEqual(["A-1"]);
  expect(links("A-2")).toBe(links("A-2"));
});
