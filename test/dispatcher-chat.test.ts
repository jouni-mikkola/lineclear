import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import compactChats, { COORDINATOR_LIMIT, DISPATCHER_LIMIT } from "../pi/compact-chats.ts";
import { dispatcherPrompt, moveMain } from "../src/dispatcher.ts";
import { readItems } from "../src/inbox.ts";
import { planMain } from "../src/plan.ts";
import { status } from "../src/status.ts";
import { webApi } from "../src/web.ts";
import { chatClient, step } from "./chat-client.ts";
import { startFakeLineclear } from "../ui/test/fake-lineclear-server.ts";

// The owner writes in the web chat; the Dispatcher (played here by a script, as no model runs in a test) runs the
// lineclear command its prompt names and answers with what it printed. Each command is the real one.
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

test("the web chat gets answers to status, plan and move from the Dispatcher", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-dchat-"));
  dirs.push(dir);
  const repo = join(dir, "demo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "ROADMAP.md"), `# Roadmap\n\n## Phase 0\n\n${step("A")}\n${step("B")}\n`);
  const bin = join(dir, "lineclear");
  const log = join(dir, "calls.log");
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nif [ "$1" = task ] && [ "$2" = list ]; then echo '[{"id":"D-1","title":"One","status":"need","sub":"Pick A or B"}]'; fi\n`,
  );
  chmodSync(bin, 0o755);
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  writeFileSync(
    join(config, "projects", "demo", "settings.json"),
    JSON.stringify({ repo, space: "demo", check: "true", askBefore: { plans: true }, models: { worker: [], reviewer: [] } }),
  );
  const env = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_SERVER_BIN: bin, LINECLEAR_ROLE: "dispatcher" };

  const run = async (f: (out: (l: string) => void) => number) => {
    const lines: string[] = [];
    const code = f((l) => lines.push(l));
    return `${code === 0 ? "" : "It failed. "}${lines.join("\n")}`;
  };
  // the script stands for the Dispatcher only while its brief names these commands
  for (const c of ["lineclear status", "lineclear plan", "lineclear move"]) expect(dispatcherPrompt()).toContain(c);
  const fake = startFakeLineclear({
    reply: (text) => {
      if (text.startsWith("status")) return run((o) => status(o, env, "demo"));
      if (text.startsWith("plan")) return run((o) => planMain(["demo", "Add a login step"], o, env) as number);
      return run((o) => moveMain(["demo", "B", "--after", "A"], o, env));
    },
  });
  try {
    const handle = webApi({ LINECLEAR_CONFIG: config, LINECLEAR_HOME: join(dir, "sh"), HOME: dir, LINECLEAR_URL: fake.url });
    const { view, send } = chatClient(handle);
    await view((v) => v.state === "ready");
    const ask = async (text: string, n: number) => {
      await send(text);
      const v = await view((v) => v.messages.length === n && !v.writing);
      return v.messages[n - 1]?.text as string;
    };

    expect(await ask("status of demo", 2)).toContain("D-1 waits for you: Pick A or B");

    expect(await ask("plan a login step", 4)).toContain("Plan PLAN-1 for the project demo");
    expect(readFileSync(log, "utf8")).not.toContain("task add");

    const before = readFileSync(join(repo, "docs", "ROADMAP.md"), "utf8");
    expect(await ask("move B after A", 6)).toContain("Nothing changes until the owner approves");
    expect(readItems(env)[0]!.move).toEqual({ step: "B", after: ["A"] });
    expect(readFileSync(join(repo, "docs", "ROADMAP.md"), "utf8")).toBe(before);
  } finally {
    fake.stop();
  }
});

test("a chat session that grew long is compacted when its turn ends, a task agent's is not", () => {
  const ended = (env: Record<string, string>, tokens: number) => {
    let compacted = 0;
    const handlers: Record<string, (e: unknown, c: unknown) => void> = {};
    compactChats({ on: (name, h) => void (handlers[name] = h) }, env);
    handlers.agent_end?.({}, { getContextUsage: () => ({ tokens }), compact: () => compacted++ });
    return compacted;
  };
  expect(ended({ LINECLEAR_ROLE: "dispatcher" }, DISPATCHER_LIMIT + 1)).toBe(1);
  expect(ended({ LINECLEAR_ROLE: "dispatcher" }, DISPATCHER_LIMIT)).toBe(0);
  expect(ended({ LINECLEAR_CHAT: "demo" }, COORDINATOR_LIMIT + 1)).toBe(1);
  expect(ended({ LINECLEAR_CHAT: "LE-1/Agent" }, COORDINATOR_LIMIT * 5)).toBe(0);
});
