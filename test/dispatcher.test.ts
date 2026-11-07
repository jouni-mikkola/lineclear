import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatcherDir, dispatcherMain, moveMain } from "../src/dispatcher.ts";
import { readItems } from "../src/inbox.ts";
import { inboxMain } from "../src/inbox-answer.ts";
import { planMain } from "../src/plan.ts";
import { status } from "../src/status.ts";
import { STATUS_MAX_CHARS } from "../src/status.ts";
import { writeWait } from "../src/waits.ts";

const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const step = (id: string, after = "none") => `### ${id} Title ${id}\n- why: because ${id}\n- done when:\n  - first ${id}\n- locks: none\n- after: ${after}\n`;
const git = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString();
};

function setup(projects = ["demo"], withRepos = true) {
  const dir = mkdtempSync(join(tmpdir(), "lc-disp-"));
  temps.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  writeFileSync(join(bin, "lineclear"), `#!/bin/sh\nfor a in "$@"; do printf '%s\\001' "$a"; done >> "${log}"; printf '\\002' >> "${log}"\n`);
  chmodSync(join(bin, "lineclear"), 0o755);
  const config = join(dir, "config");
  const env = { ...process.env, LINECLEAR_CONFIG: config, LINECLEAR_SERVER_BIN: join(bin, "lineclear"), LINECLEAR_HOME: join(dir, "sh") };
  const repos: Record<string, string> = {};
  for (const name of projects) {
    const repo = join(dir, name);
    mkdirSync(join(repo, "docs"), { recursive: true });
    if (withRepos) {
      writeFileSync(join(repo, "docs", "ROADMAP.md"), `# Roadmap\n\n## Phase 0\n\n${step("A")}\n${step("B")}\n${step("C", "A")}`);
      git(repo, "init", "-q", "-b", "main");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "start");
    }
    repos[name] = repo;
    mkdirSync(join(config, "projects", name), { recursive: true });
    writeFileSync(
      join(config, "projects", name, "settings.json"),
      JSON.stringify({ repo, space: name, check: "true", askBefore: { plans: true }, models: { worker: [], reviewer: [], planner: [] } }),
    );
  }
  const calls = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .split("\x02")
          .filter(Boolean)
          .map((c) => c.split("\x01").slice(0, -1))
      : [];
  const run = (f: (out: (l: string) => void) => number) => {
    const lines: string[] = [];
    const code = f((l) => lines.push(l));
    return { code, text: lines.join("\n") };
  };
  return { dir, env, repos, calls, run };
}

test("move sends a change to the Inbox and changes nothing until approved", () => {
  const t = setup();
  const before = readFileSync(join(t.repos.demo!, "docs", "ROADMAP.md"), "utf8");
  const r = t.run((o) => moveMain(["demo", "B", "--after", "A,C"], o, t.env));
  expect(r.code).toBe(0);
  expect(readFileSync(join(t.repos.demo!, "docs", "ROADMAP.md"), "utf8")).toBe(before);
  const [item] = readItems(t.env);
  expect(item!.move).toEqual({ step: "B", after: ["A", "C"] });
  expect(item!.diff).toContain("+ after: A, C");
  expect(t.calls().some((c) => c[0] === "alert")).toBe(false);
  expect(t.run((o) => moveMain(["demo", "B", "--after", "A"], o, t.env)).text).toContain("waits for the owner already");

  const ok = t.run((o) => inboxMain(["answer", "1", "Approve"], o, t.env));
  expect(ok.code).toBe(0);
  expect(readFileSync(join(t.repos.demo!, "docs", "ROADMAP.md"), "utf8")).toContain(
    "### B Title B\n- why: because B\n- done when:\n  - first B\n- locks: none\n- after: A, C\n",
  );
  expect(git(t.repos.demo!, "log", "-1", "--format=%s")).toBe("Lineclear: move B after A, C\n");
  expect(readItems(t.env)[0]!.answer).toBe("Approve");
});

test("a rejected move changes nothing, and bad moves are refused", () => {
  const t = setup();
  expect(t.run((o) => moveMain(["demo", "Z", "--after", "A"], o, t.env)).text).toContain("no step 'Z'");
  expect(t.run((o) => moveMain(["demo", "A", "--after", "C"], o, t.env)).text).toContain("circular");
  expect(t.run((o) => moveMain(["demo", "A", "--after", "Q"], o, t.env)).text).toContain("no step 'Q'");
  expect(t.run((o) => moveMain(["demo", "C", "--after", "A"], o, t.env)).text).toContain("already");
  expect(t.run((o) => moveMain(["demo"], o, t.env)).code).toBe(2);
  expect(t.run((o) => moveMain(["nope", "A", "--after", "B"], o, t.env)).code).toBe(1);
  expect(readItems(t.env)).toHaveLength(0);
  expect(t.run((o) => moveMain(["demo", "B", "--after", "A"], o, t.env)).code).toBe(0);
  const before = git(t.repos.demo!, "rev-parse", "HEAD");
  expect(t.run((o) => inboxMain(["answer", "1", "Reject"], o, t.env)).code).toBe(0);
  expect(git(t.repos.demo!, "rev-parse", "HEAD")).toBe(before);
  expect(readItems(t.env)[0]!.answer).toBe("Reject");
});

test("an approved move waits when the project is not on main or its roadmap is edited", () => {
  const t = setup();
  moveMain(["demo", "B", "--after", "A"], () => {}, t.env);
  writeFileSync(join(t.repos.demo!, "docs", "ROADMAP.md"), `${readFileSync(join(t.repos.demo!, "docs", "ROADMAP.md"), "utf8")}\n`);
  const r = t.run((o) => inboxMain(["answer", "1", "Approve"], o, t.env));
  expect(r.code).toBe(1);
  expect(r.text).toContain("uncommitted");
  expect(readItems(t.env)[0]!.answer).toBeUndefined();
});

test("setup makes a regular-mode space with pi, and plans go to the project's space, so no task event reaches it", () => {
  const t = setup();
  expect(t.run((o) => dispatcherMain(["setup"], o, t.env)).code).toBe(0);
  expect(readFileSync(join(dispatcherDir(t.env), "AGENTS.md"), "utf8")).toContain("lineclear status");
  expect(t.calls()).toEqual([
    ["space", "list"],
    ["space", "add", dispatcherDir(t.env), "--name", "dispatcher"],
    ["mode", "dispatcher", "regular"],
    ["set", "coordinator.agent", "pi", "--space", "dispatcher"],
  ]);
  // A plan started from the Dispatcher puts its task in the project's space.
  expect(planMain(["demo", "Ship it"], () => {}, t.env, dispatcherDir(t.env))).toBe(0);
  const add = t.calls().find((c) => c[0] === "task")!;
  expect(add[add.indexOf("--space") + 1]).toBe("demo");
  expect(t.run((o) => dispatcherMain([], o, t.env)).code).toBe(2);
});

test("status for many projects stays under 2000 tokens, and names the rest", () => {
  const names = Array.from({ length: 15 }, (_, i) => `project-number-${i}`);
  const t = setup(names, false);
  names.forEach((n, i) => {
    for (let k = 0; k < 4; k++)
      writeWait(
        {
          task: `T-${i}-${k}`,
          project: n,
          kind: "owner",
          reason: `asked: ${"a very long question that goes on and on ".repeat(8)}`,
          since: "2026-01-01T00:00:00Z",
        },
        t.env,
      );
  });
  const r = t.run((o) => status(o, t.env));
  expect(r.text.length).toBeLessThanOrEqual(STATUS_MAX_CHARS);
  expect(Math.ceil(r.text.length / 3)).toBeLessThan(2000);
  expect(r.text).toContain("more lines");
  expect(t.run((o) => status(o, t.env, "project-number-3")).text).toContain("T-3-0");
  expect(t.run((o) => status(o, t.env, "zzz")).code).toBe(1);
});

test("an approved move is pushed to the remote, and undone when the push fails", () => {
  const t = setup();
  const remote = join(t.dir, "remote.git");
  git(t.dir, "init", "-q", "--bare", "-b", "main", remote);
  git(t.repos.demo!, "remote", "add", "origin", remote);
  git(t.repos.demo!, "push", "-q", "origin", "main");
  moveMain(["demo", "B", "--after", "A"], () => {}, t.env);
  expect(t.run((o) => inboxMain(["answer", "1", "Approve"], o, t.env)).code).toBe(0);
  expect(git(remote, "log", "-1", "--format=%s", "main")).toBe("Lineclear: move B after A\n");
  moveMain(["demo", "C", "--after", "B"], () => {}, t.env);
  git(t.repos.demo!, "remote", "set-url", "origin", join(t.dir, "missing.git"));
  const head = git(t.repos.demo!, "rev-parse", "HEAD");
  const r = t.run((o) => inboxMain(["answer", "2", "Approve"], o, t.env));
  expect(r.code).toBe(1);
  expect(r.text).toContain("push failed");
  expect(git(t.repos.demo!, "rev-parse", "HEAD")).toBe(head);
  expect(readFileSync(join(t.repos.demo!, "docs", "ROADMAP.md"), "utf8")).toContain("- after: A\n");
});

test("nothing the rule loop or a project add does names the Dispatcher's space, so a task event never reaches it", async () => {
  const t = setup();
  dispatcherMain(["setup"], () => {}, t.env);
  const setupCalls = t.calls().length;
  const { project } = await import("../src/project-cli.ts");
  const lines: string[] = [];
  const code = await project(
    ["add", t.repos.demo!, "--name", "again", "--space", "dispatcher", "--check", "true", "--worker", "a/b", "--reviewer", "a/b", "--planner", "a/b"],
    null,
    (l) => lines.push(l),
    t.env,
  );
  expect(code).toBe(1);
  expect(lines.join("\n")).toContain("Dispatcher");
  writeWait({ task: "LIN-9", project: "demo", kind: "owner", reason: "asked: x", since: "2026-01-01T00:00:00Z" }, t.env);
  status(() => {}, t.env);
  // Only setup talks to Lineclear about the Dispatcher's space; an event in a project adds no call for it.
  expect(t.calls().slice(setupCalls).flat()).not.toContain("dispatcher");
  expect(
    t
      .calls()
      .slice(0, setupCalls)
      .filter((c) => c.includes("dispatcher"))
      .map((c) => c[0]),
  ).toEqual(["space", "mode", "set"]);
});

test("status names a task that waits for you, from the task list", () => {
  const t = setup();
  const bin = join(t.dir, "bin", "lineclear");
  writeFileSync(
    bin,
    `#!/bin/sh\necho '[{"id":"D-1","title":"One","status":"need","sub":"Pick A or B"},{"id":"D-2","title":"Two","status":"work","sub":"Working"}]'\n`,
  );
  const text = t.run((o) => status(o, t.env, "demo")).text;
  expect(text).toContain("D-1 waits for you: Pick A or B");
  expect(text).not.toContain("D-2");
});
