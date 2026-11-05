import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { type CandidateDeps, candidateMain, checkCandidate } from "../src/candidate-check.ts";
import { readRelease, releaseLines } from "../src/release.ts";
import { tmp } from "./helpers.ts";

let root = "";
let env: Record<string, string | undefined> = {};
beforeEach(() => {
  root = tmp("candidate");
  env = { PATH: process.env.PATH, LINECLEAR_CONFIG: join(root, "cfg") };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const COMMIT = "c".repeat(40);

/** A candidate whose smoke run fails when `smokeFails`. */
function world(smokeFails: boolean) {
  const did = { ran: [] as string[], tasks: [] as string[], told: [] as string[], done: 0 };
  let open: string | undefined;
  const deps: CandidateDeps = {
    commit: () => ({ commit: COMMIT }),
    check() {
      did.ran.push("check");
      return "";
    },
    async smoke() {
      did.ran.push("smoke");
      return smokeFails ? "the web pages do not answer" : "";
    },
    canary() {
      did.ran.push("canary");
      return { why: "", store: "s" };
    },
    store() {
      did.ran.push("store");
      return "";
    },
    done: () => did.done++,
    fileTask(title) {
      did.tasks.push(title);
      open = "T-1";
      return "";
    },
    openFix: () => open,
    tell(task, message) {
      did.told.push(`${task}: ${message}`);
      return "";
    },
  };
  return { deps, did };
}

test("a green run marks the candidate ready and files nothing", async () => {
  const { deps, did } = world(false);
  const r = await checkCandidate(deps, "0.2.0", env);
  expect(r).toMatchObject({ version: "0.2.0", commit: COMMIT, result: "ready" });
  expect(did.ran).toEqual(["check", "smoke", "canary", "store"]);
  expect(did.tasks).toEqual([]);
  expect(readRelease(env).candidate?.checks.map((c) => c.outcome)).toEqual(["passed", "passed", "passed", "passed"]);
  expect(releaseLines(readRelease(env)).join("\n")).toContain("candidate  0.2.0");
  expect(did.done).toBe(1);
});

test("a failing smoke run marks it failed, skips the rest and files one task, once", async () => {
  const { deps, did } = world(true);
  const r = await checkCandidate(deps, "0.2.0", env);
  expect(r).toMatchObject({ result: "failed" });
  expect(did.ran).toEqual(["check", "smoke"]);
  expect(readRelease(env).candidate?.checks).toEqual([
    { name: "check", outcome: "passed" },
    { name: "smoke", outcome: "failed", why: "the web pages do not answer" },
    { name: "canary", outcome: "skipped" },
    { name: "store", outcome: "skipped" },
  ]);
  expect(did.tasks).toEqual(["Fix candidate 0.2.0"]);
  await checkCandidate(deps, "0.2.0", env);
  expect(did.tasks).toHaveLength(1);
  expect(releaseLines(readRelease(env)).join("\n")).toContain("smoke failed");
});

test("a version with no tag, or a bad one, is refused", async () => {
  const { deps } = world(false);
  const out: string[] = [];
  expect(await candidateMain(["x"], (l) => out.push(l), env, deps)).toBe(2);
  expect(await candidateMain(["0.2.0"], (l) => out.push(l), env, { ...deps, commit: () => "no tag v0.2.0" })).toBe(1);
  expect(await candidateMain(["0.2.0"], (l) => out.push(l), env, deps)).toBe(0);
  expect(out.at(-1)).toContain("is ready");
});
