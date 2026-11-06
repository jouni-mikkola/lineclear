// Promotion: the one path to stable. `lineclear release promote <version>` takes a build that
// passed `release check`, points `current` at it, keeps the one before as `previous`, restarts the service, runs the smoke
// check and goes back by itself when that fails. Running work lives in herdr, a unit of its own, so it is never touched.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readlinkSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { configDir, decisionsPath } from "../pi/config.ts";
import { buildNames, buildsDir, isRejected, liftHold, pointBuild } from "./builds.ts";
import { dataDir, lockFile } from "./paths.ts";
import { readRelease, run } from "./release.ts";
import { restartService, smoke } from "./rollback.ts";
import { cacheDir } from "./tmpdirs.ts";

type Env = Record<string, string | undefined>;

const REQUIRED = ["check", "smoke", "canary", "store"];
const LOCK_STALE_MS = 60 * 60_000;

export interface Promotion {
  version: string;
  /** The version that was stable before, if there was one. */
  from: string | null;
  /** Why the promotion did not hold (and the previous build is back), or "". */
  failed: string;
  /** What the smoke check said. */
  smoke: string;
}

/** Why `version` may not be promoted, or "": its checks, smoke run and canary must all have passed. */
export function promotionRefusal(version: string, env: Env = process.env): string {
  const data = dataDir(env);
  const c = readRelease(env).candidate;
  if (c?.version !== version) return `${version} was not checked: run lineclear release check ${version}`;
  const bad = REQUIRED.filter((name) => c.checks.find((k) => k.name === name)?.outcome !== "passed");
  if (c.result !== "ready" || bad.length) return `${version} did not pass ${bad.join(", ") || "its checks"}`;
  if (!existsSync(join(buildsDir(data), version, ".release"))) return `${version} is not installed: install it first`;
  if (isRejected(data, version)) return `${version} was rolled back and is not offered again until a newer version passes`;
  if (buildNames(data).current === version) return `${version} is stable already`;
  return "";
}

/** The subjects of the commits between two versions, from the clone `release check` keeps; empty when it has none. */
export function changesSince(from: string | null, to: string, env: Env = process.env): string[] {
  if (!from) return [];
  const dir = join(cacheDir(env), "candidate");
  const r = run(["git", "log", "--format=%s", "--max-count=8", `v${from}..v${to}`], dir, env, 30_000);
  return r.ok ? r.out.split("\n").filter(Boolean) : [];
}

/** Takes the lock of a promotion; false when another one is going. */
function lock(env: Env): (() => void) | undefined {
  mkdirSync(configDir(env), { recursive: true });
  try {
    if (Date.now() - statSync(lockFile(env, "promote")).mtimeMs > LOCK_STALE_MS) rmSync(lockFile(env, "promote"), { force: true });
  } catch {}
  try {
    const fd = openSync(lockFile(env, "promote"), "wx");
    return () => {
      closeSync(fd);
      rmSync(lockFile(env, "promote"), { force: true });
    };
  } catch {
    return undefined;
  }
}

function record(env: Env, p: Promotion) {
  const reason = p.failed
    ? `promotion of ${p.version} failed and ${p.from ?? "no build"} is back: ${p.failed}`
    : `promoted ${p.version} (was ${p.from ?? "none"}) on checks ${REQUIRED.join(", ")}: all passed; ${p.smoke}`;
  const line = { time: new Date().toISOString(), project: "-", kind: p.failed ? "skip" : "wake", reason, version: p.version, checks: REQUIRED };
  appendFileSync(decisionsPath(env), `${JSON.stringify(line)}\n`);
}

/** Promotes `version`; returns why it was refused, or what happened. */
export function promote(version: string, env: Env = process.env): Promotion | string {
  const refused = promotionRefusal(version, env);
  if (refused) return refused;
  const release = lock(env);
  if (!release) return "another promotion is going";
  try {
    const data = dataDir(env);
    const builds = buildsDir(data);
    const { current: from, previous: oldPrevious } = buildNames(data);
    if (from) pointBuild(data, "previous", from);
    pointBuild(data, "current", version);
    const put = (failed: string, said: string): Promotion => ({ version, from, failed, smoke: said });
    let failed = restartService(env) ? smoke(env) : "the service did not restart";
    if (!failed) {
      liftHold(data, version);
      const done = put("", "the smoke check passed");
      record(env, done);
      return done;
    }
    if (from) pointBuild(data, "current", from);
    else rmSync(join(builds, "current"), { force: true });
    if (oldPrevious) pointBuild(data, "previous", oldPrevious);
    else if (readlinkSafe(join(builds, "previous"))) rmSync(join(builds, "previous"), { force: true });
    if (!restartService(env)) failed += "; the service did not restart on the build that was back";
    const back = put(failed, failed);
    record(env, back);
    return back;
  } finally {
    release();
  }
}

const readlinkSafe = (p: string): string | null => {
  try {
    return readlinkSync(p);
  } catch {
    return null;
  }
};
