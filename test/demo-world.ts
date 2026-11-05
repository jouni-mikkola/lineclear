import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realWorld, type World } from "../src/rules.ts";

/** A roadmap of one step. */
const ROADMAP = "# Roadmap\n\n## Phase 0\n\n### A Alpha\n- why: because\n- done when:\n  - it works\n- locks: none\n- after: none\n";

/** Writes the config of project `demo` (settings and machine load) under `dir` and returns the config folder. */
export function demoConfig(dir: string, o: { worker?: string[]; reviewer?: string[]; loadPerCore: number }): string {
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  const planner = ["anthropic/claude-opus-5-5"];
  const models = { worker: o.worker ?? ["anthropic/claude-sonnet-5-5"], reviewer: o.reviewer ?? planner, planner };
  writeFileSync(join(config, "projects", "demo", "settings.json"), JSON.stringify({ repo: dir, space: "demo", check: "true", models }));
  writeFileSync(join(config, "machine.json"), JSON.stringify({ loadPerCore: o.loadPerCore }));
  return config;
}

/** The real world with nothing happening: a fixed clock, one idle roadmap, no cards and no stalls. Each test overrides what it watches. */
export function idleWorld(env: NodeJS.ProcessEnv, over: Partial<World> = {}): World {
  return {
    ...realWorld(env),
    now: () => new Date("2026-06-01T10:00:00Z"),
    fetch: () => {},
    roadmap: () => ROADMAP,
    main: () => ({ head: "abc", checkedOut: "abc", commits: [{ subject: "start", body: "" }] }),
    tasks: () => [],
    maxTasks: () => 3,
    offered: () => undefined,
    load: () => 0,
    stallCards: () => [],
    chatCards: () => [],
    started: () => ({ kind: "busy" }),
    lastError: () => undefined,
    ownerWrote: () => false,
    reviewerSetting: () => undefined, // the real one starts a Shepherdr command, seconds on a busy machine
    clean: () => false,
    ...over,
  };
}
