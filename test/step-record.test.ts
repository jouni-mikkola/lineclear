import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type StepRecord, stepRecord } from "../src/step-page.ts";

const step = (id: string, after: string, locks: string) =>
  `### ${id} Step ${id}\n- result: R${id}.\n- why: w\n- done when:\n  - The page shows the cost in dollars.\n  - A test covers it.\n- locks: ${locks}\n- after: ${after}\n\n`;

/** A real project in a temp folder: S1 merged, S2 at work, S3 ready, S4 after S2, S5 waiting for the owner. */
function project() {
  const root = mkdtempSync(join(tmpdir(), "lc-step-"));
  const repo = join(root, "proj");
  mkdirSync(join(repo, "docs"), { recursive: true });
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  git("init", "-q", "-b", "main");
  const steps = [step("S1", "none", "x"), step("S2", "S1", "x"), step("S3", "none", "x"), step("S4", "S2", "y"), step("S5", "none", "z")];
  writeFileSync(join(repo, "docs", "ROADMAP.md"), `# Roadmap\n\n## One\n\n${steps.join("")}`);
  git("add", ".");
  git("commit", "-q", "-m", "Roadmap");
  git("commit", "-q", "--allow-empty", "-m", "OF-1: S1 Step S1");
  const dir = join(root, "lineclear");
  const asks = join(root, "cfg", `in${"box"}`);
  mkdirSync(join(root, "cfg", "projects", "proj"), { recursive: true });
  mkdirSync(asks, { recursive: true });
  mkdirSync(dir);
  writeFileSync(join(dir, "spaces.json"), JSON.stringify([{ name: "proj", key: "OF", path: repo }]));
  const facts = "ready · the page shows the cost in dollars, checked · review: round 1: 1 major, fixed; round 2: none";
  writeFileSync(
    join(dir, "tasks.json"),
    JSON.stringify({
      tasks: [
        { id: "OF-2", title: "S2 Step S2", branch: "work/2", facts },
        { id: "OF-5", title: "S5 Step S5" },
      ],
    }),
  );
  writeFileSync(join(root, "cfg", "projects", "proj", "settings.json"), JSON.stringify({ repo, space: "proj" }));
  writeFileSync(join(root, "cfg", "projects", "proj", "state.json"), JSON.stringify({ taskSteps: { "OF-2": "S2", "OF-5": "S5" } }));
  writeFileSync(
    join(asks, "4.json"),
    JSON.stringify({ n: 4, kind: "choice", task: "OF-5", project: "proj", question: "Pick A or B?", choices: ["A", "B"], since: "2026-01-05T09:12:00.000Z" }),
  );
  const env = { LINECLEAR_HOME: dir, PI_CODING_AGENT_DIR: join(root, "pi"), LINECLEAR_CONFIG: join(root, "cfg"), LINECLEAR_SERVER_BIN: "true" };
  const live = [
    { id: "OF-2", title: "S2 Step S2", status: "work" },
    { id: "OF-5", title: "S5 Step S5", status: "need", sub: "Pick A or B" },
  ];
  const record = (id: string): StepRecord => {
    const r = stepRecord("proj", id, env, () => live);
    if ("error" in r) throw new Error(r.error);
    return r;
  };
  return { root, env, record };
}

test("the page of a step lists the answers of the model that read it cold", () => {
  const { root, env: cfg, record } = project();
  expect(record("S1").read).toEqual([]);
  mkdirSync(join(cfg.LINECLEAR_CONFIG, "plan-checks"), { recursive: true });
  const a = (go: boolean) => ({ step: "S1", key: "k", round: 1, model: "m/x", go, said: "it says", missing: go ? "" : "gap", tokensIn: 1, tokensOut: 1 });
  writeFileSync(join(cfg.LINECLEAR_CONFIG, "plan-checks", "P-1.json"), JSON.stringify({ rounds: 1, answers: [a(false), a(true), { ...a(true), step: "S2" }] }));
  expect(record("S1").read).toEqual([
    { model: "m/x", go: false, said: "it says", missing: "gap" },
    { model: "m/x", go: true, said: "it says", missing: "" },
  ]);
  rmSync(root, { recursive: true, force: true });
});

test("the page of a real step has its checklist, waits and history from files and git", () => {
  const { root, env, record } = project();
  const done = record("S1");
  expect(done.checklist.map((c) => c.evidence?.startsWith("merge commit"))).toEqual([true, true]);
  expect(done.waits).toEqual([]);
  const work = record("S2");
  expect(work.checklist.map((c) => c.evidence !== undefined)).toEqual([true, false]);
  expect(work.history).toMatchObject({
    task: "OF-2",
    branch: "work/2",
    review: [
      { round: 1, findings: "1 major, fixed" },
      { round: 2, findings: "none" },
    ],
    checks: [],
  });
  expect(work.history?.cost).toBeUndefined();
  expect(record("S5").history).toMatchObject({ task: "OF-5" });
  expect(stepRecord("proj", "S9", env, () => [])).toMatchObject({ status: 404 });
  rmSync(root, { recursive: true, force: true });
});
