// A Lineclear project in a temp folder for the rules tests: a fake lineclear and a fake pi that only read and log files.
import { afterAll } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWaits, waitsMain } from "../src/waits.ts";
import { decisionsSince } from "../src/decisions-store.ts";
import { status as statusLines } from "../src/status.ts";
import { realWorld, tick } from "../src/rules.ts";

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

export const step = (id: string, after: string, locks = "repo") =>
  `### ${id} Title ${id}\n- why: because ${id}\n- done when:\n  - first ${id}\n  - second ${id}\n- locks: ${locks}\n- after: ${after}\n`;

interface Opts {
  steps?: string[];
  roadmap?: string;
  commits?: string[];
  tasks?: { id?: string; title: string; status: string; sub?: string; closed?: boolean; closedBy?: "done" | "close"; orphaned?: boolean }[];
  max?: number;
  health?: string;
  models?: string;
  worker?: string[];
  reviewer?: string[];
  rounds?: number;
  load?: number;
  machine?: object;
  /** The machine's own name for the project's space. "demo" if unset. */
  space?: string;
  /** Settings of the project beyond these. */
  settings?: object;
}

/** A project in a temp folder, with a fake lineclear and a fake pi that only read and log files. */
export function setup(o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lc-rules-"));
  temps.push(dir);
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "ROADMAP.md"), o.roadmap ?? `# Roadmap\n\n## Phase 0\n\n${(o.steps ?? []).join("\n")}`);
  const git = (...a: string[]) => {
    const p = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  };
  git("init", "-q");
  git("add", "-A");
  for (const c of o.commits ?? ["start"]) git("commit", "-q", "--allow-empty", "-m", c);
  git("update-ref", "refs/remotes/origin/main", "HEAD");

  const bin = join(dir, "bin");
  mkdirSync(bin);
  const fake = join(dir, "fake");
  mkdirSync(fake);
  const script = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  script(
    "lineclear",
    `case "$1 $2" in
  "task list") cat "${fake}/tasks.json" ;;
  "task add") { flock 9; for a in "$@"; do printf '%s\\001' "$a"; done >> "${fake}/adds.log"; printf '\\002' >> "${fake}/adds.log"; } 9>"${fake}/adds.lock" ;;
  "task stop"|"task tell") echo "$*" >> "${fake}/calls.log" ;;
  show*) echo "machine.maxTasks       $(cat "${fake}/max")  (laptop)" ;;
esac`,
  );
  script("pi", `echo "$*" >> "${fake}/pi.log"; echo "provider model context"; cat "${fake}/models.txt"`);
  writeFileSync(join(fake, "tasks.json"), JSON.stringify(o.tasks ?? []));
  writeFileSync(join(fake, "max"), String(o.max ?? 3));
  writeFileSync(
    join(fake, "models.txt"),
    o.models ?? "anthropic claude-sonnet-5-5 1M\nanthropic claude-opus-5-5 1M\nopenai gpt-6.1-sol 1M\nopenai-codex gpt-6.1-sol 1M\n",
  );

  const config = join(dir, "config");
  // the variables of an agent running these tests (its chat, its server) would point the world at the real board
  const own = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("LINECLEAR_")));
  const env = {
    ...own,
    LINECLEAR_CONFIG: config,
    // the loop copies the board's store and sweeps old temp folders: left at the defaults it works on the real ones, shared with every other run
    LINECLEAR_HOME: join(dir, "home"),
    LINECLEAR_STORE_COPIES: join(dir, "store-copies"),
    XDG_CACHE_HOME: join(dir, "cache"),
    TMPDIR: join(dir, "tmp"),
    LINECLEAR_SERVER_BIN: join(bin, "lineclear"),
    PI_BIN: join(bin, "pi"),
  };
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  writeFileSync(
    join(config, "projects", "demo", "settings.json"),
    JSON.stringify({
      repo,
      space: o.space ?? "demo",
      check: "bun run check",
      ...o.settings,
      ...(o.health ? { health: o.health } : {}),
      ...(o.rounds ? { reviewRounds: o.rounds } : {}),
      models: {
        worker: o.worker ?? ["anthropic/claude-sonnet-5-5"],
        reviewer: o.reviewer ?? ["anthropic/claude-opus-5-5", "openai-codex/gpt-6.1-sol"],
        planner: ["anthropic/claude-opus-5-5"],
      },
    }),
  );
  writeFileSync(join(config, "machine.json"), JSON.stringify(o.machine ?? { loadPerCore: 1e6 }));
  const calls = () => (existsSync(join(fake, "calls.log")) ? readFileSync(join(fake, "calls.log"), "utf8").trim().split("\n") : []);
  const adds = () => {
    const f = join(fake, "adds.log");
    return existsSync(f)
      ? readFileSync(f, "utf8")
          .split("\x02")
          .filter(Boolean)
          .map((b) => b.split("\x01").slice(0, -1))
      : [];
  };
  const decisions = () => decisionsSince(env, 0);
  const now = { at: new Date() };
  const real = realWorld(env);
  const piCalls = () => (existsSync(join(fake, "pi.log")) ? readFileSync(join(fake, "pi.log"), "utf8").trim().split("\n") : []);
  const doTick = (dryRun = false) => tick({ ...real, load: () => o.load ?? 0, now: () => now.at }, dryRun, env);
  return { dir, repo, config, env, fake, git, adds, calls, decisions, doTick, now, piCalls };
}

export const waitsOf = (t: ReturnType<typeof setup>) => readWaits(t.env);
export const run = (t: ReturnType<typeof setup>, name: string, args: string[], task = "LIN-9") => {
  const lines: string[] = [];
  const env = { ...t.env, LINECLEAR_TASK: task };
  return waitsMain(
    name,
    args,
    (l) => lines.push(l),
    env,
    t.repo,
    () => t.now.at,
  ).then((code) => ({ code, text: lines.join("\n") }));
};

/** what lineclear status prints for this project */
export async function status(t: ReturnType<typeof setup>) {
  const lines: string[] = [];
  statusLines((l) => lines.push(l), t.env);
  return lines.join("\n");
}
