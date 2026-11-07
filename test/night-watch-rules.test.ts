import assert from "node:assert";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { addDecisions, type StoredDecision } from "../src/decisions-store.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inNight, nightWatch } from "../src/rules.ts";

describe("inNight", () => {
  test("a window that wraps past midnight", () => {
    expect(inNight(new Date(2026, 0, 1, 23), "22-7")).toBe(true);
    expect(inNight(new Date(2026, 0, 1, 3), "22-7")).toBe(true);
    expect(inNight(new Date(2026, 0, 1, 12), "22-7")).toBe(false);
  });
  test("off and nonsense are never night", () => {
    expect(inNight(new Date(2026, 0, 1, 23), "off")).toBe(false);
  });
});

describe("nightWatch", () => {
  const setup = (paused: boolean) => {
    const home = mkdtempSync(join(tmpdir(), "lc-night-"));
    const projects = join(home, "projects");
    mkdirSync(join(projects, "p"), { recursive: true });
    writeFileSync(join(projects, "p", "settings.json"), JSON.stringify({ repo: home, space: "p", paused }));
    return { home, env: { LINECLEAR_HOME: home, LINECLEAR_CONFIG: home } };
  };
  const night = new Date(2026, 0, 1, 23);
  const log = (env: { LINECLEAR_CONFIG: string }, ds: StoredDecision[]) => addDecisions(env, ds);
  const stall = (time: Date, reason = "stall stuck-prompt: waits on a prompt") => ({
    time: time.toISOString(),
    project: "p",
    step: "L1",
    kind: "stall",
    event: "stall",
    reason,
  });

  test("a quiet night of 9 hours sends nothing", async () => {
    const { home, env } = setup(false);
    log(env, [{ time: night.toISOString(), project: "p", step: "L1", kind: "start", reason: "started" }]);
    const send = async () => assert.fail("sent");
    for (let h = 0; h < 9; h++) expect(await nightWatch(new Date(night.getTime() + h * 3_600_000), env, send)).toBeUndefined();
    rmSync(home, { recursive: true, force: true });
  });

  test("a stall at 02:10 sends one message that holds its line, once", async () => {
    const { home, env } = setup(false);
    const at = new Date(2026, 0, 2, 2, 10);
    log(env, [stall(at)]);
    const sent: string[] = [];
    const send = async (t: string) => (sent.push(t), undefined);
    expect(await nightWatch(new Date(at.getTime() + 30_000), env, send)).toContain("sent");
    expect(await nightWatch(new Date(at.getTime() + 60_000), env, send)).toBeUndefined();
    expect(await nightWatch(new Date(at.getTime() + 3 * 3_600_000), env, send)).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("p L1: stall stuck-prompt: waits on a prompt");
    rmSync(home, { recursive: true, force: true });
  });

  test("a skip that waits for the owner is sent, one that does not is not", async () => {
    const { home, env } = setup(false);
    const at = new Date(2026, 0, 2, 1);
    const skip = (reason: string) => ({ time: at.toISOString(), project: "p", step: "L1", kind: "skip", reason });
    log(env, [skip("L1 waits for your answer"), skip("slots are full")]);
    const sent: string[] = [];
    await nightWatch(new Date(at.getTime() + 1000), env, async (t) => (sent.push(t), undefined));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("waits for your answer");
    expect(sent[0]).not.toContain("slots are full");
    rmSync(home, { recursive: true, force: true });
  });

  test("a failed send is tried again after a while, not at the next tick", async () => {
    const { home, env } = setup(false);
    log(env, [stall(night)]);
    expect(await nightWatch(new Date(night.getTime() + 1000), env, async () => "away")).toContain("away");
    expect(await nightWatch(new Date(night.getTime() + 30_000), env, async () => undefined)).toBeUndefined();
    expect(await nightWatch(new Date(night.getTime() + 16 * 60_000), env, async () => undefined)).toContain("sent");
    rmSync(home, { recursive: true, force: true });
  });

  test("a paused project is left out, and by day nothing is sent", async () => {
    const { home, env } = setup(true);
    log(env, [stall(night)]);
    expect(await nightWatch(new Date(night.getTime() + 1000), env, async () => undefined)).toBeUndefined();
    rmSync(home, { recursive: true, force: true });
    const day = setup(false);
    const noon = new Date(2026, 0, 1, 12);
    log(day.env, [stall(noon)]);
    expect(await nightWatch(new Date(noon.getTime() + 1000), day.env, async () => undefined)).toBeUndefined();
    rmSync(day.home, { recursive: true, force: true });
  });
});
