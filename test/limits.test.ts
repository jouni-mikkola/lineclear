import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import lineclearExtension, { limitsOf, recordLimits } from "../pi/extension.ts";
import { usageLimits } from "../src/limits.ts";
import { tmp } from "./helpers.ts";

// How full each account's limits are (U17): pi's extension notes them from a response's headers, and Home's Usage
// card reads them with the accounts marked full.

const NOW = Date.parse("2026-10-31T12:00:00Z");
const unix = (iso: string) => String(Date.parse(iso) / 1000);
const HEADERS = {
  "anthropic-ratelimit-unified-5h-utilization": "0.39",
  "anthropic-ratelimit-unified-5h-reset": unix("2026-10-31T14:00:00Z"),
  "anthropic-ratelimit-unified-7d-utilization": "0.25",
  "anthropic-ratelimit-unified-7d-reset": unix("2026-11-04T09:00:00Z"),
};
const env = (root: string) => ({ LINECLEAR_CONFIG: join(root, "config"), HOME: root });

test("a response's unified limit headers read as the session and the week in percent with their reset times", () => {
  expect(limitsOf(HEADERS)).toEqual({
    session: { percent: 39, resetAt: "2026-10-31T14:00:00.000Z" },
    week: { percent: 25, resetAt: "2026-11-04T09:00:00.000Z" },
  });
  expect(limitsOf({ "Anthropic-Ratelimit-Unified-7d-Utilization": "1.2" })).toEqual({ week: { percent: 100 } });
  expect(limitsOf({ "content-type": "text/event-stream" })).toBeUndefined();
  expect(limitsOf({ "anthropic-ratelimit-unified-5h-utilization": "" })).toBeUndefined();
});

test("the extension notes each account's limits from its responses, and writes only when they change", async () => {
  const root = tmp("limits");
  const handlers: Record<string, (e: any, ctx: any) => unknown> = {};
  const old = process.env.LINECLEAR_CONFIG;
  process.env.LINECLEAR_CONFIG = join(root, "config");
  try {
    await lineclearExtension({ on: (name, h) => void (handlers[name] ??= h) });
    handlers.after_provider_response!({ status: 200, headers: HEADERS }, { model: { provider: "claude-sub" } });
    handlers.after_provider_response!({ status: 200, headers: { "x-other": "1" } }, { model: { provider: "openai" } });
  } finally {
    if (old === undefined) delete process.env.LINECLEAR_CONFIG;
    else process.env.LINECLEAR_CONFIG = old;
  }
  const file = join(root, "config", "limits.json");
  const noted = JSON.parse(readFileSync(file, "utf8"));
  expect(Object.keys(noted)).toEqual(["claude-sub"]);
  expect(noted["claude-sub"].session).toEqual({ percent: 39, resetAt: "2026-10-31T14:00:00.000Z" });
  const at = noted["claude-sub"].at;
  recordLimits("claude-sub", HEADERS, env(root), new Date(NOW + 60_000));
  expect(JSON.parse(readFileSync(file, "utf8"))["claude-sub"].at).toBe(at);
  recordLimits("claude-sub", { ...HEADERS, "anthropic-ratelimit-unified-5h-utilization": "0.5" }, env(root), new Date(NOW));
  expect(JSON.parse(readFileSync(file, "utf8"))["claude-sub"]).toMatchObject({ session: { percent: 50 }, at: new Date(NOW).toISOString() });
});

test("Usage lists each account fullest first: a full one at 100% until its reset, a reset one at 0%, one with no limit reported", () => {
  const root = tmp("usage");
  const e = env(root);
  recordLimits("sub-a", HEADERS, e, new Date(NOW));
  recordLimits("sub-old", HEADERS, e, new Date(NOW - 8 * 86_400_000));
  recordLimits(
    "sub-reset",
    { "anthropic-ratelimit-unified-5h-utilization": "0.9", "anthropic-ratelimit-unified-5h-reset": unix("2026-10-31T11:00:00Z") },
    e,
    new Date(NOW),
  );
  writeFileSync(
    join(root, "config", "accounts.json"),
    JSON.stringify({ "sub-full": { kind: "subscription", out: true, resetAt: "2026-10-31T13:00:00.000Z", window: "session" } }),
  );
  expect(usageLimits(["api-key", "sub-a"], e, NOW)).toEqual([
    { account: "sub-full", session: { percent: 100, resetAt: "2026-10-31T13:00:00.000Z" } },
    {
      account: "sub-a",
      pace: "on pace",
      session: { percent: 39, resetAt: "2026-10-31T14:00:00.000Z" },
      week: { percent: 25, resetAt: "2026-11-04T09:00:00.000Z" },
    },
    { account: "sub-reset", session: { percent: 0 } },
    { account: "api-key", unreported: true },
  ]);
  // after its reset the full account is listed no more, unless it was used
  expect(usageLimits([], e, Date.parse("2026-10-31T13:30:00Z")).map((u) => u.account)).toEqual(["sub-a", "sub-reset"]);
});

test("an account the owner retired is not on Usage, even when it is used or full", () => {
  const root = tmp("usage-retired");
  const e = env(root);
  recordLimits("sub-a", HEADERS, e, new Date(NOW));
  writeFileSync(
    join(root, "config", "accounts.json"),
    JSON.stringify({
      "sub-a": { kind: "subscription", retired: true },
      "sub-full": { kind: "subscription", out: true, resetAt: "2026-10-31T13:00:00.000Z", retired: true },
    }),
  );
  expect(usageLimits(["sub-a"], e, NOW)).toEqual([]);
});
