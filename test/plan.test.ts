import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inboxMain } from "../src/inbox-answer.ts";
import { readItems } from "../src/inbox.ts";
import { planMain } from "../src/plan.ts";
import { ANSWER_MAX_TOKENS, INPUT_MAX_TOKENS } from "../src/ask-model.ts";
import { tokensOf } from "../src/stepcheck.ts";

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const step = (id: string) =>
  `### ${id} Title ${id}\n- result: Title ${id} works.\n- why: because ${id}\n- done when:\n  - first ${id}\n- locks: none\n- after: none\n- files: src/${id}.ts\n`;

/** A project repo with a roadmap, a planning worktree, and a fake lineclear that logs its calls. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "lc-plan-"));
  temps.push(dir);
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "ROADMAP.md"), `# Roadmap\n\n## Phase 0\n\n${step("A")}`);
  const git = (cwd: string, ...a: string[]) => {
    const p = Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  };
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "start");
  const work = join(dir, "work");
  git(repo, "worktree", "add", "-q", "-b", "work/5-plan", work);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  writeFileSync(join(bin, "lineclear"), `#!/bin/sh\nfor a in "$@"; do printf '%s\\001' "$a"; done >> "${log}"; printf '\\002' >> "${log}"\n`);
  chmodSync(join(bin, "lineclear"), 0o755);
  const config = join(dir, "config");
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  writeFileSync(
    join(config, "projects", "demo", "settings.json"),
    JSON.stringify({
      repo,
      space: "demo",
      check: "true",
      askBefore: { plans: true },
      models: { worker: [], reviewer: ["anthropic/claude-sonnet-5-5", "opencode-go/glm-5.3"], planner: ["anthropic/claude-opus-5-5"] },
    }),
  );
  // the fake checking model: logs each question and the model asked, and answers with the contents of `answer`
  const answer = join(dir, "answer");
  const asked = join(dir, "asked.log");
  writeFileSync(answer, "SAID: B does one thing.\nGO");
  writeFileSync(join(bin, "model"), `#!/bin/sh\n{ cat; printf '\\001'; echo "$LINECLEAR_STEPCHECK_MODEL"; printf '\\002'; } >> "${asked}"\ncat "${answer}"\n`);
  chmodSync(join(bin, "model"), 0o755);
  const env = {
    ...process.env,
    LINECLEAR_CONFIG: config,
    LINECLEAR_SERVER_BIN: join(bin, "lineclear"),
    LINECLEAR_TASK: "LIN-5",
    LINECLEAR_STEPCHECK: join(bin, "model"),
  };
  const says = (text: string) => writeFileSync(answer, text);
  const questions = () =>
    existsSync(asked)
      ? readFileSync(asked, "utf8")
          .split("\x02")
          .filter(Boolean)
          .map((q) => q.split("\x01"))
      : [];
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\x02")
          .filter(Boolean)
          .map((c) => c.split("\x01").slice(0, -1))
      : [];
  const plan = (args: string[]) => {
    const lines: string[] = [];
    const code = planMain(args, (l) => lines.push(l), env, work);
    return { code, text: lines.join("\n") };
  };
  const inbox = (args: string[]) => {
    const lines: string[] = [];
    const code = inboxMain(args, (l) => lines.push(l), env);
    return { code, text: lines.join("\n") };
  };
  /** The fake planner: adds a step to the roadmap and commits it. */
  const edit = (id: string) => {
    const f = join(work, "docs", "ROADMAP.md");
    writeFileSync(f, `${readFileSync(f, "utf8")}\n${step(id)}`);
    git(work, "commit", "-q", "-am", `plan ${id}`);
  };
  return { work, env, calls, plan, inbox, edit, says, questions };
}

test("plan starts a task with the brief from the template", () => {
  const t = setup();
  expect(t.plan(["demo", "Ship the thing"]).code).toBe(0);
  const [add] = t.calls();
  expect(add!.slice(0, 4)).toEqual(["task", "add", "Plan: Ship the thing", "--brief"]);
  expect(add![4]).toContain("Goal: Ship the thing");
  expect(add![4]).toContain("lineclear plan submit");
  const template = readFileSync(join(import.meta.dir, "..", "templates", "plan.md"), "utf8");
  expect(add![4]).toContain(template.split("{{")[0]!.trim());
  expect(add).toContain("--space");
  expect(t.plan(["nope", "x"]).code).toBe(1);
  expect(t.plan(["demo"]).code).toBe(2);
});

test("submit refuses a roadmap that fails the check or has no change", () => {
  const t = setup();
  expect(t.plan(["submit"]).text).toContain("no change from main");
  writeFileSync(join(t.work, "docs", "ROADMAP.md"), `${step("A")}- bogus: x\n`);
  Bun.spawnSync(["git", "-C", t.work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "bad"]);
  const r = t.plan(["submit"]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("does not pass the check");
  expect(readItems(t.env)).toHaveLength(0);
});

test("submit sends an incomplete step back to the planner, logs it and adds nothing to the Inbox", () => {
  const t = setup();
  const f = join(t.work, "docs", "ROADMAP.md");
  writeFileSync(f, `${readFileSync(f, "utf8")}\n### B Title B\n- why: because\n- locks: none\n- after: Z9\n`);
  Bun.spawnSync(["git", "-C", t.work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "thin"]);
  const r = t.plan(["submit"]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("step B needs a done when with at least one item; known ids in after (unknown: Z9); a files line");
  expect(readItems(t.env)).toHaveLength(0);
  expect(readFileSync(join(String(t.env.LINECLEAR_CONFIG), "decisions.jsonl"), "utf8")).toContain("step B needs");
});

test("approving a plan merges it", () => {
  const t = setup();
  t.edit("B");
  expect(t.plan(["submit"]).code).toBe(0);
  const [item] = readItems(t.env);
  expect(item).toMatchObject({ kind: "plan", task: "LIN-5", project: "demo", round: 1, choices: ["Approve", "Reject"] });
  expect(item!.diff).toContain("+### B Title B");
  expect(t.inbox([]).text).toContain("+### B Title B");
  expect(t.inbox(["answer", "1", "Approve"]).code).toBe(0);
  expect(t.calls().at(-1)).toEqual(["merge", "LIN-5"]);
  expect(readItems(t.env)[0]!.answer).toBe("Approve");
});

test("rejecting with a note sends it back once; a second rejection closes the task", () => {
  const t = setup();
  t.edit("B");
  t.plan(["submit"]);
  expect(t.inbox(["answer", "1", "Reject"]).code).toBe(2); // a note is needed
  expect(t.inbox(["answer", "1", "Reject", "--note", "split B in two"]).code).toBe(0);
  const tell = t.calls().at(-1)!;
  expect(tell.slice(0, 3)).toEqual(["task", "tell", "LIN-5"]);
  expect(tell[3]).toContain("split B in two");
  expect(readItems(t.env)[0]).toMatchObject({ answer: "Reject", note: "split B in two" });

  t.edit("C");
  expect(t.plan(["submit"]).code).toBe(0);
  expect(readItems(t.env)[1]).toMatchObject({ round: 2 });
  expect(t.inbox(["answer", "2", "Reject"]).code).toBe(0);
  expect(t.calls().at(-1)).toEqual(["task", "close", "LIN-5"]);
  t.edit("D");
  expect(t.plan(["submit"]).code).toBe(1); // no third try
});

test("a plan with other files, a second pending plan, or a moved branch is refused", () => {
  const t = setup();
  writeFileSync(join(t.work, "other.txt"), "x");
  Bun.spawnSync(["git", "-C", t.work, "add", "-A"]);
  Bun.spawnSync(["git", "-C", t.work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "other"]);
  t.edit("B");
  expect(t.plan(["submit"]).text).toContain("docs/ROADMAP.md only");
  Bun.spawnSync(["git", "-C", t.work, "rm", "-q", "other.txt"]);
  Bun.spawnSync(["git", "-C", t.work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "undo"]);
  expect(t.plan(["submit"]).code).toBe(0);
  expect(t.plan(["submit"]).text).toContain("waits for the owner already");
  t.edit("C"); // a commit after submit
  const r = t.inbox(["answer", "1", "Approve"]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("branch changed");
  expect(t.calls().some((c) => c[0] === "merge")).toBe(false);
});

test("submit sends back a new step with no result or a long title, and names each fault", () => {
  const t = setup();
  const f = join(t.work, "docs", "ROADMAP.md");
  const commit = () => Bun.spawnSync(["git", "-C", t.work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "bad"]);
  writeFileSync(f, `${readFileSync(f, "utf8")}\n${step("B").replace("- result: Title B works.\n", "")}`);
  commit();
  let r = t.plan(["submit"]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("step B has no 'result' line");
  writeFileSync(
    f,
    readFileSync(f, "utf8")
      .replace("### B Title B", "### B A title that is far too long to fit a card")
      .replace("- why: because B", "- result: Title B works.\n- why: because B"),
  );
  commit();
  r = t.plan(["submit"]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("title of 42 characters");
  expect(readItems(t.env)).toHaveLength(0);
});

const commit = (work: string, msg: string) => Bun.spawnSync(["git", "-C", work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", msg]);

test("a go keeps the answer with its model and tokens and sends it with the Inbox item", () => {
  const t = setup();
  t.edit("B");
  expect(t.plan(["submit"]).code).toBe(0);
  const asked = t.questions();
  expect(asked).toHaveLength(1);
  const [question = "", model = ""] = asked[0] ?? [];
  expect(question).toContain("### B Title B");
  expect(question).not.toContain("### A Title A");
  expect(question).toContain("Tracked files:\ndocs/ROADMAP.md");
  expect(model.trim()).toBe("opencode-go/glm-5.3");
  const checks = readItems(t.env)[0]?.checks ?? [];
  expect(checks).toHaveLength(1);
  expect(checks[0]).toMatchObject({ step: "B", go: true, model: "opencode-go/glm-5.3", said: "B does one thing." });
  expect(checks[0]?.tokensIn).toBeGreaterThan(0);
  const kept = JSON.parse(readFileSync(join(String(t.env.LINECLEAR_CONFIG), "plan-checks", "LIN-5.json"), "utf8"));
  expect(kept.answers[0]).toMatchObject({ step: "B", go: true });
});

test("a no-go goes back to the planner, and the fixed step is asked again and passes", () => {
  const t = setup();
  t.says("SAID: B does something.\nNO-GO: it never says where the page is");
  t.edit("B");
  const r = t.plan(["submit"]);
  expect(r.code).toBe(1);
  expect(r.text).toContain("step B");
  expect(r.text).toContain("never says where the page is");
  expect(readItems(t.env)).toHaveLength(0);
  t.says("SAID: B adds a page.\nGO");
  const f = join(t.work, "docs", "ROADMAP.md");
  writeFileSync(f, readFileSync(f, "utf8").replace("because B", "because B needs a page"));
  commit(t.work, "fix");
  expect(t.plan(["submit"]).code).toBe(0);
  expect(t.questions()).toHaveLength(2);
  expect(readItems(t.env)[0]?.checks?.map((c) => c.round)).toEqual([2]);
});

test("3 rounds with a no-go end the task with a report and no Inbox item", () => {
  const t = setup();
  t.says("SAID: unclear\nNO-GO: the done when cannot be checked");
  t.edit("B");
  expect(t.plan(["submit"]).code).toBe(1);
  t.edit("C");
  expect(t.plan(["submit"]).code).toBe(1);
  t.edit("D");
  const last = t.plan(["submit"]);
  expect(last.code).toBe(0);
  expect(last.text).toContain("report:");
  expect(last.text).toContain("step B");
  expect(last.text).toContain("the done when cannot be checked");
  expect(t.calls().at(-1)).toEqual(["task", "close", "LIN-5"]);
  expect(readItems(t.env)).toHaveLength(0);
});

test("a planner and a checker from the same company are not refused when no other company has room", () => {
  const t = setup();
  const file = join(String(t.env.LINECLEAR_CONFIG), "projects", "demo", "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  settings.models.reviewer = ["claude-bridge-b/claude-sonnet-5-5"];
  writeFileSync(file, JSON.stringify(settings));
  t.edit("B");
  const r = t.plan(["submit"]);
  expect(r.code).toBe(0);
  expect(readItems(t.env)[0]?.checks?.[0]?.model).toBe("claude-bridge-b/claude-sonnet-5-5");
});

test("a step check that cannot run records a command-failed stall for the task", () => {
  const t = setup();
  const file = join(String(t.env.LINECLEAR_CONFIG), "projects", "demo", "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  settings.models.reviewer = [];
  writeFileSync(file, JSON.stringify(settings));
  t.edit("B");
  expect(t.plan(["submit"]).code).toBe(1);
  const last = JSON.parse(
    readFileSync(join(String(t.env.LINECLEAR_CONFIG), "decisions.jsonl"), "utf8")
      .trim()
      .split("\n")
      .at(-1) ?? "",
  );
  expect(last).toMatchObject({ kind: "stall", event: "stall", class: "command-failed", step: "LIN-5" });
});

test("a long answer is kept cut to the answer size", () => {
  const t = setup();
  t.says(`SAID: ${"x".repeat(20000)}\nGO`);
  t.edit("B");
  expect(t.plan(["submit"]).code).toBe(0);
  const check = readItems(t.env)[0]?.checks?.[0];
  expect(check?.tokensOut).toBeLessThanOrEqual(ANSWER_MAX_TOKENS);
  expect(tokensOf(check?.said ?? "")).toBeLessThanOrEqual(ANSWER_MAX_TOKENS);
  expect(check?.tokensIn).toBeLessThanOrEqual(INPUT_MAX_TOKENS);
});

test("the plan template says a fresh model reads each step cold and a no-go is fixed before the owner sees anything", () => {
  const text = readFileSync(join(import.meta.dir, "..", "templates", "plan.md"), "utf8");
  expect(text).toContain("fresh model that knows only the step and the repo's map");
  expect(text).toContain("A no-go comes back to you as a message");
  expect(text).toContain("before anything reaches the owner");
});

/** A fake server in its own process (planMain blocks this one): it logs each call it gets, as the server's command sends them. */
function fakeServer(dir: string, port: number) {
  const log = join(dir, "server.log");
  const code = `Bun.serve({ port: ${port}, hostname: "127.0.0.1", async fetch(r) { require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify((await r.json()).args) + "\\n"); return Response.json({ out: "[]", code: 0 }); } });`;
  return { child: Bun.spawn([process.execPath, "-e", code], { stdout: "ignore", stderr: "ignore" }), log };
}

/** The real server command (not a fake) reading only its own data folder. */
function serverEnv(home: string, base: Record<string, string | undefined>) {
  const { LINECLEAR_URL, LINECLEAR_PORT, LINECLEAR_TASK, LINECLEAR_CHAT, ...rest } = base;
  const bin = join(home, "lineclear");
  writeFileSync(bin, `#!/bin/sh\nexec perl ${join(import.meta.dir, "..", "server", "helper", "lineclear")} "$@"\n`);
  chmodSync(bin, 0o755);
  return { ...rest, LINECLEAR_HOME: home, LINECLEAR_SERVER_BIN: bin };
}

test("plan submit finds the running server in the data folder with no flag", async () => {
  const s = setup();
  const home = mkdtempSync(join(tmpdir(), "lc-plan-home-"));
  temps.push(home);
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = Number(probe.port);
  probe.stop(true);
  writeFileSync(join(home, "server.json"), JSON.stringify({ port, pid: process.pid }));
  const { child, log } = fakeServer(home, port);
  try {
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(`http://127.0.0.1:${port}`, { method: "POST", body: '{"args":["ping"]}' }).then(
          () => true,
          () => false,
        )
      )
        break;
      await Bun.sleep(50);
    }
    const lines: string[] = [];
    planMain(["submit"], (l) => lines.push(l), serverEnv(home, s.env), s.work);
    expect(readFileSync(log, "utf8")).toContain('["task","list","--json"]');
    expect(lines.join("\n")).not.toContain("no Lineclear server");
  } finally {
    child.kill();
  }
});

test("plan with no server running says so in one line and names the command that starts it", () => {
  const s = setup();
  const home = mkdtempSync(join(tmpdir(), "lc-plan-home-"));
  temps.push(home);
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = Number(probe.port);
  probe.stop(true);
  writeFileSync(join(home, "server.json"), JSON.stringify({ port, pid: 1 }));
  const env = { ...serverEnv(home, s.env), LINECLEAR_TASK: "LIN-5" };
  for (const args of [["submit"], ["demo", "a goal"]]) {
    const lines: string[] = [];
    expect(planMain(args, (l) => lines.push(l), env, s.work)).toBe(1);
    expect(lines).toEqual(["lineclear plan: no Lineclear server is running here; start it with: lineclear serve"]);
  }
});

/** A free port, found by binding and releasing one. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = Number(probe.port);
  probe.stop(true);
  return port;
}

async function listening(port: number) {
  for (let i = 0; i < 100; i++) {
    const up = await fetch(`http://127.0.0.1:${port}`, { method: "POST", body: '{"args":["ping"]}' }).then(
      () => true,
      () => false,
    );
    if (up) return;
    await Bun.sleep(50);
  }
}

test("plan takes the server from the flag, then the environment, then the data folder's record", async () => {
  const s = setup();
  const home = mkdtempSync(join(tmpdir(), "lc-plan-home-"));
  temps.push(home);
  const places = ["flag", "env", "record"].map((name) => ({ name, port: freePort() }));
  const [flagPort, envPort, recordPort] = places.map((p) => p.port);
  // one log file per fake server: tell them apart by their own port's log
  const logs = places.map((p) => {
    const dir = mkdtempSync(join(tmpdir(), `lc-plan-${p.name}-`));
    temps.push(dir);
    return fakeServer(dir, p.port);
  });
  try {
    await Promise.all(places.map((p) => listening(p.port)));
    writeFileSync(join(home, "server.json"), JSON.stringify({ port: recordPort, pid: process.pid }));
    const base = serverEnv(home, s.env);
    const asked = (i: number) => existsSync(logs[i]?.log ?? "") && readFileSync(logs[i]?.log ?? "", "utf8").includes("task");
    planMain(["--url", `http://127.0.0.1:${flagPort}`, "submit"], () => {}, { ...base, LINECLEAR_URL: `http://127.0.0.1:${envPort}` }, s.work);
    expect([asked(0), asked(1), asked(2)]).toEqual([true, false, false]);
    planMain(["submit"], () => {}, { ...base, LINECLEAR_URL: `http://127.0.0.1:${envPort}` }, s.work);
    expect([asked(1), asked(2)]).toEqual([true, false]);
    planMain(["submit"], () => {}, base, s.work);
    expect(asked(2)).toBe(true);
  } finally {
    logs.forEach((x) => x.child.kill());
  }
});

test('plan <project> "<goal>" starts its task on the server the data folder records, with no flag', async () => {
  const s = setup();
  const home = mkdtempSync(join(tmpdir(), "lc-plan-home-"));
  temps.push(home);
  const port = freePort();
  writeFileSync(join(home, "server.json"), JSON.stringify({ port, pid: process.pid }));
  const { child, log } = fakeServer(home, port);
  try {
    await listening(port);
    const lines: string[] = [];
    expect(planMain(["demo", "Add a thing"], (l) => lines.push(l), serverEnv(home, s.env), s.work)).toBe(0);
    expect(readFileSync(log, "utf8")).toContain('"task","add"');
    expect(lines.join("\n")).not.toContain("no Lineclear server");
  } finally {
    child.kill();
  }
});

test("plan takes the port in LINECLEAR_PORT over the data folder's record", async () => {
  const s = setup();
  const home = mkdtempSync(join(tmpdir(), "lc-plan-home-"));
  temps.push(home);
  const [envPort, recordPort] = [freePort(), freePort()];
  writeFileSync(join(home, "server.json"), JSON.stringify({ port: recordPort, pid: process.pid }));
  const { child, log } = fakeServer(home, envPort);
  try {
    await listening(envPort);
    const env = { ...serverEnv(home, s.env), LINECLEAR_PORT: String(envPort) };
    expect(planMain(["demo", "Add a thing"], () => {}, env, s.work)).toBe(0);
    expect(readFileSync(log, "utf8")).toContain('"task","add"');
  } finally {
    child.kill();
  }
});
