import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionsRoot } from "./harness-pi.ts";
import { writeAtomic } from "../pi/atomic.ts";
import { runMain } from "./rules.ts";
import { startWeb } from "./web.ts";
import { DAY, HOUR_MS, MIN } from "./time.ts";
import { gitWith } from "./git.ts";

// Demo mode: `lineclear run --demo` serves the real app on fixed data written into one folder, so a picture of it
// shows what the app does. The data has no real project, owner or machine name, and the machine shown is a fixed stand-in.

const write = (file: string, data: unknown) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeAtomic(file, typeof data === "string" ? data : JSON.stringify(data));
};

const WEB_ROADMAP = `# Roadmap

## Phase 0: Base

### W0 Repo and check
- why: every step needs a place to land.
- done when: the check passes.
- locks: none
- after: none

### W1 Product pages
- why: people buy what they can see.
- done when: each product has a page.
- locks: none
- after: W0

## Phase 1: Checkout

### W2 Pay with a saved card
- why: paying again should take one click.
- done when:
  - A saved card pays in one click.
  - A test covers it.
- locks: checkout
- after: W1

### W3 Search that forgives typos
- why: people misspell product names.
- done when: a search with one typo finds the product.
- locks: none
- after: W1

### W4 Stock alerts by mail
- why: people come back when a product is in stock again.
- done when: a mail goes out when stock comes back.
- locks: none
- after: W1

### W5 Gift cards
- why: gifts bring new customers.
- done when: a gift card pays an order.
- locks: checkout
- after: W2, W3
`;

/** `count` more steps in a phase of their own, each after the one before: the size of a long roadmap, for the speed budget. */
const longRoadmap = (count: number) =>
  Array.from(
    { length: count },
    (_, i) =>
      `\n### Z${i} Step number ${i} of the long run\n- why: a long roadmap must load fast.\n- done when: step ${i} is checked.\n- locks: none\n- after: ${i === 0 ? "W5" : `Z${i - 1}`}\n`,
  ).reduce((text, step) => text + step, "\n## Phase 2: The long run\n");

const API_ROADMAP = `# Roadmap

## Phase 0: Base

### B0 Repo and check
- why: every step needs a place to land.
- done when: the check passes.
- locks: none
- after: none

### B1 Retry failed webhooks
- why: a missed webhook loses an invoice.
- done when: a failed webhook is sent again with a growing pause.
- locks: none
- after: B0

### B2 Invoice export
- why: accountants ask for a file.
- done when: an invoice list downloads as CSV.
- locks: none
- after: B0
`;

interface DemoTask {
  id: string;
  title: string;
  status: "work" | "need" | "queued" | "done";
  sub?: string;
  /** Minutes ago it last moved. */
  ago: number;
}

const WEB_TASKS: DemoTask[] = [
  { id: "WEB-1", title: "W0 Repo and check", status: "done", ago: 3 * 24 * 60 },
  { id: "WEB-2", title: "W1 Product pages", status: "done", ago: 26 * 60 },
  { id: "WEB-3", title: "W2 Pay with a saved card", status: "need", sub: "Waits for your answer", ago: 25 },
  { id: "WEB-4", title: "W3 Search that forgives typos", status: "work", sub: "in review, round 1", ago: 12 },
  { id: "WEB-5", title: "W4 Stock alerts by mail", status: "work", sub: "Writing the tests", ago: 4 },
];

const API_TASKS: DemoTask[] = [
  { id: "API-1", title: "B0 Repo and check", status: "done", ago: 2 * 24 * 60 },
  { id: "API-2", title: "B1 Retry failed webhooks", status: "work", sub: "Writing the tests", ago: 9 },
];

const commitAt = (repo: string, args: string[], at: number) => {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Demo",
    GIT_AUTHOR_EMAIL: "demo@example.com",
    GIT_COMMITTER_NAME: "Demo",
    GIT_COMMITTER_EMAIL: "demo@example.com",
    GIT_AUTHOR_DATE: `@${Math.floor(at / 1000)} +0000`,
    GIT_COMMITTER_DATE: `@${Math.floor(at / 1000)} +0000`,
  };
  gitWith({ env }, repo, ...args);
};

/** A project's repo: its roadmap, then one commit per merged task, with origin/main at the last. */
function writeRepo(dir: string, name: string, roadmap: string, tasks: DemoTask[], now: number): string {
  const repo = join(dir, "repos", name);
  write(join(repo, "docs", "ROADMAP.md"), roadmap);
  const start = now - 4 * DAY;
  commitAt(repo, ["init", "-q", "-b", "main"], start);
  commitAt(repo, ["add", "."], start);
  commitAt(repo, ["commit", "-q", "-m", "Roadmap"], start);
  for (const t of tasks.filter((x) => x.status === "done")) commitAt(repo, ["commit", "-q", "--allow-empty", "-m", `${t.id}: ${t.title}`], now - t.ago * MIN);
  commitAt(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"], now);
  return repo;
}

/** Tokens of one day's work, in a pi session file: the dollars of each day come from them at the prices below. */
const sessionLine = (at: number, provider: string, model: string, outputTokens: number) =>
  JSON.stringify({
    timestamp: new Date(at).toISOString(),
    message: {
      role: "assistant",
      provider,
      model,
      usage: { input: outputTokens / 4, output: outputTokens, cacheRead: outputTokens * 2, cacheWrite: outputTokens / 8 },
    },
  });

const PRICES = {
  anthropic: { models: [{ id: "demo-sonnet", cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }] },
  openai: { models: [{ id: "demo-codex", cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 } }] },
};
const DAILY_K_TOKENS = [310, 420, 380, 250, 90, 60, 510, 640, 590, 470, 700, 820, 540, 610];

function writeUsage(dir: string, now: number) {
  const lines = DAILY_K_TOKENS.map((k, i) => {
    const at = now - (DAILY_K_TOKENS.length - 1 - i) * DAY - HOUR_MS;
    return [sessionLine(at, "anthropic", "demo-sonnet", k * 1000), ...(i % 3 === 0 ? [sessionLine(at, "openai", "demo-codex", k * 400)] : [])];
  });
  write(join(sessionsRoot(join(dir, "pi")), "demo", "work.jsonl"), `${lines.flat().join("\n")}\n`);
  write(join(dir, "pi", "models-store.json"), PRICES);
  const window = (percent: number, hours: number) => ({ percent, resetAt: new Date(now + hours * HOUR_MS).toISOString() });
  const at = new Date(now).toISOString();
  write(join(dir, "config", "limits.json"), {
    anthropic: { at, session: window(42, 2.5), week: window(81, 70) },
    openai: { at, session: window(18, 4), week: window(33, 120) },
  });
  write(join(dir, "config", "accounts.json"), {
    anthropic: { kind: "subscription", price: 100, currency: "USD" },
    openai: { kind: "subscription", price: 20, currency: "USD" },
  });
}

function writeProject(dir: string, name: string, space: string, repo: string) {
  write(join(dir, "config", "projects", name, "settings.json"), {
    repo,
    space,
    check: "bun run check",
    models: { worker: ["anthropic/demo-sonnet", "openai/demo-codex"], reviewer: ["openai/demo-codex"], planner: ["anthropic/demo-sonnet"] },
  });
}

// The stand-ins for Lineclear's and playwright-cli's commands: the first answers `task list` from the task files, the
// second lists two open browsers. They find their data by their own path: a child process may not see the changed environment. Every other command does nothing.
const LINECLEAR = `#!/bin/sh
[ "$1 $2" = "task list" ] && cat "$(dirname "$0")/../lineclear/task-list-$4.json"
exit 0
`;
const PLAYWRIGHT_CLI = `#!/bin/sh
[ "$1" = "list" ] && echo '{"browsers":[{"name":"WEB-5","workspace":"0123456789abcdef","status":"open"},{"name":"API-2-review","workspace":"0123456789abcdef","status":"open"}]}'
exit 0
`;

/**
 * Writes the demo data into `dir` (an empty folder): two projects with roadmaps, their tasks, an Inbox ask, two
 * accounts with usage and two weeks of spend. Returns the environment that makes the app read it.
 */
function writeDemo(dir: string, now = Date.now()): Record<string, string> {
  const projects = [
    {
      key: "WEB",
      name: "web-shop",
      roadmap: WEB_ROADMAP + longRoadmap(Number(process.env.LINECLEAR_DEMO_STEPS) || 0).replace(/^\n## Phase 2: The long run\n$/, ""),
      tasks: WEB_TASKS,
    },
    { key: "API", name: "billing-api", roadmap: API_ROADMAP, tasks: API_TASKS },
  ];
  const repos = projects.map((p) => writeRepo(dir, p.name, p.roadmap, p.tasks, now));
  const lineclear = join(dir, "lineclear");
  write(
    join(lineclear, "spaces.json"),
    projects.map((p, i) => ({ key: p.key, name: p.name, path: repos[i] })),
  );
  const all = projects.flatMap((p) => p.tasks);
  write(join(lineclear, "tasks.json"), {
    tasks: all.map((t) => ({
      id: t.id,
      title: t.title,
      updated: now - t.ago * MIN,
      ...(t.status === "done" ? { merged: true, doneAt: now - t.ago * MIN } : { told: "work" }),
      ...(t.status !== "done" && t.status !== "queued" ? { agent: { model: "anthropic/demo-sonnet" } } : {}),
    })),
    red: {},
  });
  write(join(lineclear, "chatlog", "cards.json"), {
    posted: [{ at: now - 25 * MIN, card: { task: "WEB-3", status: "need", text: "Which payment provider should the saved card use?" } }],
  });
  for (const p of projects) {
    write(
      join(lineclear, `task-list-${p.name}.json`),
      p.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, ...(t.sub ? { sub: t.sub } : {}) })),
    );
  }
  for (const [i, p] of projects.entries()) writeProject(dir, p.name, p.name, repos[i] ?? "");
  write(join(dir, "config", "inbox", "1.json"), {
    n: 1,
    kind: "step",
    task: "WEB-3",
    project: "web-shop",
    since: new Date(now - 25 * MIN).toISOString(),
    question: "Pay with a saved card needs a payment provider. Which one?",
    choices: ["Stripe", "Adyen"],
  });
  write(join(dir, "doctor.json"), []);
  writeUsage(dir, now);
  for (const [name, text] of [
    ["lineclear", LINECLEAR],
    ["playwright-cli", PLAYWRIGHT_CLI],
  ] as const) {
    write(join(dir, "bin", name), text);
    chmodSync(join(dir, "bin", name), 0o755);
  }
  return {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_HOME: lineclear,
    PI_CODING_AGENT_DIR: join(dir, "pi"),
    XDG_CACHE_HOME: join(dir, "cache"),
    LINECLEAR_SERVER_BIN: join(dir, "bin", "lineclear"),
    LINECLEAR_PLAYWRIGHT_CLI: join(dir, "bin", "playwright-cli"),
    LINECLEAR_DOCTOR_FILE: join(dir, "doctor.json"),
    PI_BIN: "true",
    LINECLEAR_DEMO: "1",
  };
}

/** `lineclear run --demo`: serves the web pages on the demo data and runs no rule. The data goes when it stops. */
export async function demoMain(args: string[], out: (line: string) => void): Promise<number> {
  if (args.length > 0) {
    out("usage: lineclear run --demo");
    return 2;
  }
  const dir = mkdtempSync(join(tmpdir(), "lineclear-demo-"));
  try {
    // LINECLEAR_HOME would win over the demo's own folder
    delete process.env.LINECLEAR_HOME;
    Object.assign(process.env, writeDemo(dir));
    return await runMain([], out, undefined, { tick: async () => [], web: startWeb });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
