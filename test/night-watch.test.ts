import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checklist, inNight, nightWatch } from "../src/night-watch.ts";

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

  test("sends the checklist once per interval, only for running projects", async () => {
    const { home, env } = setup(false);
    const sent: string[] = [];
    const send = async (t: string) => (sent.push(t), undefined);
    expect(await nightWatch(night, env, send)).toContain("sent");
    expect(await nightWatch(new Date(night.getTime() + 60_000), env, send)).toBeUndefined();
    expect(sent).toEqual([checklist(["p"])]);
    rmSync(home, { recursive: true, force: true });
  });

  test("a failed send is tried again after a while, not at the next tick", async () => {
    const { home, env } = setup(false);
    expect(await nightWatch(night, env, async () => "away")).toContain("away");
    expect(await nightWatch(new Date(night.getTime() + 30_000), env, async () => undefined)).toBeUndefined();
    expect(await nightWatch(new Date(night.getTime() + 16 * 60_000), env, async () => undefined)).toContain("sent");
    rmSync(home, { recursive: true, force: true });
  });

  test("a paused project is left out, and by day nothing is sent", async () => {
    const { home, env } = setup(true);
    expect(await nightWatch(night, env, async () => undefined)).toBeUndefined();
    rmSync(home, { recursive: true, force: true });
    const day = setup(false);
    expect(await nightWatch(new Date(2026, 0, 1, 12), day.env, async () => undefined)).toBeUndefined();
    rmSync(day.home, { recursive: true, force: true });
  });
});
