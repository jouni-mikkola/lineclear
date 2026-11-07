import { machineTasksShown, readTasks } from "./task-read.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { keptBy, refsKey } from "./kept-read.ts";
import type { Task } from "./roadmap.ts";
import { mainRefs } from "./main-branch.ts";
import { git } from "./git.ts";

type Env = Record<string, string | undefined>;

/** This machine's tasks of every space in one call, for a reader that needs them all (Home). */
export function lineclearAllTasks(env: Env = process.env): (Task & { machine?: string })[] | string {
  // other machines' tasks are left out: each reader adds its project's own from what they last said
  const r = readTasks(env);
  return "tasks" in r ? r.tasks : `lineclear task list failed: ${r.why}`;
}

export function lineclearTasks(space: string, env: Env = process.env): Task[] | string {
  const r = readTasks(env, space);
  // The tasks of the project's other machines count as its own: ids end in `@host`, titles say where they run.
  return "tasks" in r ? [...r.tasks, ...machineTasksShown(env, space)] : `task list failed: ${r.why}`;
}

type Source = { text: string; commits: { commit: string; at: number; subject: string; body: string }[] };

/** A roadmap file and the commits that mark its steps done: from origin/main, else the folder's own file and main.
 *  Read again only when main, origin/main or the file changed. */
export function roadmapSource(repo: string): Source | undefined {
  const key = refsKey(repo);
  return key === undefined ? readSource(repo) : keptBy(`roadmap:${repo}`, key, () => readSource(repo));
}

const byId = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** Step files joined in id order, so the parser reads them as one roadmap. Undefined when there are none. */
function joinSteps(files: { name: string; text: string }[]): string | undefined {
  const md = files.filter((f) => f.name.endsWith(".md"));
  if (md.length === 0) return undefined;
  return `${md
    .sort((a, b) => byId(a.name, b.name))
    .map((f) => f.text.trimEnd())
    .join("\n\n")}\n`;
}

/** The roadmap's text in the working folder: `docs/roadmap/<id>.md` joined when the folder exists, else `docs/ROADMAP.md`. */
export function roadmapFolderText(repo: string): { text: string; file: string } | undefined {
  const folder = join(repo, "docs", "roadmap");
  if (existsSync(folder)) {
    const text = joinSteps(readdirSync(folder).map((name) => ({ name, text: readFileSync(join(folder, name), "utf8") })));
    if (text !== undefined) return { text, file: folder };
  }
  const file = join(repo, "docs", "ROADMAP.md");
  return existsSync(file) ? { text: readFileSync(file, "utf8"), file } : undefined;
}

function originText(repo: string, origin: string): string | undefined {
  const listed = git(repo, "ls-tree", "--name-only", origin, "docs/roadmap/");
  if (listed.ok) {
    const names = listed.out.split("\n").filter((n) => n.endsWith(".md"));
    const files = names.map((path) => ({ name: path.slice(path.lastIndexOf("/") + 1), shown: git(repo, "show", `${origin}:${path}`) }));
    const text = joinSteps(files.filter((f) => f.shown.ok).map((f) => ({ name: f.name, text: f.shown.out })));
    if (text !== undefined) return text;
  }
  const shown = git(repo, "show", `${origin}:docs/ROADMAP.md`);
  return shown.ok ? shown.out : undefined;
}

function readSource(repo: string): Source | undefined {
  const [origin, main] = mainRefs(repo);
  const fromOrigin = originText(repo, origin);
  const shown = { ok: fromOrigin !== undefined };
  const text = fromOrigin ?? roadmapFolderText(repo)?.text;
  if (text === undefined) return undefined;
  const format = "--format=%H%x01%ct%x01%s%x01%b";
  const originLog = git(repo, "log", origin, "-z", format);
  const log = shown.ok || originLog.ok ? originLog : git(repo, "log", main, "-z", format);
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
