// The rule loop's step for promotion (the switch itself is src/promote.ts, the command src/promote-cmd.ts).
import { KEPT_ENV } from "./herdr.ts";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { configDir, decisionsPath } from "../pi/config.ts";
import { buildNames } from "./builds.ts";
import { dataDir, pathsFor } from "./paths.ts";
import { promotionRefusal } from "./promote.ts";
import { follows, readRelease, saveRelease } from "./release.ts";
import { selfProject } from "./self-fix.ts";

type Env = Record<string, string | undefined>;

/** The candidate the rule loop should promote now, or undefined: it passed, is newer than stable and was not tried yet. */
export function promotionDue(env: Env = process.env): string | undefined {
  const state = readRelease(env);
  const version = state.candidate?.version;
  if (!version || state.promoteTried === version || promotionRefusal(version, env)) return undefined;
  const { current } = buildNames(dataDir(env));
  if (current && current.localeCompare(version, undefined, { numeric: true }) >= 0) return undefined;
  return version;
}

/**
 * From the rule loop: a candidate that passed all its checks and is newer than stable is promoted, as a unit of its own
 * (the restart of a promotion does not stop it). A project that sets `release.promote: ask` gets an Inbox item instead and
 * nothing happens until the owner taps it. A version is tried by the loop once; a failed one waits for a newer candidate.
 */
export function startPromoteIfDue(env: Env = process.env, now = new Date()): void {
  const app = pathsFor(env).app;
  if (env.LINECLEAR_CANARY || env.LINECLEAR_RELEASE === "off" || follows(env) || resolve(import.meta.dir, "..") !== app) return;
  const version = promotionDue(env);
  if (!version) return;
  mkdirSync(configDir(env), { recursive: true });
  saveRelease({ ...readRelease(env), promoteTried: version }, env);
  const ask = selfProject(env)?.settings.release?.promote === "ask";
  const how = ask ? "asks the owner to promote" : "starts the promotion of";
  const line = {
    time: now.toISOString(),
    project: "-",
    kind: "wake",
    reason: `the rule loop ${how} ${version}: it passed its checks, smoke run and canary`,
    version,
  };
  appendFileSync(decisionsPath(env), `${JSON.stringify(line)}\n`);
  const cmd = [process.execPath, join(app, "bin", "lineclear"), "release", "promote", ...(ask ? ["--ask"] : []), version];
  const keep = Object.entries(env).filter(([k, v]) => v !== undefined && KEPT_ENV.test(k));
  const unit = [
    "systemd-run",
    "--user",
    "--collect",
    "--quiet",
    `--unit=lineclear-promote-${now.getTime()}`,
    ...keep.map(([k, v]) => `--setenv=${k}=${v}`),
    ...cmd,
  ];
  if (spawnSync(unit[0] as string, unit.slice(1), { stdio: "ignore" }).status !== 0) {
    Bun.spawn(cmd, { env: env as Record<string, string>, stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
  }
}
