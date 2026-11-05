import { expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inputCode, parseInput, taskOfSession } from "../src/browsers.ts";
import { knownHost, PAGE_TOKEN, webApi } from "../src/web.ts";
import { until, webShopDir } from "./helpers.ts";

// The Agent browsers' data, with ui/test/fake-playwright-cli for playwright-cli: it lists the sessions in
// browsers.json and logs each piece of code a session runs to browser-inputs.log.

const FAKE = join(import.meta.dir, "..", "ui", "test", "fake-playwright-cli");

const api = (sessions: string[], extra: Record<string, string> = {}, now?: () => number) => {
  const dir = webShopDir("lc-browsers-");
  writeFileSync(
    join(dir, "shepherdr", "tasks.json"),
    JSON.stringify({
      tasks: [
        { id: "WEB-1", title: "Pay with a saved card" },
        { id: "WEB-12", title: "Gift cards" },
      ],
      red: {},
    }),
  );
  writeFileSync(
    join(dir, "browsers.json"),
    JSON.stringify({
      browsers: [...sessions.map((name) => ({ name, workspace: "0abc", status: "open" })), { name: "old", workspace: "0abc", status: "closed" }],
    }),
  );
  writeFileSync(
    join(dir, "config", "inbox", "1.json"),
    JSON.stringify({
      n: 1,
      kind: "login",
      task: "WEB-12",
      session: "WEB-12-review",
      question: "Sign in to the test shop.",
      choices: ["Done"],
      since: "2026-01-05T09:12:00.000Z",
    }),
  );
  const env = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    LINECLEAR_PLAYWRIGHT_CLI: FAKE,
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    SHEPHERDR_BIN: "true",
    ...extra,
    HOME: dir,
    PATH: process.env.PATH,
  };
  const handle = webApi(env, now);
  const call = (path: string, body?: unknown, headers: Record<string, string> = { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN }) =>
    handle(new Request(`http://127.0.0.1:7420${path}`, body === undefined ? {} : { method: "POST", headers, body: JSON.stringify(body) }));
  const inputs = () => {
    try {
      return readFileSync(join(dir, "browser-inputs.log"), "utf8");
    } catch {
      return "";
    }
  };
  return {
    dir,
    call,
    inputs,
    sessions: (names: string[]) =>
      writeFileSync(join(dir, "browsers.json"), JSON.stringify({ browsers: names.map((name) => ({ name, workspace: "0abc", status: "open" })) })),
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
};

test("a session belongs to the longest task id it starts with, and the rest is a note", () => {
  const ids = ["WEB-1", "WEB-12", "API-3"];
  expect(taskOfSession("WEB-1", ids)).toEqual({ task: "WEB-1" });
  expect(taskOfSession("WEB-12-review", ids)).toEqual({ task: "WEB-12", note: "review" });
  expect(taskOfSession("web-1-second_look", ids)).toEqual({ task: "WEB-1", note: "second look" });
  expect(taskOfSession("WEB-123", ids)).toBeUndefined();
  expect(taskOfSession("scratch", ids)).toBeUndefined();
});

test("an input is checked: numbers in range, listed keys, text of a sane length", () => {
  expect(parseInput({ do: "click", x: 10.4, y: 20.6 })).toEqual({ do: "click", x: 10, y: 21 });
  expect(parseInput({ do: "key", key: "Enter" })).toEqual({ do: "key", key: "Enter" });
  expect(parseInput({ do: "scroll", dy: -400 })).toEqual({ do: "scroll", dy: -400 });
  expect(parseInput({ do: "type", text: "hi" })).toEqual({ do: "type", text: "hi" });
  for (const bad of [
    { do: "click", x: "1); evil(", y: 2 },
    { do: "click", x: -1, y: 2 },
    { do: "key", key: "Control+w" },
    { do: "type", text: "" },
    { do: "type", text: "x".repeat(2001) },
    { do: "eval" },
    null,
  ]) {
    expect(typeof parseInput(bad)).toBe("string");
  }
});

test("typed text goes into the code as JSON, so it cannot break out of it", () => {
  expect(inputCode({ do: "type", text: `"); process.exit(1); ("` })).toBe(
    `async page => { await page.keyboard.type(${JSON.stringify(`"); process.exit(1); ("`)}); }`,
  );
  expect(inputCode({ do: "click", x: 3, y: 4 })).toContain("page.mouse.click(3, 4)");
});

test("/api/browsers is each open session with its task's plain title, a login it waits for first", async () => {
  const { call, done } = api(["scratch", "WEB-1", "WEB-12-review"]);
  const list = (await (await call("/api/browsers")).json()) as any[];
  expect(list.map((b) => b.session)).toEqual(["WEB-12-review", "WEB-1", "scratch"]);
  expect(list[0]).toMatchObject({
    title: "Gift cards",
    task: "WEB-12",
    project: "web-shop",
    note: "review",
    waits: { item: "1", question: "Sign in to the test shop." },
    taken: false,
  });
  expect(list[1]).toMatchObject({ title: "Pay with a saved card", task: "WEB-1" });
  expect(list[2]).toEqual({ session: "scratch", title: "scratch", taken: false });
  done();
});

test("/api/browsers leaves out the browser of a task that is done", async () => {
  const { call, dir, done } = api(["WEB-1", "WEB-12-review", "scratch"]);
  writeFileSync(
    join(dir, "shepherdr", "tasks.json"),
    JSON.stringify({
      tasks: [
        { id: "WEB-1", title: "Pay with a saved card", merged: true },
        { id: "WEB-12", title: "Gift cards" },
      ],
      red: {},
    }),
  );
  const list = (await (await call("/api/browsers")).json()) as { session: string }[];
  expect(list.map((b) => b.session)).toEqual(["WEB-12-review", "scratch"]);
  done();
});

test("the list is read again only when the Browsers view asks, and then after ten seconds", async () => {
  let t = 1_000_000;
  const { call, sessions, done } = api(["WEB-1"], {}, () => t);
  const names = async (path: string) => ((await (await call(path)).json()) as any[]).map((b) => b.session);
  expect(await names("/api/browsers")).toEqual(["WEB-1"]);
  sessions(["WEB-1", "WEB-12"]);
  t += 60_000;
  expect(await names("/api/browsers")).toEqual(["WEB-1"]);
  await Bun.sleep(100);
  expect(await names("/api/browsers")).toEqual(["WEB-1"]);
  await names("/api/browsers?live");
  // the list is read in the background: wait for it, however slow the machine
  await until(async () => (await names("/api/browsers?live")).length === 2);
  expect(await names("/api/browsers?live")).toEqual(["WEB-12", "WEB-1"]);
  done();
});

test("a picture is a JPEG, and the page it showed joins the list", async () => {
  const { call, done } = api(["WEB-1"]);
  const r = await call("/api/browsers/WEB-1/picture");
  expect(r.headers.get("content-type")).toBe("image/jpeg");
  expect([...new Uint8Array(await r.arrayBuffer()).slice(0, 2)]).toEqual([0xff, 0xd8]);
  expect((await call("/api/browsers/gone/picture")).status).toBe(404);
  expect((await call("/api/browsers/..%2Fx/picture")).status).toBe(404);
  const list = (await (await call("/api/browsers")).json()) as any[];
  expect(list[0].page).toEqual({ title: "Sign in", url: "http://localhost:5173/login" });
  done();
});

test("input reaches a session only once it is taken over, and only from Lineclear's own pages", async () => {
  const { call, inputs, done } = api(["WEB-1"]);
  expect((await call("/api/browsers/WEB-1/input", { do: "key", key: "Enter" })).status).toBe(409);
  expect((await call("/api/browsers/WEB-1/take", { take: true }, { "content-type": "text/plain" })).status).toBe(403);
  expect(
    (
      await call(
        "/api/browsers/WEB-1/take",
        { take: true },
        { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, origin: "http://elsewhere.example" },
      )
    ).status,
  ).toBe(403);
  expect((await call("/api/browsers/gone/take", { take: true })).status).toBe(404);
  // Behind an HTTPS proxy the Origin is https while the server sees http; the name must still be known.
  const behind = (origin: string) =>
    call(
      "/api/browsers/gone/take",
      { take: true },
      { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, origin, host: origin.replace(/^https?:\/\//, "") },
    );
  expect((await behind("https://127.0.0.1:7420")).status).toBe(404);
  expect((await behind("https://evil.example:7420")).status).toBe(403);
  expect(await (await call("/api/browsers/WEB-1/take", { take: true })).json()).toEqual({ taken: true });
  expect((await call("/api/browsers/WEB-1/input", { do: "key", key: "Meta+q" })).status).toBe(400);
  expect(await (await call("/api/browsers/WEB-1/input", { do: "key", key: "Enter" })).json()).toEqual({ sent: "key" });
  expect(inputs()).toContain(`WEB-1 async page => { await page.keyboard.press("Enter"); }`);
  const list = (await (await call("/api/browsers")).json()) as any[];
  expect(list[0].taken).toBe(true);
  await call("/api/browsers/WEB-1/take", { take: false });
  expect((await call("/api/browsers/WEB-1/input", { do: "key", key: "Enter" })).status).toBe(409);
  done();
});

test("an Inbox login item names its session", async () => {
  const { call, done } = api([]);
  const items = (await (await call("/api/inbox")).json()) as any[];
  expect(items[0]).toMatchObject({ id: "1", session: "WEB-12-review" });
  done();
});

test("the data answers only to an address, localhost or a listed name", () => {
  for (const h of ["127.0.0.1", "localhost", "192.168.1.20", "[::1]"]) expect(knownHost(h, {})).toBe(true);
  expect(knownHost("evil.example", {})).toBe(false);
  expect(knownHost("box.tail.ts.net", { LINECLEAR_HOSTS: "other, box.tail.ts.net" })).toBe(true);
});

test("a page that points its own name at the server is refused", async () => {
  const { dir, done } = api(["WEB-1"]);
  const handle = webApi({
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    LINECLEAR_PLAYWRIGHT_CLI: FAKE,
    PATH: process.env.PATH,
  });
  expect((await handle(new Request("http://evil.example:7420/api/browsers"))).status).toBe(403);
  done();
});

test("a playwright-cli that fails gives a 502 with its words, and is asked again next time", async () => {
  const { dir, done } = api([]);
  const env = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    LINECLEAR_PLAYWRIGHT_CLI: FAKE,
    PATH: process.env.PATH,
  };
  writeFileSync(join(dir, "browsers.json"), "not json");
  const handle = webApi(env);
  expect((await handle(new Request("http://127.0.0.1:7420/api/browsers"))).status).toBe(502);
  writeFileSync(join(dir, "browsers.json"), JSON.stringify({ browsers: [{ name: "WEB-1", workspace: "0abc", status: "open" }] }));
  const list = (await (await handle(new Request("http://127.0.0.1:7420/api/browsers"))).json()) as any[];
  expect(list.map((b) => b.session)).toEqual(["WEB-1"]);
  done();
});

test("the list and the pictures come from memory once read: a playwright-cli that hangs does not hold the page", async () => {
  let t = 1_000_000;
  const { dir, call, done } = api(["WEB-1", "WEB-2"], {}, () => t);
  try {
    expect((await call("/api/browsers")).status).toBe(200);
    expect((await call("/api/browsers/WEB-1/picture?size=thumb")).status).toBe(200);
    expect((await call("/api/browsers/WEB-1/picture")).status).toBe(200);
    // the full picture is stale now, the thumbnail and the list are not; every playwright-cli call from here hangs,
    // so an answer that waited for one would never come
    t += 2_000;
    writeFileSync(join(dir, "hang"), "");
    const list = await call("/api/browsers");
    const thumb = await call("/api/browsers/WEB-1/picture?size=thumb");
    const full = await call("/api/browsers/WEB-1/picture");
    expect(list.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");
    expect(full.status).toBe(200);
  } finally {
    done();
  }
});
