import { afterAll, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { turnTimes } from "../src/session-text.ts";
import { ownMark, tick } from "../src/rules.ts";
import { availability } from "../src/stalls.ts";
import { demoConfig, idleWorld } from "./demo-world.ts";
import { tmp } from "./helpers.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A world where every way to reach an agent is logged, and a burst of machine events is fed to a few ticks. */
test("a burst of load, quota and status events sends no message to any agent and calls no model", () => {
  const dir = tmp("quiet");
  dirs.push(dir);
  const config = demoConfig(dir, {
    worker: ["anthropic/claude-sonnet-5-5", "openai-codex/gpt-6.1-sol"],
    reviewer: ["anthropic/claude-opus-5-5", "openai-codex/gpt-6.1-sol"],
    loadPerCore: 1 / cpus().length,
  });
  // the tick copies the store each hour: keep its home and copies in the scratch folder, not the machine's real ones
  const env = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_HOME: join(dir, "home"), LINECLEAR_STORE_COPIES: join(dir, "copies") };
  const clock = { at: new Date("2026-06-01T10:00:00Z") };
  const agentCalls: string[] = [];
  const statuses = ["work", "need", "work", "queued", "work", "need", "done"];
  let status = "work";
  let load = 0;
  let error: { text: string; at: number } | undefined;
  const chat: { id: string; task: string; at: number; text: string }[] = [];
  const world = idleWorld(env, {
    now: () => clock.at,
    tasks: () => [{ id: "LIN-5", title: "A Alpha", status, sub: status === "need" ? "signed out" : undefined }],
    load: () => load,
    stopTask: (id) => (agentCalls.push(`stop ${id}`), undefined),
    tellTask: (id, text) => (agentCalls.push(`tell ${id} ${text}`), undefined),
    closeTask: (id) => (agentCalls.push(`close ${id}`), undefined),
    branchOf: () => undefined,
    reviewerSetting: () => undefined,
    chatCards: () => chat,
    lastError: () => error,
    nudge: (id) => (agentCalls.push(`nudge ${id}`), undefined),
    addTask: () => undefined,
  });
  for (let i = 0; i < 7; i++) {
    load = i % 2 === 0 ? 50 : 0; // CPU load up and down
    status = statuses[i]!; // task status changes
    // the account runs out (a model call failed on it), and a reviewer reports a usage limit
    error = { text: "You have hit your session limit, resets 2026-06-01T15:00:00Z", at: clock.at.getTime() };
    chat.push({ id: `c${i}`, task: "LIN-5", at: clock.at.getTime() + 1, text: "anthropic usage limit reached, resets in 3 hours" });
    clock.at = new Date(clock.at.getTime() + 60_000);
    tick(world, false, env);
  }
  expect(availability("anthropic/claude-sonnet-5-5", env, clock.at)).toBe("out"); // the quota event was seen, by a rule
  expect(agentCalls.filter((c) => c.startsWith("tell") || c.startsWith("enter"))).toEqual([]);
});

test("a rule's lines are marked in the agent's log, the owner's are not", () => {
  expect(ownMark()).toBe("[lineclear]");
  expect(ownMark("resume")).toBe("[lineclear:resume]");
  expect(ownMark("answer")).toBe("[lineclear:answer]");
});

const user = (text: string, at: number) =>
  JSON.stringify({ type: "message", timestamp: new Date(at).toISOString(), message: { role: "user", content: [{ type: "text", text }] } });

test("measure counts the model turns that no step and no owner message started", () => {
  const session = [
    user("Task brief", 1000), // the step's brief
    user("<lineclear><go>Start</go></lineclear>", 2000),
    user("Please also fix the typo", 3000), // the owner
    user("[lineclear:resume] Your wait is over", 4000),
    user("[lineclear:answer] A stored login exists", 5000),
    user('<lineclear><health kind="cpu">CPU load is high</health></lineclear>', 6000),
    user('<lineclear><news task="LIN-9">LIN-9 is done</news></lineclear>', 7000),
    user("[lineclear] You may be stuck", 8000),
  ].join("\n");
  expect(turnTimes(session)).toEqual([6000, 7000, 8000]);
});
