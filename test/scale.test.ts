import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realWorld, tick, TICK_MS, type World } from "../src/rules.ts";
import { webApi } from "../src/web.ts";
import { loadFactor } from "../scripts/check-speed.ts";
import { sh, tmp } from "./helpers.ts";

// L116: with 10 projects and 1000 tasks, the rule loop's tick stays under a tenth of its interval, and /api/home answers
// its first read in 2 s, its read again a second later (nothing changed) in half of one, and in between at once.
const PROJECTS = 10;
const TASKS = 100; // per project
const TICK_LIMIT = TICK_MS / 10;
const HOME_FIRST = 2000; // cold: git reads each repo once
const HOME_REREAD = 500;
const HOME_AGAIN = 100;
// a busy machine slows the git reads of a cold read by what it is busy: the limits grow with it, as the check's own do
const busy = loadFactor();

const root = tmp("scale");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const step = (p: number, i: number) =>
  `### P${p}S${i} Step ${i}\n- why: w\n- done when:\n  - d\n- locks: l${i % 7}\n- after: ${i === 0 ? "none" : `P${p}S${i - 1}`}\n`;
const roadmapOf = (p: number) => `# Roadmap\n\n## Phase 0: P\n\n${Array.from({ length: TASKS }, (_, i) => step(p, i)).join("\n")}`;
// the first 60 steps of each project are merged, 3 run, the rest wait for them
const statusOf = (i: number) => (i < 60 ? "done" : i < 63 ? "work" : "queued");

const config = join(root, "config");
const data = join(root, "data");
const bin = join(root, "bin");
mkdirSync(join(data, "chatlog"), { recursive: true });
mkdirSync(bin, { recursive: true });
const spaces: object[] = [];
const tasks: object[] = [];
const lists: Record<string, object[]> = {};
const commits: Record<string, { subject: string; body: string }[]> = {};
const t0 = Date.parse("2026-06-01T10:00:00Z");
for (let p = 0; p < PROJECTS; p++) {
  const name = `proj${p}`;
  const repo = join(root, name);
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "ROADMAP.md"), roadmapOf(p));
  sh(["git", "-c", "maintenance.auto=false", "init", "-q", "-b", "main"], { cwd: repo });
  sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "maintenance.auto=false", "-c", "gc.auto=0", "commit", "-qm", "start", "--allow-empty"], {
    cwd: repo,
  });
  mkdirSync(join(config, "projects", name), { recursive: true });
  const models = { worker: ["anthropic/claude-sonnet-5-5"], reviewer: ["anthropic/claude-opus-5-5"], planner: ["anthropic/claude-opus-5-5"] };
  writeFileSync(join(config, "projects", name, "settings.json"), JSON.stringify({ repo, space: name, check: "true", models }));
  const key = `K${p}`;
  spaces.push({ name, path: repo, key, base: "main" });
  lists[name] = [];
  commits[repo] = [{ subject: "start", body: "" }];
  for (let i = 0; i < TASKS; i++) {
    const id = `${key}-${i + 1}`;
    const s = statusOf(i);
    const done = s === "done" ? { merged: true, reportedAt: t0 - (TASKS - i) * 60_000, doneAt: t0 - (TASKS - i) * 50_000 } : {};
    tasks.push({
      id,
      project: `p:m:${name}`,
      title: `P${p}S${i} Step ${i}`,
      created: t0 - (TASKS - i) * 70_000,
      updated: t0,
      worktree: `/w/${id}`,
      told: "work",
      ...done,
    });
    if (s !== "done") lists[name]?.push({ id, title: `P${p}S${i} Step ${i}`, status: s });
    if (s === "done") commits[repo]?.push({ subject: `${id}: P${p}S${i} Step ${i}`, body: "" });
    writeFileSync(
      join(data, "chatlog", `${id}_Agent.json`),
      JSON.stringify({ posted: [{ at: t0 - i * 1000, id: `m${i}`, text: `working on ${i}` }], answers: {} }),
    );
  }
}
writeFileSync(join(data, "spaces.json"), JSON.stringify(spaces));
writeFileSync(join(data, "tasks.json"), JSON.stringify({ next: {}, tasks }));
mkdirSync(config, { recursive: true });
writeFileSync(join(config, "machine.json"), JSON.stringify({ loadLimit: 1e6 }));
// `shepherdr task list --space <name> --json` answers from a file, as fast as the server's own list
for (const [name, list] of Object.entries(lists)) writeFileSync(join(bin, `${name}.json`), JSON.stringify(list));
writeFileSync(join(bin, "all.json"), JSON.stringify(Object.values(lists).flat()));
writeFileSync(
  join(bin, "lineclear"),
  `#!/bin/sh\nif [ "$3" = --json ]; then cat "${bin}/all.json"; elif [ "$2" = list ]; then cat "${bin}/$4.json"; else echo '[]'; fi\n`,
);
chmodSync(join(bin, "lineclear"), 0o755);
// no real playwright-cli: it would list this machine's browsers and spawn node in the middle of a timed read
writeFileSync(join(bin, "playwright-cli"), "#!/bin/sh\necho '[]'\n");
chmodSync(join(bin, "playwright-cli"), 0o755);
const env = {
  ...process.env,
  LINECLEAR_CONFIG: config,
  LINECLEAR_HOME: data,
  LINECLEAR_SHEPHERDR_DIR: data,
  LINECLEAR_STORE_COPIES: join(root, "copies"), // the tick copies the store: not the real one, shared with other runs
  LINECLEAR_PLAYWRIGHT_CLI: join(bin, "playwright-cli"),
  SHEPHERDR_BIN: join(bin, "lineclear"),
  PI_CODING_AGENT_DIR: join(root, "pi"),
  LINECLEAR_NO_DOCTOR: "1",
};

test("10 projects and 1000 tasks: a tick stays under a tenth of its interval", () => {
  const world: World = {
    ...realWorld(env),
    now: () => new Date(t0),
    fetch: () => {},
    proveStep: () => "no checker in this test",
    roadmap: (repo) => roadmapOf(Number(repo.match(/proj(\d+)$/)?.[1])),
    main: (repo) => ({ head: "abc", checkedOut: "abc", commits: commits[repo] ?? [] }),
    tasks: (space) => lists[space] as never,
    maxTasks: () => 3,
    offered: () => undefined,
    load: () => 0,
    health: () => ({ ok: true, output: "" }),
    stopTask: () => undefined,
    tellTask: () => undefined,
    closeTask: () => undefined,
    addTask: () => undefined,
    branchOf: () => undefined,
    stallCards: () => [],
    reviewerSetting: () => "opencode-go/glm-5.3",
    chatCards: () => [],
    started: () => ({ kind: "busy" }),
    lastError: () => undefined,
    ownerWrote: () => false,
    nudge: () => undefined,
  };
  tick(world, false, env); // the first tick writes the state files
  const took: number[] = [];
  for (let i = 0; i < 3; i++) {
    const at = performance.now();
    const decisions = tick(world, false, env);
    took.push(performance.now() - at);
    expect(decisions.filter((d) => d.kind === "start")).toEqual([]); // each project runs its 3 already
  }
  console.log(`tick with ${PROJECTS} projects and ${PROJECTS * TASKS} tasks: ${took.map((t) => Math.round(t)).join(", ")} ms`);
  expect(Math.min(...took)).toBeLessThan(TICK_LIMIT);
}, 60_000);

test("10 projects and 1000 tasks: /api/home answers its first read in 2 s, every next one in half a second", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    // the slow reads aside (doctor, spend) answer nothing: Home never waits for them
    const handle = webApi(
      env,
      () => Date.now(),
      () => new Promise(() => {}),
    );
    let at = performance.now();
    const r = await handle(new Request("http://127.0.0.1:7420/api/home"));
    const first = performance.now() - at;
    expect(r.status).toBe(200);
    const home = (await r.json()) as { projects: { name: string; tasks: unknown[] }[] };
    expect(home.projects).toHaveLength(PROJECTS);
    // projects are read again at most once a second: the next read after one reads them again
    await Bun.sleep(1100);
    at = performance.now();
    await handle(new Request("http://127.0.0.1:7420/api/home"));
    const reread = performance.now() - at;
    at = performance.now();
    await handle(new Request("http://127.0.0.1:7420/api/home"));
    const again = performance.now() - at;
    console.log(
      `/api/home with ${PROJECTS} projects and ${PROJECTS * TASKS} tasks: first ${Math.round(first)} ms, read again ${Math.round(reread)} ms, kept ${Math.round(again)} ms`,
    );
    expect(first).toBeLessThan(HOME_FIRST * busy);
    expect(reread).toBeLessThan(HOME_REREAD * busy);
    expect(again).toBeLessThan(HOME_AGAIN * busy);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}, 60_000);
