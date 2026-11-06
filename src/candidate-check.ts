// A candidate release checked on its own (see docs/stable-and-next.md): `lineclear release check <version>` runs the
// project's check at the candidate's tag, then the smoke check and canary on its test instance, then the store check
// both ways. Every outcome is kept in release.json under `candidate`; a failed candidate files one fix task.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { configDir } from "../pi/config.ts";
import { buildsDir } from "./builds.ts";
import { dataDir, pathsFor } from "./paths.ts";
import { projectsDir } from "./project.ts";
import {
  type CandidateCheck,
  type CandidateResult,
  type ReleaseDeps,
  formatsOf,
  nextReadsStable,
  fixTaskTools,
  readRelease,
  checkoutSteps,
  run,
  runSteps,
  saveRelease,
  tail,
  githubCheck,
} from "./release.ts";
import { cacheDir, diskTmpRoot } from "./tmpdirs.ts";
import { runningTryEnv, stopTry, tryMain } from "./try-instance.ts";

type Env = Record<string, string | undefined>;

/** The checks in order; each returns why it failed, or "". The store check gets the store the canary left. */
export interface CandidateDeps extends Pick<ReleaseDeps, "fileTask" | "openFix" | "tell"> {
  /** The commit the version's tag names, or why there is none. */
  commit(version: string): { commit: string } | string;
  check(version: string, commit: string): string;
  smoke(version: string): Promise<string>;
  canary(version: string): { why: string; store: string };
  store(version: string, store: string): string;
  /** Ends the test instance and removes what the checks left. */
  done(store: string): void;
}

const NAMES = ["check", "smoke", "canary", "store"] as const;

/** Runs the checks on `version`, stops at the first that fails, and keeps the result. Returns the result. */
export async function checkCandidate(deps: CandidateDeps, version: string, env: Env = process.env, now = new Date()): Promise<CandidateResult | string> {
  const found = deps.commit(version);
  if (typeof found === "string") return found;
  const { commit } = found;
  const state = readRelease(env);
  const prev = state.candidate?.commit === commit ? state.candidate : undefined;
  const result: CandidateResult = { version, commit, at: now.toISOString(), result: "checking", checks: [], filed: prev?.filed };
  const keep = () => {
    state.candidate = result;
    saveRelease(state, env);
  };
  keep();
  let store = "";
  try {
    for (const name of NAMES) {
      let why = "";
      if (result.result !== "failed") {
        if (name === "check") why = deps.check(version, commit);
        else if (name === "smoke") why = await deps.smoke(version);
        else if (name === "canary") ({ why, store } = deps.canary(version));
        else why = deps.store(version, store);
      }
      const c: CandidateCheck =
        result.result === "failed" ? { name, outcome: "skipped" } : why ? { name, outcome: "failed", why } : { name, outcome: "passed" };
      result.checks.push(c);
      if (why) result.result = "failed";
      keep();
    }
  } finally {
    deps.done(store);
  }
  if (result.result === "failed") fileCandidateFix(deps, result);
  else result.result = "ready";
  keep();
  return result;
}

function fileCandidateFix(deps: CandidateDeps, r: CandidateResult) {
  if (r.filed === r.commit) return;
  const failed = r.checks.find((c) => c.outcome === "failed");
  const why = `${failed?.name}: ${failed?.why ?? ""}`.slice(0, 2000);
  const open = deps.openFix();
  if (open) {
    if (!deps.tell(open, `Candidate ${r.version} (${r.commit}) failed its own check too. Fix this one too:\n\n${why}`)) r.filed = r.commit;
    return;
  }
  const brief = [
    `Candidate ${r.version} at ${r.commit} did not pass its own check, so it is not ready to promote:`,
    "",
    why,
    "",
    "Fix main so a new candidate passes: `lineclear release check <version>` runs the check, smoke check, canary and store check, and `lineclear release` shows the outcome of each.",
  ].join("\n");
  if (!deps.fileTask(`Fix candidate ${r.version}`, brief)) r.filed = r.commit;
}

/** The real world: a clone of the origin in the cache for the tag's check, the built release and its test instance for the rest. */
function realDeps(env: Env): CandidateDeps {
  const app = pathsFor(env).app;
  const dir = join(cacheDir(env), "candidate");
  const build = (v: string) => join(buildsDir(dataDir(env)), v);
  const origin = () => run(["git", "-C", app, "remote", "get-url", "origin"], app, env).out;
  return {
    commit(version) {
      mkdirSync(dir, { recursive: true });
      run(["git", "init", "-q"], dir, env);
      run(["git", "remote", "remove", "origin"], dir, env);
      run(["git", "remote", "add", "origin", origin()], dir, env);
      const f = run(["git", "fetch", "-q", "--force", "origin", `refs/tags/v${version}:refs/tags/v${version}`], dir, env, 120_000);
      if (!f.ok) return `no tag v${version}: ${tail(f.out)}`;
      return { commit: run(["git", "rev-parse", `v${version}^{commit}`], dir, env).out };
    },
    check(_version, commit) {
      const broke = runSteps(checkoutSteps(dir, commit), env);
      if (broke) return broke;
      return githubCheck(commit, dir, env);
    },
    async smoke(version) {
      const lines: string[] = [];
      if ((await tryMain([version], (l) => lines.push(l), env, undefined)) !== 0) return lines.join("; ");
      const inst = runningTryEnv(env);
      if (!inst) return "the test instance did not stay up";
      const r = run(["bun", join(build(version), "scripts", "smoke.ts"), "check", projectsDir(inst), "api"], build(version), {
        ...inst,
        LINECLEAR_WEB_PORT: inst.LINECLEAR_PORT,
        LINECLEAR_SMOKE_SECONDS: "60",
      });
      return r.ok ? "" : tail(r.out);
    },
    canary(version) {
      const store = mkdtempSync(join(diskTmpRoot(env), "candidate-store-"));
      const r = run(["bun", join(build(version), "scripts", "canary.ts"), "--keep", store], build(version), env);
      return { why: r.ok ? "" : (r.out.split("\n").find((l) => l.startsWith("fail ")) ?? `canary: ${tail(r.out)}`), store };
    },
    store(version, store) {
      // both ways: stable reads what the candidate wrote, and the candidate reads what stable wrote
      return formatsOf(app, build(version), store, env) || nextReadsStable(build(version), env);
    },
    done(store) {
      stopTry(env);
      if (store) rmSync(store, { recursive: true, force: true });
    },
    ...fixTaskTools(origin, dir, "Fix candidate", env),
  };
}

/** `lineclear release check <version>`. */
export async function candidateMain(args: string[], out: (l: string) => void, env: Env = process.env, deps?: CandidateDeps): Promise<number> {
  const [version] = args;
  if (args.length !== 1 || !/^\d+\.\d+\.\d+$/.test(version ?? "")) {
    out("usage: lineclear release check <version>");
    return 2;
  }
  mkdirSync(configDir(env), { recursive: true });
  const r = await checkCandidate(deps ?? realDeps(env), version as string, env);
  if (typeof r === "string") {
    out(`lineclear release: ${r}`);
    return 1;
  }
  for (const c of r.checks) out(`${c.name}  ${c.outcome}${c.why ? `: ${c.why}` : ""}`);
  out(`candidate ${r.version} (${r.commit.slice(0, 7)}) is ${r.result}`);
  return r.result === "ready" ? 0 : 1;
}
