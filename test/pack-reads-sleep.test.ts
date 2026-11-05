import { expect, test } from "bun:test";
import batchedReads, { HINT, SINGLE_READS } from "../pi/parts/batched-reads.ts";
import noSleep, { sleepSeconds } from "../pi/parts/no-sleep.ts";

function register(part: (pi: any) => void) {
  const h: Record<string, ((e: any, c: any) => any)[]> = {};
  part({ on: (e: string, f: (e: any, c: any) => any) => void (h[e] ??= []).push(f) });
  const fire = (e: string, ev: any = {}) => h[e]?.map((f) => f(ev, {})).find((r) => r !== undefined);
  return fire;
}

/** One whole turn that makes the given tool calls. */
function turn(fire: ReturnType<typeof register>, ...tools: string[]) {
  fire("turn_start");
  for (const t of tools) fire("tool_call", { toolName: t, input: {} });
  fire("turn_end");
}
const read = (fire: ReturnType<typeof register>) => fire("tool_result", { toolName: "read", content: [{ type: "text", text: "file" }] });

test("after several single-read turns in a row the next read gets the hint", () => {
  const fire = register(batchedReads);
  for (let i = 0; i < SINGLE_READS - 1; i++) turn(fire, "read");
  expect(read(fire)).toBeUndefined();
  turn(fire, "read");
  const r = read(fire);
  expect(r.content).toEqual([
    { type: "text", text: "file" },
    { type: "text", text: HINT },
  ]);
});

test("the hint comes once, then the count starts again", () => {
  const fire = register(batchedReads);
  for (let i = 0; i < SINGLE_READS; i++) turn(fire, "read");
  expect(read(fire)).toBeDefined();
  expect(read(fire)).toBeUndefined();
});

test("a turn with several reads, or another tool, ends the streak", () => {
  const fire = register(batchedReads);
  for (let i = 0; i < SINGLE_READS; i++) turn(fire, "read");
  expect(read(fire)).toBeDefined();
  turn(fire, "read", "read");
  expect(read(fire)).toBeUndefined();
  for (let i = 0; i < SINGLE_READS; i++) turn(fire, "read");
  turn(fire, "bash");
  expect(read(fire)).toBeUndefined();
});

test("only a read result gets the hint", () => {
  const fire = register(batchedReads);
  for (let i = 0; i < SINGLE_READS; i++) turn(fire, "read");
  expect(fire("tool_result", { toolName: "bash", content: [] })).toBeUndefined();
});

test("a bash call that starts with a long sleep is refused and names a blocking command", () => {
  const fire = register(noSleep);
  for (const c of ["sleep 30", "sleep 10; tail log", "sleep 2m && cat log", "  sleep 8 5", "sleep 0.5h", "lineclear slot 'sleep 60 && bun run check'"]) {
    const r = fire("tool_call", { toolName: "bash", input: { command: c } });
    expect(r?.block).toBe(true);
    expect(r.reason).toContain("until grep -q DONE log");
  }
});

test("a short sleep, a sleep inside a loop and other commands are allowed", () => {
  const fire = register(noSleep);
  for (const c of ["sleep 2", "sleep 9.9", "until grep -q DONE log; do sleep 5; done", "echo sleep 60", "bun test", "sleeper 60"])
    expect(fire("tool_call", { toolName: "bash", input: { command: c } })).toBeUndefined();
  expect(fire("tool_call", { toolName: "read", input: { path: "sleep 60" } })).toBeUndefined();
  expect(sleepSeconds("sleep 1m")).toBe(60);
});
