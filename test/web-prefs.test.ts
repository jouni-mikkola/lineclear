import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shownProjects } from "../src/prefs.ts";
import { listProjectNames } from "../src/project.ts";
import { webApi } from "../src/web.ts";
import { json, until } from "./helpers.ts";

type Answer = { projects: { name: string }[]; usage: { account: string }[]; month?: { accounts: unknown[] }; accounts: unknown[]; showPaused: boolean };

const api = () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-prefs-"));
  mkdirSync(join(dir, "config", "projects", "web-shop"), { recursive: true });
  mkdirSync(join(dir, "shepherdr"), { recursive: true });
  writeFileSync(join(dir, "shepherdr", "spaces.json"), JSON.stringify([{ key: "WEB", name: "web-shop", path: join(dir, "none") }]));
  writeFileSync(join(dir, "shepherdr", "tasks.json"), JSON.stringify({ tasks: [], red: {} }));
  writeFileSync(join(dir, "config", "projects", "web-shop", "settings.json"), JSON.stringify({ space: "web-shop", repo: join(dir, "none") }));
  const conf = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    SHEPHERDR_BIN: "true",
    HOME: dir,
  };
  return { dir, handle: webApi(conf) };
};

test("an account is retired from Settings: hidden from usage and the month's spend, listed there until it is used again", async () => {
  const { dir, handle } = api();
  writeFileSync(
    join(dir, "config", "accounts.json"),
    JSON.stringify({ gone: { kind: "subscription", price: 20, currency: "USD", out: true, resetAt: "2999-01-01T00:00:00.000Z" } }),
  );
  const read = async (): Promise<Answer> => (await handle(new Request("http://127.0.0.1:7420/api/home"))).json();
  await until(async () => !!(await read()).month, 50);
  expect((await read()).usage.map((u) => u.account)).toEqual(["gone"]);
  expect((await handle(json("/api/accounts/gone", { retired: "yes" }))).status).toBe(400);
  expect((await handle(json("/api/accounts/gone", { retired: true }, { "content-type": "text/plain" }))).status).toBe(403);
  expect((await handle(json("/api/accounts/gone", { retired: true }))).status).toBe(200);
  const home = await read();
  expect(home.usage).toEqual([]);
  expect(home.month?.accounts).toEqual([]);
  const settings: Answer = await (await handle(new Request("http://127.0.0.1:7420/api/settings"))).json();
  expect(settings.accounts).toEqual([{ account: "gone", kind: "subscription", price: 20, currency: "USD", retired: true }]);
  // a price change keeps it retired; unticked, it counts again
  await handle(json("/api/accounts/gone", { price: 25, currency: "USD" }));
  expect(JSON.parse(readFileSync(join(dir, "config", "accounts.json"), "utf8")).gone.retired).toBe(true);
  expect((await handle(json("/api/accounts/gone", { retired: false }))).status).toBe(200);
  expect((await read()).usage.map((u) => u.account)).toEqual(["gone"]);
  rmSync(dir, { recursive: true, force: true });
});

test("paused projects and the test space leave Home until Settings asks for them", async () => {
  const { dir, handle } = api();
  const proj = join(dir, "config", "projects", "web-shop", "settings.json");
  const names = async () => ((await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as Answer).projects.map((p) => p.name);
  const shown = async () => ((await (await handle(new Request("http://127.0.0.1:7420/api/settings"))).json()) as Answer).showPaused;
  writeFileSync(proj, JSON.stringify({ space: "web-shop", repo: join(dir, "none"), paused: true }));
  expect(await names()).toEqual([]);
  expect(await shown()).toBe(false);
  expect((await handle(json("/api/prefs", { showPaused: "yes" }))).status).toBe(400);
  expect((await handle(json("/api/prefs", { showPaused: true }, { "content-type": "text/plain" }))).status).toBe(403);
  expect((await handle(json("/api/prefs", { showPaused: true }))).status).toBe(200);
  expect(await names()).toEqual(["web-shop"]);
  expect(await shown()).toBe(true);
  await handle(json("/api/prefs", { showPaused: false }));
  expect(await names()).toEqual([]);
  // the test space goes the same way
  expect(shownProjects([{ project: "lineclear-track" }, { project: "web-shop" }], {}).map((p) => p.project)).toEqual(["web-shop"]);
  expect(shownProjects([{ project: "lineclear-track" }], { showPaused: true })).toHaveLength(1);
  rmSync(dir, { recursive: true, force: true });
});

test("/api/home lists the projects of `project list` (paused shown), not the Dispatcher's space, and the loose task of another", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-exact-"));
  const spaces = ["a", "b", "c", "Dispatcher", "orphan"];
  mkdirSync(join(dir, "shepherdr"), { recursive: true });
  writeFileSync(join(dir, "shepherdr", "spaces.json"), JSON.stringify(spaces.map((name, i) => ({ name, key: `K${i}`, path: join(dir, name) }))));
  writeFileSync(join(dir, "shepherdr", "tasks.json"), JSON.stringify({ tasks: [{ id: "K4-1", title: "Loose work", created: 1, updated: 2 }], red: {} }));
  for (const n of ["a", "b", "c"]) {
    mkdirSync(join(dir, "config", "projects", n), { recursive: true });
    writeFileSync(
      join(dir, "config", "projects", n, "settings.json"),
      JSON.stringify({ space: n, repo: join(dir, n), ...(n === "c" ? { paused: true } : {}) }),
    );
  }
  const bin = join(dir, "task-list.sh");
  writeFileSync(bin, `#!/bin/sh\necho '[{"id":"K4-1","status":"work"}]'\n`, { mode: 0o755 });
  const conf = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    SHEPHERDR_BIN: bin,
  };
  const handle = webApi(conf);
  await handle(json("/api/prefs", { showPaused: true }));
  const home = (await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as {
    projects: { project: string }[];
    loose: { id: string; space: string }[];
  };
  expect(home.projects.map((p) => p.project).sort()).toEqual(listProjectNames(conf));
  expect(home.projects).toHaveLength(3);
  expect(home.loose.map((t) => [t.id, t.space])).toEqual([["K4-1", "orphan"]]);
  rmSync(dir, { recursive: true, force: true });
});

test("/api/home lists exactly `project list` less the paused and the test space, and all of it once Settings asks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-except-"));
  const bin = join(dir, "task-list.sh");
  writeFileSync(bin, "#!/bin/sh\necho '[]'\n", { mode: 0o755 });
  mkdirSync(join(dir, "shepherdr"), { recursive: true });
  writeFileSync(
    join(dir, "shepherdr", "spaces.json"),
    JSON.stringify(["a", "b", "c", "Dispatcher"].map((name, i) => ({ name, key: `K${i}`, path: join(dir, name) }))),
  );
  writeFileSync(join(dir, "shepherdr", "tasks.json"), JSON.stringify({ tasks: [], red: {} }));
  for (const [n, extra] of [
    ["a", {}],
    ["b", {}],
    ["c", { paused: true }],
    ["lineclear-track", {}],
  ] as const) {
    mkdirSync(join(dir, "config", "projects", n), { recursive: true });
    writeFileSync(
      join(dir, "config", "projects", n, "settings.json"),
      JSON.stringify({ space: n === "lineclear-track" ? "a" : n, repo: join(dir, n), ...extra }),
    );
  }
  const conf = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_SHEPHERDR_DIR: join(dir, "shepherdr"),
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    SHEPHERDR_BIN: bin,
  };
  const handle = webApi(conf);
  const listed = async () =>
    ((await (await handle(new Request("http://127.0.0.1:7420/api/home"))).json()) as { projects: { project: string }[] }).projects.map((p) => p.project).sort();
  const all = listProjectNames(conf);
  expect(all).toEqual(["a", "b", "c", "lineclear-track"]);
  expect(await listed()).toEqual(all.filter((n) => n !== "c" && n !== "lineclear-track"));
  await handle(json("/api/prefs", { showPaused: true }));
  expect(await listed()).toEqual(all);
  rmSync(dir, { recursive: true, force: true });
});
