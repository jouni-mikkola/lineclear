import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { herdrWorld } from "../src/herdr-world.ts";
import { type HerdrFacts, herdrHealth, herdrLines } from "../src/herdr-health.ts";
import { readSettings, type Settings } from "../src/project.ts";
import { demoConfig, idleWorld } from "./demo-world.ts";
import { tmp } from "./helpers.ts";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A fake herdr: its facts are set per tick, and every restart and close it is asked for is logged. */
function setup(tasks: { id: string; title: string; status: string }[] = [], archivedTasks: typeof tasks = []) {
  const dir = tmp("herdr-health");
  dirs.push(dir);
  const config = demoConfig(dir, { loadPerCore: 1e6 });
  const world0 = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_HOME: join(dir, "home"), LINECLEAR_STORE_COPIES: join(dir, "copies") };
  const clock = { at: new Date("2026-06-01T10:00:00Z") };
  const facts: HerdrFacts = {
    servers: [{ pid: 7, cpuSeconds: 0, inService: true }],
    unit: "herdr.service",
    service: { state: "active", restarts: 0 },
    workspaces: [],
  };
  const log: string[] = [];
  const world = idleWorld(world0, {
    now: () => clock.at,
    tasks: (_space: string, archived?: boolean) => (archived ? archivedTasks : tasks),
    herdr: () => facts,
    restartHerdr: () => (log.push("restart"), undefined),
    closeWorkspace: (id) => (log.push(`close ${id}`), undefined),
  });
  const settings = readSettings("demo", world0) as Settings;
  const next = () => {
    clock.at = new Date(clock.at.getTime() + 30_000);
    return herdrHealth(world, [{ name: "demo", settings }], false, world0);
  };
  return { dir, world0, facts, log, next };
}

test("a herdr above the CPU limit for several ticks is restarted under the service, once, with one decision line", () => {
  const s = setup();
  const spin = () => (s.facts.servers[0]!.cpuSeconds += 30);
  s.next(); // the first look has nothing to compare with
  for (let i = 0; i < 5; i++) {
    spin();
    expect(s.next()).toEqual([]);
  }
  spin();
  const lines = s.next();
  expect(lines).toHaveLength(1);
  expect(lines[0]?.reason).toMatch(/restarted herdr under herdr\.service: herdr server 7 used over 90 % of a core for 6 ticks/);
  expect(s.log).toEqual(["restart"]);
});

test("a busy herdr that rests between ticks is left alone", () => {
  const s = setup();
  for (let i = 0; i < 12; i++) {
    s.facts.servers[0]!.cpuSeconds += i % 3 === 0 ? 0 : 30;
    s.next();
  }
  expect(s.log).toEqual([]);
});

test("a herdr outside its service is restarted under it", () => {
  const s = setup();
  s.facts.servers = [{ pid: 9, cpuSeconds: 1, inService: false }];
  const lines = s.next();
  expect(lines.map((d) => d.reason)).toEqual(["restarted herdr under herdr.service: herdr server 9 runs outside herdr.service"]);
  expect(s.log).toEqual(["restart"]);
});

test("a herdr that holds too much memory is restarted under the service", () => {
  const s = setup();
  s.facts.servers = [{ pid: 7, cpuSeconds: 1, inService: true, rssMb: 4000 }];
  expect(s.next()).toEqual([]);
  expect(s.next()).toEqual([]);
  expect(s.next().map((d) => d.reason)).toEqual(["restarted herdr under herdr.service: herdr server 7 holds 4000 MB of memory"]);
  expect(s.log).toEqual(["restart"]);
});

test("the workspace of a closed or done task is closed, an open task's and another repo's are not", () => {
  const s = setup([
    { id: "LIN-5", title: "A", status: "closed" },
    { id: "LIN-6", title: "B", status: "done" },
    { id: "LIN-7", title: "C", status: "work" },
  ]);
  const at = (id: string, n: number, repo = s.dir) => ({ id, repo, checkout: `/wt/work-${n}-x` });
  s.facts.workspaces = [at("w1", 5), at("w2", 6), at("w3", 7), at("w4", 5, "/other"), { id: "w5" }];
  const lines = s.next();
  expect(lines.map((d) => d.kind)).toEqual(["close", "close"]);
  expect(s.log).toEqual(["close w1", "close w2"]);
});

test("a test instance or a cold start in its own home gets no way to restart or close anything of herdr", () => {
  const run = () => ({ code: 0, out: "", err: "" });
  expect(herdrWorld(run, { LINECLEAR_CONFIG: "/tmp/x" }, () => [])).toEqual({});
  expect(herdrWorld(run, { HOME: "/tmp/fresh-home" }, () => [])).toEqual({});
});

test("a failing service is named for Home with its failure count", () => {
  const s = setup();
  s.facts.service = { state: "activating", restarts: 15 };
  s.next();
  expect(herdrLines(s.world0)).toEqual(["herdr.service is activating, failed 15 times"]);
  s.facts.service = { state: "active", restarts: 15 };
  s.next();
  expect(herdrLines(s.world0)).toEqual([]);
});

test("the workspace of an archived done task is closed too", () => {
  const s = setup([], [{ id: "LIN-8", title: "D", status: "done" }]);
  s.facts.workspaces = [{ id: "w9", repo: s.dir, checkout: "/wt/work-8-x" }];
  s.next();
  expect(s.log).toEqual(["close w9"]);
});

// the test runner may itself sit in herdr.service: only a unit it is not in makes the spawned servers outside the service
const OTHER_UNITS = ["nothing.service"];

function spawnIdle(dir: string) {
  mkdirSync(join(dir, "bin"), { recursive: true });
  symlinkSync(process.execPath, join(dir, "bin", "herdr")); // `herdr server` is then bun running ./server, which idles
  writeFileSync(join(dir, "server"), "setInterval(() => {}, 1000);\n");
  return Bun.spawn([join(dir, "bin", "herdr"), "server"], { cwd: dir, stdout: "ignore", stderr: "ignore" });
}

// only the installer's unit is loaded, so a spawned process, which may itself sit in herdr.service, is outside it
const fakeRun = (calls: string[]) => (cmd: string[]) => {
  calls.push(cmd.join(" "));
  return { code: 0, out: cmd.includes("show") && cmd.includes("lineclear-herdr.service") ? "LoadState=loaded" : "", err: "" };
};

/** Records every signal sent while a herdr test runs; the test fails when one went to a pid it did not spawn. */
function guardKills(spawned: number[]) {
  const kills: number[] = [];
  const realKill = process.kill;
  process.kill = ((pid: number, sig?: string | number) => (kills.push(pid), realKill(pid, sig))) as typeof process.kill;
  return {
    realKill,
    done() {
      process.kill = realKill;
      expect(kills.filter((p) => !spawned.includes(p))).toEqual([]);
      return kills;
    },
  };
}

test("on the real install a herdr server outside the service is found in /proc, stopped, and the service restarted", async () => {
  const dir = tmp("herdr-real");
  dirs.push(dir);
  const proc = spawnIdle(dir);
  const guard = guardKills([proc.pid]);
  try {
    const calls: string[] = [];
    const world = herdrWorld(fakeRun(calls), { HOME: userInfo().homedir }, () => [proc.pid], OTHER_UNITS);
    const seen = world.herdr?.()?.servers.find((s) => s.pid === proc.pid);
    expect(seen?.inService).toBe(false);
    expect(world.restartHerdr?.()).toBeUndefined();
    expect(await proc.exited).not.toBe(0); // SIGTERM
    expect(calls.at(-1)).toBe("systemctl --user restart lineclear-herdr.service");
    expect(guard.done()).toEqual([proc.pid]);
  } finally {
    process.kill = guard.realKill;
    proc.kill();
  }
});

test("a herdr server left off the list of pids to stop is still running after the restart", async () => {
  const dir = tmp("herdr-real-other");
  dirs.push(dir);
  const listed = spawnIdle(join(dir, "a"));
  const unlisted = spawnIdle(join(dir, "b"));
  const guard = guardKills([listed.pid, unlisted.pid]);
  try {
    const world = herdrWorld(fakeRun([]), { HOME: userInfo().homedir }, () => [listed.pid], OTHER_UNITS);
    expect(world.restartHerdr?.()).toBeUndefined();
    await listed.exited;
    expect(unlisted.exitCode).toBeNull();
    expect(() => guard.realKill(unlisted.pid, 0)).not.toThrow();
    expect(guard.done()).toEqual([listed.pid]);
  } finally {
    process.kill = guard.realKill;
    listed.kill();
    unlisted.kill();
  }
});
