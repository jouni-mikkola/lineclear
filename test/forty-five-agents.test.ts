import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tick } from "../src/rules.ts";
import { demoEnv, fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();

const step = (n: number) => `### S${n} Step S${n}
- why: because
- done when:
  - it works
- locks: lock-${n}
- after: none
`;

/** A project of `n` ready steps on disjoint locks, with two other machines of the given slots, `mid` and `big`. */
function project(name: string, n: number, slots: Record<string, number>) {
  const dir = scratchDir(name);
  const env = demoEnv(dir);
  const settings = join(dir, "config", "projects", "demo", "settings.json");
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, "utf8")), machines: ["mid", "big"] }));
  const roadmap = `# Roadmap\n\n## Next in order\n\n${Array.from({ length: n }, (_, i) => step(i + 1)).join("\n")}`;
  const f = fakeWorld(env, [], roadmap, []);
  const there = (host: string) => f.remote[host] ?? [];
  f.world.room = (host) => ({ host, tasks: there(host), working: there(host).length, max: slots[host], load: 0, loadLimit: 1e6 });
  const claims: string[] = [];
  f.world.claimSteps = (_repo, steps) => steps.map((s) => (claims.push(s), undefined));
  const titles = () => [...f.tasks.list, ...there("mid"), ...there("big")].map((t) => t.title);
  return { env, f, there, claims, titles };
}

test("45 ready steps on disjoint locks start within 5 simulated minutes on machines of 10, 12 and 25 slots, never over a machine's slots", () => {
  const { env, f, there, titles } = project("forty-five", 45, { mid: 12, big: 25 });
  f.world.maxTasks = () => 10;
  const start = f.clock.at.getTime();
  let elapsed = 0;
  while (titles().length < 45 && elapsed < 5 * 60_000) {
    tick(f.world, false, env);
    expect(f.tasks.list.length).toBeLessThanOrEqual(10);
    expect(there("mid").length).toBeLessThanOrEqual(12);
    expect(there("big").length).toBeLessThanOrEqual(25);
    f.clock.at = new Date(start + (elapsed += 30_000));
  }
  expect(titles()).toHaveLength(45);
  expect(elapsed).toBeLessThanOrEqual(5 * 60_000);
});

test("40 free steps and 40 free slots on 3 machines start in one tick, each once, with one claim each", () => {
  const { env, f, there, claims, titles } = project("forty", 40, { mid: 13, big: 13 });
  f.world.maxTasks = () => 14;
  const d = tick(f.world, false, env);
  expect(d.filter((x) => x.kind === "start")).toHaveLength(40);
  expect(new Set(titles()).size).toBe(40);
  expect(titles()).toHaveLength(40);
  expect([f.tasks.list.length, there("mid").length, there("big").length]).toEqual([14, 13, 13]);
  expect(new Set(claims).size).toBe(40);
  expect(claims).toHaveLength(40);
});

test("a load above this machine's limit keeps starts off this machine only", () => {
  const { env, f, there } = project("overloaded", 30, { mid: 5, big: 5 });
  f.world.maxTasks = () => 10;
  f.world.load = () => 2e6;
  tick(f.world, false, env);
  expect(f.tasks.list).toHaveLength(0);
  expect([there("mid").length, there("big").length]).toEqual([5, 5]);
});

test("a task that cannot be added gives its claim back at once, and the other starts go on", () => {
  const { env, f, there } = project("add-fails", 4, { mid: 0, big: 0 });
  f.world.maxTasks = () => 4;
  const added = f.world.addTasks;
  f.world.addTasks = (s, jobs, p) => added(s, jobs, p).map((err, i) => (jobs[i]?.title.startsWith("S2 ") ? "server said no" : err));
  const released: string[] = [];
  f.world.releaseStep = (_repo, s) => void released.push(s);
  const d = tick(f.world, false, env);
  expect(released).toEqual(["S2"]);
  expect(d.find((x) => x.step === "S2")?.reason).toContain("task add failed: server said no");
  expect(d.filter((x) => x.kind === "start").map((x) => x.step)).toEqual(["S1", "S3", "S4"]);
  expect(there("mid")).toHaveLength(0);
});
