import { afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realWorld, type World } from "../src/rules.ts";
import { tmp } from "./helpers.ts";

/** A maker of scratch folders that are removed after the file's tests. */
export function scratch(): (prefix: string) => string {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  return (prefix) => {
    const d = tmp(prefix);
    dirs.push(d);
    return d;
  };
}

/** A project `demo` in a scratch folder with room for tasks: returns the environment a tick of it needs. */
export function demoEnv(dir: string): NodeJS.ProcessEnv {
  const at = (...p: string[]) => join(dir, ...p);
  mkdirSync(at("config", "projects", "demo"), { recursive: true });
  mkdirSync(at("tmp"));
  const models = { worker: ["anthropic/claude-sonnet-5-5"], reviewer: ["anthropic/claude-opus-5-5"] };
  writeFileSync(at("config", "projects", "demo", "settings.json"), JSON.stringify({ repo: dir, space: "demo", check: "true", models }));
  writeFileSync(at("config", "machine.json"), JSON.stringify({ loadLimit: 1e6 }));
  return {
    ...process.env,
    LINECLEAR_CONFIG: at("config"),
    TMPDIR: at("tmp"),
    LINECLEAR_HOME: at("home"),
    LINECLEAR_STORE_COPIES: at("copies"),
    XDG_CACHE_HOME: at("cache"),
    PI_CODING_AGENT_DIR: at("pi"),
  };
}

type T = { id: string; title: string; status: string; sub?: string };

/** A rule loop's world with a fake clock, task list and agents: what it does lands in `log` and `adds`. */
export function fakeWorld(env: Record<string, string | undefined>, list: T[], roadmap: string, commits: { subject: string; body: string }[] = []) {
  const clock = { at: new Date("2026-06-01T10:00:00Z") };
  const log: string[] = [];
  const adds: string[][] = [];
  const cards: { id: string; task: string; at: number }[] = [];
  const tasks = { list };
  /** The tasks started on each other machine. */
  const remote: Record<string, T[]> = {};
  const did = (line: string) => {
    log.push(line);
    return undefined;
  };
  const world: World = {
    ...realWorld(env),
    now: () => clock.at,
    fetch: () => {},
    roadmap: () => roadmap,
    main: () => ({ head: "abc", commits: [{ subject: "start", body: "" }, ...commits] }),
    tasks: () => tasks.list,
    maxTasks: () => 3,
    offered: () => undefined,
    load: () => 0,
    stopTask: (id) => did(`stop ${id}`),
    tellTask: (id, text) => did(`tell ${id} ${text.slice(0, 60)}`),
    closeTask: (id) => did(`close ${id}`),
    branchOf: (_, id) => `work/5-${id}`,
    stallCards: () => cards,
    reviewerSetting: () => "opencode-go/glm-5.3",
    chatCards: () => [],
    started: () => ({ kind: "acted" }),
    lastError: () => undefined,
    ownerWrote: () => false,
    nudge: (id) => did(`nudge ${id}`),
    addTasks: (_s, jobs) =>
      jobs.map(({ host, title, brief, extra }) => {
        if (host !== undefined) {
          const there = (remote[host] ??= []);
          there.push({ id: `T${host}${there.length}@${host}`, title, status: "work" });
          return undefined;
        }
        adds.push([title, brief, ...extra]);
        tasks.list = [...tasks.list, { id: `LIN-${100 + adds.length}`, title, status: "work" }];
        return undefined;
      }),
  };
  return { world, clock, log, adds, cards, tasks, remote };
}
