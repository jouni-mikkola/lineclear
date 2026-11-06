import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { join } from "node:path";
import { unprovenOf } from "./doneproof.ts";
import { lineOfRoadmap } from "./roadmap-view.ts";
import { lineclearTasks } from "./roadmap-source.ts";
import { statusesOf } from "./task-steps.ts";
import { importRoadmap } from "./roadmap-import.ts";
import { stepText } from "./brief.ts";
import {
  checkRoadmap,
  doneIds,
  existingMeasuring,
  formErrors,
  measuringFaults,
  proofFaults,
  resultOf,
  type RoadmapError,
  type Step,
  type StepStatus,
  type Task,
} from "./roadmap.ts";
import { unblockedByFiles } from "./parts.ts";
import { mainRefs } from "./main-branch.ts";
import { git } from "./git.ts";

type Out = (line: string) => void;

const USAGE = [
  "usage: lineclear roadmap check <repo>",
  "       lineclear roadmap show <id> [<repo>]",
  "       lineclear roadmap status <repo> --space <name> [--json]",
  "       lineclear roadmap locks <repo> --space <name>",
  "       lineclear roadmap import <file.json> <repo> [--force] [--no-commit]",
];

function readRoadmap(repo: string, out: Out): { text: string; file: string } | undefined {
  const file = join(repo, "docs", "ROADMAP.md");
  if (!existsSync(file)) {
    out(`${file}: no such file`);
    return undefined;
  }
  return { text: readFileSync(file, "utf8"), file };
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
  if (sub === "import") return importMain(rest, out);
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
    const faults = [...missingProofs(repo, parsed.steps), ...noNewMeasuring(repo, parsed.steps)];
    for (const f of faults) out(`${road.file}:${f.line}: ${f.message}`);
    if (faults.length > 0) return 1;
    out(`ok: ${parsed.steps.length} steps`);
    return 0;
  }

  const commits = mainCommits(repo);
  if (typeof commits === "string") return fail(out, commits);
  const tasks = tasksOf(space as string);
  if (typeof tasks === "string") return fail(out, tasks);
  const done = doneIds(commits, new Set(parsed.steps.map((s) => s.id)));
  const status = statusesOf(parsed.steps, done, tasks, repo, env, unprovenOf(repo, env));
  if (sub === "locks") return locksMain(parsed.steps, status, out);
  // the same line the roadmap view and Home show
  const line = lineOfRoadmap(repo, space as string, tasks, env, now);
  if (line && !flags.has("--json")) {
    out(line.text);
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

function doneOnMain(repo: string, steps: Step[]): Set<string> {
  const commits =
    mainRefs(repo)
      .map((ref) => mainCommits(repo, ref))
      .find((c) => typeof c !== "string") ?? [];
  return doneIds(commits as { subject: string; body: string }[], new Set(steps.map((s) => s.id)));
}

/** L319: with a `docs/simplify.md` that lists the existing measuring steps, a new one must wait for L271. */
function noNewMeasuring(repo: string, steps: Step[]): { line: number; message: string }[] {
  const file = join(repo, "docs", "simplify.md");
  if (!existsSync(file)) return [];
  return measuringFaults(steps, existingMeasuring(readFileSync(file, "utf8")));
}

function missingProofs(repo: string, steps: Step[]): { line: number; message: string }[] {
  const file = join(repo, "docs", "numbers.md");
  if (!existsSync(file)) return [];
  return proofFaults(steps, doneOnMain(repo, steps), readFileSync(file, "utf8"));
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

/** Writes docs/ROADMAP.md from a JSON list and commits it with a `Step: <id>` line for each done step. */
function importMain(args: string[], out: Out): number {
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [file, repo, ...extra] = args.filter((a) => !a.startsWith("--"));
  if (!file || !repo || extra.length > 0 || [...flags].some((f) => f !== "--force" && f !== "--no-commit")) {
    USAGE.forEach((l) => out(l));
    return 2;
  }
  if (!existsSync(file)) return fail(out, `${file}: no such file`);
  if (!existsSync(repo)) return fail(out, `${repo}: no such folder`);
  const result = importRoadmap(readFileSync(file, "utf8"));
  if ("errors" in result) {
    for (const e of result.errors) out(`${file}: ${e}`);
    return 1;
  }
  const target = join(repo, "docs", "ROADMAP.md");
  if (existsSync(target) && !flags.has("--force")) return fail(out, `${target} exists; use --force to replace it`);
  mkdirSync(join(repo, "docs"), { recursive: true });
  const before = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  writeAtomic(target, result.text);
  out(`wrote ${target}: ${result.done.length} done steps`);

  const message = ["Roadmap: import", "", ...result.done.map((id) => `Step: ${id}`)].join("\n");
  if (flags.has("--no-commit") || !git(repo, "rev-parse", "--git-dir").ok) {
    out("not committed; give the commit this message so that done steps stay done:");
    out(message);
    return 0;
  }
  const add = git(repo, "add", "--", "docs/ROADMAP.md");
  const commit = add.ok ? git(repo, "commit", "-q", "-m", message, "--", "docs/ROADMAP.md") : add;
  if (!commit.ok) {
    // Leave the repo as it was: a rerun must not need --force.
    git(repo, "reset", "-q", "--", "docs/ROADMAP.md");
    if (before === undefined) rmSync(target);
    else writeAtomic(target, before);
    return fail(out, `commit failed, nothing written: ${commit.err || commit.out.trim()}`);
  }
  out("committed");
  return 0;
}
