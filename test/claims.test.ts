import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claimWorld } from "../src/claims.ts";
import { tick } from "../src/rules.ts";
import type { Cmd, Ran } from "../src/run-all.ts";
import { demoEnv, fakeWorld, scratch } from "./fake-world.ts";

const scratchDir = scratch();
const ok = (out = ""): Ran => ({ code: 0, out, err: "" });
const fail = (err: string): Ran => ({ code: 1, out: "", err });

/** Claims on a repo whose origin is `origin`; `answer` is GitHub's answer to each gh call. */
function claims(origin: string | undefined, answer: (argv: string[]) => Ran = () => ok()) {
  const single: string[][] = [];
  const batches: string[][][] = [];
  const run = (argv: string[]): Ran => {
    if (argv.includes("get-url")) return origin === undefined ? fail("no such remote") : ok(`${origin}\n`);
    if (argv.includes("rev-parse")) return ok("abc123\n");
    single.push(argv);
    return answer(argv);
  };
  const runAll = (cmds: Cmd[]) => (batches.push(cmds.map((c) => c.argv)), cmds.map((c) => answer(c.argv)));
  return { world: claimWorld(run, runAll, () => "origin/main"), single, batches };
}

test("every claim is made at once through GitHub's REST API, not a git push", () => {
  const c = claims("git@github.com:owner/repo.git");
  expect(c.world.claimSteps?.("/r", ["A", "B"])).toEqual([undefined, undefined]);
  expect(c.batches).toEqual([
    ["A", "B"].map((s) => [
      "gh",
      "api",
      "--method",
      "POST",
      "repos/owner/repo/git/refs",
      "-f",
      `ref=refs/lineclear/claims/${s}`,
      "-f",
      "sha=abc123",
      "--silent",
    ]),
  ]);
});

test("a claim that exists is held by another loop; any other failure is said", () => {
  const c = claims("https://github.com/owner/repo", (argv) =>
    argv.some((a) => a.endsWith("/A")) ? fail("gh: Reference already exists (HTTP 422)") : fail("gh: Bad credentials (HTTP 401)\nmore"),
  );
  expect(c.world.claimSteps?.("/r", ["A", "B"])).toEqual(["held", "gh: Bad credentials (HTTP 401)"]);
});

test("a repo with no origin on GitHub has nobody to race: no claim is asked for", () => {
  for (const origin of [undefined, "/srv/git/repo.git"]) {
    const c = claims(origin);
    expect(c.world.claimSteps?.("/r", ["A"])).toEqual([undefined]);
    expect(c.world.claimedSteps?.("/r")).toEqual([]);
    c.world.releaseSteps?.("/r", ["A"]);
    expect([...c.single, ...c.batches]).toEqual([]);
  }
});

test("claimed steps are read, and released all at once, through the REST API", () => {
  const c = claims("https://github.com/owner/repo.git", (argv) => ok(argv.includes("--jq") ? "refs/lineclear/claims/A\nrefs/lineclear/claims/B\n" : ""));
  expect(c.world.claimedSteps?.("/r")).toEqual(["A", "B"]);
  c.world.releaseSteps?.("/r", ["A", "B"]);
  expect(c.batches).toEqual([["A", "B"].map((s) => ["gh", "api", "--method", "DELETE", `repos/owner/repo/git/refs/lineclear/claims/${s}`, "--silent"])]);
});

/** Two loops of one repo: a step claimed by one is held for the other. */
function loop(name: string, taken: Set<string>, settings: object = {}, commits: { subject: string; body: string }[] = []) {
  const dir = scratchDir(name);
  const env = demoEnv(dir);
  const file = join(dir, "config", "projects", "demo", "settings.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...settings }));
  const f = fakeWorld(env, [], "# Roadmap\n\n## Phase 0\n\n### A Alpha\n- why: because\n- done when:\n  - it works\n- locks: none\n- after: none\n", commits);
  f.world.claimSteps = (_repo, steps) => steps.map((s) => (taken.has(s) ? "held" : (taken.add(s), undefined)));
  return { f, tick: () => tick(f.world, false, env) };
}

test("two loops on two machines start a step once", () => {
  const taken = new Set<string>();
  const thinkpad = loop("thinkpad", taken);
  const elitebook = loop("elitebook", taken);
  expect(thinkpad.tick().map((d) => d.kind)).toContain("start");
  const second = elitebook.tick();
  expect(second.some((d) => d.kind === "start")).toBe(false);
  expect(second.some((d) => d.step === "A" && d.reason.includes("claim"))).toBe(true);
  expect(thinkpad.f.adds).toHaveLength(1);
  expect(elitebook.f.adds).toHaveLength(0);
});

test("a machine with starts: false starts no step and takes no claim", () => {
  const taken = new Set<string>();
  const thinkpad = loop("no-starts", taken, { starts: false });
  expect(thinkpad.tick().some((x) => x.kind === "start")).toBe(false);
  expect(taken.size).toBe(0);
});

test("a claim is deleted once its step is done on main", () => {
  const taken = new Set(["A"]);
  const done = loop("done", taken, {}, [{ subject: "LIN-1: A Alpha", body: "" }]);
  done.f.world.claimedSteps = () => [...taken];
  done.f.world.releaseSteps = (_repo, steps) => steps.forEach((s) => taken.delete(s));
  done.tick();
  expect(taken.size).toBe(0);
});
