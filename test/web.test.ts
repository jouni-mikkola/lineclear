import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGE_TOKEN, serveWeb, webApi } from "../src/web.ts";
import { webAddress } from "../src/web-address.ts";
import { webResponse } from "../src/web-files.ts";
import { listProjects } from "../src/project-cli.ts";
import { json, until, webShopDir } from "./helpers.ts";

const root = mkdtempSync(join(tmpdir(), "lc-web-"));
const dist = join(root, "dist");
mkdirSync(join(dist, "assets"), { recursive: true });
writeFileSync(join(dist, "index.html"), "<p>app</p>");
writeFileSync(join(dist, "assets", "app-1.js"), "run();".repeat(2000));
writeFileSync(join(root, "secret.txt"), "no");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const get = async (path: string) => {
  const r = webResponse(dist, `http://127.0.0.1${path}`);
  return { status: r.status, body: await r.text(), cache: r.headers.get("cache-control") };
};

test("a file is served, built assets are kept for a year", async () => {
  expect(await get("/assets/app-1.js")).toEqual({ status: 200, body: "run();".repeat(2000), cache: "public, max-age=31536000, immutable" });
});

test("scripts go out gzipped when the browser accepts it, and smaller", async () => {
  const plain = webResponse(dist, "http://127.0.0.1/assets/app-1.js");
  expect(plain.headers.get("content-encoding")).toBeNull();
  const zipped = webResponse(dist, "http://127.0.0.1/assets/app-1.js", "gzip, deflate, br");
  expect(zipped.headers.get("content-encoding")).toBe("gzip");
  expect(zipped.headers.get("content-type")).toContain("javascript");
  const bytes = new Uint8Array(await zipped.arrayBuffer());
  expect(bytes.length).toBeLessThan(12000 / 10);
  expect(new TextDecoder().decode(Bun.gunzipSync(bytes))).toBe("run();".repeat(2000));
  expect(webResponse(dist, "http://127.0.0.1/design", "gzip").headers.get("content-encoding")).toBe("gzip");
});

test("a page path gets the app", async () => {
  expect((await get("/design")).body).toBe("<p>app</p>");
  expect((await get("/")).body).toBe("<p>app</p>");
});

test("a missing file or a bad path is a 404", async () => {
  expect((await get("/assets/gone.js")).status).toBe(404);
  expect((await get("/%")).status).toBe(404);
});

test("nothing outside the folder is read", async () => {
  for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt"]) {
    const r = await get(p);
    expect(r.body).not.toBe("no");
  }
});

test("the address comes from LINECLEAR_HOST and LINECLEAR_PORT", () => {
  expect(webAddress({})).toEqual({ hostname: "127.0.0.1", port: 7420 });
  expect(webAddress({ LINECLEAR_HOST: "0.0.0.0", LINECLEAR_PORT: "8000" })).toEqual({ hostname: "0.0.0.0", port: 8000 });
  expect(() => webAddress({ LINECLEAR_PORT: "web" })).toThrow("not a port");
});

const api = () => {
  const dir = webShopDir("lc-api-");
  writeFileSync(
    join(dir, "shepherdr", "tasks.json"),
    JSON.stringify({ tasks: [{ id: "WEB-1", title: "Pay with a saved card", told: "work", updated: 1 }], red: {} }),
  );
  mkdirSync(join(dir, "config", "projects", "web-shop"), { recursive: true });
  writeFileSync(join(dir, "config", "projects", "web-shop", "settings.json"), JSON.stringify({ space: "web-shop", repo: join(dir, "none") }));
  const item = (n: number, extra = {}) =>
    writeFileSync(
      join(dir, "config", "inbox", `${n}.json`),
      JSON.stringify({
        n,
        kind: "step",
        task: "WEB-1",
        project: "web-shop",
        question: `Question ${n}?`,
        choices: ["Yes", "No"],
        since: "2026-01-05T09:12:00.000Z",
        ...extra,
      }),
    );
  item(1);
  item(2, { kind: "login", session: "WEB-1" });
  item(3, { answer: "Yes" });
  const env = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    SHEPHERDR_BIN: "true",
    HOME: dir,
    LINECLEAR_MAIN_HOME: join(dir, "data"),
    LINECLEAR_HOSTS: "box.tail.ts.net",
  };
  return { dir, handle: webApi(env) };
};

const post = (n: number, body: unknown, headers: Record<string, string> = { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN }) =>
  new Request(`http://127.0.0.1:7420/api/inbox/${n}`, { method: "POST", headers, body: JSON.stringify(body) });

test("/api/home is the projects with plain titles, and 14 days of spend once it is read", async () => {
  const { dir, handle } = api();
  const home = async () => (await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as any;
  expect((await home()).projects[0]).toMatchObject({
    name: "web-shop",
    broken: false,
    tasks: [{ id: "WEB-1", title: "Pay with a saved card", state: "work" }],
  });
  await until(async () => !!(await home()).spend, 50);
  expect((await home()).spend).toHaveLength(14);
  expect((await home()).usage).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test("/api/home answers with the projects at once while spend and usage are still read", async () => {
  const { dir } = api();
  const env = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    HOME: dir,
    LINECLEAR_DOCTOR_FILE: join(dir, "none.json"),
  };
  const asked: string[] = [];
  // a read of spend that never ends
  const handle = webApi(env, undefined, (what) => (asked.push(what), new Promise(() => {})));
  const home = (await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as any;
  expect(home.projects[0]).toMatchObject({ name: "web-shop" });
  expect(home.spend).toBeUndefined();
  expect(home.usage).toBeUndefined();
  // asked again, it does not start a second read
  await handle(new Request("http://127.0.0.1:7420/api/home"));
  expect(asked.filter((w) => w === "spend")).toEqual(["spend"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a roadmap answers from its last read while the next one runs", async () => {
  const { dir } = api();
  let t = 0;
  const reads: string[] = [];
  const handle = webApi(
    { LINECLEAR_CONFIG: join(dir, "config"), LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"), HOME: dir },
    () => t,
    async (what, arg) => {
      if (what !== "roadmap") return new Promise(() => {});
      reads.push(arg!);
      // the first read answers, the next never ends
      return reads.length === 1 ? { ok: { project: arg, phases: [], steps: [] } } : new Promise(() => {});
    },
  );
  const road = async () => (await (await handle(new Request("http://127.0.0.1:7420/api/roadmap/web-shop"))).json()) as any;
  expect(await road()).toMatchObject({ project: "web-shop", phases: [] });
  t = 5_000;
  expect(await road()).toMatchObject({ project: "web-shop", phases: [] });
  expect(await road()).toMatchObject({ project: "web-shop", phases: [] });
  expect(reads).toEqual(["web-shop", "web-shop"]);
  rmSync(dir, { recursive: true, force: true });
});

test("/api/inbox is the open items, newest first, with their details", async () => {
  const { dir, handle } = api();
  const items = (await (await handle(new Request("http://127.0.0.1:7420/api/inbox"))).json()) as any[];
  expect(items.map((i) => i.id)).toEqual(["2", "1"]);
  expect(items[0]).toMatchObject({ project: "web-shop", question: "Question 2?", choices: ["Yes", "No"] });
  expect(items[0].details).toContain("Login or code.");
  expect(items[0].details).toContain("playwright-cli -s=WEB-1 show");
  rmSync(dir, { recursive: true, force: true });
});

test("a plan's Inbox item carries the go of each step with the model's words, and no no-go", async () => {
  const { dir, handle } = api();
  const check = (step: string, go: boolean) => ({
    step,
    key: "k",
    round: 1,
    model: "m/x",
    go,
    said: `${step} said back`,
    missing: go ? "" : "what",
    tokensIn: 1,
    tokensOut: 1,
  });
  writeFileSync(
    join(dir, "config", "inbox", "5.json"),
    JSON.stringify({
      n: 5,
      kind: "plan",
      task: "PLAN-1",
      project: "web-shop",
      question: "Approve?",
      choices: ["Approve", "Reject"],
      since: "2026-01-05T09:12:00.000Z",
      checks: [check("S1", true), check("S2", false)],
    }),
  );
  const items = (await (await handle(new Request("http://127.0.0.1:7420/api/inbox"))).json()) as { id: string; stepChecks?: unknown }[];
  expect(items.find((i) => i.id === "5")?.stepChecks).toEqual([{ step: "S1", model: "m/x", said: "S1 said back" }]);
  expect(items.find((i) => i.id === "1")?.stepChecks).toBeUndefined();
  expect(JSON.stringify(items)).not.toContain("S2");
  rmSync(dir, { recursive: true, force: true });
});

test("an answer is posted as JSON from the server's own pages, and goes to the task", async () => {
  const { dir, handle } = api();
  expect((await handle(post(1, { choice: "Yes" }, { "content-type": "text/plain" }))).status).toBe(403);
  expect(
    (await handle(post(1, { choice: "Yes" }, { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, origin: "http://elsewhere.example" })))
      .status,
  ).toBe(403);
  expect((await handle(post(1, { choice: "Maybe" }))).status).toBe(400);
  expect((await handle(post(3, { choice: "Yes" }))).status).toBe(409);
  const ok = await handle(post(1, { choice: "yes" }, { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, origin: "http://127.0.0.1:7420" }));
  expect(await ok.json()).toEqual({ said: "WEB-1 was told: Yes" });
  const items = (await (await handle(new Request("http://127.0.0.1:7420/api/inbox"))).json()) as any[];
  expect(items.map((i) => i.id)).toEqual(["2"]);
  expect((await handle(new Request("http://127.0.0.1:7420/api/nothing"))).status).toBe(404);
  rmSync(dir, { recursive: true, force: true });
});

test("an answer with no token is refused, as a plain curl from an agent sends it", async () => {
  const { dir, handle } = api();
  const json = { "content-type": "application/json" };
  expect((await handle(post(1, { choice: "Yes" }, json))).status).toBe(403);
  expect((await handle(post(1, { choice: "Yes" }, { ...json, "x-lineclear-token": "guess" }))).status).toBe(403);
  // the token alone does not help from another site
  expect((await handle(post(1, { choice: "Yes" }, { ...json, "x-lineclear-token": PAGE_TOKEN, origin: "https://evil.example" }))).status).toBe(403);
  expect(((await (await handle(new Request("http://127.0.0.1:7420/api/inbox"))).json()) as any[]).map((i) => i.id)).toEqual(["2", "1"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a name that is not in LINECLEAR_HOSTS is refused by the API and by the pages, and a page load sets the token", async () => {
  const { dir, handle } = api();
  expect((await handle(new Request("http://evil.example:7420/api/inbox"))).status).toBe(403);
  const foreign = new Request("http://evil.example:7420/api/inbox/1", {
    method: "POST",
    headers: { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN },
    body: JSON.stringify({ choice: "Yes" }),
  });
  expect((await handle(foreign)).status).toBe(403);
  const pages = join(dir, "pages");
  mkdirSync(pages);
  writeFileSync(join(pages, "index.html"), "<html></html>");
  const env = {
    LINECLEAR_HOSTS: "box.tail.ts.net",
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    HOME: dir,
    LINECLEAR_DOCTOR_FILE: join(dir, "none.json"),
  };
  const server = serveWeb(pages, { hostname: "127.0.0.1", port: 0 }, env);
  try {
    // the data goes out gzipped too
    const data = await fetch(`http://127.0.0.1:${server.port}/api/inbox`, { headers: { "accept-encoding": "gzip" } });
    expect(data.headers.get("content-encoding")).toBe("gzip");
    expect((await data.json()).map((i: any) => i.id)).toEqual(["2", "1"]);
    const at = (host: string) => fetch(`http://127.0.0.1:${server.port}/`, { headers: { host } });
    const own = await at("box.tail.ts.net");
    expect(own.status).toBe(200);
    expect(own.headers.get("set-cookie")).toContain(`lineclear_token=${PAGE_TOKEN}`);
    const other = await at("evil.example");
    expect(other.status).toBe(403);
    expect(other.headers.get("set-cookie")).toBeNull();
  } finally {
    server.stop(true);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("answers work behind an HTTPS proxy that ends TLS, and still refuse foreign or unknown origins", async () => {
  const { dir, handle } = api();
  const json = { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN };
  const via = (origin: string, host: string) => {
    const r = post(1, { choice: "Maybe" }, { ...json, origin, host });
    return handle(r);
  };
  // Known name, same host and port, other scheme: passes the origin check (400 is the bad choice, not 403).
  expect((await via("https://127.0.0.1:7420", "127.0.0.1:7420")).status).toBe(400);
  expect((await via("http://127.0.0.1:7420", "127.0.0.1:7420")).status).toBe(400);
  // Another port or host than the request's is foreign.
  expect((await via("https://127.0.0.1:7421", "127.0.0.1:7420")).status).toBe(403);
  expect((await via("https://elsewhere.example:7420", "127.0.0.1:7420")).status).toBe(403);
  expect((await via("null", "127.0.0.1:7420")).status).toBe(403);
  // The proxy case: the browser says https, the server sees http, the name is in LINECLEAR_HOSTS.
  expect((await via("https://box.tail.ts.net:7420", "box.tail.ts.net:7420")).status).toBe(400);
  // An unknown name is refused even when Origin and Host agree.
  expect((await via("https://evil.example:7420", "evil.example:7420")).status).toBe(403);
  rmSync(dir, { recursive: true, force: true });
});

test("a plan's rejection needs its reason, and the reason goes with the answer", async () => {
  const { dir, handle } = api();
  writeFileSync(
    join(dir, "config", "inbox", "4.json"),
    JSON.stringify({ n: 4, kind: "plan", task: "WEB-9", question: "Approve the plan?", choices: ["Approve", "Reject"], since: "2026-01-05T09:12:00.000Z" }),
  );
  const items = (await (await handle(new Request("http://127.0.0.1:7420/api/inbox"))).json()) as any[];
  expect(items.find((i) => i.id === "4").needsNote).toBe("Reject");
  expect(items.find((i) => i.id === "1").needsNote).toBeUndefined();
  expect((await handle(post(4, { choice: "Reject" }))).status).toBe(400);
  expect((await handle(post(4, { choice: "Reject", note: "Split step 3" }))).status).toBe(200);
  expect(JSON.parse(readFileSync(join(dir, "config", "inbox", "4.json"), "utf8"))).toMatchObject({ answer: "Reject", note: "Split step 3" });
  rmSync(dir, { recursive: true, force: true });
});

test("/api/home gives each account's limits and the last moves; an account marked full is at 100% until its reset", async () => {
  const { dir, handle } = api();
  writeFileSync(
    join(dir, "config", "accounts.json"),
    JSON.stringify({ anthropic: { kind: "subscription", out: true, resetAt: "2999-01-01T00:00:00.000Z", window: "week" } }),
  );
  writeFileSync(
    join(dir, "config", "moves.jsonl"),
    `${JSON.stringify({ time: "2026-06-01T10:00:00.000Z", task: "LIN-5", step: "A", from: "anthropic/x", to: "b/z", why: "w" })}\n`,
  );
  const read = async () => (await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as any;
  // usage comes with spend, once the spend read is done
  await until(async () => !!(await read()).usage, 50);
  const home = await read();
  expect(home.usage).toEqual([{ account: "anthropic", pace: "ahead", week: { percent: 100, resetAt: "2999-01-01T00:00:00.000Z" } }]);
  expect(home.moves).toMatchObject([{ task: "LIN-5", from: "anthropic/x", to: "b/z" }]);
  rmSync(dir, { recursive: true, force: true });
});

test("an account's monthly price is set from Settings, never guessed, and /api/home reports paid", async () => {
  const { dir, handle } = api();
  const accounts = () => (JSON.parse(readFileSync(join(dir, "config", "accounts.json"), "utf8")) ?? {}) as any;
  writeFileSync(join(dir, "config", "accounts.json"), JSON.stringify({ anthropic: { kind: "subscription" }, openrouter: { kind: "key" } }));
  const settings = async () => (await (await handle(new Request("http://127.0.0.1:7420/api/settings"))).json()) as any;
  // no price and no use: not listed
  expect((await settings()).accounts).toEqual([]);
  expect((await handle(json("/api/accounts/anthropic", { price: 100, currency: "usd" }, { "content-type": "text/plain" }))).status).toBe(403);
  expect((await handle(json("/api/accounts/anthropic", { price: "lots", currency: "USD" }))).status).toBe(400);
  expect((await handle(json("/api/accounts/anthropic", { price: 100, currency: "dollars" }))).status).toBe(400);
  expect((await handle(json("/api/accounts/anthropic", { price: "100", currency: "usd" }))).status).toBe(200);
  expect(accounts().anthropic).toEqual({ kind: "subscription", price: 100, currency: "USD" });
  expect((await settings()).accounts[0]).toEqual({ account: "anthropic", kind: "subscription", price: 100, currency: "USD" });
  const read = async () => (await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as any;
  await until(async () => !!(await read()).month, 50);
  expect((await read()).month.paid).toEqual([{ amount: 100, currency: "USD" }]);
  // an empty price clears it
  expect((await handle(json("/api/accounts/anthropic", { price: "" }))).status).toBe(200);
  expect(accounts().anthropic).toEqual({ kind: "subscription" });
  rmSync(dir, { recursive: true, force: true });
});

test("/api/settings gives the machines and each project with its secret names, never their values, and no usage", async () => {
  const { dir, handle } = api();
  const proj = join(dir, "config", "projects", "web-shop");
  mkdirSync(proj, { recursive: true });
  writeFileSync(
    join(proj, "settings.json"),
    JSON.stringify({ repo: "/r", space: "web-shop", check: "true", models: { worker: ["a/x", "a/y"], reviewer: ["b/z"], planner: ["c/w"] } }),
  );
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "data", "vault.json"), JSON.stringify({ all: { API_TOKEN: { value: "s3cret", at: 1 } } }));
  const r = await handle(new Request("http://127.0.0.1:7420/api/settings"));
  const text = await r.text();
  expect(text).not.toContain("s3cret");
  const s = JSON.parse(text);
  expect(Object.keys(s).sort()).toEqual(["accounts", "machines", "projects", "showPaused"]);
  expect(s.machines[0]).toMatchObject({ local: true });
  expect(typeof s.machines[0].limit).toBe("number");
  expect(s.projects).toEqual([
    {
      name: "web-shop",
      repo: "/r",
      check: "true",
      models: { worker: ["a/x", "a/y"], reviewer: ["b/z"], planner: ["c/w"] },
      secrets: ["API_TOKEN"],
      askBefore: { plans: false, releases: true, spending: true },
      reasons: {
        worker: [
          { state: "use", reason: "in use, usage not reported" },
          { state: "next", reason: "next, takes over when the ones above are full, usage not reported" },
        ],
        reviewer: [{ state: "use", reason: "in use, usage not reported" }],
        planner: [{ state: "use", reason: "in use, usage not reported" }],
      },
    },
  ]);

  // a change is saved where the CLI saves it
  expect((await handle(json("/api/projects/web-shop", { check: "make check" }, { "content-type": "text/plain" }))).status).toBe(403);
  expect((await handle(json("/api/projects/web-shop", { check: "" }))).status).toBe(400);
  expect((await handle(json("/api/projects/nope", { check: "x" }))).status).toBe(404);
  expect((await handle(json("/api/projects/web-shop", { check: "make check", health: "curl -f x", models: { worker: ["a/y", "a/x"] } }))).status).toBe(200);
  expect(JSON.parse(readFileSync(join(proj, "settings.json"), "utf8"))).toMatchObject({
    check: "make check",
    health: "curl -f x",
    models: { worker: ["a/y", "a/x"], reviewer: ["b/z"] },
  });
  const listed: string[] = [];
  listProjects((l) => listed.push(l), { ...process.env, LINECLEAR_CONFIG: join(dir, "config") });
  expect(listed.join("\n")).toContain("make check");
  expect(listed.join("\n")).toContain("a/y, a/x");
  rmSync(dir, { recursive: true, force: true });
});

test("a machine is added over SSH in the background and removed, only from the server's own pages", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-api-"));
  const env = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    SHEPHERDR_BIN: "true",
    HOME: dir,
    PATH: process.env.PATH,
    LINECLEAR_SSH: join(import.meta.dir, "..", "ui", "test", "fake-ssh"),
  };
  const handle = webApi(env);
  // the first read of usage, which Settings waits for once
  await handle(new Request("http://127.0.0.1:7420/api/settings"));
  expect(
    (
      await handle(
        json("/api/machines", { add: "build-box" }, { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN, origin: "http://evil.example" }),
      )
    ).status,
  ).toBe(403);
  expect((await handle(json("/api/machines", { add: "-oProxyCommand=x" }))).status).toBe(400);
  expect((await handle(json("/api/machines", { add: "build-box" }))).status).toBe(202);
  const hosts = async () => ((await (await handle(new Request("http://127.0.0.1:7420/api/settings"))).json()) as any).machines.slice(1);
  expect(await hosts()).toMatchObject([{ host: "build-box", state: "installing" }]);
  await until(async () => !((await hosts())[0].state === "installing"), 50);
  expect((await hosts())[0]).toMatchObject({ host: "build-box", state: "ready", doctor: ["ok     git", "ok     service", "All well."] });
  expect((await handle(json("/api/machines", { remove: "build-box" }))).status).toBe(200);
  expect(await hosts()).toEqual([]);
  expect((await handle(json("/api/machines", { remove: "build-box" }))).status).toBe(404);
  rmSync(dir, { recursive: true, force: true });
});

test("the add form's API detects a folder and saves a project where the CLI does", async () => {
  const repo = join(root, "new-repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { check: "true" } }));
  writeFileSync(join(repo, "bun.lock"), "");
  const config = join(root, "config");
  const env = { LINECLEAR_CONFIG: config, SHEPHERDR_BIN: "/nowhere/shepherdr", PI_BIN: "/nowhere/pi", LINECLEAR_DOCTOR_FILE: join(root, "none.json") };
  const api = webApi(env);
  const found = await (await api(new Request(`http://127.0.0.1/api/detect?repo=${encodeURIComponent(repo)}`))).json();
  expect(found).toMatchObject({ repo, name: "new-repo", check: "bun run check", roadmap: false, models: [] });
  expect(found.space).toBeUndefined();
  expect((await api(new Request("http://127.0.0.1/api/detect?repo=/nowhere/at/all"))).status).toBe(400);

  const post = (body: unknown) =>
    api(
      new Request("http://127.0.0.1/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN },
        body: JSON.stringify(body),
      }),
    );
  const full = { repo, space: "new-space", check: "bun run check", models: ["a/b"] };
  expect((await post({ ...full, models: [] })).status).toBe(400);
  // no space and no board to make one
  expect((await post({ ...full, space: "" })).status).toBe(502);
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs", "ROADMAP.md"), "# Roadmap\n");
  expect((await post(full)).status).toBe(201);
  expect((await post(full)).status).toBe(409);
  const saved = JSON.parse(readFileSync(join(config, "projects", "new-repo", "settings.json"), "utf8"));
  expect(saved).toMatchObject({ repo, space: "new-space", check: "bun run check", models: { worker: ["a/b"], reviewer: ["a/b"], planner: ["a/b"] } });
  const noOrigin = await api(new Request("http://127.0.0.1/api/projects", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }));
  expect(noOrigin.status).toBe(403);
});

test("a space with a Now, Next and Later roadmap and no Lineclear project is not on Home, and its roadmap view still answers", async () => {
  const { dir, handle } = api();
  const repo = join(dir, "notes-app");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(
    join(repo, "docs", "ROADMAP.md"),
    "# Roadmap\n\n## Now\n\n- Sync notes\n- Search\n\n## Next\n\n1. Share a note\n\n## Later\n\n- Offline mode\n\n## Done\n\n- Sign in\n",
  );
  for (const a of [
    ["init", "-q", "-b", "main"],
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start"],
  ])
    Bun.spawnSync(["git", "-C", repo, ...a]);
  writeFileSync(join(dir, "shepherdr", "spaces.json"), JSON.stringify([{ key: "NOT", name: "Notes App", path: repo }]));
  const home = (await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as any;
  expect(home.projects.map((p: any) => p.name)).toEqual(["web-shop"]);
  const view = (await (await handle(new Request("http://127.0.0.1:7420/api/roadmap/notes-app"))).json()) as any;
  expect(view).toMatchObject({ project: "notes-app", phases: ["Now", "Next", "Later", "Done"], done: 1, total: 5, phase: "Now" });
  expect(view.steps.map((s: any) => [s.title, s.phase, s.state])).toEqual([
    ["Sync notes", "Now", "ready"],
    ["Search", "Now", "ready"],
    ["Share a note", "Next", "ready"],
    ["Offline mode", "Later", "ready"],
    ["Sign in", "Done", "done"],
  ]);
  expect((await handle(new Request("http://127.0.0.1:7420/api/roadmap/nothing"))).status).toBe(404);
  const first = view.steps[0].id;
  // with no task the page has a checklist, no wait and no history; a step that is not there is a 404
  const one = (await (await handle(new Request(`http://127.0.0.1:7420/api/roadmap/notes-app/step/${first}`))).json()) as {
    step: string;
    waits: unknown[];
    history?: unknown;
  };
  expect(one).toMatchObject({ step: first, waits: [] });
  expect(one.history).toBeUndefined();
  expect((await handle(new Request("http://127.0.0.1:7420/api/roadmap/notes-app/step/nope"))).status).toBe(404);
  rmSync(dir, { recursive: true, force: true });
});

test("/api/stalls gives the stalls of the last hours by class, and refuses a bad window", async () => {
  const { dir, handle } = api();
  const at = new Date().toISOString();
  writeFileSync(
    join(dir, "config", "decisions.jsonl"),
    `${JSON.stringify({ time: at, project: "web-shop", step: "WEB-1", kind: "stall", class: "signed-out", event: "stall", reason: "stall signed-out: x" })}\n`,
  );
  const body = (await (await handle(new Request("http://127.0.0.1:7420/api/stalls?hours=2"))).json()) as {
    stalls: number;
    classes: Record<string, { stalls: number }>;
  };
  expect(body.stalls).toBe(1);
  expect(body.classes["signed-out"]?.stalls).toBe(1);
  expect((await handle(new Request("http://127.0.0.1:7420/api/stalls?hours=x"))).status).toBe(400);
});

test("/api/home lists three projects, not the Dispatcher's space, and shows the open task of another space apart", async () => {
  const { dir, handle } = api();
  const spaces = ["web-shop", "two", "three", "dispatcher", "retired"];
  writeFileSync(join(dir, "shepherdr", "spaces.json"), JSON.stringify(spaces.map((name, i) => ({ key: `S${i}`, name, path: join(dir, "none", name) }))));
  writeFileSync(join(dir, "shepherdr", "tasks.json"), JSON.stringify({ tasks: [{ id: "S4-1", title: "Left over", told: "work", updated: 1 }], red: {} }));
  for (const name of ["two", "three"]) {
    mkdirSync(join(dir, "config", "projects", name), { recursive: true });
    writeFileSync(join(dir, "config", "projects", name, "settings.json"), JSON.stringify({ space: name, repo: join(dir, "none", name) }));
  }
  const home = (await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as { projects: { name: string }[]; loose: unknown[] };
  expect(home.projects.map((p) => p.name)).toEqual(["web-shop", "two", "three"]);
  expect(home.loose).toMatchObject([{ id: "S4-1", space: "retired", state: "work" }]);
});
