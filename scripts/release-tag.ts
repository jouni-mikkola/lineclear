// `bun run release 0.1.0`: refuses on a dirty tree, an existing tag or a HEAD whose GitHub check is not green. Otherwise it sets the
// version, commits, tags `v<version>`, installs from the tag into a fresh HOME and runs the doctor there. It never pushes.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIMIT_MS = 30 * 60_000; // an install that downloads tools ends by this limit rather than hangs
export type Release = { ok: boolean; lines: string[] };
type Ran = { ok: boolean; out: string };
// exit 0 when GitHub's "check" passed on HEAD
const GITHUB_GREEN = [
  "sh",
  "-c",
  `gh api "repos/{owner}/{repo}/commits/$(git rev-parse HEAD)/check-runs" --jq '[.check_runs[] | select(.name == "check") | .conclusion] | unique | join(",")' | grep -qx success`,
];
/** What release runs; tests swap the check and the install for stand-ins. `install` puts `tag` of `repo` into `home` and returns its doctor. */
export type ReleaseSteps = { repo: string; check: string[]; install: (repo: string, tag: string, home: string) => Ran };
function run(cmd: string[], cwd: string, env?: Record<string, string>): Ran {
  const p = Bun.spawnSync(cmd, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: LIMIT_MS });
  return { ok: p.exitCode === 0, out: (p.stdout.toString() + p.stderr.toString()).trim() };
}

/** The README's install from a tag, then the doctor, as a newcomer with nothing of this machine's own. */
export function installFromTag(repo: string, tag: string, home: string): Ran {
  const path = `${home}/.local/bin:${home}/.bun/bin:/usr/local/bin:/usr/bin:/bin`;
  const env = { HOME: home, PATH: path, USER: process.env.USER ?? "", LANG: process.env.LANG ?? "C.UTF-8", LINECLEAR_REPO: repo, LINECLEAR_REF: tag };
  const installed = run(["sh", "-c", `sh ${repo}/install.sh`], home, env);
  if (!installed.ok) return { ok: false, out: `install.sh failed:\n${installed.out}` };
  return run(["sh", "-c", "lineclear --version && lineclear doctor"], home, env);
}

export function release(version: string, steps: Partial<ReleaseSteps> = {}): Release {
  const { repo = join(import.meta.dir, ".."), check = GITHUB_GREEN, install = installFromTag } = steps;
  const lines: string[] = [];
  const refuse = (why: string): Release => ({ ok: false, lines: [...lines, `release: refused: ${why}`] });
  const tag = `v${version}`;
  if (!/^\d+\.\d+\.\d+$/.test(version)) return refuse(`"${version}" is not a version like 0.1.0`);
  if (run(["git", "status", "--porcelain"], repo).out) return refuse("the tree is not clean");
  if (run(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}`], repo).ok) return refuse(`the tag ${tag} exists`);
  const checked = run(check, repo);
  if (!checked.ok) return refuse(`${check.join(" ")} is red:\n${checked.out.split("\n").slice(-20).join("\n")}`);
  lines.push(`release: ${check.join(" ")} passed`);
  const file = join(repo, "package.json");
  writeFileSync(file, `${JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), version }, null, 2)}\n`);
  const git = (...a: string[]) => run(["git", "-c", "user.name=Lineclear", "-c", "user.email=release@lineclear.invalid", ...a], repo);
  const made = [git("commit", "-q", "-am", `Release ${version}`), git("tag", "-a", tag, "-m", `Lineclear ${version}`)].find((r) => !r.ok);
  if (made) return refuse(`git: ${made.out}`);
  lines.push(`release: version ${version}, commit ${run(["git", "rev-parse", "--short", "HEAD"], repo).out}, tag ${tag} (not pushed)`);
  const home = mkdtempSync(join(tmpdir(), "lineclear-release-"));
  const installed = install(repo, tag, home);
  rmSync(home, { recursive: true, force: true });
  lines.push(`release: install from ${tag} into a fresh HOME, then doctor:`, installed.out);
  if (installed.ok) lines.push(`release: ${tag} installs and its doctor runs`);
  else {
    // the tag and its commit are only here: take them back so the release can be run again
    git("tag", "-d", tag);
    git("reset", "-q", "--hard", "HEAD~1");
    lines.push(`release: the install from ${tag} failed; the tag and the version commit are taken back`);
  }
  return { ok: installed.ok, lines };
}

/** What is wrong with the release notes in docs/releases: a part off the template, a left-over {field}, a missing picture. */
export function releaseProblems(root: string = join(import.meta.dir, "..")): string[] {
  const dir = join(root, "docs", "releases");
  const heads = (t: string): string[] => [...(t.match(/^## .+$/gm) ?? [])];
  const template = heads(readFileSync(join(dir, "TEMPLATE.md"), "utf8"));
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d+\.\d+\.\d+\.md$/.test(f))) {
    const text = readFileSync(join(dir, f), "utf8");
    if (!text.startsWith(`# Lineclear ${f.replace(/\.md$/, "")}\n\n![`)) out.push(`${f} does not start with the template's title and a picture`);
    if (/\{[a-z]+\}/.test(text)) out.push(`${f} leaves a template field unfilled`);
    const own = heads(text);
    if (JSON.stringify(own) !== JSON.stringify(template.filter((h) => own.includes(h)))) out.push(`${f} leaves the template's parts or their order`);
    const pictures = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(([, p = ""]) => p);
    if (pictures.length === 0) out.push(`${f} shows no picture of what changed`);
    for (const p of pictures) if (!existsSync(join(dir, p))) out.push(`${f} shows ${p}, which is not there`);
  }
  return out;
}

if (import.meta.main) {
  const result = release(process.argv[2] ?? "");
  console.log(result.lines.join("\n"));
  process.exit(result.ok ? 0 : 1);
}
