import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chatView } from "../src/chat.ts";
import { dispatcherMain, dispatcherPrompt } from "../src/dispatcher.ts";
import { addItem, readItems } from "../src/inbox.ts";
import { planMain } from "../src/plan.ts";
import { about, addedSteps, planStatus, readRequests } from "../src/requests.ts";
import { webApi } from "../src/web.ts";
import { type ChatMessage, chatClient, step } from "./chat-client.ts";
import { startFakeLineclear } from "../ui/test/fake-lineclear-server.ts";

// One request from a sentence in the web chat to steps on the roadmap. Two fake projects, a fake planner (it puts its
// plan in the Inbox as `lineclear plan submit` does) and a fake Lineclear. No model runs in a test, so a script plays
// the Dispatcher's model: it reads the real project list and picks by the words they share, the way its brief says.
// Every lineclear command it runs is the real one.
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const roadmap = (...steps: string[]) => `# Roadmap\n\n## Phase 0\n\n${steps.join("\n")}`;
const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdin: "ignore" });

function world() {
  const dir = mkdtempSync(join(tmpdir(), "lc-pick-"));
  dirs.push(dir);
  const config = join(dir, "config");
  const projects = {
    "budget-app": { idea: "# Budget app: the idea\n\n**Track household spending by month, with charts.**\n\nIt is for one family.\n" },
    recipes: { readme: "# Recipes\n\n![logo](logo.png)\n\nA recipe box for the family: meals and shopping lists.\n" },
  };
  for (const [name, p] of Object.entries(projects)) {
    const repo = join(dir, name);
    mkdirSync(join(repo, "docs"), { recursive: true });
    writeFileSync(join(repo, "docs", "ROADMAP.md"), roadmap(step("A1")));
    if ("idea" in p) writeFileSync(join(repo, "docs", "idea.md"), p.idea);
    if ("readme" in p) writeFileSync(join(repo, "README.md"), p.readme);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "start");
    mkdirSync(join(config, "projects", name), { recursive: true });
    writeFileSync(
      join(config, "projects", name, "settings.json"),
      JSON.stringify({ repo, space: name, check: "true", askBefore: { plans: true }, models: { worker: [], reviewer: [] } }),
    );
  }
  const bin = join(dir, "lineclear");
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  // a planning task gets the next id, as Lineclear's own answer says
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n` +
      `if [ "$1" = task ] && [ "$2" = add ]; then n=$(grep -c '^task add' "${log}"); echo "Added PLAN-$n: $3. Its agent (pi) starts on the brief now."; fi\n` +
      `if [ "$1" = task ] && [ "$2" = list ]; then echo '[]'; fi\n`,
  );
  chmodSync(bin, 0o755);
  const env = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_SERVER_BIN: bin, LINECLEAR_ROLE: "dispatcher" };
  return { dir, config, env, log, repo: (name: string) => join(dir, name) };
}

/** The Dispatcher's model, played by a script: picks from `lineclear dispatcher projects` as its brief says. */
function dispatcher(env: NodeJS.ProcessEnv) {
  const run = (f: (out: (l: string) => void) => number) => {
    const lines: string[] = [];
    f((l) => lines.push(l));
    return lines;
  };
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const plan = (project: string, goal: string) => {
    const said = run((o) => planMain([project, goal], o, env) as number);
    const live = said.find((l) => l.startsWith("live: "))!.slice(6);
    return `I picked **${project}**. I write the steps; they come back to you as one approval.\n\n[See the steps live](${live})`;
  };
  let asked = "";
  return (text: string, answer?: boolean) => {
    if (answer) return plan(text, asked);
    if (text.startsWith("where are we")) return run((o) => planStatus(o, env, text.split(" ").pop())).join("\n");
    const listing = run((o) => dispatcherMain(["projects"], o, env));
    const blocks: { name: string; words: Set<string> }[] = [];
    for (const l of listing) {
      if (!l.startsWith(" ")) blocks.push({ name: l.split(/\s+/)[0]!, words: new Set() });
      else for (const w of words(l)) blocks.at(-1)!.words.add(w);
    }
    const want = words(text);
    const scored = blocks.map((b) => ({ name: b.name, score: [...want].filter((w) => b.words.has(w) || b.name.includes(w)).length }));
    const best = Math.max(...scored.map((s) => s.score));
    const fit = scored.filter((s) => s.score === best && best > 0);
    if (fit.length === 0) return `No project fits that. The projects are ${blocks.map((b) => b.name).join(" and ")}.`;
    if (fit.length > 1) {
      asked = text;
      return { question: { title: "Which project is this for?", choices: fit.map((f) => f.name) } };
    }
    return plan(fit[0]!.name, text);
  };
}

/** The planner, faked: it sends a plan that adds `ids` to the Inbox, as `lineclear plan submit` does. */
const planned = (env: NodeJS.ProcessEnv, task: string, project: string, ids: string[], round = 1) =>
  addItem(
    {
      kind: "plan",
      task,
      project,
      question: `Approve this roadmap change for ${project}?`,
      choices: ["Approve", "Reject"],
      diff: ids.map((id) => `+### ${id} Title ${id}\n+- after: A1`).join("\n"),
      round,
      since: new Date().toISOString(),
    },
    env,
  );

async function chatWith(w: ReturnType<typeof world>) {
  const fake = startFakeLineclear({ reply: dispatcher(w.env) });
  const handle = webApi({
    ...w.env,
    LINECLEAR_HOME: join(w.dir, "sh"),
    HOME: w.dir,
    LINECLEAR_PLAYWRIGHT_CLI: "true",
    LINECLEAR_URL: fake.url,
  });
  const { req, view, send } = chatClient(handle);
  await view((v) => v.state === "ready");
  const last = async (n: number) => (await view((v) => v.messages.length === n && !v.writing)).messages[n - 1] as ChatMessage;
  const ask = async (text: string, n: number) => {
    await send(text);
    return last(n);
  };
  const get = async (path: string) => (await handle(req(path))).json() as Promise<any>;
  const post = async (path: string, body: unknown) => {
    const r = await handle(req(path, body));
    return { status: r.status, body: (await r.json()) as any };
  };
  return { fake, ask, last, get, post };
}

test("the brief names the pick, the plan, the live link and the plan's status", () => {
  const p = dispatcherPrompt();
  for (const c of ["lineclear dispatcher projects", "lineclear card", "lineclear plan", "lineclear status --plan", "roadmap/track?plan="])
    expect(p).toContain(c);
  expect(p).toMatch(/Never guess silently/);
  expect(p).not.toMatch(/\b(boss|manager|orchestra)\b/i);
});

test("the project list gives each project's name, repo and first lines, with no headings or pictures", () => {
  const w = world();
  const lines: string[] = [];
  expect(dispatcherMain(["projects"], (l) => lines.push(l), w.env)).toBe(0);
  expect(lines).toEqual([
    `budget-app  ${w.repo("budget-app")}`,
    "  Track household spending by month, with charts.",
    "  It is for one family.",
    `recipes  ${w.repo("recipes")}`,
    "  A recipe box for the family: meals and shopping lists.",
  ]);
  expect(about(join(w.dir, "nothing"))).toEqual([]);
  expect(addedSteps("+### B1 One\n ### A1 Old\n-### A2 Gone\n+### B2 Two")).toEqual(["B1", "B2"]);
  // a renamed step is not a new one
  expect(addedSteps("-### A1 Old\n+### A1 New\n+### B1 One")).toEqual(["B1"]);
});

test("the lineclear command itself prints the project list the Dispatcher picks from", () => {
  const w = world();
  const r = Bun.spawnSync(["bun", "bin/lineclear", "dispatcher", "projects"], {
    env: { ...w.env, LINECLEAR_HOME: join(w.dir, "home"), LINECLEAR_PORT: "0" },
    stdin: "ignore",
  });
  const text = r.stdout.toString();
  expect(r.exitCode).toBe(0);
  expect(text).toContain(`budget-app  ${w.repo("budget-app")}`);
  expect(text).toContain("  A recipe box for the family: meals and shopping lists.");
});

test("a clear pick plans in that project; the plan comes back as one approval in the chat and the Inbox; approving puts its steps in the roadmap", async () => {
  const w = world();
  const c = await chatWith(w);
  try {
    const answer = await c.ask("Add CSV export to the budget app", 2);
    expect(answer.text).toContain("I picked **budget-app**");
    expect(answer.text).toContain("[See the steps live](/budget-app/roadmap/track?plan=PLAN-1)");
    expect(readFileSync(w.log, "utf8")).not.toContain("task add");
    expect(readRequests(w.env)).toMatchObject([{ task: "PLAN-1", project: "budget-app", goal: "Add CSV export to the budget app", by: "dispatcher" }]);
    expect((await c.get("/api/plans"))[0]).toMatchObject({ task: "PLAN-1", state: "planning", steps: [], live: "/budget-app/roadmap/track?plan=PLAN-1" });

    // the planner sends its steps: the chat's card is the Inbox's item
    const item = planned(w.env, "PLAN-1", "budget-app", ["B1", "B2"]);
    const [plan] = await c.get("/api/plans");
    expect(plan).toMatchObject({ state: "approve", steps: ["B1", "B2"], item: { id: String(item.n), choices: ["Approve", "Reject"] } });
    expect((await c.get("/api/inbox")).map((i: any) => i.id)).toEqual([String(item.n)]);

    // approving merges the plan's branch `plan/PLAN-1`; the Dispatcher merged nothing itself
    const repo = w.repo("budget-app");
    git(repo, "branch", "plan/PLAN-1");
    git(repo, "worktree", "add", "-q", join(w.dir, "plan-1"), "plan/PLAN-1");
    writeFileSync(join(w.dir, "plan-1", "plan-note.txt"), "B1, B2\n");
    git(join(w.dir, "plan-1"), "add", ".");
    git(join(w.dir, "plan-1"), "commit", "-q", "-m", "plan B1 and B2");
    expect(git(repo, "log", "--format=%s", "main").stdout.toString()).not.toContain("PLAN-1: roadmap plan");
    expect((await c.post(`/api/inbox/${plan.item.id}`, { choice: "Approve" })).status).toBe(200);
    expect(git(repo, "log", "--format=%s", "main").stdout.toString()).toContain("PLAN-1: roadmap plan");
    expect((await c.get("/api/plans"))[0]).toMatchObject({ state: "approved", answer: "Approve" });
    expect(await c.get("/api/inbox")).toEqual([]);

    // the merged plan is on main; "where are we?" answers for exactly those steps
    writeFileSync(join(w.repo("budget-app"), "docs", "ROADMAP.md"), roadmap(step("A1"), step("B1", "A1"), step("B2", "B1"), step("C9")));
    git(w.repo("budget-app"), "commit", "-qam", "PLAN-1: plan");
    git(w.repo("budget-app"), "commit", "-q", "--allow-empty", "-m", "BUD-4: A1");
    git(w.repo("budget-app"), "commit", "-q", "--allow-empty", "-m", "BUD-5: B1");
    const status = (await c.ask("where are we on PLAN-1", 4)).text as string;
    expect(status).toContain(
      'PLAN-1  budget-app  "Add CSV export to the budget app": approved, the steps are in the roadmap. Live: /budget-app/roadmap/track?plan=PLAN-1',
    );
    expect(status).toContain("B1 Title B1  merged");
    expect(status).toContain("B2 Title B2  ready to start");
    expect(status).not.toContain("C9");
  } finally {
    c.fake.stop();
  }
});

test("when two projects fit, the Dispatcher asks with the projects as buttons, and plans in the one you tap", async () => {
  const w = world();
  const c = await chatWith(w);
  try {
    const card = await c.ask("Plan a shopping list from the monthly spending", 2);
    expect(card).toMatchObject({ text: "Which project is this for?", question: { choices: ["budget-app", "recipes"] } });
    expect(readFileSync(w.log, "utf8")).not.toContain("task add");
    expect((await c.post("/api/chat/answer", { question: card.question.id, choice: 1 })).status).toBe(200);
    const answer = await c.last(3);
    expect(answer.text).toContain("I picked **recipes**");
    expect((await c.get("/api/chat")).messages[1].question.sent).toBe(1);
    expect(readRequests(w.env)).toMatchObject([{ project: "recipes", goal: "Plan a shopping list from the monthly spending" }]);
    // a card takes one answer
    expect((await c.post("/api/chat/answer", { question: card.question.id, choice: 0 })).status).toBe(502);
    expect((await c.post("/api/chat/answer", { question: card.question.id, choice: -1 })).status).toBe(400);
  } finally {
    c.fake.stop();
  }
});

test("when no project fits, the Dispatcher says so and starts nothing; a plan for an unknown project is refused", async () => {
  const w = world();
  const c = await chatWith(w);
  try {
    expect((await c.ask("Fix the login of the photo gallery", 2)).text).toBe("No project fits that. The projects are budget-app and recipes.");
    expect(readFileSync(w.log, "utf8").trim()).toBe("");
    const lines: string[] = [];
    expect(planMain(["gallery", "Fix the login"], (l) => lines.push(l), w.env)).toBe(1);
    expect(lines).toEqual(["lineclear plan: no project 'gallery', nearest: 'recipes' and 'budget-app'"]);
    expect(readRequests(w.env)).toEqual([]);
  } finally {
    c.fake.stop();
  }
});

test("rejecting a plan sends it back once with your note, and a second rejection ends it; the roadmap stays", async () => {
  const w = world();
  const c = await chatWith(w);
  try {
    await c.ask("Add CSV export to the budget app", 2);
    const first = planned(w.env, "PLAN-1", "budget-app", ["B1"]);
    expect((await c.post(`/api/inbox/${first.n}`, { choice: "Reject" })).status).toBe(400);
    expect((await c.post(`/api/inbox/${first.n}`, { choice: "Reject", note: "One step is enough" })).status).toBe(200);
    // the Dispatcher wrote the plan and has no task to tell
    expect(readFileSync(w.log, "utf8")).not.toContain("task tell");
    expect((await c.get("/api/plans"))[0]).toMatchObject({ state: "planning", answer: "Reject" });

    const second = planned(w.env, "PLAN-1", "budget-app", ["B1"], 2);
    expect((await c.get("/api/plans"))[0]).toMatchObject({ state: "approve", item: { id: String(second.n) } });
    expect((await c.post(`/api/inbox/${second.n}`, { choice: "Reject" })).status).toBe(200);
    expect(readFileSync(w.log, "utf8")).not.toContain("task close");
    expect((await c.get("/api/plans"))[0]).toMatchObject({ state: "rejected" });
    expect(readFileSync(w.log, "utf8")).not.toMatch(/^merge /m);
    expect(readFileSync(join(w.repo("budget-app"), "docs", "ROADMAP.md"), "utf8")).toBe(roadmap(step("A1")));
    const lines: string[] = [];
    expect(planStatus((l) => lines.push(l), w.env, "PLAN-1")).toBe(0);
    expect(lines[0]).toContain(": rejected.");
    expect(planStatus(() => {}, w.env, "PLAN-9")).toBe(1);
    expect(readItems(w.env).filter((i) => i.answer === "Reject")).toHaveLength(2);
  } finally {
    c.fake.stop();
  }
});

test("a plan started outside the Dispatcher is kept too, but not as the Dispatcher's, and its goal goes to the chat", async () => {
  const w = world();
  const { LINECLEAR_ROLE: _, ...env } = w.env;
  const lines: string[] = [];
  const sent: string[] = [];
  const send = async (text: string) => void sent.push(text);
  expect(await planMain(["recipes", "Add a weekly menu"], (l) => lines.push(l), env, "/tmp", undefined, send)).toBe(0);
  expect(sent[0]).toContain("Goal: Add a weekly menu");
  expect(lines).toContain("live: /recipes/roadmap/track?plan=PLAN-1");
  expect(readRequests(env)).toMatchObject([{ task: "PLAN-1", by: "cli" }]);
});

test("a card one tap cannot answer stays in words, and one answered without a pick shows as answered", () => {
  const card = (q: object) =>
    chatView({ messages: [{ id: "m", who: "agent", at: 1, question: { id: "q", title: "Which?", choices: [{ label: "a" }, { label: "b" }], ...q } }] })
      .messages[0]!.question;
  expect(card({})).toEqual({ id: "q", choices: ["a", "b"] });
  expect(card({ sent: 1 })).toEqual({ id: "q", choices: ["a", "b"], sent: 1 });
  expect(card({ sent: -1 })).toEqual({ id: "q", choices: ["a", "b"], said: "" });
  expect(card({ sent: -1, said: "both" })).toEqual({ id: "q", choices: ["a", "b"], said: "both" });
  for (const q of [{ multi: true }, { other: true }, { noteRequiredFor: 1 }]) expect(card(q)?.words).toBe(true);
});
