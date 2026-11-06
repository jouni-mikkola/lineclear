// `bun run release 0.1.0`: the release of a version, made here and never pushed. It refuses on a dirty tree, an
// existing tag, a HEAD whose GitHub check is not green (checks are light and run on GitHub, never here) or a failing whole-repo gate check (gates:full). Otherwise it sets the version in package.json, commits it, tags `v<version>`,
// installs from that tag into a fresh HOME with the README's installer and runs the doctor there. The push and the
// GitHub release are a separate, outward step.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slowFailures } from "../src/heavy-run.ts";

// An install that downloads tools both end by this limit rather than hang.
const LIMIT_MS = 30 * 60_000;

export type Release = { ok: boolean; lines: string[] };

/** Exit 0 when GitHub's "check" passed on HEAD. */
const GITHUB_GREEN = [
  "sh",
  "-c",
  `gh api "repos/{owner}/{repo}/commits/$(git rev-parse HEAD)/check-runs" --jq '[.check_runs[] | select(.name == "check") | .conclusion] | unique | join(",")' | grep -qx success`,
];

/** What release runs; tests swap the check and the install for stand-ins. */
export type ReleaseSteps = {
  repo: string;
  check: string[];
  /** The heavy tier's commands; undefined means the project's own. */
  heavy?: string[];
  /** Installs `tag` of `repo` into `home` and returns the installed lineclear's doctor. */
  install: (repo: string, tag: string, home: string) => { ok: boolean; out: string };
};

function run(cmd: string[], cwd: string, env?: Record<string, string>) {
  const p = Bun.spawnSync(cmd, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: LIMIT_MS });
  return { ok: p.exitCode === 0, out: (p.stdout.toString() + p.stderr.toString()).trim() };
}

/** The README's install from a tag, then the doctor, as a newcomer with nothing of this machine's own. */
export function installFromTag(repo: string, tag: string, home: string): { ok: boolean; out: string } {
  const env = {
    HOME: home,
    PATH: `${home}/.local/bin:${home}/.bun/bin:/usr/local/bin:/usr/bin:/bin`,
    USER: process.env.USER ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
    LINECLEAR_REPO: repo,
    LINECLEAR_REF: tag,
  };
  const spawn = (script: string) => run(["sh", "-c", script], home, env);
  const installed = spawn(`sh ${repo}/install.sh`);
  if (!installed.ok) return { ok: false, out: `install.sh failed:\n${installed.out}` };
  const doctor = spawn("lineclear --version && lineclear doctor");
  return { ok: doctor.ok, out: doctor.out };
}

export function release(version: string, steps: Partial<ReleaseSteps> = {}): Release {
  const { repo = join(import.meta.dir, ".."), check = GITHUB_GREEN, install = installFromTag } = steps;
  const heavy = steps.heavy ?? ["bun run gates:full"];
  const lines: string[] = [];
  const refuse = (why: string): Release => ({ ok: false, lines: [...lines, `release: refused: ${why}`] });
  const tag = `v${version}`;
  if (!/^\d+\.\d+\.\d+$/.test(version)) return refuse(`"${version}" is not a version like 0.1.0`);
  if (run(["git", "status", "--porcelain"], repo).out) return refuse("the tree is not clean");
  if (run(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}`], repo).ok) return refuse(`the tag ${tag} exists`);
  const checked = run(check, repo);
  if (!checked.ok) return refuse(`${check.join(" ")} is red:\n${checked.out.split("\n").slice(-20).join("\n")}`);
  lines.push(`release: ${check.join(" ")} passed`);
  const slow = slowFailures(repo, heavy);
  if (slow.length > 0) return refuse(`a heavy check fails: ${slow.map((f) => `${f.name}\n${f.output.split("\n").slice(-20).join("\n")}`).join("\n")}`);
  lines.push(`release: ${heavy.length} heavy check(s) passed`);

  const file = join(repo, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  const git = (...a: string[]) => run(["git", "-c", "user.name=Lineclear", "-c", "user.email=release@lineclear.invalid", ...a], repo);
  const made = [git("commit", "-q", "-am", `Release ${version}`), git("tag", "-a", tag, "-m", `Lineclear ${version}`)].find((r) => !r.ok);
  if (made) return refuse(`git: ${made.out}`);
  lines.push(`release: version ${version}, commit ${run(["git", "rev-parse", "--short", "HEAD"], repo).out}, tag ${tag} (not pushed)`);

  const home = mkdtempSync(join(tmpdir(), "lineclear-release-"));
  const installed = install(repo, tag, home);
  rmSync(home, { recursive: true, force: true });
  lines.push(`release: install from ${tag} into a fresh HOME, then doctor:`, installed.out);
  if (!installed.ok) {
    // the tag and its commit are only here: take them back so the release can be run again
    git("tag", "-d", tag);
    git("reset", "-q", "--hard", "HEAD~1");
    lines.push(`release: the install from ${tag} failed; the tag and the version commit are taken back`);
  } else lines.push(`release: ${tag} installs and its doctor runs`);
  return { ok: installed.ok, lines };
}

if (import.meta.main) {
  const version = process.argv[2] ?? "";
  const result = release(version);
  console.log(result.lines.join("\n"));
  process.exit(result.ok ? 0 : 1);
}
