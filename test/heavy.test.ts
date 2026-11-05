import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { inSlot } from "../pi/extension.ts";
import { limitOf, lineOf, machineOf, readWaits, slotCost, checkLines } from "../src/waits.ts";
import { status } from "../src/status.ts";
import { chooseModels, ownEnv, runCli, sh, tmp, until } from "./helpers.ts";

const bin = join(import.meta.dir, "..", "bin", "lineclear");
let root: string;
let repo: string;
let env: Record<string, string | undefined>;

const git = (cwd: string, ...a: string[]) => sh(["git", "-c", "user.email=a@b.c", "-c", "user.name=t", ...a], { cwd });
const settingsFile = () => join(root, "config", "projects", "demo", "settings.json");
const settings = () => JSON.parse(readFileSync(settingsFile(), "utf8"));

beforeEach(() => {
  root = tmp("heavy");
  repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "x");
  const fake = join(root, "shepherdr");
  writeFileSync(fake, `#!/bin/sh\nprintf 'demo  DEM  ${repo}  github:x/y\\n'\n`);
  chmodSync(fake, 0o755);
  env = ownEnv(root, { LINECLEAR_CONFIG: join(root, "config"), HOME: root, SHEPHERDR_BIN: fake, LINECLEAR_BIN: bin });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function add(extra: string[] = []) {
  chooseModels(join(root, "config"));
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const code = await main(["project", "add", repo, "--name", "demo", "--worker", "a", "--reviewer", "b", "--planner", "c", ...extra], () => {}, null);
    // a busy machine must not hold these runs back: the load limit is not what they test
    writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ loadPerCore: 1e6 }));
    return code;
  } finally {
    for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("project add lists the check command and the scripts that test, build or lint the whole project as heavy", async () => {
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({
      scripts: {
        check: "x",
        test: "x",
        "ui:test": "x",
        "ui:record": "x",
        build: "x",
        "test:e2e": "x",
        "web:build": "bunx --bun vite build",
        tarkistus: "eslint . && svelte-check",
        format: "prettier --write .",
        types: "tsc --noEmit",
        "test:watch": "vitest",
        "web:dev": "vite",
        "test:one": "bun test test/a.test.ts",
        browse: "playwright-cli open http://localhost:5173",
        "e2e:ui": "playwright test --ui",
      },
    }),
  );
  writeFileSync(join(repo, "bun.lock"), "");
  expect(await add()).toBe(0);
  expect(settings().heavy).toEqual([
    "bun run check",
    "bun run test",
    "bun run ui:test",
    "bun run ui:record",
    "bun run build",
    "bun run test:e2e",
    "bun run web:build",
    "bun run tarkistus",
  ]);
});

test("a project with no heavy list (added before it existed) gets the one detected now", async () => {
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ scripts: { verify: "node scripts/verify.mjs", lint: "node scripts/lint.mjs", doctor: "node x.mjs" } }),
  );
  expect(await add(["--check", "npm run verify"])).toBe(0);
  const s = settings();
  delete s.heavy;
  writeFileSync(settingsFile(), JSON.stringify(s));
  expect(inSlot("npm run lint", repo, env)).toBe(`${bin} slot 'npm run lint'`);
  expect(inSlot("npm run verify", repo, env)).toBe(`${bin} check 'npm run verify'`);
  expect(inSlot("npm run doctor", repo, env)).toBeUndefined();
});

test("a heavy tool run straight takes a slot in any project; one test file stays free", () => {
  mkdirSync(join(root, "suite"));
  const heavy = [
    "npx playwright test",
    "bunx playwright test --project 1440",
    "bunx --bun vite build --config x.ts",
    "eslint .",
    "pnpm exec eslint src",
    "bun test",
    "bun test ./test",
    "cd x && bun test 2>&1 | tail",
    "env -u X bun test ./test",
    "FOO=1 timeout -k 10 300 nice -n 19 bun test",
    "bun x vite build",
    "npx next build",
    "node --test",
    "bun test suite",
    "npx vitest run",
    "jest",
  ];
  for (const c of heavy) expect(inSlot(c, root, env)).toBe(`${bin} slot '${c.replace(/'/g, `'\\''`)}'`);
  const free = [
    "bun test test/heavy.test.ts",
    "bun test --timeout 60000 test/a.test.ts 2>&1 | tail",
    "bun test -t 'one name'",
    "ls",
    "echo playwright",
    "git log --grep eslint",
    "npx eslint src/one.ts",
    "npx vitest run src/a.test.ts",
    "jest a.test.ts",
    "bun test heavy",
    "bun test test/heavy",
    "git commit -m 'x; eslint fix'",
    "node --test test/a.test.js",
    "npx vitest watch",
    "npx jest --watchAll",
    "playwright-cli open http://x",
    "vite build --watch",
  ];
  for (const c of free) expect(inSlot(c, root, env)).toBeUndefined();
});

test("the heavy list can be changed with project set", async () => {
  writeFileSync(join(repo, "Makefile"), "check:\n\ttrue\ntest:\n\ttrue\n");
  expect(await add()).toBe(0);
  expect(settings().heavy).toEqual(["make check", "make test"]);
  expect((await runCli(env, ["project", "set", "demo", "--heavy", "make test", "--heavy", "pnpm e2e"])).code).toBe(0);
  expect(settings().heavy).toEqual(["make test", "pnpm e2e"]);
});

test("the pi extension wraps the check in lineclear check, another heavy command in lineclear slot, and nothing else", async () => {
  expect(await add(["--check", "make check", "--heavy", "bun run test", "--heavy", "make check"])).toBe(0);
  expect(inSlot("bun run test", repo, env)).toBe(`${bin} slot 'bun run test'`);
  // the full check waits in the machine's one line, with the merges
  expect(inSlot("  make check ", repo, env)).toBe(`${bin} check 'make check'`);
  expect(inSlot("make check 2>&1 | tail -5", repo, env)).toBe(`${bin} check 'make check 2>&1 | tail -5'`);
  expect(inSlot("bun run test 2>&1 | tail -20", repo, env)).toBe(`${bin} slot 'bun run test 2>&1 | tail -20'`);
  expect(inSlot("cd x && timeout 60 bun run test", repo, env)).toContain(" slot ");
  expect(inSlot("bun run tests", repo, env)).toBeUndefined();
  expect(inSlot("ls", repo, env)).toBeUndefined();
  expect(inSlot("lineclear check", repo, env)).toBeUndefined();
  expect(inSlot("bun run test", root, env)).toBeUndefined();
});

test("four heavy suites at once with two slots: two run, two wait as checks waits, and all pass", async () => {
  expect(await add(["--check", "true", "--heavy", "true"])).toBe(0);
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ checkSlots: 2, loadPerCore: 1e6 }));
  const log = join(root, "suite.log");
  // each run holds its slot until the test lets it go, so a slow start cannot end one early
  const go = join(root, "go");
  const cmd = `echo start >> ${log}; while [ ! -f ${go} ]; do sleep 0.05; done; echo end >> ${log}`;
  const procs = [1, 2, 3, 4].map((n) =>
    Bun.spawn([bin, "slot", cmd], { cwd: repo, env: { ...env, LINECLEAR_TASK: `LIN-${n}` } as Record<string, string>, stdout: "ignore", stderr: "ignore" }),
  );
  await until(() => !(readWaits(env as NodeJS.ProcessEnv).length < 2 || !existsSync(log) || readFileSync(log, "utf8").trim().split("\n").length < 2), 100);
  expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["start", "start"]);
  expect(readWaits(env as NodeJS.ProcessEnv).map((w) => w.kind)).toEqual(["checks", "checks"]);
  writeFileSync(go, "");
  expect(await Promise.all(procs.map((p) => p.exited))).toEqual([0, 0, 0, 0]);
  let open = 0;
  let peak = 0;
  for (const e of readFileSync(log, "utf8").trim().split("\n")) {
    open += e === "start" ? 1 : -1;
    peak = Math.max(peak, open);
  }
  expect(peak).toBe(2);
  expect(readWaits(env as NodeJS.ProcessEnv)).toHaveLength(0);
});

test("a killed heavy command frees its slot", async () => {
  expect(await add(["--check", "true", "--heavy", "true"])).toBe(0);
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ checkSlots: 1, loadPerCore: 1e6 }));
  const first = Bun.spawn([bin, "slot", "sleep 3137; true"], {
    cwd: repo,
    env: { ...env, LINECLEAR_TASK: "LIN-1" } as Record<string, string>,
    stdout: "ignore",
    stderr: "ignore",
  });
  await until(() => Bun.spawnSync(["pgrep", "-f", "sleep 313[7]"]).exitCode === 0);
  first.kill("SIGTERM");
  await first.exited;
  await until(() => !(Bun.spawnSync(["pgrep", "-f", "sleep 313[7]"]).exitCode === 0), 100);
  expect(Bun.spawnSync(["pgrep", "-af", "sleep 313[7]"]).stdout.toString()).toBe("");
  const second = Bun.spawn([bin, "slot", "true"], {
    cwd: repo,
    env: { ...env, LINECLEAR_TASK: "LIN-2" } as Record<string, string>,
    stdout: "ignore",
    stderr: "ignore",
  });
  expect(await second.exited).toBe(0);
});

test("a group SIGKILL, as pi does on a timeout, takes the suite down with the wrapper", async () => {
  expect(await add(["--check", "true", "--heavy", "true"])).toBe(0);
  const wrapper = Bun.spawn(["setsid", bin, "slot", "sleep 4242; true"], {
    cwd: repo,
    env: { ...env, LINECLEAR_TASK: "LIN-1" } as Record<string, string>,
    stdout: "ignore",
    stderr: "ignore",
  });
  const running = () => Bun.spawnSync(["pgrep", "-f", "^sleep 424[2]$"]).exitCode === 0;
  await until(running);
  process.kill(-wrapper.pid, "SIGKILL");
  await wrapper.exited;
  await until(() => !running());
  expect(Bun.spawnSync(["pgrep", "-f", "^sleep 424[2]$"]).exitCode).toBe(1);
});

test("a browser suite takes two of two slots, so a bun suite cannot start beside it (the load stays down)", async () => {
  expect(await add(["--check", "true", "--heavy", "true"])).toBe(0);
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ checkSlots: 2, loadPerCore: 1e6 }));
  expect(slotCost("bunx playwright test")).toBe(2);
  expect(slotCost("bun run ui:test")).toBe(2);
  expect(slotCost("bun run test")).toBe(1);
  const log = join(root, "cost.log");
  const run = (n: number, cmd: string) =>
    Bun.spawn([bin, "slot", cmd], { cwd: repo, env: { ...env, LINECLEAR_TASK: `LIN-${n}` } as Record<string, string>, stdout: "ignore", stderr: "ignore" });
  const go = join(root, "go");
  const browser = run(1, `echo b-start >> ${log}; while [ ! -f ${go} ]; do sleep 0.05; done; echo b-end >> ${log}; : playwright`);
  await until(() => existsSync(log));
  const plain = run(2, `echo p-start >> ${log}; echo p-end >> ${log}`);
  await until(() => readWaits(env as NodeJS.ProcessEnv).some((w) => w.task === "LIN-2"));
  writeFileSync(go, "");
  expect(await Promise.all([browser.exited, plain.exited])).toEqual([0, 0]);
  // on Shepherdr's one-slot-per-command count the bun suite would have started at once, beside the browser suite
  expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["b-start", "b-end", "p-start", "p-end"]);
});

test("with a command running and the load above the limit, a second one waits even when a slot is free", async () => {
  expect(await add(["--check", "true", "--heavy", "true"])).toBe(0);
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ checkSlots: 2, loadPerCore: 1e-9 }));
  const log = join(root, "load.log");
  const go = join(root, "go");
  const run = (n: number, cmd: string) =>
    Bun.spawn([bin, "slot", cmd], { cwd: repo, env: { ...env, LINECLEAR_TASK: `LIN-${n}` } as Record<string, string>, stdout: "ignore", stderr: "ignore" });
  const first = run(1, `echo a-start >> ${log}; while [ ! -f ${go} ]; do sleep 0.05; done; echo a-end >> ${log}`);
  await until(() => existsSync(log));
  const second = run(2, `echo b-start >> ${log}; echo b-end >> ${log}`);
  await until(() => readWaits(env as NodeJS.ProcessEnv).some((w) => w.task === "LIN-2"));
  writeFileSync(go, "");
  expect(await Promise.all([first.exited, second.exited])).toEqual([0, 0]);
  expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["a-start", "a-end", "b-start", "b-end"]);
});

test("full checks run one at a time even with free slots, in the order they came, each waiting as a checks wait", async () => {
  expect(await add(["--check", "true"])).toBe(0);
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ checkSlots: 4, loadPerCore: 1e6 }));
  const log = join(root, "check.log");
  const run = (n: number) =>
    Bun.spawn([bin, "check", `echo ${n}-start >> ${log}; while [ ! -f ${join(root, `go-${n}`)} ]; do sleep 0.05; done; echo ${n}-end >> ${log}`], {
      cwd: repo,
      env: { ...env, LINECLEAR_TASK: `LIN-${n}` } as Record<string, string>,
      stdout: "ignore",
      stderr: "ignore",
    });
  const reasons = () => Object.fromEntries(readWaits(env as NodeJS.ProcessEnv).map((w) => [w.task, `${w.kind}: ${w.reason}`]));
  const first = run(1);
  await until(() => existsSync(log));
  const second = run(2);
  await until(() => reasons()["LIN-2"] !== undefined);
  const third = run(3);
  await until(() => reasons()["LIN-3"] !== undefined);
  expect(reasons()).toEqual({
    "LIN-2": `checks: waiting for the check slot on ${machineOf(env as NodeJS.ProcessEnv)} (1 ahead, one full check at a time)`,
    "LIN-3": `checks: waiting for the check slot on ${machineOf(env as NodeJS.ProcessEnv)} (2 ahead, one full check at a time)`,
  });
  writeFileSync(join(root, "go-1"), "");
  expect(await first.exited).toBe(0);
  await until(() => readFileSync(log, "utf8").includes("2-start") && reasons()["LIN-3"]?.includes("1 ahead") === true);
  expect(reasons()).toEqual({ "LIN-3": `checks: waiting for the check slot on ${machineOf(env as NodeJS.ProcessEnv)} (1 ahead, one full check at a time)` });
  writeFileSync(join(root, "go-2"), "");
  writeFileSync(join(root, "go-3"), "");
  expect(await Promise.all([second.exited, third.exited])).toEqual([0, 0]);
  expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["1-start", "1-end", "2-start", "2-end", "3-start", "3-end"]);
  expect(readWaits(env as NodeJS.ProcessEnv)).toEqual([]);
});

test("a full check takes a check slot, and no heavy run of its repo starts while it is in line", async () => {
  expect(await add(["--check", "true", "--heavy", "true"])).toBe(0);
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ checkSlots: 1, loadPerCore: 1e6 }));
  const log = join(root, "lock.log");
  const gate = (n: string) => `while [ ! -f ${join(root, `go-${n}`)} ]; do sleep 0.05; done`;
  const spawn = (n: number, how: string, cmd: string) =>
    Bun.spawn([bin, how, cmd], { cwd: repo, env: { ...env, LINECLEAR_TASK: `LIN-${n}` } as Record<string, string>, stdout: "ignore", stderr: "ignore" });
  const reasons = () => Object.fromEntries(readWaits(env as NodeJS.ProcessEnv).map((w) => [w.task, w.reason]));
  const heavy = spawn(1, "slot", `echo h-start >> ${log}; ${gate("h")}; echo h-end >> ${log}`);
  await until(() => existsSync(log));
  const check = spawn(2, "check", `echo c-start >> ${log}; ${gate("c")}; echo c-end >> ${log}`);
  await until(() => reasons()["LIN-2"] !== undefined);
  expect(reasons()["LIN-2"]).toBe(
    `waiting for a check slot on ${machineOf(env as NodeJS.ProcessEnv)} (1 at once, shared by every repo on ${machineOf(env as NodeJS.ProcessEnv)})`,
  );
  const later = spawn(3, "slot", `echo l-start >> ${log}; echo l-end >> ${log}`);
  await until(() => reasons()["LIN-3"] !== undefined);
  expect(reasons()["LIN-3"]).toBe(`waiting for the full check in line on ${machineOf(env as NodeJS.ProcessEnv)} to end (it goes first)`);
  writeFileSync(join(root, "go-h"), "");
  expect(await heavy.exited).toBe(0);
  await until(() => readFileSync(log, "utf8").includes("c-start"));
  writeFileSync(join(root, "go-c"), "");
  expect(await Promise.all([check.exited, later.exited])).toEqual([0, 0]);
  expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["h-start", "h-end", "c-start", "c-end", "l-start", "l-end"]);
  expect(readWaits(env as NodeJS.ProcessEnv)).toEqual([]);
});

test("the load limit is per core: 1 by default, the machine's loadPerCore when it is a positive number, an old fixed limit ignored", () => {
  expect(limitOf(undefined, 8)).toBe(8);
  expect(limitOf({ loadPerCore: 1.5 }, 8)).toBe(12);
  expect(limitOf({ loadPerCore: 0.333 }, 3)).toBe(1);
  for (const bad of [0, -1, "2", Number.NaN, null]) expect(limitOf({ loadPerCore: bad }, 4)).toBe(4);
  expect(limitOf({ loadLimit: 16 }, 4)).toBe(4);
});

test("a head with no progress for 10 minutes, while a lane turn waits, shows in status as stuck, naming the lock it waits on", async () => {
  expect(await add(["--check", "true"])).toBe(0);
  const lock = join(root, "browser.lock");
  const holder = Bun.spawn(["flock", lock, "sleep", "60"], { stdout: "ignore", stderr: "ignore" });
  // the file exists before flock holds it: a waiter started now could win the lock and leave the holder blocked
  await until(() => existsSync("/proc/locks") && readFileSync("/proc/locks", "utf8").includes(` ${holder.pid} `));
  const waiter = Bun.spawn(["flock", lock, "true"], { stdout: "ignore", stderr: "ignore" });
  try {
    const line = join(root, "config", "check-queue", lineOf(repo));
    mkdirSync(line, { recursive: true });
    const turn = { pid: process.pid, who: "LIN-1", since: 1, work: waiter.pid, cpu: 1, moved: Date.now() - 11 * 60_000 };
    // the kernel lists the blocked process a moment after it starts
    await until(() => readFileSync("/proc/locks", "utf8").includes(` ${waiter.pid} `));
    writeFileSync(join(line, "000000000000001-x.json"), JSON.stringify(turn));
    writeFileSync(join(line, "000000000000002-y.json"), JSON.stringify({ pid: process.pid, who: "lane", since: 2, lane: true }));
    const lines: string[] = [];
    status((l) => lines.push(l), env as NodeJS.ProcessEnv, "demo");
    expect(lines.join("\n")).toMatch(
      /demo {2}the check line of \S+ is stuck: LIN-1's check shows no progress for 11 min, it waits for the lock .*browser\.lock held by flock/,
    );
    // Home names it as what stops the project
    expect(checkLines(repo, env as NodeJS.ProcessEnv)).toHaveLength(1);
  } finally {
    waiter.kill();
    holder.kill();
  }
});

/** A release check on this machine, as `lineclear release run` makes it: its own process that holds the slots while its command runs. */
function releaseCheck(command: string) {
  const script = join(root, "release-hold.ts");
  writeFileSync(
    script,
    `import { runFullCheck } from ${JSON.stringify(join(import.meta.dir, "..", "src", "release.ts"))};\nprocess.exit(runFullCheck(["sh", "-c", process.argv[2] as string], process.argv[3] as string, process.env, 60_000, () => true).ok ? 0 : 1);\n`,
  );
  return Bun.spawn(["bun", script, command, repo], { env: env as Record<string, string>, stdout: "ignore", stderr: "ignore" });
}

test("with a release check holding the slots, a task's check and a browser suite wait and start after it", async () => {
  expect(await add(["--check", "true", "--heavy", "true"])).toBe(0);
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ checkSlots: 2, loadPerCore: 1e6 }));
  const log = join(root, "release.log");
  const machine = machineOf(env as NodeJS.ProcessEnv);
  const spawn = (n: number, how: string, cmd: string) =>
    Bun.spawn([bin, how, cmd], { cwd: repo, env: { ...env, LINECLEAR_TASK: `LIN-${n}` } as Record<string, string>, stdout: "ignore", stderr: "ignore" });
  const reasons = () => Object.fromEntries(readWaits(env as NodeJS.ProcessEnv).map((w) => [w.task, w.reason]));
  const release = releaseCheck(`echo r-start >> ${log}; while [ ! -f ${join(root, "go-r")} ]; do sleep 0.05; done; echo r-end >> ${log}`);
  await until(() => existsSync(log));
  const check = spawn(1, "check", `echo c-start >> ${log}; echo c-end >> ${log}`);
  const browser = spawn(2, "slot", `echo b-start >> ${log}; echo b-end >> ${log}; : playwright`);
  await until(() => reasons()["LIN-1"] !== undefined && reasons()["LIN-2"] !== undefined);
  expect(reasons()).toEqual({
    "LIN-1": `waiting for the release check on ${machine}`,
    "LIN-2": `waiting for the release check on ${machine}`,
  });
  writeFileSync(join(root, "go-r"), "");
  expect(await Promise.all([release.exited, check.exited, browser.exited])).toEqual([0, 0, 0]);
  const lines = readFileSync(log, "utf8").trim().split("\n");
  expect(lines.slice(0, 2)).toEqual(["r-start", "r-end"]);
  expect(lines.slice(2).sort()).toEqual(["b-end", "b-start", "c-end", "c-start"]);
  expect(readWaits(env as NodeJS.ProcessEnv)).toEqual([]);
  const runs = readFileSync(join(root, "config", "check-runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const mine = runs.find((r) => r.tier === "nightly");
  expect(mine.slotWaitMin).toBeGreaterThanOrEqual(0);
  expect(typeof mine.loadAtStart).toBe("number");
});

test("a release check killed mid-run frees every slot", async () => {
  expect(await add(["--check", "true", "--heavy", "true"])).toBe(0);
  writeFileSync(join(root, "config", "machine.json"), JSON.stringify({ checkSlots: 2, loadPerCore: 1e6 }));
  const log = join(root, "killed.log");
  const release = releaseCheck(`echo r-start >> ${log}; echo $$ > ${join(root, "r-pid")}; exec sleep 30`);
  await until(() => existsSync(log));
  const later = Bun.spawn([bin, "slot", `echo l-start >> ${log}`], {
    cwd: repo,
    env: { ...env, LINECLEAR_TASK: "LIN-1" } as Record<string, string>,
    stdout: "ignore",
    stderr: "ignore",
  });
  await until(() => readWaits(env as NodeJS.ProcessEnv).some((w) => w.task === "LIN-1"));
  process.kill(release.pid, "SIGKILL");
  expect(await later.exited).toBe(0);
  expect(readFileSync(log, "utf8")).toContain("l-start");
  // the suite goes down with its release run, so nothing runs on beside the next start
  await until(() => !existsSync(`/proc/${Number(readFileSync(join(root, "r-pid"), "utf8"))}`));
});
