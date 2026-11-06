// The files the views read in the UI bar's tests: Lineclear's spaces and tasks, and Lineclear's Inbox.
import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomic } from "../../pi/atomic.ts";
import type { Motion } from "../kit/motion.ts";

/** The port the tests' server answers on: `LINECLEAR_UI_PORT`, so two runs on one machine can each have their own. */
export const UI_PORT = Number(process.env.LINECLEAR_UI_PORT) || 7432;
export const FIXTURE = join(tmpdir(), `lineclear-ui-${UI_PORT}`);

export interface FixtureTask {
  id: string;
  title: string;
  told?: string;
  merged?: boolean;
  /** Its status line in `lineclear task list`, such as "in review". */
  sub?: string;
}

const write = (file: string, data: unknown) => {
  mkdirSync(join(file, ".."), { recursive: true });
  // written whole, so the server never reads a half-written file
  writeAtomic(file, JSON.stringify(data));
};

/** The tasks, with the ones in `need` asking for you on their last card. A project in `red` has main's head marked red, one in `stale` an older commit. */
export function writeTasks(tasks: FixtureTask[], o: { need?: string[]; red?: string[]; stale?: string[] } = {}) {
  const { need = [], red = [], stale = [] } = o;
  const names = [
    ["WEB", "web-shop"],
    ["API", "billing-api"],
  ] as const;
  const marks: Record<string, string> = {};
  const path = (name: string) => {
    if (!red.includes(name) && !stale.includes(name)) return `/nowhere/${name}`;
    const repo = join(FIXTURE, "homes", name);
    if (!existsSync(join(repo, ".git"))) {
      mkdirSync(repo, { recursive: true });
      git(repo, ["init", "-q", "-b", "main"]);
      git(repo, ["commit", "-q", "--allow-empty", "-m", "old"]);
      git(repo, ["commit", "-q", "--allow-empty", "-m", "head"]);
    }
    marks[repo] = git(repo, ["rev-parse", red.includes(name) ? "HEAD" : "HEAD~1"])
      .toString()
      .trim();
    return repo;
  };
  write(
    join(FIXTURE, "lineclear", "spaces.json"),
    names.map(([key, name]) => ({ key, name, path: path(name) })),
  );
  // Home lists Lineclear projects, so each space has its project
  for (const [, name] of names)
    write(join(FIXTURE, "config", "projects", name, "settings.json"), {
      repo: path(name),
      space: name,
      check: "true",
      models: { worker: [], reviewer: [], planner: [] },
    });
  write(join(FIXTURE, "lineclear", "tasks.json"), {
    tasks: tasks.map((t, i) => ({ ...t, updated: i + 1, ...(t.merged ? { doneAt: i + 1 } : {}) })),
    red: marks,
  });
  write(join(FIXTURE, "lineclear", "chatlog", "cards.json"), {
    posted: need.map((task, i) => ({ at: i + 1, card: { task, status: "need", text: `Card of ${task}` } })),
  });
  // what `lineclear task list` says: a task waits for you when it is in `need`
  for (const [key, name] of names) {
    const status = (t: FixtureTask) => (need.includes(t.id) ? "need" : t.merged ? "done" : t.told === "work" ? "work" : "queued");
    writeSpaceTasks(
      name,
      tasks.filter((t) => t.id.startsWith(`${key}-`)).map((t) => ({ id: t.id, title: t.title, status: status(t), ...(t.sub ? { sub: t.sub } : {}) })),
    );
  }
}

export function writeItem(
  n: number,
  item: { question: string; choices: string[]; kind?: string; task?: string; project?: string; diff?: string; session?: string; answer?: string },
) {
  write(join(FIXTURE, "config", "inbox", `${n}.json`), { n, kind: "step", task: "WEB-1", project: "web-shop", since: "2026-01-05T09:12:00.000Z", ...item });
}

function clearFixture() {
  for (const d of [
    "lineclear",
    "config/inbox",
    "config/machines.json",
    "config/machine.json",
    "config/projects",
    "browsers.json",
    "browser-inputs.log",
    "ssh.log",
  ])
    rmSync(join(FIXTURE, d), { recursive: true, force: true });
  // the doctor of the run finds nothing, so no picture shows the host's own findings
  write(join(FIXTURE, "doctor.json"), []);
}

// The agents' browsers: the open playwright-cli sessions that ui/test/fake-playwright-cli lists, and the code it ran.

function writeBrowsers(names: string[]) {
  write(join(FIXTURE, "browsers.json"), { browsers: names.map((name) => ({ name, workspace: "0123456789abcdef", status: "open" })) });
}

export const browserInputs = () => {
  try {
    return readFileSync(join(FIXTURE, "browser-inputs.log"), "utf8");
  } catch {
    return "";
  }
};

const BROWSERS = ["WEB-1", "API-1-review", "scratch"];

/** The browsers every live test of their view starts from, with a login in WEB-1's browser waiting in the Inbox. */
export function startBrowsers() {
  startFixture();
  writeBrowsers(BROWSERS);
  writeItem(2, {
    kind: "login",
    task: "WEB-1",
    session: "WEB-1",
    question: "Sign in to the payment provider's test dashboard.",
    choices: ["Done", "I cannot"],
  });
}

export const BASE: FixtureTask[] = [
  { id: "WEB-1", title: "Pay with a saved card", told: "work" },
  { id: "WEB-2", title: "Search that forgives typos" },
  { id: "WEB-3", title: "Order history page" },
  { id: "WEB-4", title: "Cart survives a reload", merged: true },
  { id: "API-1", title: "Retry failed webhooks", told: "work" },
];

const state = (id: string) => `document.querySelector('[data-task="${id}"]')?.dataset.state`;

/** Each live motion: the page it shows on, the change to the files, and what shows once the page has read it. */
export const LIVE: Partial<Record<Motion, { path: string; change: () => void; after: string }>> = {
  "task-start": {
    path: "/",
    change: () => writeTasks(BASE.map((t) => (t.id === "WEB-2" ? { ...t, told: "work" } : t))),
    after: `${state("WEB-2")} === "work"`,
  },
  "task-move": {
    path: "/",
    change: () => writeTasks(BASE.map((t) => (t.id === "WEB-1" ? { ...t, sub: "in review, round 1" } : t))),
    after: `document.querySelector('[data-task="WEB-1"]')?.dataset.stage === "review"`,
  },
  "task-wait": { path: "/", change: () => writeTasks(BASE, { need: ["WEB-1"] }), after: `${state("WEB-1")} === "need"` },
  "task-finish": {
    path: "/",
    change: () => writeTasks(BASE.map((t) => (t.id === "WEB-1" ? { ...t, merged: true } : t))),
    after: `!document.querySelector('[data-row-id="WEB-1"]')`,
  },
  "inbox-arrive": {
    path: "/",
    // the first ask is answered, so the next one takes the strip and drops in
    change: () => {
      writeItem(1, { question: "Pay with a saved card needs a payment provider. Which one?", choices: ["Stripe", "Adyen"], answer: "Stripe" });
      writeItem(2, { question: "Release 2.4 to production?", choices: ["Release", "Not yet"], task: "API-1", project: "billing-api" });
    },
    after: `document.querySelector('[data-inbox-where]')?.textContent?.includes("billing-api") === true`,
  },
};

/** A clean config: two projects from their repos, no task, no request, nothing in the Inbox. */
export function startFirstRun() {
  clearFixture();
  rmSync(join(FIXTURE, "config", "requests"), { recursive: true, force: true });
  writeTasks([]);
}

/** The Dispatcher hands a request to the Planner. */
export function writeRequest(task: string, goal: string) {
  write(join(FIXTURE, "config", "requests", `${task}.json`), { task, project: "web-shop", goal, since: "2026-01-05T09:00:00.000Z", by: "dispatcher" });
}

/** The files every live test starts from: two projects, five tasks and one Inbox item. */
export function startFixture() {
  clearFixture();
  writeTasks(BASE);
  writeItem(1, { question: "Pay with a saved card needs a payment provider. Which one?", choices: ["Stripe", "Adyen"] });
}

// Roadmaps: a Lineclear project per repo, its git history on origin/main and its space's tasks.

const GIT_ENV = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = (repo: string, args: string[], at?: number) =>
  execFileSync("git", ["-C", repo, ...args], {
    stdio: "pipe",
    env: { ...process.env, ...GIT_ENV, ...(at ? { GIT_AUTHOR_DATE: `@${at} +0000`, GIT_COMMITTER_DATE: `@${at} +0000` } : {}) },
  });

const repoOf = (project: string) => join(FIXTURE, "repos", project);

/** A project's repo with its roadmap and its commits, each in its own second, with origin/main at the last one. */
function writeRoadmapProject(
  project: string,
  roadmap: string,
  commits: { subject: string; at: number }[],
  tasks: { id: string; title: string; status: string; sub?: string }[],
) {
  const repo = repoOf(project);
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  git(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "docs", "ROADMAP.md"), roadmap);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Roadmap"], (commits[0]?.at ?? 1_767_225_600) - 60);
  for (const c of commits) git(repo, ["commit", "-q", "--allow-empty", "-m", c.subject], c.at);
  git(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  write(join(FIXTURE, "config", "projects", project, "settings.json"), {
    repo,
    space: project,
    check: "true",
    models: { worker: [], reviewer: [], planner: [] },
  });
  writeSpaceTasks(project, tasks);
  recordSteps(project, tasks);
}

/** The rules' record of the step each task was started for, which is how a local task marks its step: here the step id its title starts with. */
function recordSteps(project: string, tasks: { id: string; title: string }[]) {
  write(join(FIXTURE, "config", "projects", project, "state.json"), { taskSteps: Object.fromEntries(tasks.map((t) => [t.id, t.title.split(" ")[0]])) });
}

export function writeSpaceTasks(space: string, tasks: { id: string; title: string; status: string; sub?: string }[]) {
  write(join(FIXTURE, "lineclear", `task-list-${space}.json`), tasks);
}

/** A merge on origin/main, as a task's merge makes it, with what changed in the repo's folder. */
function mergeStep(project: string, subject: string, at: number) {
  git(repoOf(project), ["add", "-A"]);
  git(repoOf(project), ["commit", "-q", "--allow-empty", "-m", subject], at);
  git(repoOf(project), ["update-ref", "refs/remotes/origin/main", "HEAD"]);
}

/** Lineclear's own roadmap as it was when the Roadmap view was built, with its merges then. */
export function writeThisRoadmap() {
  const here = import.meta.dirname;
  writeRoadmapProject("lineclear", readFileSync(join(here, "roadmap-this.md"), "utf8"), JSON.parse(readFileSync(join(here, "roadmap-this.json"), "utf8")), [
    { id: "LIN-21", title: "L8 Pilot", status: "need", sub: "Pick A or B" },
    { id: "LIN-30", title: "U4 Roadmap view, one per project", status: "work", sub: "Building the view" },
    { id: "LIN-31", title: "U8 Agent browsers view", status: "queued", sub: "After LIN-30" },
  ]);
}

const SHOP = `# Roadmap

## Phase 0: Base

### W0 Repo and check
- result: You can run the shop and know its checks pass.
- why: every step needs a place to land.
- done when: the check passes.
- locks: none
- after: none

### W1 Product pages
- result: Every product has a page you can open.
- why: people buy what they can see.
- done when: each product has a page.
- locks: none
- after: W0

## Phase 1: Checkout

### W2 Pay with a saved card
- result: A saved card pays an order in one click.
- why: paying again should take one click.
- done when:
  - A saved card pays in one click.
  - A test covers it.
- locks: checkout
- after: W1

### W3 Search that forgives typos
- result: A search with one typo still finds the product.
- why: people misspell product names.
- done when: a search with one typo finds the product.
- locks: none
- after: W1

### W4 Stock alerts by mail
- result: You get a mail when a product is back in stock.
- why: people come back when a product is in stock again.
- done when: a mail goes out when stock comes back.
- locks: none
- after: W1

### W5 Gift cards
- result: A gift card pays an order.
- why: gifts bring new customers.
- done when: a gift card pays an order.
- locks: checkout
- after: W2, W3
`;

export const SHOP_TASKS = [
  { id: "WEB-3", title: "W2 Pay with a saved card", status: "work", sub: "Writing the tests" },
  { id: "WEB-4", title: "W3 Search that forgives typos", status: "work", sub: "Writing the tests" },
];

const T0 = 1_767_258_000;

/** The small roadmap of web-shop that the live roadmap tests change. */
export function writeShopRoadmap() {
  writeRoadmapProject(
    "web-shop",
    SHOP,
    [
      { subject: "WEB-1: W0 Repo and check", at: T0 },
      { subject: "WEB-2: W1 Product pages", at: T0 + 3600 },
    ],
    SHOP_TASKS,
  );
}

/** The shop's roadmap grown to this many steps, each in a phase of fifty, with every step after the one before it. */
export function writeBigRoadmap(steps: number) {
  const parts = ["# Roadmap\n"];
  for (let i = 0; i < steps; i++) {
    if (i % 50 === 0) parts.push(`\n## Phase ${i / 50}: Part ${i / 50}\n`);
    parts.push(
      `\n### W${i} Step number ${i}\n- result: Step ${i} is done and shows in the shop.\n- why: the shop grows by one step at a time.\n- done when: step ${i} is merged.\n- locks: none\n- after: ${i === 0 ? "none" : `W${i - 1}`}\n`,
    );
  }
  writeRoadmapProject("web-shop", parts.join(""), [{ subject: "WEB-1: W0 Step number 0", at: T0 }], SHOP_TASKS);
}

const BILLING = `# Roadmap

## Phase 0: Base

### B0 Webhooks that retry
- result: A failed webhook is sent again until it arrives.
- why: a lost payment message costs money.
- done when: a failed webhook is retried.
- locks: none
- after: none
`;

/** billing-api as a project with a roadmap of one step, its tasks as the fixture wrote them: a link to its roadmap then finds one. */
export function writeBillingRoadmap() {
  const tasks = JSON.parse(readFileSync(join(FIXTURE, "lineclear", "task-list-billing-api.json"), "utf8"));
  writeRoadmapProject("billing-api", BILLING, [{ subject: "API-1: B0 Webhooks that retry", at: T0 }], tasks);
}

const LIST = `# Roadmap

## Now

- **Sync notes between phone and laptop.** Edits merge, and a clash keeps both.
- Search every note

## Next

1. Share a note by link
2. Pin a note to the top

## Later

- Offline mode

## Done

- Sign in
`;

/** A roadmap of Now, Next, Later and Done lists with no step ids. */
export function writeListRoadmap() {
  writeRoadmapProject("notes-app", LIST, [{ subject: "NOT-1: Sign in", at: T0 }], []);
}

const step = (id: string) => `document.querySelector('[data-station="${id}"]')?.dataset.state`;

/** Each live motion on the Roadmap view: the change to the repo or the tasks, and what shows once the page read it. */
export const ROADMAP_LIVE: Partial<Record<Motion, { change: () => void; after: string }>> = {
  "task-start": {
    change: () => {
      const tasks = [...SHOP_TASKS, { id: "WEB-5", title: "W4 Stock alerts by mail", status: "work" }];
      writeSpaceTasks("web-shop", tasks);
      recordSteps("web-shop", tasks);
    },
    after: `${step("W4")} === "work"`,
  },
  "task-finish": {
    change: () => {
      mergeStep("web-shop", "WEB-4: W3 Search that forgives typos", T0 + 7200);
      writeSpaceTasks("web-shop", [SHOP_TASKS[0]!, { ...SHOP_TASKS[1]!, status: "done", sub: "Merged" }]);
    },
    after: `${step("W3")} === "done"`,
  },
};

// Settings: the machines in <config>/machines.json, each reached over ui/test/fake-ssh, and a project's settings.

export function writeMachines(machines: { host: string; state: "installing" | "ready" | "failed"; doctor?: string[] }[]) {
  write(join(FIXTURE, "config", "machines.json"), { machines: machines.map((m) => ({ since: "2026-01-05T09:12:00.000Z", ...m })) });
}

export const sshLog = () => {
  try {
    return readFileSync(join(FIXTURE, "ssh.log"), "utf8");
  } catch {
    return "";
  }
};

export const MACHINES = [
  { host: "build-box", state: "ready" as const, doctor: ["ok     git", "All well."] },
  { host: "broken-box", state: "failed" as const, doctor: ["FAILED service: lineclear.service is not running"] },
];

const SHOP_MODELS = { worker: ["vendor-a/model-mid", "vendor-b/model-code"], reviewer: ["vendor-b/model-code"], planner: ["vendor-a/model-top"] };

export const shopSettings = () => JSON.parse(readFileSync(join(FIXTURE, "config", "projects", "web-shop", "settings.json"), "utf8"));

/** The files every live test of Settings starts from: two machines besides this one, and one project. */
export function startSettings() {
  startFixture();
  writeMachines(MACHINES);
  write(join(FIXTURE, "config", "projects", "web-shop", "settings.json"), {
    repo: "/nowhere/web-shop",
    space: "web-shop",
    check: "bun run check",
    models: SHOP_MODELS,
  });
}

const machine = (h: string) => `document.querySelector('[data-machines] > [data-key="${h}"]')`;

/** Each live motion on Settings: a machine added in the CLI. */
export const SETTINGS_LIVE: Partial<Record<Motion, { change: () => void; after: string }>> = {
  "machine-add": { change: () => writeMachines([...MACHINES, { host: "new-box", state: "ready" }]), after: `!!${machine("new-box")}` },
};

// Adding a project from Home: an empty config, a repo folder with a check script and a roadmap, and its space.

export const NEW_REPO = join(FIXTURE, "repos", "new-shop");

export function startEmpty() {
  clearFixture();
  rmSync(NEW_REPO, { recursive: true, force: true });
  mkdirSync(join(NEW_REPO, "docs"), { recursive: true });
  mkdirSync(join(NEW_REPO, ".git"));
  writeFileSync(join(NEW_REPO, "package.json"), JSON.stringify({ scripts: { check: "true" } }));
  writeFileSync(join(NEW_REPO, "bun.lock"), "");
  writeFileSync(join(NEW_REPO, "docs", "ROADMAP.md"), "# Roadmap\n");
  mkdirSync(join(FIXTURE, "lineclear"), { recursive: true });
  writeFileSync(join(FIXTURE, "lineclear", "space-list.txt"), `new-shop  ${NEW_REPO}\n`);
}

/** Merges a roadmap web-shop's check refuses, has the page read again, and waits until the server answers 422 for it. */
export async function breakRoadmap(page: Page, text: string) {
  writeFileSync(join(repoOf("web-shop"), "docs", "ROADMAP.md"), text);
  mergeStep("web-shop", "Roadmap: break it", 1_767_300_000);
  await page.waitForTimeout(1100);
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => (await page.request.get("/api/roadmap/web-shop")).status()).toBe(422);
}

/** The first run of the setup: no model chosen, and the models fake-pi lists as `provider model` lines. */
export function startSetup(models: string[]) {
  startSettings();
  rmSync(join(FIXTURE, "config", "setup.json"), { force: true });
  mkdirSync(join(FIXTURE, "pi"), { recursive: true });
  writeFileSync(join(FIXTURE, "pi", "models.txt"), `${models.join("\n")}\n`);
}
