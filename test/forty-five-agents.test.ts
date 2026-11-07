import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tick } from "../src/rules.ts";
import type { Task } from "../src/roadmap.ts";
import { demoEnv, fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();

const step = (n: number) => `### S${n} Step S${n}
- why: because
- done when:
  - it works
- locks: lock-${n}
- after: none
`;

test("45 ready steps on disjoint locks start within 5 simulated minutes on machines of 10, 12 and 25 slots, never over a machine's slots", () => {
  const dir = scratchDir("forty-five");
  const env = demoEnv(dir);
  const settings = join(dir, "config", "projects", "demo", "settings.json");
  writeFileSync(settings, JSON.stringify({ ...JSON.parse(readFileSync(settings, "utf8")), machines: ["mid", "big"] }));
  const roadmap = `# Roadmap\n\n## Next in order\n\n${Array.from({ length: 45 }, (_, i) => step(i + 1)).join("\n")}`;
  const f = fakeWorld(env, [], roadmap, []);
  const slots: Record<string, number> = { mid: 12, big: 25 };
  const mid: Task[] = [];
  const big: Task[] = [];
  const remote: Record<string, Task[] | undefined> = { mid, big };
  f.world.maxTasks = () => 10;
  f.world.room = (host) => ({ host, tasks: remote[host] ?? [], working: remote[host]?.length ?? 0, max: slots[host], load: 0, loadLimit: 1e6 });
  f.world.addTaskOn = (host, _s, title) => {
    remote[host]?.push({ id: `T${host}${remote[host].length}@${host}`, title, status: "work" });
    return undefined;
  };
  const started = () => f.tasks.list.length + mid.length + big.length;
  const start = f.clock.at.getTime();
  let elapsed = 0;
  while (started() < 45 && elapsed < 5 * 60_000) {
    tick(f.world, false, env);
    expect(f.tasks.list.length).toBeLessThanOrEqual(10);
    expect(mid.length).toBeLessThanOrEqual(12);
    expect(big.length).toBeLessThanOrEqual(25);
    f.clock.at = new Date(start + (elapsed += 30_000));
  }
  expect(started()).toBe(45);
  expect(elapsed).toBeLessThanOrEqual(5 * 60_000);
});
