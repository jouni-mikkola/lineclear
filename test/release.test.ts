import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  fullCheckWhy,
  PROMOTE_EVERY_MS,
  type ReleaseDeps,
  readRelease,
  releaseLines,
  releaseMain,
  releaseStartDue,
  releaseStep,
  startReleaseIfDue,
  waitUntilQuiet,
} from "../src/release.ts";
import { sh, tmp } from "./helpers.ts";

let root: string;
let env: Record<string, string | undefined>;

beforeEach(() => {
  root = tmp("release");
  env = { PATH: process.env.PATH, HOME: root, LINECLEAR_CONFIG: join(root, "config"), LINECLEAR_HOME: join(root, "data") };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

/** A world whose main is `head`, and whose test fails for the commits in `broken`. */
function world(head: () => string, broken: Set<string> = new Set()) {
  const did = { tested: [] as string[], promoted: [] as string[], tasks: [] as string[], told: [] as string[] };
  let open: string | undefined;
  let stable = A;
  const deps: ReleaseDeps = {
    stable: () => stable,
    head,
    test(c) {
      did.tested.push(c);
      return broken.has(c) ? "smoke: the web pages do not answer" : "";
    },
    promote(c) {
      did.promoted.push(c);
      stable = c;
      return "";
    },
    fileTask(title) {
      did.tasks.push(title);
      open = `T-${did.tasks.length}`;
      return "";
    },
    openFix: () => open,
    tell(task, message) {
      did.told.push(`${task}: ${message}`);
      return "";
    },
  };
  return { deps, did, close: () => (open = undefined) };
}

const at = (min: number) => new Date(Date.UTC(2026, 10, 1, 12, min));

test("main the same as stable: next is green and nothing is held", () => {
  const { deps, did } = world(() => A);
  const s = releaseStep(deps, env, at(0));
  expect(s.next).toMatchObject({ commit: A, result: "green" });
  expect(s.held).toBeUndefined();
  expect(did.tested).toEqual([]);
});

test("a planted breaking merge is held at next, never promoted, and files one fix task", () => {
  const { deps, did } = world(() => B, new Set([B]));
  const s = releaseStep(deps, env, at(0));
  expect(s.stable?.commit).toBe(A);
  expect(s.next).toMatchObject({ commit: B, result: "red", why: "smoke: the web pages do not answer" });
  expect(s.held).toContain("next bbbbbbb failed: smoke");
  expect(did.promoted).toEqual([]);
  expect(did.tasks).toEqual(["Fix next bbbbbbb"]);
  // the same red commit is not tested again, and no second task is filed
  releaseStep(deps, env, at(40));
  expect(did.tested).toEqual([B]);
  expect(did.tasks).toHaveLength(1);
  expect(readRelease(env).stable?.commit).toBe(A);
});

test("a good merge is promoted with no human, and the fix of a red one too", () => {
  let head = B;
  const { deps, did } = world(() => head, new Set([B]));
  releaseStep(deps, env, at(0));
  head = C;
  const s = releaseStep(deps, env, at(2));
  expect(did.promoted).toEqual([C]);
  expect(s.stable?.commit).toBe(C);
  expect(s.promoted).toMatchObject({ commit: C, from: A });
  expect(s.held).toBeUndefined();
});

test("at most one promotion per 30 minutes: the next waits, then goes", () => {
  let head = B;
  const { deps, did } = world(() => head);
  releaseStep(deps, env, at(0));
  const promotedAt = Date.parse(readRelease(env).promoted?.at ?? "");
  head = C;
  const waiting = releaseStep(deps, env, new Date(promotedAt + PROMOTE_EVERY_MS - 60_000));
  expect(waiting.next?.result).toBe("waiting");
  expect(waiting.held).toContain("one promotion per 30 min");
  expect(did.promoted).toEqual([B]);
  releaseStep(deps, env, new Date(promotedAt + PROMOTE_EVERY_MS + 1));
  expect(did.promoted).toEqual([B, C]);
});

test("a promotion that install.sh rolled back holds next and files a task", () => {
  const { deps, did } = world(() => B);
  deps.promote = () => "the new version did not pass its smoke check";
  const s = releaseStep(deps, env, at(0));
  expect(s.stable?.commit).toBe(A);
  expect(s.next?.result).toBe("red");
  expect(s.held).toContain("rolled back");
  expect(did.tasks).toHaveLength(1);
});

test("main that cannot be read is held with why", () => {
  const { deps } = world(() => {
    throw new Error("could not resolve host");
  });
  expect(releaseStep(deps, env, at(0)).held).toBe("cannot read main: could not resolve host");
});

test("release status prints stable, next, the last promotion and why held", () => {
  const { deps } = world(() => B, new Set([B]));
  releaseStep(deps, env, at(0));
  const out: string[] = [];
  expect(releaseMain([], (l) => out.push(l), env)).toBe(0);
  expect(out.join("\n")).toMatch(/^stable {2}aaaaaaa since .*\nnext {4}bbbbbbb red\nlast promotion {2}none yet\nheld {4}next bbbbbbb failed/);
  expect(releaseLines({})[0]).toBe("stable  unknown");
});

test("only the installed app starts release runs", () => {
  startReleaseIfDue(env, at(0));
  expect(existsSync(join(root, "config", "release.json"))).toBe(false);
});

test("install.sh by hand takes this machine's stable build, else main", () => {
  const fn = readFileSync(join(import.meta.dir, "..", "install.sh"), "utf8").match(/^stable_commit\(\) \{\n[\s\S]*?\n\}/m)?.[0];
  expect(fn).toBeDefined();
  const ask = () =>
    sh(["sh", "-c", `${fn}\nstable_commit`], { env: { PATH: process.env.PATH ?? "", HOME: root, LINECLEAR_CONFIG: join(root, "config") } }).out.trim();
  expect(ask()).toBe("");
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "release.json"), JSON.stringify({ next: { commit: B }, stable: { commit: A, at: "x" } }, null, 2));
  expect(ask()).toBe(A);
});

test("install.sh by hand on a machine that follows another keeps the build that one gave it", () => {
  const fn = readFileSync(join(import.meta.dir, "..", "install.sh"), "utf8").match(/^stable_commit\(\) \{\n[\s\S]*?\n\}/m)?.[0];
  const app = join(root, "share", "lineclear");
  mkdirSync(app, { recursive: true });
  sh(["sh", "-c", "git init -q && git -c user.email=t@t -c user.name=T commit -q --allow-empty -m one"], { cwd: app });
  const head = sh(["git", "rev-parse", "HEAD"], { cwd: app }).out.trim();
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "release-follows"), "desk\n");
  const ask = sh(["sh", "-c", `${fn}\nstable_commit`], {
    env: { PATH: process.env.PATH ?? "", HOME: root, XDG_DATA_HOME: join(root, "share"), LINECLEAR_CONFIG: join(root, "config") },
  });
  expect(ask.out.trim()).toBe(head);
});

/** The server's generated plugin list is not in git: build it, then write the store its code writes. */
test("a machine another one installed promotes nothing of its own", () => {
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config", "release-follows"), "desk\n");
  const out: string[] = [];
  expect(releaseMain(["run"], (l) => out.push(l), env)).toBe(0);
  expect(releaseMain(["status"], (l) => out.push(l), env)).toBe(0);
  expect(out).toEqual([
    "lineclear release: this machine follows desk, which promotes for it",
    "follows desk: this machine gets the stable build desk promotes",
  ]);
  expect(existsSync(join(root, "config", "release.json"))).toBe(false);
});

test("install.sh marks a machine another one installs as its follower", () => {
  const fn = readFileSync(join(import.meta.dir, "..", "install.sh"), "utf8").match(/^mark_follows\(\) \{\n[\s\S]*?\n\}/m)?.[0];
  expect(fn).toBeDefined();
  const base = { PATH: process.env.PATH ?? "", HOME: root, LINECLEAR_CONFIG: join(root, "config") };
  const mark = (extra: Record<string, string> = {}) => sh(["sh", "-c", `${fn}\nmark_follows`], { env: { ...base, ...extra } });
  mark();
  expect(existsSync(join(root, "config", "release-follows"))).toBe(false);
  mark({ LINECLEAR_FOLLOWS: "desk" });
  expect(readFileSync(join(root, "config", "release-follows"), "utf8")).toBe("desk\n");
});

test("the release check waits for a quiet machine, and runs anyway after the longest wait", () => {
  let t = 0;
  const loads = [5, 3, 1];
  const waited: number[] = [];
  const pause = (ms: number) => {
    t += ms;
    waited.push(ms);
  };
  expect(
    waitUntilQuiet(
      () => loads.shift() ?? 1,
      () => t,
      pause,
      600_000,
    ),
  ).toBe(true);
  expect(waited).toHaveLength(2);
  waited.length = 0;
  t = 0;
  expect(
    waitUntilQuiet(
      () => 9,
      () => t,
      pause,
      60_000,
    ),
  ).toBe(false);
  expect(waited.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
});

test("a newer red main tells the open Fix next task and files no second one", () => {
  let head = B;
  const { deps, did, close } = world(() => head, new Set([B, C]));
  releaseStep(deps, env, at(0));
  head = C;
  const s = releaseStep(deps, env, at(40));
  expect(did.tasks).toEqual(["Fix next bbbbbbb"]);
  expect(did.told).toHaveLength(1);
  expect(did.told[0]).toContain(`T-1: Main moved on and is red at ${C}`);
  expect(did.told[0]).toContain("smoke: the web pages do not answer");
  expect(s.filed).toBe(C);
  // once that task is done, a later red main gets a new one
  close();
  head = "d".repeat(40);
  deps.test = () => "smoke";
  releaseStep(deps, env, at(80));
  expect(did.tasks).toEqual(["Fix next bbbbbbb", "Fix next ddddddd"]);
});

test("a release run that fails or leaves main held is started less and less often, one that leaves nothing held is not", () => {
  const start = (t: number) => {
    const { due, tries } = releaseStartDue(env, t);
    if (due) {
      mkdirSync(join(root, "config"), { recursive: true });
      writeFileSync(join(root, "config", "release-started.json"), JSON.stringify({ at: t, tries: tries + 1 }));
    }
    return due;
  };
  const MIN = 60_000;
  expect(start(0)).toBe(true);
  expect(start(1 * MIN)).toBe(false);
  expect(start(2 * MIN)).toBe(true);
  expect(start(5 * MIN)).toBe(false);
  expect(start(6 * MIN)).toBe(true);
  expect(start(13 * MIN)).toBe(false);
  expect(start(14 * MIN)).toBe(true);
  // a run that looked at main but left it held red does not reset the wait
  writeFileSync(join(root, "config", "release.json"), JSON.stringify({ checked: new Date(15 * MIN).toISOString(), held: "next failed" }));
  expect(start(16 * MIN)).toBe(false);
  expect(start(30 * MIN)).toBe(true);
  // one that looked at main and left nothing held does
  writeFileSync(join(root, "config", "release.json"), JSON.stringify({ checked: new Date(31 * MIN).toISOString() }));
  expect(start(32 * MIN)).toBe(true);
  expect(start(33 * MIN)).toBe(false);
  expect(start(34 * MIN)).toBe(true);
});

/** A full check's output with a failing test, a timed-out test and a failed gate planted in it. */
const planted = [
  "check: failing tests:",
  "  test/a.test.ts > adds up: expect(received).toBe(expected)",
  "  test/b.test.ts > waits for it: timed out after 120000ms",
  "check: tests 1/2 failed",
  "check: gates failed: error: file src/x.ts is 700 lines",
  "check: every step ran",
].join("\n");

test("the held line names each failing test, a timed-out one and a failed gate", () => {
  const { deps } = world(() => B);
  deps.test = () => `full check: ${fullCheckWhy(planted)}`;
  const held = releaseStep(deps, env, at(0)).held ?? "";
  expect(held).toContain("test/a.test.ts > adds up: expect(received).toBe(expected)");
  expect(held).toContain("test/b.test.ts > waits for it: timed out after 120000ms");
  expect(held).toContain("gates failed: error: file src/x.ts is 700 lines");
});

test("a failed step with no test names is never an empty list", () => {
  expect(fullCheckWhy("check: ui tests failed: Error: browser killed\ncheck: every step ran")).toContain("ui tests failed: Error: browser killed");
});

test("failing tests of every shard are named, and a shard with no test names is named with its last error line", () => {
  const out = [
    "check: failing tests:",
    "  test/a.test.ts > one: e1",
    "check: tests 1/2 failed: error: unhandled between tests",
    "check: failing tests:",
    "  test/c.test.ts > two: e2",
    "  and 3 more",
    "check: tests 2/2 failed",
  ].join("\n");
  const why = fullCheckWhy(out);
  expect(why).toContain("test/a.test.ts > one: e1; test/c.test.ts > two: e2; and 3 more");
  expect(why).toContain("tests 1/2 failed: error: unhandled between tests");
});
