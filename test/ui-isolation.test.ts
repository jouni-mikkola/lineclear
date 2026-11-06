// A UI test run must never reach the real board: the server `playwright.config.ts` starts drops every LINECLEAR_
// variable of the shell it runs in (an agent's shell carries the real `LINECLEAR_URL` and `LINECLEAR_CHAT`).
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureEnv, unsetLineclearEnv } from "../ui/test/fixture.ts";

const REAL = {
  LINECLEAR_URL: "http://127.0.0.1:9",
  LINECLEAR_CHAT: "LIN-1/Agent",
  LINECLEAR_COMMAND: "/real/lineclear",
  LINECLEAR_UI_PORT: "7432",
  PATH: process.env.PATH ?? "",
};

test("every real LINECLEAR_ variable is unset, the UI port stays", () => {
  const flags = unsetLineclearEnv(REAL).split(" ");
  expect(flags).toEqual(["-u", "LINECLEAR_URL", "-u", "LINECLEAR_CHAT", "-u", "LINECLEAR_COMMAND"].filter(Boolean));
});

test("playwright.config.ts starts the server with those variables unset", async () => {
  const command = (await import(`../playwright.config.ts?${Date.now()}`)).default.webServer.command as string;
  expect(command).toContain(`env ${unsetLineclearEnv()} HOME=`);
  // the real shell's variables are in this test's own env too, when an agent runs it
  for (const k of Object.keys(process.env).filter((k) => k.startsWith("LINECLEAR_") && k !== "LINECLEAR_UI_PORT")) expect(command).toContain(`-u ${k}`);
});

test("with the real URL in the shell, the stripped server still finds only the fixture's", () => {
  const home = mkdtempSync(join(tmpdir(), "ui-isolation-"));
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "server.json"), JSON.stringify({ port: 4321 }));
  const run = `env ${unsetLineclearEnv(REAL)} LINECLEAR_HOME=${home} bun -e 'import { lineclearServer } from "./src/lineclear-client.ts"; console.log(lineclearServer())'`;
  const out = Bun.spawnSync(["sh", "-c", run], { env: REAL, cwd: join(import.meta.dir, "..") });
  expect(out.stdout.toString().trim()).toBe("http://127.0.0.1:4321");
});

test("the config unsets a LINECLEAR_ variable the shell has, even on a machine with none", async () => {
  process.env.LINECLEAR_URL = REAL.LINECLEAR_URL;
  try {
    const command = (await import(`../playwright.config.ts?${Date.now()}x`)).default.webServer.command as string;
    expect(command).toContain("-u LINECLEAR_URL");
    expect(Object.keys(fixtureEnv())).not.toContain("LINECLEAR_URL");
    expect(fixtureEnv().LINECLEAR_HOME).toContain("lineclear-ui-");
  } finally {
    delete process.env.LINECLEAR_URL;
  }
});

test("no browser test hands the whole shell environment to a command", async () => {
  const root = join(import.meta.dir, "..");
  const files = [...new Bun.Glob("ui/test/*.ts").scanSync({ cwd: root })].filter((f) => !f.endsWith("fixture.ts"));
  for (const f of files) expect((await Bun.file(join(root, f)).text()).includes("...process.env"), `${f} passes it on`).toBe(false);
});
