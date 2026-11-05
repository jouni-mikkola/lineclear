import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readItems } from "../src/inbox.ts";
import { inboxMain } from "../src/inbox-answer.ts";
import { promote, promotionRefusal } from "../src/promote.ts";
import { promotionDue } from "../src/promote-step.ts";
import { postPromoteAsk, promoteMain } from "../src/promote-cmd.ts";
import { tmp } from "./helpers.ts";

const NAMES = ["check", "smoke", "canary", "store"];

/** Builds 1.0.0 (current) and 1.1.0 (installed, not stable), a systemctl stand-in that logs its calls and a smoke script of 1.1.0 that exits with `smoke`. */
function world(smoke: number, outcomes: Partial<Record<string, string>> = {}) {
  const root = tmp("promote");
  const data = join(root, "data");
  const config = join(root, "config");
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(config, { recursive: true });
  for (const v of ["1.0.0", "1.1.0"]) {
    mkdirSync(join(data, "builds", v, "scripts"), { recursive: true });
    writeFileSync(join(data, "builds", v, ".release"), `${v}\n`);
    writeFileSync(join(data, "builds", v, "scripts", "smoke.ts"), `console.log("smoke said no"); process.exit(${v === "1.1.0" ? smoke : 0});\n`);
  }
  symlinkSync(join(data, "builds", "1.0.0"), join(data, "builds", "current"));
  writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >>${join(root, "systemctl.log")}\nexit 0\n`);
  chmodSync(join(bin, "systemctl"), 0o755);
  const checks = NAMES.map((name) => ({ name, outcome: outcomes[name] ?? "passed" }));
  const result = checks.every((c) => c.outcome === "passed") ? "ready" : "failed";
  writeFileSync(
    join(config, "release.json"),
    JSON.stringify({ candidate: { version: "1.1.0", commit: "c".repeat(40), at: "2026-01-01T00:00:00Z", result, checks } }),
  );
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LINECLEAR_HOME: data, LINECLEAR_CONFIG: config, LINECLEAR_CACHE: join(root, "cache") };
  const link = (n: string) => readlinkSync(join(data, "builds", n));
  const decisions = () => readFileSync(join(config, "decisions.jsonl"), "utf8");
  return { root, data, config, env, link, decisions, calls: () => readFileSync(join(root, "systemctl.log"), "utf8") };
}

test("a candidate without passed checks is refused, and nothing moves", () => {
  for (const outcomes of [{ canary: "failed" }, { smoke: "skipped" }, { store: "failed" }]) {
    const w = world(0, outcomes);
    expect(promotionRefusal("1.1.0", w.env)).toContain("did not pass");
    expect(promote("1.1.0", w.env)).toContain("did not pass");
    expect(w.link("current")).toEndWith("1.0.0");
  }
  const w = world(0);
  expect(promotionRefusal("1.2.0", w.env)).toContain("was not checked");
  const lines: string[] = [];
  expect(promoteMain(["1.2.0"], (l) => lines.push(l), w.env)).toBe(1);
  expect(readItems(w.env)).toEqual([]);
});

test("a promotion points current at the build, keeps the one before as previous, logs the decision and leaves one item with a way back", () => {
  const w = world(0);
  const lines: string[] = [];
  expect(promoteMain(["1.1.0"], (l) => lines.push(l), w.env)).toBe(0);
  expect(w.link("current")).toEndWith("1.1.0");
  expect(w.link("previous")).toEndWith("1.0.0");
  const logged = JSON.parse(w.decisions().trim().split("\n").at(-1) as string);
  expect(logged).toMatchObject({ version: "1.1.0", checks: NAMES });
  expect(logged.reason).toContain("promoted 1.1.0 (was 1.0.0)");
  const items = readItems(w.env);
  expect(items).toHaveLength(1);
  expect(items[0]?.question).toContain("1.1.0 is stable now");
  expect(items[0]?.question).toContain("Smoke run: the smoke check passed");
  expect(items[0]?.choices).toEqual(["Roll back"]);
  expect(items[0]?.release).toEqual({ version: "1.1.0", action: "rollback" });
});

test("a smoke check that fails after the switch puts the previous build back", () => {
  const w = world(1);
  const lines: string[] = [];
  expect(promoteMain(["1.1.0"], (l) => lines.push(l), w.env)).toBe(1);
  expect(w.link("current")).toEndWith("1.0.0");
  expect(() => w.link("previous")).toThrow();
  expect(lines[0]).toContain("smoke said no");
  expect(w.decisions()).toContain("promotion of 1.1.0 failed and 1.0.0 is back");
  expect(readItems(w.env)[0]?.choices).toEqual(["Ok"]);
  // the service restarted twice: onto the new build and back
  expect(w.calls().match(/restart lineclear.service/g)).toHaveLength(2);
});

test("a promotion leaves working, waiting and queued tasks as they were: only Lineclear's units restart", () => {
  const w = world(0);
  // the live state a restart must not touch: the store's tasks, the waits, the merge line's queue and a running agent
  const files = {
    "tasks.json": '{"LIN-1":"working","LIN-2":"waiting","LIN-3":"queued"}',
    "waits.json": '{"LIN-2":"asked: Go?"}',
    "merge-queue.json": '["LIN-3","LIN-4"]',
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(w.data, name), text);
  const agent = Bun.spawn(["sleep", "300"], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    expect(typeof promote("1.1.0", w.env)).toBe("object");
    for (const [name, text] of Object.entries(files)) expect(readFileSync(join(w.data, name), "utf8")).toBe(text);
    expect(agent.exitCode).toBe(null);
    const restarted = w
      .calls()
      .split("\n")
      .filter((l) => l.includes("restart"));
    expect(restarted.length).toBeGreaterThan(0);
    expect(restarted.every((l) => /lineclear(-serve-\d+)?\.service/.test(l))).toBe(true);
    expect(w.calls()).not.toContain("herdr");
  } finally {
    agent.kill();
  }
});

test("a project that asks gets one item with a tap to promote, once per version", () => {
  const w = world(0);
  const first = postPromoteAsk("1.1.0", w.env);
  expect(first?.release).toEqual({ version: "1.1.0", action: "promote" });
  expect(first?.choices).toEqual(["Promote"]);
  expect(postPromoteAsk("1.1.0", w.env)).toBeUndefined();
  expect(readItems(w.env)).toHaveLength(1);
});

test("the roll-back tap of an older promotion does nothing once another build is stable", () => {
  const w = world(0);
  const lines: string[] = [];
  promoteMain(["1.1.0"], (l) => lines.push(l), w.env);
  const item = readItems(w.env)[0] as NonNullable<ReturnType<typeof readItems>[number]>;
  symlinkSync(join(w.data, "builds", "1.0.0"), join(w.data, "builds", ".c.tmp"));
  renameSync(join(w.data, "builds", ".c.tmp"), join(w.data, "builds", "current"));
  expect(inboxMain(["answer", String(item.n), "Roll back"], (l) => lines.push(l), w.env)).toBe(1);
  expect(lines.at(-1)).toContain("is not stable any more");
  expect(w.link("current")).toEndWith("1.0.0");
});

test("the rule loop offers a passed candidate that is newer than stable, and none that failed or is stable", () => {
  expect(promotionDue(world(0).env)).toBe("1.1.0");
  expect(promotionDue(world(0, { canary: "failed" }).env)).toBeUndefined();
  const w = world(0);
  promote("1.1.0", w.env);
  expect(promotionDue(w.env)).toBeUndefined();
});
