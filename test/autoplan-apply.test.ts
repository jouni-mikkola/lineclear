import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPlan, undoApplied } from "../src/plan-apply.ts";
import { readAllItems as readItems } from "../src/inbox.ts";

// An applied change on a temp git repo: merged by a fake server, then undone with a revert.
const temps: string[] = [];
afterAll(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const step = (id: string, after: string) =>
  `### ${id} Title ${id}\n- result: Title ${id} works.\n- why: because\n- done when:\n  - it works\n- locks: repo\n- after: ${after}\n`;
const doc = (...steps: string[]) => `# Roadmap\n\n## Phase 0: Base\n\n${steps.join("\n")}`;
const start = doc(step("A1", "none"), step("U43", "A1"));

function world(askPlans: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "lc-autoplan-"));
  temps.push(dir);
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  const g = (...a: string[]) => {
    const p = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
    if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    return p.stdout.toString().trim();
  };
  g("init", "-q", "-b", "main");
  writeFileSync(join(repo, "docs", "ROADMAP.md"), start);
  g("add", "-A");
  g("commit", "-q", "-m", "start");
  g("checkout", "-q", "-b", "work/7-plan");
  writeFileSync(join(repo, "docs", "ROADMAP.md"), doc(step("A1", "none"), step("B1", "A1"), step("U43", "A1")));
  g("commit", "-qam", "plan: add B1");
  g("checkout", "-q", "main");
  const bin = join(dir, "fake-server");
  writeFileSync(bin, `#!/bin/sh\nexec git -C ${repo} -c user.name=t -c user.email=t@t merge --no-ff -q -m "Merge LIN-7" work/7-plan\n`);
  chmodSync(bin, 0o755);
  const cfg = join(dir, "config");
  mkdirSync(join(cfg, "projects", "demo"), { recursive: true });
  const settings = join(cfg, "projects", "demo", "settings.json");
  const write = (plans: boolean) =>
    writeFileSync(
      settings,
      JSON.stringify({
        repo,
        space: "s",
        check: "true",
        heavy: [],
        models: { worker: [], reviewer: [] },
        askBefore: { plans, releases: true, spending: true },
      }),
    );
  write(askPlans);
  const vars = { ...process.env, LINECLEAR_CONFIG: cfg, LINECLEAR_SERVER_BIN: bin, LINECLEAR_READINESS: "echo GO" } as NodeJS.ProcessEnv;
  const item = {
    kind: "choice" as const,
    task: "LIN-7",
    project: "demo",
    question: "q",
    choices: ["Approve", "Reject"],
    diff: "+B1",
    since: "2026-11-01T00:00:00Z",
  };
  return { repo, vars, item, write };
}

const roadmap = (repo: string) => readFileSync(join(repo, "docs", "ROADMAP.md"), "utf8");

test("a plan applies by itself under the setting, and one undo reverts it", () => {
  const w = world(false);
  expect("item" in applyPlan(w.item, w.repo, new Date(), w.vars)).toBe(true);
  expect(roadmap(w.repo)).toContain("B1");
  const applied = readItems(w.vars)[0]!;
  expect(applied).toMatchObject({ auto: true, answer: "Approve" });
  expect(undoApplied(applied, new Date(), w.vars)).toBeUndefined();
  expect(roadmap(w.repo)).not.toContain("B1");
  expect(readItems(w.vars)[0]!.undone).toBeDefined();
  expect(undoApplied(readItems(w.vars)[0]!, new Date(), w.vars)).toBe("it was undone already");
});

test("merging a 40 commit plan spawns 3 git processes or fewer", () => {
  const w = world(false);
  const g = (...a: string[]) => Bun.spawnSync(["/usr/bin/git", "-C", w.repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  g("checkout", "-q", "work/7-plan");
  for (let i = 0; i < 39; i++) g("commit", "-q", "--allow-empty", "-m", `plan: step ${i}`);
  g("checkout", "-q", "main");
  const trace = join(mkdtempSync(join(tmpdir(), "lc-trace-")), "trace");
  temps.push(join(trace, ".."));
  // the fake server's own merge is not traced, so only the code under test counts
  const bin = w.vars.LINECLEAR_SERVER_BIN!;
  writeFileSync(bin, readFileSync(bin, "utf8").replace("exec git", "unset GIT_TRACE\nexec git"));
  // Bun does not pass a changed process.env to children, so the merge runs in a process that starts with the trace on
  const code = `import { applyPlan } from ${JSON.stringify(join(import.meta.dir, "..", "src", "plan-apply.ts"))}; const r = applyPlan(JSON.parse(process.env.ITEM!), process.env.REPO!, new Date()); if ("error" in r) throw new Error(r.error);`;
  const run = Bun.spawnSync([process.execPath, "-e", code], {
    env: { ...w.vars, GIT_TRACE: trace, ITEM: JSON.stringify(w.item), REPO: w.repo },
    stderr: "pipe",
  });
  expect(run.stderr.toString()).toBe("");
  const runs = readFileSync(trace, "utf8")
    .split("\n")
    .filter((l) => l.includes("built-in: git"));
  expect(runs.length).toBeLessThanOrEqual(3);
});

test("an undo refuses when the checkout has uncommitted changes, and loses nothing", () => {
  const w = world(false);
  applyPlan(w.item, w.repo, new Date(), w.vars);
  writeFileSync(join(w.repo, "docs", "ROADMAP.md"), "mine\n");
  expect(undoApplied(readItems(w.vars)[0]!, new Date(), w.vars)).toContain("uncommitted");
  expect(roadmap(w.repo)).toBe("mine\n");
});
