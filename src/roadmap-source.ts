import { serverBin } from "./paths.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { keptBy, refsKey } from "./kept-read.ts";
import { remoteTasks } from "./spread.ts";
import type { Task } from "./roadmap.ts";
import { mainRefs } from "./main-branch.ts";

type Env = Record<string, string | undefined>;

function git(repo: string, ...args: string[]) {
  const p = Bun.spawnSync(["git", "-C", repo, ...args], { stdin: "ignore", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString(), err: p.stderr.toString().trim() };
}

/** This machine's tasks of every space in one call, for a reader that needs them all (Home). */
export function shepherdrAllTasks(env: Env = process.env): (Task & { machine?: string })[] | string {
  try {
    const p = Bun.spawnSync([serverBin(env), "task", "list", "--json"], { stdin: "ignore", timeout: 10_000 });
    if (p.exitCode !== 0) return `lineclear task list failed: ${(p.stderr.toString() || p.stdout.toString()).trim()}`;
    // other machines' tasks are in it too: each reader adds its project's own from what they last said
    return (JSON.parse(p.stdout.toString()) as (Task & { machine?: string })[]).filter((t) => !t.machine);
  } catch {
    return "lineclear task list did not give JSON";
  }
}

export function shepherdrTasks(space: string, env: Env = process.env): Task[] | string {
  try {
    const p = Bun.spawnSync([serverBin(env), "task", "list", "--space", space, "--json"], { stdin: "ignore", timeout: 10_000 });
    if (p.exitCode !== 0) return `task list failed: ${(p.stderr.toString() || p.stdout.toString()).trim()}`;
    // The tasks of the project's other machines count as its own: ids end in `@host`, titles say where they run.
    return [...(JSON.parse(p.stdout.toString()) as Task[]), ...remoteTasks(space, env)];
  } catch {
    return "task list did not give JSON";
  }
}

type Source = { text: string; commits: { commit: string; at: number; subject: string; body: string }[] };

/** A roadmap file and the commits that mark its steps done: from origin/main, else the folder's own file and main.
 *  Read again only when main, origin/main or the file changed. */
export function roadmapSource(repo: string): Source | undefined {
  const key = refsKey(repo);
  return key === undefined ? readSource(repo) : keptBy(`roadmap:${repo}`, key, () => readSource(repo));
}

function readSource(repo: string): Source | undefined {
  const file = join(repo, "docs", "ROADMAP.md");
  const [origin, main] = mainRefs(repo);
  const shown = git(repo, "show", `${origin}:docs/ROADMAP.md`);
  const text = shown.ok ? shown.out : existsSync(file) ? readFileSync(file, "utf8") : undefined;
  if (text === undefined) return undefined;
  const format = "--format=%H%x01%ct%x01%s%x01%b";
  const fromOrigin = git(repo, "log", origin, "-z", format);
  const log = shown.ok || fromOrigin.ok ? fromOrigin : git(repo, "log", main, "-z", format);
  const commits = log.ok
    ? log.out
        .split("\0")
        .filter((r) => r.trim() !== "")
        .map((r) => {
          const [commit = "", at = "0", subject = "", body = ""] = r.split("\x01");
          return { commit: commit.trim(), at: Number(at) * 1000, subject: subject.trim(), body };
        })
    : [];
  return { text, commits };
}
