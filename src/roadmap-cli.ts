import { lineOfRoadmap } from "./roadmap-view.ts";
import { lineclearTasks, roadmapFolderText } from "./roadmap-source.ts";
import { statusesOf } from "./task-steps.ts";
import { stepText } from "./brief.ts";
import { checkRoadmap, formErrors, resultOf, type RoadmapError, type Step, type StepStatus, type Task } from "./roadmap.ts";
import { unblockedByFiles } from "./parts.ts";
import { mainRefs } from "./main-branch.ts";
import { git } from "./git.ts";

type Out = (line: string) => void;

const USAGE = [
  "usage: lineclear roadmap check <repo>",
  "       lineclear roadmap show <id> [<repo>]",
  "       lineclear roadmap status <repo> --space <name> [--json]",
  "       lineclear roadmap locks <repo> --space <name>",
];

function readRoadmap(repo: string, out: Out): { text: string; file: string } | undefined {
  const road = roadmapFolderText(repo);
  if (!road) out(`${repo}/docs/ROADMAP.md: no such file`);
  return road;
}

function mainCommits(repo: string, ref = mainRefs(repo)[0]): { subject: string; body: string }[] | string {
  const p = git(repo, "log", ref, "-z", "--format=%s%x01%b");
  if (!p.ok) return `cannot read origin/main in ${repo}: ${p.err}`;
  return p.out
    .split("\0")
    .filter((r) => r.trim() !== "")
    .map((r) => {
      const [subject = "", body = ""] = r.split("\x01");
      return { subject: subject.trim(), body };
    });
}

const withFormErrors = (errors: RoadmapError[], steps: Step[]) => [...errors, ...formErrors(steps)].sort((a, b) => a.line - b.line);

function locksMain(steps: Step[], status: StepStatus[], out: Out): number {
  const of = (state: string) => steps.filter((s) => status.some((t) => t.id === s.id && t.state === state));
  const ready = of("ready");
  const freed = unblockedByFiles(ready, of("work"));
  out(`file locks let ${freed.length} of ${ready.length} ready steps start now${freed.length > 0 ? `: ${freed.map((s) => s.id).join(", ")}` : ""}`);
  return 0;
}

export function roadmapMain(
  args: string[],
  out: Out,
  tasksOf: (space: string) => Task[] | string = (s) => lineclearTasks(s),
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): number {
  const [sub, ...rest] = args;
  if (sub === "show") return showMain(rest, out);
  const flags = new Set(rest.filter((a) => a === "--json"));
  const spaceAt = rest.indexOf("--space");
  const space = spaceAt >= 0 ? rest[spaceAt + 1] : undefined;
  const positional = rest.filter((a, i) => !a.startsWith("--") && !(spaceAt >= 0 && i === spaceAt + 1));
  const repo = positional[0];
  if ((sub !== "check" && sub !== "status" && sub !== "locks") || repo === undefined || positional.length > 1) {
    USAGE.forEach((l) => out(l));
    return 2;
  }
  if (sub !== "check" && !space) {
    USAGE.forEach((l) => out(l));
    return 2;
  }

  const road = readRoadmap(repo, out);
  if (!road) return 1;
  const checked = checkRoadmap(road.text);
  const { parsed } = checked;
  // the form (a short title, a result line) is checked by `check`; the views and the rule loop read older files too
  const errors = sub === "check" ? withFormErrors(checked.errors, parsed.steps) : checked.errors;
  if (errors.length > 0) {
    for (const e of errors) out(`${road.file}:${e.line}: ${e.message}`);
    return 1;
  }
  if (sub === "check") {
    out(`ok: ${parsed.steps.length} steps`);
    return 0;
  }

  const commits = mainCommits(repo);
  if (typeof commits === "string") return fail(out, commits);
  const tasks = tasksOf(space as string);
  if (typeof tasks === "string") return fail(out, tasks);
  const status = statusesOf(parsed.steps, commits, tasks, repo, env);
  if (sub === "locks") return locksMain(parsed.steps, status, out);
  // the same line the roadmap view and Home show
  const line = lineOfRoadmap(repo, space as string, tasks, env, now);
  if (line && !flags.has("--json")) {
    out(line.detail ? `${line.text} ${line.detail}` : line.text);
    if (line.path) out(`Critical path: ${line.path.join(" > ")}`);
  }
  printStatus(status, new Map(parsed.steps.map((s) => [s.id, resultOf(s)])), flags.has("--json"), out);
  return 0;
}

function printStatus(status: StepStatus[], results: Map<string, string>, json: boolean, out: Out) {
  if (json)
    out(
      JSON.stringify(
        status.map((s) => ({ ...s, ...(results.get(s.id) ? { result: results.get(s.id) } : {}) })),
        null,
        2,
      ),
    );
  else {
    for (const s of status) out(`${s.id.padEnd(5)} ${s.state.padEnd(8)} ${s.title}${results.get(s.id) ? `: ${results.get(s.id)}` : ""}`);
    for (const s of status) if (s.unproven !== undefined) out(`${s.id} merged, unproven: ${s.unproven}`);
  }
}

/** Prints one step of the roadmap, so that a worker need not read the whole file. */
function showMain(args: string[], out: Out): number {
  const [id, repo = ".", ...extra] = args;
  if (!id || extra.length > 0 || id.startsWith("--")) {
    USAGE.forEach((l) => out(l));
    return 2;
  }
  const road = readRoadmap(repo, out);
  if (!road) return 1;
  const step = checkRoadmap(road.text).parsed.steps.find((s) => s.id.toLowerCase() === id.toLowerCase());
  if (!step) return fail(out, `no step '${id}' in ${road.file}`);
  out(stepText(road.text, step));
  return 0;
}

function fail(out: Out, message: string): number {
  out(`lineclear: ${message}`);
  return 1;
}
