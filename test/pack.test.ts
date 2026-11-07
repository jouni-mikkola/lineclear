import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pack, { PACK_ENTRY, parts, switchesFile } from "../pi/pack.ts";
import { packMain } from "../src/pack.ts";
import { doctorChecks } from "../src/doctor.ts";
import { extensionFile, pathsFor } from "../src/paths.ts";
import { tmp } from "./helpers.ts";
import lineclearExtension, { BEAT_MS, beatDuringCalls, nudgeQuietTurns } from "../pi/extension.ts";
import { IDLE_NUDGE, PROMISE_NUDGE } from "../pi/nudge.ts";

/** A pack with parts `a` and `b`: each registers one handler and says so in `seen`. */
function setup() {
  const root = tmp("pack");
  const dir = join(root, "parts");
  mkdirSync(dir);
  for (const n of ["a", "b"])
    writeFileSync(join(dir, `${n}.ts`), `export default (pi) => pi.on("tool_result", () => (globalThis.__seen ??= []).push("${n}"));\n`);
  const env = { HOME: root, LINECLEAR_CONFIG: join(root, "config"), LINECLEAR_PACK_PARTS: dir };
  const handlers: Record<string, ((e: any, c: any) => unknown)[]> = {};
  const entries: [string, any][] = [];
  const pi = {
    on: (e: string, h: (e: any, c: any) => unknown) => void (handlers[e] ??= []).push(h),
    appendEntry: (t: string, d: unknown) => void entries.push([t, d]),
  };
  return { root, dir, env, handlers, entries, pi };
}

test("every part is on by default and registers itself", async () => {
  const s = setup();
  expect(parts(s.env)).toEqual([
    { name: "a", on: true },
    { name: "b", on: true },
  ]);
  expect(await pack(s.pi, s.env)).toEqual(["a", "b"]);
  expect(s.handlers.tool_result).toHaveLength(2);
});

test("a switch keeps the other settings of pack.json", () => {
  const s = setup();
  mkdirSync(dirname(switchesFile(s.env)), { recursive: true });
  writeFileSync(switchesFile(s.env), JSON.stringify({ compaction: { worker: 120_000 } }));
  packMain(["off", "a"], () => undefined, s.env);
  expect(JSON.parse(readFileSync(switchesFile(s.env), "utf8"))).toEqual({ compaction: { worker: 120_000 }, off: ["a"] });
});

test("a switch turns a part off and on, and an unknown part is refused", async () => {
  const s = setup();
  const lines: string[] = [];
  expect(packMain(["off", "a"], (l) => lines.push(l), s.env)).toBe(0);
  expect(JSON.parse(readFileSync(switchesFile(s.env), "utf8"))).toEqual({ off: ["a"] });
  expect(await pack(s.pi, s.env)).toEqual(["b"]);
  expect(s.handlers.tool_result).toHaveLength(1);
  packMain([], (l) => lines.push(l), s.env);
  expect(lines).toEqual(["a: off", "off  a", "on   b"]);
  expect(packMain(["on", "a"], () => {}, s.env)).toBe(0);
  expect(parts(s.env).every((p) => p.on)).toBe(true);
  expect(packMain(["off", "nope"], (l) => lines.push(l), s.env)).toBe(1);
  expect(packMain(["off"], () => {}, s.env)).toBe(2);
});

test("a switch set twice writes nothing the second time", () => {
  const s = setup();
  packMain(["off", "a"], () => {}, s.env);
  const before = readFileSync(switchesFile(s.env), "utf8");
  packMain(["off", "a"], () => {}, s.env);
  expect(readFileSync(switchesFile(s.env), "utf8")).toBe(before);
  expect(readdirSync(join(s.root, "config"))).toEqual(["pack.json"]);
});

test("a part that fails to load does not stop the others", async () => {
  const s = setup();
  writeFileSync(join(s.dir, "broken.ts"), "throw new Error('no');\n");
  expect(await pack(s.pi, s.env)).toEqual(["a", "b"]);
});

test("the session records the parts that were on", async () => {
  const s = setup();
  packMain(["off", "b"], () => {}, s.env);
  await pack(s.pi, s.env);
  s.handlers.session_start?.forEach((h) => h({}, {}));
  expect(s.entries).toEqual([[PACK_ENTRY, { on: ["a"] }]]);
});

test("the file install writes for pi loads the pack, and the extension imports nothing pi resolves from that file", async () => {
  const s = setup();
  const app = join(import.meta.dir, "..");
  const file = join(s.root, "lineclear.ts");
  writeFileSync(file, extensionFile(app));
  expect(readFileSync(file, "utf8")).not.toMatch(/from\s+["']\./); // pi resolves a relative import from this file's folder
  const mod = await import(file);
  await mod.default(s.pi);
  expect(s.handlers.tool_call?.length).toBeGreaterThan(0);
});

test("doctor shows which parts are on", () => {
  const s = setup();
  packMain(["off", "b"], () => {}, s.env);
  const paths = { ...pathsFor({ HOME: s.root }), config: s.env.LINECLEAR_CONFIG, app: join(s.root, "app") };
  mkdirSync(join(paths.app, "pi", "parts"), { recursive: true });
  writeFileSync(join(paths.app, "pi", "parts", "a.ts"), "export default () => {};\n");
  writeFileSync(join(paths.app, "pi", "parts", "b.ts"), "export default () => {};\n");
  const check = doctorChecks({ paths, pathDirs: [], which: () => "x", run: () => null }).find((c) => c.name.startsWith("token pack"));
  expect(check?.name).toBe("token pack: a on, b off");
  expect(check?.problem).toBe("");
});

test("the shipped parts hold no account, provider or owner rule", () => {
  const dir = join(import.meta.dir, "..", "pi", "parts");
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (f.endsWith(".ts")) expect(readFileSync(join(dir, f), "utf8")).not.toMatch(/anthropic|openai|google|opencode|@[a-z0-9.-]+\.[a-z]+/i);
  }
});

/** One turn's messages: the user's, then an assistant that runs the given bash commands and says `text`. */
const turn = (text: string, ...commands: string[]) => [
  { role: "user", content: "go" },
  { role: "assistant", content: [...commands.map((command) => ({ type: "toolCall", name: "bash", arguments: { command } })), { type: "text", text }] },
];

function nudged(env: Record<string, string>) {
  const sent: string[] = [];
  const handlers: Record<string, ((e: unknown, c: unknown) => unknown)[]> = {};
  const on = (e: string, h: (e: unknown, c: unknown) => unknown) => {
    handlers[e] = [...(handlers[e] ?? []), h];
  };
  nudgeQuietTurns({ on, sendUserMessage: (t: string) => void sent.push(t) } as unknown as Parameters<typeof nudgeQuietTurns>[0], env);
  const start = () => {
    for (const h of handlers.before_agent_start ?? []) h({}, {});
  };
  // a nudge starts the next turn at once, as pi does
  const end = (messages: unknown[]) => {
    const before = sent.length;
    for (const h of handlers.agent_end ?? []) h({ messages }, {});
    if (sent.length > before) start();
  };
  return { sent, end, human: start };
}

test("a task agent's quiet turn is nudged at once, twice in a row, then left to the ladder", () => {
  const n = nudged({ LINECLEAR_CHAT: "LIN-1/Agent" });
  n.end(turn("Looks fine."));
  n.end(turn("I'll keep calling lineclear merge."));
  n.end(turn("Still nothing."));
  expect(n.sent).toEqual([IDLE_NUDGE, PROMISE_NUDGE]);
  n.human();
  n.end(turn("Quiet again."));
  expect(n.sent.length).toBe(3);
});

test("a turn that asked, declared a wait or reported ends with no nudge, and others are never nudged", () => {
  const n = nudged({ LINECLEAR_CHAT: "LIN-1/Agent" });
  for (const cmd of ['lineclear ask "Rerun?" --choice a', 'lineclear wait task LIN-2 "its code"', "lineclear ready LIN-1 --summary x", "lineclear done LIN-1"])
    n.end(turn("ok", cmd));
  expect(n.sent).toEqual([]);
  for (const chat of ["LIN-1/Reviewer", "dispatcher"]) {
    const other = nudged({ LINECLEAR_CHAT: chat });
    other.end(turn("quiet"));
    expect(other.sent).toEqual([]);
  }
});

// Waits for a condition instead of a fixed time, so a loaded machine only makes the test slower.
async function until(ok: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !ok(); i++) await Bun.sleep(10);
  expect(ok()).toBe(true);
}

test("L257: a task agent beats while a tool call runs and stops when it ends", async () => {
  const handlers: Record<string, ((e: any, c: any) => unknown)[]> = {};
  const pi = { on: (e: string, h: (e: any, c: any) => unknown) => void (handlers[e] ??= []).push(h) };
  const beats: string[] = [];
  beatDuringCalls(pi, { LINECLEAR_CHAT: "LINE-9/Agent" }, (task) => void beats.push(task), 10);
  const fire = (name: string, event: object) => handlers[name]!.forEach((h) => h(event, {}));
  await Bun.sleep(40);
  expect(beats).toEqual([]);
  fire("tool_call", { toolCallId: "a" });
  fire("tool_call", { toolCallId: "b" });
  await until(() => beats.length > 1);
  expect(new Set(beats)).toEqual(new Set(["LINE-9"]));
  fire("tool_result", { toolCallId: "a" });
  const one = beats.length;
  await until(() => beats.length > one);
  fire("tool_result", { toolCallId: "b" });
  const done = beats.length;
  await Bun.sleep(50);
  expect(beats.length).toBe(done);
  // not a task agent: nothing registered
  const none: Record<string, unknown[]> = {};
  beatDuringCalls({ on: (e: string, _h: unknown) => void (none[e] = []) }, { LINECLEAR_CHAT: "p:x" });
  expect(none).toEqual({});
});

test("L257: the beat is at most 5 minutes apart and runs `lineclear alive <task>` by default", async () => {
  expect(BEAT_MS).toBeLessThanOrEqual(5 * 60_000);
  const root = tmp("beat");
  const bin = join(root, "lineclear");
  const out = join(root, "args");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> ${out}\n`, { mode: 0o755 });
  const handlers: Record<string, ((e: any, c: any) => unknown)[]> = {};
  const pi = { on: (e: string, h: (e: any, c: any) => unknown) => void (handlers[e] ??= []).push(h) };
  beatDuringCalls(pi, { LINECLEAR_CHAT: "LINE-9/Agent", LINECLEAR_BIN: bin }, undefined, 10);
  handlers.tool_call![0]!({ toolCallId: "a" }, {});
  await until(() => existsSync(out) && readFileSync(out, "utf8").includes("\n"));
  handlers.tool_result![0]!({ toolCallId: "a" }, {});
  expect(readFileSync(out, "utf8").split("\n")[0]).toBe("alive LINE-9");
});

test("L257: the loaded extension itself registers the beat on pi's tool events", async () => {
  const seen: string[] = [];
  const prior = process.env.LINECLEAR_CHAT;
  process.env.LINECLEAR_CHAT = "LINE-9/Agent";
  try {
    await lineclearExtension({ on: (e: string) => void seen.push(e) });
  } finally {
    if (prior === undefined) delete process.env.LINECLEAR_CHAT;
    else process.env.LINECLEAR_CHAT = prior;
  }
  expect(seen.filter((e) => e === "tool_result").length).toBeGreaterThan(0);
  expect(seen).toContain("agent_end");
});
