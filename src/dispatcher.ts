import { serverBin } from "./paths.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { join } from "node:path";
import { planProblems } from "./autoplan.ts";
import { recordApplied } from "./plan-apply.ts";
import { ownerDirection } from "./direction.ts";
import type { Item } from "./inbox.ts";
import { readSettings } from "./project.ts";
import { looseNote, resolveProject, resolveStep } from "./resolve.ts";
import { projectsMain } from "./requests.ts";
import { checkRoadmap } from "./roadmap.ts";
import { configDir } from "../pi/config.ts";
import { gitAsLineclear } from "./git.ts";

export const DISPATCHER_SPACE = "dispatcher";
const USAGE = ["usage: lineclear move <project> <step> --after <ids|none>", "       lineclear dispatcher setup | projects"];

const lineclear = serverBin;
/** The folder of the Dispatcher's space. */
export const dispatcherDir = (env = process.env) => join(configDir(env), DISPATCHER_SPACE);

/** The roadmap text with the `after` of one step set to `ids`, or an error line. */
function withAfter(text: string, step: string, ids: string[]): { text: string } | { error: string } {
  const s = checkRoadmap(text).parsed.steps.find((x) => x.id === step);
  const field = s?.fields.after;
  if (s === undefined || field === undefined) return { error: `no step '${step}' in docs/ROADMAP.md` };
  const lines = text.split("\n");
  // The field may continue on the lines below it: drop those, the new value is on one line.
  const onNextLine = /^- [^:]*:\s*$/.test(lines[field.line - 1]!) && field.value !== "";
  lines.splice(field.line - 1, 1 + field.more.length + (onNextLine ? 1 : 0), `- after: ${ids.join(", ")}`);
  const next = lines.join("\n");
  const errors = checkRoadmap(next).errors;
  return errors.length > 0 ? { error: `the roadmap would not pass the check: ${errors[0]!.message}` } : { text: next };
}

/** A move as asked, checked against the roadmap: the project, the step, its new `after`, and the text before and after. */
function checkedMove(rawName: string, rawStep: string, value: string, env: NodeJS.ProcessEnv) {
  const project = resolveProject(rawName, env);
  if ("error" in project) return project;
  const name = project.name;
  const settings = readSettings(name, env);
  if (typeof settings === "string") return { error: settings };
  const file = join(settings.repo, "docs", "ROADMAP.md");
  if (!existsSync(file)) return { error: `${file} does not exist` };
  const given = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (given.length === 0 || (given.includes("none") && given.length > 1)) return { error: "--after takes ids, or 'none' alone" };
  if (rawStep.trim().toLowerCase() === "none") return { error: "'none' is not a step" };
  const steps = checkRoadmap(readFileSync(file, "utf8")).parsed.steps;
  const picked = resolveStep(rawStep, steps);
  if ("error" in picked) return picked;
  const step = picked.name;
  const after: string[] = [];
  for (const g of given) {
    const r = g === "none" ? { name: g } : resolveStep(g, steps);
    if ("error" in r) return r;
    after.push(r.name);
  }
  const old = readFileSync(file, "utf8");
  const changed = withAfter(old, step, after);
  if ("error" in changed) return changed;
  if (changed.text === old) return { error: `${step} already comes after ${after.join(", ")}` };
  return { name, settings, step, after, old, text: changed.text };
}

/** `lineclear move <project> <step> --after <ids>`: applies a change of one step's `after` once the rule checks pass. */
export function moveMain(args: string[], out: (l: string) => void, env = process.env, now: () => Date = () => new Date()): number {
  if (args[0] === "--help" || args[0] === "-h") return (out(USAGE[0]!), 0);
  const [rawName, rawStep, flag, value, ...extra] = args;
  if (!rawName || !rawStep || flag !== "--after" || !value || extra.length > 0) return (USAGE.slice(0, 1).forEach((l) => out(l)), 2);
  const fail = (m: string) => (out(`lineclear move: ${m}`), 1);
  const move = checkedMove(rawName, rawStep, value, env);
  if ("error" in move) return fail(move.error);
  const { name, settings, step, after, old } = move;
  const changed = { text: move.text };
  const question = `Move ${step} in ${name} to come after ${after.join(", ")}?`;
  const diff = `- after: ${
    checkRoadmap(old)
      .parsed.steps.find((s) => s.id === step)!
      .after.join(", ") || "none"
  }\n+ after: ${after.join(", ")}`;
  // the rule checks decide, and the owner can undo it
  const problems = planProblems(old, changed.text);
  if (problems.length > 0) return fail(`the rule checks refuse this move: ${problems.join("; ")}`);
  const base = gitAsLineclear(settings.repo, "rev-parse", "HEAD").out.trim();
  const problem = applyMove({ move: { step, after }, project: name } as Item, env);
  if (problem) return fail(problem);
  const commit = gitAsLineclear(settings.repo, "rev-parse", "HEAD").out.trim();
  const done = recordApplied(
    { kind: "choice", task: "-", project: name, question, choices: ["Approve", "Reject"], diff, move: { step, after }, since: now().toISOString() },
    base,
    commit,
    now(),
    env,
  );
  out(
    `inbox ${done.n}: ${step} in ${name} now comes after ${after.join(", ")}. It applied by itself, the owner can undo it.${looseNote([
      [rawName, name],
      [rawStep, step],
    ])}`,
  );
  return 0;
}

/** Applies a move: commits the new `after` on the project's main. Returns an error line, or undefined when done. */
function applyMove(item: Item, env = process.env): string | undefined {
  if (!item.move || !item.project) return "this item has no move to apply";
  const settings = readSettings(item.project, env);
  if (typeof settings === "string") return settings;
  const repo = settings.repo;
  if (gitAsLineclear(repo, "rev-parse", "--abbrev-ref", "HEAD").out.trim() !== "main") return `${repo} is not on main, switch it to main and try again`;
  if (gitAsLineclear(repo, "status", "--porcelain", "--", "docs/ROADMAP.md").out.trim() !== "")
    return "docs/ROADMAP.md has uncommitted changes, commit or undo them and try again";
  const file = join(repo, "docs", "ROADMAP.md");
  const changed = withAfter(readFileSync(file, "utf8"), item.move.step, item.move.after);
  if ("error" in changed) return changed.error;
  writeAtomic(file, changed.text);
  const c = gitAsLineclear(repo, "commit", "-q", "-m", `Lineclear: move ${item.move.step} after ${item.move.after.join(", ")}`, "--", "docs/ROADMAP.md");
  if (!c.ok) return `git commit failed: ${c.err}`;
  // Lineclear pushes this one commit itself (agents never push), so main and the project's remote stay level.
  if (gitAsLineclear(repo, "remote", "get-url", "origin").ok) {
    const p = gitAsLineclear(repo, "push", "-q", "origin", "main");
    if (!p.ok) {
      gitAsLineclear(repo, "reset", "-q", "--hard", "HEAD~1");
      return `git push failed, nothing changed: ${p.err}`;
    }
  }
  return undefined;
}

/** The Dispatcher's brief, from `templates/dispatcher.md`. */
export function dispatcherPrompt(): string {
  return `${readFileSync(join(import.meta.dir, "..", "templates", "dispatcher.md"), "utf8").trimEnd()}\n\n${ownerDirection()}\n`;
}

/** The smallest model that keeps `bun run dispatcher:eval` at 95 % or more (sonnet-5-5 scored 98 %, haiku-5-5 90 % at best). */
export const DISPATCHER_MODEL = "claude-bridge/claude-sonnet-5-5";

/** True when the space stores `value` for `key` itself, as `lineclear show` prints it. */
const isStored = (run: (...a: string[]) => { stdout: Buffer }, key: string, value: string) =>
  run("show", "--space", DISPATCHER_SPACE)
    .stdout.toString()
    .split("\n")
    .some((l) => l.startsWith(`${key} `) && l.slice(key.length).trim().startsWith(`${value} (this space)`));

/** `lineclear dispatcher setup`: makes the Dispatcher's space, in regular mode, with pi and DISPATCHER_MODEL as its coordinator. Safe to run again. */
export function dispatcherMain(args: string[], out: (l: string) => void, env = process.env): number {
  if (args.length === 1 && args[0] === "projects") return projectsMain(out, env);
  if (args.length !== 1 || args[0] !== "setup") return (USAGE.slice(1).forEach((l) => out(l)), 2);
  const dir = dispatcherDir(env);
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, "AGENTS.md"), dispatcherPrompt());
  if (!existsSync(join(dir, ".git"))) {
    const i = gitAsLineclear(dir, "init", "-q", "-b", "main");
    if (!i.ok) return (out(`lineclear dispatcher: git init failed: ${i.err}`), 1);
  }
  gitAsLineclear(dir, "add", "AGENTS.md");
  gitAsLineclear(dir, "commit", "-q", "-m", "Dispatcher prompt", "--", "AGENTS.md");
  const run = (...a: string[]) => Bun.spawnSync([lineclear(env), ...a], { stdin: "ignore" });
  const listing = run("space", "list");
  const exists =
    listing.exitCode === 0 &&
    listing.stdout
      .toString()
      .split("\n")
      .some((l) => l.trim().split(/\s{2,}/)[0] === DISPATCHER_SPACE);
  const steps = [
    ...(exists ? [] : [["space", "add", dir, "--name", DISPATCHER_SPACE]]),
    ["mode", DISPATCHER_SPACE, "regular"],
    ["set", "coordinator.agent", "pi", "--space", DISPATCHER_SPACE],
    ["set", "coordinator.model", DISPATCHER_MODEL, "--space", DISPATCHER_SPACE],
  ];
  for (const s of steps) {
    const p = run(...s);
    // The set can store the value and still fail on restarting the coordinator where no local runtime runs: the stored value decides.
    if (p.exitCode !== 0 && !(s[0] === "set" && isStored(run, s[1]!, s[2]!)))
      return (out(`lineclear dispatcher: lineclear ${s.slice(0, 2).join(" ")} failed: ${(p.stderr.toString() || p.stdout.toString()).trim()}`), 1);
  }
  out(`the Dispatcher is the chat of the space '${DISPATCHER_SPACE}' (${dir}).`);
  return 0;
}
