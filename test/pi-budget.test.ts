import { expect, test } from "bun:test";
import budget from "../pi/budget.ts";

function run(env: Record<string, string>, turns: number[]) {
  const seen = { compact: 0, message: 0, abort: 0 };
  let turnEnd: (e: unknown, c: unknown) => void = () => {};
  budget(
    {
      on: (name, h) => {
        if (name === "turn_end") turnEnd = h;
      },
      sendUserMessage: () => void seen.message++,
    },
    env,
  );
  const ctx = { compact: () => seen.compact++, abort: () => seen.abort++ };
  for (const input of turns) turnEnd({ message: { role: "assistant", usage: { input, cacheRead: 9e6 } } }, ctx);
  return seen;
}

test("a task agent compacts at 80 %, is told at 100 % and stops at its cap, each once", () => {
  const env = { LINECLEAR_CHAT: "LE-1/Agent" };
  expect(run(env, [100_000, 10_000])).toEqual({ compact: 0, message: 0, abort: 0 });
  expect(run(env, [100_000, 30_000, 5_000])).toEqual({ compact: 1, message: 0, abort: 0 });
  expect(run(env, [100_000, 30_000, 30_000, 5_000])).toEqual({ compact: 1, message: 1, abort: 0 });
  expect(run(env, [100_000, 30_000, 30_000, 250_000, 10_000])).toEqual({ compact: 1, message: 1, abort: 1 });
});

test("LINECLEAR_BUDGET_<ROLE> overrides the budget", () => {
  expect(run({ LINECLEAR_CHAT: "LE-1/Agent", LINECLEAR_BUDGET_AGENT: "1000" }, [900])).toEqual({
    compact: 1,
    message: 0,
    abort: 0,
  });
});

test("a chat role never aborts", () => {
  expect(run({ LINECLEAR_CHAT: "demo" }, [900_000, 900_000, 900_000])).toEqual({ compact: 1, message: 0, abort: 0 });
  expect(run({ LINECLEAR_ROLE: "dispatcher" }, [600_000, 600_000, 9_000_000])).toEqual({
    compact: 1,
    message: 0,
    abort: 0,
  });
});

test("a hand-run pi has no budget", () => {
  expect(run({}, [9_000_000])).toEqual({ compact: 0, message: 0, abort: 0 });
});
