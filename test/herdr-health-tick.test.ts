import { afterAll, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { decisionsPath } from "../pi/config.ts";
import { tick } from "../src/rules.ts";
import { demoConfig, idleWorld } from "./demo-world.ts";
import { tmp } from "./helpers.ts";

const dir = tmp("herdr-health-tick");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a tick runs the herdr rule and logs its line in the decision log", () => {
  const where = {
    ...process.env,
    LINECLEAR_CONFIG: demoConfig(dir, { loadPerCore: 1e6 }),
    LINECLEAR_HOME: join(dir, "home"),
    LINECLEAR_STORE_COPIES: join(dir, "copies"),
  };
  const restarts: string[] = [];
  const world = idleWorld(where, {
    herdr: () => ({ servers: [{ pid: 9, cpuSeconds: 1, inService: false }], unit: "herdr.service", service: { state: "active", restarts: 0 }, workspaces: [] }),
    restartHerdr: () => (restarts.push("restart"), undefined),
  });
  tick(world, false, where);
  expect(readFileSync(decisionsPath(where), "utf8")).toContain("restarted herdr under herdr.service");
  expect(restarts).toEqual(["restart"]);
}, 30_000);
