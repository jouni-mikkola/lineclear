import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { addItem, closeItem } from "../src/inbox.ts";
import { alertOf, notifyNew, type Pusher, realPush } from "../src/notify.ts";
import { PAGE_TOKEN, webApi } from "../src/web.ts";
import { tmp } from "./helpers.ts";

const dir = tmp("notify");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
type E = Record<string, string | undefined>;
const world = (name: string): E => {
  const config = join(dir, name, "config");
  mkdirSync(config, { recursive: true });
  return { LINECLEAR_CONFIG: config, PATH: process.env.PATH };
};
const since = new Date().toISOString();
const step = (e: E, question: string) => addItem({ kind: "step", task: "LIN-9", project: "demo", question, choices: ["Yes", "No"], since }, e as never);

/** The fork's own Push, with its delivery to the browser's push service replaced: what it would send is kept. */
async function fakePush() {
  const file = "../server/server/push.ts";
  const { Push } = (await import(file)) as {
    Push: new (contact: string, deliver: (sub: { endpoint: string }, body: string) => Promise<void>) => Pusher & { devices: string[] };
  };
  const sent: { endpoint: string; body: { title: string; body: string; badge: number; tag: string; url: string } }[] = [];
  const push = new Push("mailto:owner@example.com", async (sub, body) => void sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) }));
  (push as unknown as { subs: unknown[] }).subs = []; // the devices file is shared by this process: start with none
  return { push, sent };
}
const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "k", auth: "a" } });

test("a page subscribes a device, and the key is the server's", async () => {
  const { push } = await fakePush();
  const api = webApi(
    world("sub"),
    () => Date.now(),
    async () => ({}),
    Promise.resolve(push),
  );
  const call = (path: string, body?: unknown, headers: Record<string, string> = { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN }) =>
    api(new Request(`http://127.0.0.1${path}`, body === undefined ? undefined : { method: "POST", headers, body: JSON.stringify(body) }));
  expect(await (await call("/api/push/key")).json()).toEqual({ key: push.publicKey });
  expect((await call("/api/push/subscribe", { sub: sub("https://push.example/1"), device: "phone" }, { "content-type": "application/json" })).status).toBe(403); // a plain curl has no token
  expect((await call("/api/push/subscribe", { sub: { endpoint: 3 }, device: "phone" })).status).toBe(400);
  expect((await call("/api/push/subscribe", { sub: sub("https://push.example/1"), device: "phone" })).status).toBe(200);
  expect(push.devices).toEqual(["phone"]);
  expect((await call("/api/push/subscribe", { sub: sub("https://push.example/1"), device: "phone" })).status).toBe(200);
  expect(push.devices).toHaveLength(1); // the same device again is still one
});

test("without push the key is null and a subscription is refused", async () => {
  const api = webApi(
    world("none"),
    () => Date.now(),
    async () => ({}),
  );
  expect(await (await api(new Request("http://127.0.0.1/api/push/key"))).json()).toEqual({ key: null });
  const r = await api(
    new Request("http://127.0.0.1/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN },
      body: JSON.stringify({ sub: sub("https://p/1"), device: "d" }),
    }),
  );
  expect(r.status).toBe(503);
});

test("each new Inbox item is one push to each device, and old items are not announced", async () => {
  const e = world("items");
  step(e, "Old question?");
  const { push, sent } = await fakePush();
  push.subscribe(sub("https://push.example/a"), "phone");
  push.subscribe(sub("https://push.example/b"), "tablet");
  expect(await notifyNew(push, e as never)).toBe(0); // the first look only sets the mark
  expect(await notifyNew(push, e as never)).toBe(0);
  expect(sent).toHaveLength(0);
  const item = step(e, "Which one?");
  expect(await notifyNew(push, e as never)).toBe(1);
  expect(sent.map((s) => s.endpoint).sort()).toEqual(["https://push.example/a", "https://push.example/b"]);
  expect(sent[0]!.body).toMatchObject({ title: `Inbox ${item.n}: step waits for you`, body: "LIN-9: Which one?", badge: 2 });
  expect(await notifyNew(push, e as never)).toBe(0); // the same item is not sent again
  expect(sent).toHaveLength(2);
  const quick = step(e, "Quick?");
  closeItem(quick, "task is over", new Date(), e as never); // closed before the next look: nothing to say
  expect(await notifyNew(push, e as never)).toBe(0);
  step(e, "A?");
  step(e, "B?");
  expect(await notifyNew(push, e as never)).toBe(2);
  expect(sent).toHaveLength(6);
});

test("with 1,000 closed items and nothing new, a look reads no item", async () => {
  const e = world("quiet");
  step(e, "Open?");
  for (let n = 2; n <= 1001; n++) closeItem(step(e, `Q${n}?`), "task is over", new Date(), e as never);
  const { push } = await fakePush();
  expect(await notifyNew(push, e as never)).toBe(0);
  const parse = JSON.parse;
  let parsed = 0;
  JSON.parse = (...a: Parameters<typeof JSON.parse>) => (parsed++, parse(...a));
  try {
    expect(await notifyNew(push, e as never)).toBe(0);
  } finally {
    JSON.parse = parse;
  }
  expect(parsed).toBe(0);
});

test("main turning red is one push with its own title", async () => {
  const e = world("red");
  const { push, sent } = await fakePush();
  push.subscribe(sub("https://push.example/a"), "phone");
  await notifyNew(push, e as never);
  const red = addItem(
    { kind: "stuck", task: "-", project: "demo", question: "demo: main failed its health command twice.", choices: ["Ok"], alert: "Main is red", since },
    e as never,
  );
  expect(await notifyNew(push, e as never)).toBe(1);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.body).toMatchObject({ title: "Main is red", body: "demo: main failed its health command twice." });
  expect(alertOf(red).tag).toBe(`inbox-${red.n}`);
});

test("the fork's push code loads and keeps a key for this server", async () => {
  const push = await realPush();
  expect(push.publicKey.length).toBeGreaterThan(40);
});

test("starting the push code leaves LINECLEAR_HOME unset, so Home still finds the board's spaces", async () => {
  const before = process.env.LINECLEAR_HOME;
  delete process.env.LINECLEAR_HOME;
  try {
    const loading = realPush();
    expect(String(process.env.LINECLEAR_HOME)).toContain("push"); // set while it loads
    await loading;
    expect(process.env.LINECLEAR_HOME).toBeUndefined();
  } finally {
    if (before !== undefined) process.env.LINECLEAR_HOME = before;
  }
});

test("every push for an Inbox item opens the Inbox of the Lineclear UI: no old port, no old page path", async () => {
  const { push, sent } = await fakePush();
  push.subscribe(sub("https://push.example/1"), "phone");
  const e = world("links");
  for (const kind of ["outward", "login", "step", "plan"] as const)
    await push.send(alertOf(addItem({ kind, task: "LIN-9", question: "Go?", choices: ["Go"], since }, e as never)));
  const urls = sent.map((s) => s.body.url);
  expect(urls).toEqual(["/inbox", "/inbox", "/inbox", "/inbox"]);
  for (const url of urls) expect(url).not.toMatch(/:7421\b|\?place=|[?&]focus=|^\.\/|#\//);
});
