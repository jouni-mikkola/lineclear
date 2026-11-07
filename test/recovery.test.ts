import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addItem, readItems } from "../src/inbox.ts";
import { readWaits, writeWait } from "../src/waits.ts";
import { addDecisions, decisionsSince } from "../src/decisions-store.ts";
import { chooseModels } from "./helpers.ts";

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const RULES = join(import.meta.dir, "..", "src", "rules.ts");

test("no source file writes a state file in place", () => {
  // Allowed: the one-time code file in a private temp folder.
  const allowed = new Set(["atomic.ts", "browser-cli.ts"]);
  // Appends are for the logs only (a cut leaves at most one partial last line, which readers skip).
  const plain = /\b(writeFileSync|writeFile|Bun\.write|createWriteStream|appendFileSync|cpSync)\(/;
  const logs = new Set(["rules.ts", "full.ts", "plan.ts", "task-work.ts", "api-latency.ts", "stall-class.ts", "stall-ladder.ts"]);
  const found: string[] = [];
  const src = join(import.meta.dir, "..", "src");
  for (const f of readdirSync(src).filter((f) => f.endsWith(".ts") && !allowed.has(f))) {
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
  const decisions = () => decisionsSince(vars, 0).map((d) => JSON.stringify(d));
  /** What a crash must not lose: the wait, the Inbox item and the decisions. */
  const state = (withDecisions = true) => JSON.stringify({ waits: readWaits(vars), inbox: readItems(vars), decisions: withDecisions ? decisions() : [] });
  return { dir, fake, config, vars, roadmap, step, adds, decisions, state };
}

type Machine = ReturnType<typeof machine>;

/** Starts the service's rule loop and returns it (the server around it has its own tests). */
const start = (m: Machine) =>
  Bun.spawn([process.execPath, "-e", `import { runMain } from ${JSON.stringify(RULES)}; process.exit(await runMain([], console.log));`], {
    env: m.vars,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

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
  addDecisions(m.vars, [{ time: new Date().toISOString(), project: "demo", kind: "start", reason: "earlier" }]);
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
