import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, step } from "./rules-world.ts";

const gitIn = (dir: string, ...a: string[]) => {
  const p = Bun.spawnSync(["git", "-C", dir, ...a]);
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};

/** Two machines of one GitHub repo (one origin), each with its own name for the project's space. */
function twoMachines(extra: object = {}) {
  const origin = mkdtempSync(join(tmpdir(), "lc-origin-"));
  gitIn(origin, "init", "-q", "--bare");
  const mk = (space: string, settings: object = {}) => {
    const m = setup({ steps: [step("A", "none")], space, settings });
    gitIn(m.repo, "remote", "add", "origin", origin);
    return m;
  };
  return { origin, thinkpad: mk("lineclear", extra), elitebook: mk("lineclear-eb", extra) };
}

test("two loops on two machines with different space names start a step once", () => {
  const { thinkpad, elitebook, origin } = twoMachines();
  expect(thinkpad.doTick().map((d) => d.kind)).toContain("start");
  const second = elitebook.doTick();
  expect(second.some((d) => d.kind === "start")).toBe(false);
  expect(second.some((d) => d.step === "A" && d.reason.includes("claim"))).toBe(true);
  expect(thinkpad.adds()).toHaveLength(1);
  expect(elitebook.adds()).toHaveLength(0);
  expect(gitIn(origin, "for-each-ref", "refs/lineclear/claims/")).toContain("refs/lineclear/claims/A");
});

test("a machine with starts: false starts no step and takes no claim", () => {
  const { thinkpad, origin } = twoMachines({ starts: false });
  const d = thinkpad.doTick();
  expect(d.some((x) => x.kind === "start")).toBe(false);
  expect(thinkpad.adds()).toHaveLength(0);
  expect(gitIn(origin, "for-each-ref", "refs/lineclear/claims/")).toBe("");
});

test("a claim is deleted once its step is done on main", () => {
  const { thinkpad, origin } = twoMachines();
  thinkpad.doTick();
  expect(gitIn(origin, "for-each-ref", "refs/lineclear/claims/")).not.toBe("");
  gitIn(thinkpad.repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "LIN-1: A Title A");
  gitIn(thinkpad.repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  thinkpad.doTick();
  expect(gitIn(origin, "for-each-ref", "refs/lineclear/claims/")).toBe("");
});
