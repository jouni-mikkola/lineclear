import { afterAll, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { addItem, readItems } from "../src/inbox.ts";
import { machineOf, readWaits, writeWait } from "../src/waits.ts";
import { decisionsPath } from "../pi/config.ts";
import { webApi } from "../src/web.ts";
import { networkTrouble } from "../src/health.ts";
import { chooseModels, until as untilAsync } from "./helpers.ts";

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const CLI = join(import.meta.dir, "..", "bin", "lineclear");

test("no source file writes a state file in place", () => {
  // Allowed: the one-time code file in a private temp folder.
  const allowed = new Set(["atomic.ts", "browsers.ts"]);
  // Appends are for the logs only (a cut leaves at most one partial last line, which readers skip).
  const plain = /\b(writeFileSync|writeFile|Bun\.write|createWriteStream|appendFileSync|cpSync)\(/;
  const logs = new Set([
    "rules.ts",
    "full.ts",
    "plan.ts",
    "check-runs.ts",
    "task-work.ts",
    "api-latency.ts",
    "stall-class.ts",
    "track.ts",
    "stall-ladder.ts",
    "rollback.ts",
    "promote.ts",
    "promote-step.ts",
  ]);
  // The test instance writes only into its own folder, which is made new for each run and removed with it.
  const scratch = "try-instance.ts";
  const found: string[] = [];
  const src = join(import.meta.dir, "..", "src");
  for (const f of readdirSync(src).filter((f) => f.endsWith(".ts") && !allowed.has(f) && f !== scratch)) {
    readFileSync(join(src, f), "utf8")
      .split("\n")
      .forEach((l, i) => {
        if (plain.test(l) && !(logs.has(f) && l.includes("appendFileSync("))) found.push(`${f}:${i + 1}: ${l.trim()}`);
      });
  }
  expect(found).toEqual([]);
});

/** A project with a roadmap, a fake lineclear that can be taken "down", and the folders a service keeps state in. */
function machine() {
  const dir = mkdtempSync(join(tmpdir(), "lc-recovery-"));
  temps.push(dir);
  const repo = join(dir, "repo");
  const fake = join(dir, "fake");
  const bin = join(dir, "bin");
  const config = join(dir, "config");
  for (const d of [join(repo, "docs"), fake, bin, join(config, "projects", "demo")]) mkdirSync(d, { recursive: true });
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  git("init", "-q");
  const roadmap = (steps: string) => {
    writeFileSync(join(repo, "docs", "ROADMAP.md"), `# Roadmap\n\n## Phase 0\n\n${steps}`);
    git("add", "-A");
    git("commit", "-q", "-m", "roadmap");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
  };
  const step = (id: string) => `### ${id} Title ${id}\n- why: because\n- done when:\n  - it works\n- locks: repo\n- after: none\n`;
  const script = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  script(
    "lineclear",
    `case "$1 $2" in
  "task list") if [ -f "${fake}/down" ]; then echo "network is unreachable" >&2; exit 1; fi; echo '[{"id":"LIN-1","title":"Waiting task","status":"need"}]' ;;
  "task add") echo "$3" >> "${fake}/adds.log" ;;
  show*) echo "machine.maxTasks       3  (box)" ;;
esac`,
  );
  script("pi", `echo "provider model context"; echo "anthropic claude-sonnet-5-5 1M"; echo "anthropic claude-opus-5-5 1M"; echo "openai-codex gpt-6.1-sol 1M"`);
  writeFileSync(
    join(config, "projects", "demo", "settings.json"),
    JSON.stringify({
      repo,
      space: "demo",
      check: "bun run check",
      models: { worker: ["anthropic/claude-sonnet-5-5"], reviewer: ["openai-codex/gpt-6.1-sol"], planner: ["anthropic/claude-opus-5-5"] },
    }),
  );
  writeFileSync(join(config, "machine.json"), JSON.stringify({ loadPerCore: 1e6 }));
  chooseModels(config);
  const vars = {
    ...process.env,
    HOME: dir,
    LINECLEAR_CONFIG: config,
    LINECLEAR_HOME: join(dir, "data"),
    LINECLEAR_PORT: "0",
    LINECLEAR_SERVER_BIN: join(bin, "lineclear"),
    PI_BIN: join(bin, "pi"),
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    LINECLEAR_NET_CHECK: "off",
  } as Record<string, string>;
  const adds = () => (existsSync(join(fake, "adds.log")) ? readFileSync(join(fake, "adds.log"), "utf8").trim().split("\n") : []);
  const decisions = () => (existsSync(decisionsPath(vars)) ? readFileSync(decisionsPath(vars), "utf8").trim().split("\n") : []);
  /** What a crash must not lose: the wait, the Inbox item and the decisions. */
  const state = (withDecisions = true) => JSON.stringify({ waits: readWaits(vars), inbox: readItems(vars), decisions: withDecisions ? decisions() : [] });
  return { dir, fake, config, vars, roadmap, step, adds, decisions, state };
}

type Machine = ReturnType<typeof machine>;

/** Starts the service the way systemd does and returns it. */
const start = (m: Machine) => Bun.spawn([process.execPath, CLI, "run"], { env: m.vars, stdin: "ignore", stdout: "ignore", stderr: "ignore" });

async function until(ok: () => boolean, ms = 30_000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await Bun.sleep(100);
  expect(ok()).toBe(true);
}

/** Puts a wait, an Inbox item and a decision on disk, as a day of work would. */
function work(m: Machine) {
  writeWait({ task: "LIN-1", project: "demo", kind: "owner", reason: "asked: Ship it?", since: "2026-11-01T00:00:00Z" }, m.vars);
  addItem({ kind: "step", task: "LIN-1", project: "demo", question: "Ship it?", choices: ["Yes", "No"], since: "2026-11-01T00:00:00Z" }, m.vars);
  mkdirSync(m.config, { recursive: true });
  writeFileSync(decisionsPath(m.vars), `${JSON.stringify({ time: "t", project: "demo", kind: "start", reason: "earlier" })}\n`);
}

for (const kind of ["a killed service", "a reboot"] as const) {
  test(`${kind} comes back by itself: nothing lost, and the tasks go on`, async () => {
    const m = machine();
    m.roadmap(""); // nothing ready yet
    work(m);
    const before = m.state(false);
    const earlier = m.decisions();
    const first = start(m);
    await Bun.sleep(1500);
    first.kill("SIGKILL"); // no chance to clean up
    await first.exited;
    if (kind === "a reboot") {
      // a reboot also leaves what a power cut leaves: a half-written temporary file, a dead holder's lock
      writeFileSync(join(m.config, "waits", "LIN-9.json.1.0.tmp"), '{"task":"LIN-9","kind"');
      mkdirSync(join(m.config, "check-slots", machineOf(m.vars)), { recursive: true });
      writeFileSync(join(m.config, "check-slots", machineOf(m.vars), "slot-0"), "999999");
    }
    expect(m.state(false)).toBe(before);
    // the service may log a decision of its own before the kill, so the earlier ones must stay as the first lines
    expect(m.decisions().slice(0, earlier.length)).toEqual(earlier);
    m.roadmap(m.step("A")); // the next step becomes ready while the service is down
    const second = start(m);
    try {
      await until(() => m.adds().includes("A Title A"));
      expect(readWaits(m.vars).map((w) => w.task)).toEqual(["LIN-1"]);
      expect(readItems(m.vars).map((i) => i.question)).toEqual(["Ship it?"]);
      expect(m.decisions()[0]).toContain("earlier");
    } finally {
      second.kill("SIGKILL");
      await second.exited;
    }
  });
}

/** The lines of this machine's doctor in Settings that name `name`: what is wrong shows there, once. */
const machineProblems = async (api: ReturnType<typeof webApi>, name: string) =>
  (((await (await api(new Request("http://127.0.0.1/api/settings"))).json()) as any).machines[0].doctor as string[]).filter((l) =>
    l.startsWith(`FAILED ${name}`),
  );

test("a full disk fails the write whole: the old file stays, nothing is lost, and Settings shows it once until space is free", async () => {
  const m = machine();
  m.roadmap(m.step("A"));
  work(m);
  const before = m.state();
  const file = join(m.dir, "state.json");
  writeAtomic(file, '{"v":1}');
  // The disk is full when a write fails with ENOSPC half way through the temporary file.
  const full = spyOn(fs, "writeSync").mockImplementation(() => {
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
  });
  try {
    expect(() => writeAtomic(file, '{"v":2}')).toThrow(/ENOSPC/);
    expect(() => writeWait({ task: "LIN-2", kind: "owner", reason: "x", since: "s" }, m.vars)).toThrow(/ENOSPC/);
  } finally {
    full.mockRestore();
  }
  expect(readFileSync(file, "utf8")).toBe('{"v":1}');
  expect(readdirSync(m.dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  expect(readdirSync(join(m.config, "waits")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  expect(m.state()).toBe(before);
  // space is back: the next step starts, and the wait, the item and the decision are still there
  expect(Bun.spawnSync([process.execPath, CLI, "run", "--once"], { env: m.vars, stdin: "ignore" }).exitCode).toBe(0);
  expect(m.adds()).toEqual(["A Title A"]);
  expect(readWaits(m.vars).map((w) => w.task)).toEqual(["LIN-1"]);
  expect(readItems(m.vars).map((i) => i.question)).toEqual(["Ship it?"]);

  // Home: the disk check reads the real free space against a limit, so a huge limit is a full disk.
  const vars = { ...m.vars, LINECLEAR_MIN_FREE_MB: "999999999999" };
  let t = 1_000_000;
  const api = webApi(vars, () => t);
  const read = () => machineProblems(api, "disk full");
  expect(await read()).toHaveLength(1);
  t += 5_000;
  expect(await read()).toHaveLength(1); // still one entry, not one more each time
  vars.LINECLEAR_MIN_FREE_MB = "1"; // space is free again
  t += 61_000;
  expect(await read()).toEqual([]);
});

test("a lost network shows once in Settings, no task starts, and it clears and goes on", async () => {
  const m = machine();
  m.roadmap(m.step("A"));
  work(m);
  writeFileSync(join(m.fake, "down"), "");

  // the network check: a listener that answers is a network that is up
  const listen = (port: number) =>
    Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
        open(s) {
          s.end();
        },
      },
    });
  let server = listen(0);
  const port = server.port;
  const vars = { ...m.vars, LINECLEAR_NET_CHECK: `127.0.0.1:${port}` };
  expect(await networkTrouble(vars, 500)).toBeUndefined();
  server.stop(true);
  expect((await networkTrouble(vars, 500))?.name).toBe("network lost");

  // Home shows it from the server's background check, once
  let t = 1_000_000;
  const api = webApi(vars, () => t);
  await machineProblems(api, "network lost");
  // the check runs in the background: ask again until it has answered, however slow the machine
  let shown: Awaited<ReturnType<typeof machineProblems>> = [];
  await untilAsync(async () => {
    t += 31_000;
    shown = await machineProblems(api, "network lost");
    return shown.length > 0;
  });
  expect(shown).toHaveLength(1);

  // while the network is gone no task starts and nothing is lost
  const run = () => Bun.spawnSync([process.execPath, CLI, "run", "--once"], { env: m.vars, stdin: "ignore" });
  expect(run().exitCode).toBe(0);
  expect(m.adds()).toEqual([]);
  expect(readWaits(m.vars)).toHaveLength(1);
  expect(readItems(m.vars)).toHaveLength(1);

  // the network is back: the entry clears and the step starts by itself
  server = listen(port);
  rmSync(join(m.fake, "down"));
  t += 31_000;
  await machineProblems(api, "network lost"); // starts the check
  await untilAsync(async () => {
    t += 31_000;
    return (await machineProblems(api, "network lost")).length === 0;
  });
  expect(await machineProblems(api, "network lost")).toEqual([]);
  expect(run().exitCode).toBe(0);
  expect(m.adds()).toEqual(["A Title A"]);
  server.stop(true);
});
