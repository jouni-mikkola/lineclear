import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { modelNote, modelReasons } from "../src/model-use.ts";
import { recordLimits } from "../pi/extension.ts";
import { reorderReasons } from "../ui/kit/model-list.tsx";
import { tmp } from "./helpers.ts";

// Why each model of a list is or is not used now, so "active" explains itself.

const NOW = new Date(2026, 10, 1, 12, 0, 0);

function setup() {
  const root = tmp("model-use");
  const vars = { LINECLEAR_CONFIG: join(root, "config"), HOME: root } as NodeJS.ProcessEnv;
  recordLimits(
    "sub-b",
    { "anthropic-ratelimit-unified-5h-utilization": "0.2", "anthropic-ratelimit-unified-5h-reset": String(Date.parse("2026-12-01T00:00:00Z") / 1000) },
    vars,
    NOW,
  );
  writeFileSync(
    join(root, "config", "accounts.json"),
    JSON.stringify({ "sub-a": { kind: "subscription", out: true, resetAt: new Date(2026, 10, 1, 16, 0, 0).toISOString(), window: "session" } }),
  );
  return vars;
}

test("a full account says until when, the first one with room is in use and the rest wait their turn", () => {
  const r = modelReasons(["sub-a/m1", "sub-b/m2", "sub-b/m3"], setup(), NOW);
  expect(r).toEqual([
    { state: "full", reason: "account full until 16:00" },
    { state: "use", reason: "in use" },
    { state: "next", reason: "next, takes over when the ones above are full" },
  ]);
});

test("an account that reports no limit says so, and a reorder changes which row is in use", () => {
  const vars = setup();
  const list = ["sub-b/m2", "free/m4", "sub-a/m1"];
  const r = modelReasons(list, vars, NOW);
  expect(r.map((x) => x.reason)).toEqual(["in use", "next, takes over when the ones above are full, usage not reported", "account full until 16:00"]);
  const swapped = ["free/m4", "sub-b/m2", "sub-a/m1"];
  expect(modelReasons(swapped, vars, NOW).map((x) => x.state)).toEqual(["use", "next", "full"]);
  // the page re-ranks at once, before the server answers
  expect(reorderReasons(list, r, swapped)?.map((x) => [x.state, x.reason])).toEqual([
    ["use", "in use, usage not reported"],
    ["next", "next, takes over when the ones above are full"],
    ["full", "account full until 16:00"],
  ]);
});

test("a task on a model outside its project's list says it was set by its coordinator", () => {
  expect(modelNote("a/x", ["a/x", "b/y"])).toBeUndefined();
  expect(modelNote("c/z", ["a/x", "b/y"])).toBe("set by coordinator: not in the project's list");
});
