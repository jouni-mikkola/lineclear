// Which command line runs a heavy tool straight: a browser suite, a build, a linter of the whole tree, or a whole test
// run. The pi extension sends those through a check slot; `project add` uses the same reading for package.json scripts.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** What a command does to the machine: `heavy` loads every core a while, `free` is a quick or a never-ending run. */
export type ToolRun = "heavy" | "free";

// the words in front of a command that only change how it runs
const WRAPPERS = new Set(["time", "command", "exec", "nohup"]);
// the package runners in front of a tool: npx eslint, bunx vite build, pnpm exec jest, bun x vitest
const RUNNERS = [["npx"], ["bunx"], ["bun", "x"], ["pnpm", "exec"], ["pnpm", "dlx"], ["npm", "exec"], ["yarn"]];
// a test runner's options that take the next word as their value
const VALUED = new Set([
  "--config",
  "-c",
  "--project",
  "--reporter",
  "--timeout",
  "--preload",
  "--workers",
  "-j",
  "--shard",
  "--max-workers",
  "--maxWorkers",
  "--root",
  "--dir",
  "--env-file",
  "--tsconfig-override",
  "--coverage-dir",
]);
// a test runner's options that pick some tests by name
const BY_NAME = /^(-t|-g|--grep|--test-name-pattern|--testNamePattern)(=|$)/;
// the usual folders of a whole suite, when the command runs from somewhere else (`cd x && bun test ./test`)
const WHOLE = /^(\.\/?|(\.\/)?(tests?|src|specs?|e2e|__tests__|packages|apps)\/?)$/;
const SOURCE = /\.([cm]?[jt]sx?|svelte|vue)$/;

/** the words of each command in a line, with quoted text made one opaque word so its separators do not count */
function commands(line: string): string[][] {
  const plain = line.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "Q");
  return plain
    .split(/[;&|()\n]+/)
    .map((c) => c.trim().split(/\s+/).filter(Boolean))
    .filter((w) => w.length > 0);
}

/** the index after the options from `i` on; an option in `valued` takes the next word too */
function pastOptions(w: string[], i: number, valued: string[]): number {
  while ((w[i] ?? "").startsWith("-")) i += valued.includes(w[i] ?? "") ? 2 : 1;
  return i;
}

// the commands in front that run the next one, and where that one starts
const FRONT: Record<string, (w: string[], i: number) => number> = {
  env: (w, i) => pastOptions(w, i + 1, ["-u", "--unset", "-C", "--chdir"]),
  timeout: (w, i) => pastOptions(w, i + 1, ["-k", "-s", "--kill-after", "--signal"]) + 1,
  nice: (w, i) => (w[i + 1] === "-n" ? i + 3 : /^-n?\d+$/.test(w[i + 1] ?? "") ? i + 2 : i + 1),
};

/** the words after the variables, env, timeout, nice and the like in front */
function strip(w: string[]): string[] {
  let i = 0;
  for (let x = w[0]; x !== undefined; x = w[i]) {
    const front = FRONT[x];
    if (front) i = front(w, i);
    else if (/^\w+=/.test(x) || WRAPPERS.has(x)) i++;
    else break;
  }
  const rest = w.slice(i);
  const runner = RUNNERS.find((r) => r.every((p, j) => rest[j] === p));
  return runner ? rest.slice(pastOptions(rest, runner.length, [])) : rest;
}

// a watch or a UI never ends: it would hold its slot for good
const ENDLESS = new Set(["--watch", "--watchAll", "-w", "--ui"]);

/** a test runner's arguments: free when they pick some files or names, or watch; heavy for the whole suite */
function testRun(args: string[], cwd?: string): ToolRun {
  const positional: string[] = [];
  // parallel workers load every core even for a few files
  if (args.some((a) => a === "--parallel" || a.startsWith("--parallel="))) return args.some((a) => ENDLESS.has(a)) ? "free" : "heavy";
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (ENDLESS.has(a) || BY_NAME.test(a)) return "free";
    if (VALUED.has(a)) i++;
    else if (!a.startsWith("-") && !/[<>]/.test(a) && !/^\d+$/.test(a)) positional.push(a);
  }
  const whole = (p: string) => WHOLE.test(p) || (cwd !== undefined && isDir(join(cwd, p)));
  return positional.every(whole) ? "heavy" : "free";
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/** a linter: free on some source files, heavy on a folder or the whole tree */
function lintRun(args: string[]): ToolRun {
  const files = args.filter((x) => !x.startsWith("-") && !/[<>]/.test(x));
  return files.length > 0 && files.every((f) => SOURCE.test(f)) ? "free" : "heavy";
}

// builds, by their first word or two, and the test runners with how many words their arguments start after
const BUILDS = new Set(["vite build", "next build", "cypress run", "svelte-check", "webpack", "tsc"]);
const TESTS: Record<string, number> = { "playwright test": 2, "bun test": 2, "vitest run": 2, vitest: 1, jest: 1 };

/** what one command does, or undefined when it runs no heavy tool */
function run(words: string[], cwd?: string): ToolRun | undefined {
  const w = strip(words);
  const one = w[0] ?? "";
  const two = w.slice(0, 2).join(" ");
  if (BUILDS.has(two) || BUILDS.has(one)) return w.some((x) => ENDLESS.has(x)) || w[1] === "serve" ? "free" : "heavy";
  if (one === "eslint" || one === "oxlint") return lintRun(w.slice(1));
  if (one === "vitest" && (w[1] === "watch" || w[1] === "dev")) return "free";
  const skip = TESTS[two] ?? TESTS[one];
  if (skip !== undefined) return testRun(w.slice(skip), cwd);
  if (one === "node" && w.includes("--test"))
    return testRun(
      w.slice(1).filter((x) => x !== "--test"),
      cwd,
    );
  return undefined;
}

/** what a command line does: heavy when any of its commands is, free when one runs a tool lightly, else undefined */
export function toolRun(line: string, cwd?: string): ToolRun | undefined {
  const runs = commands(line).map((w) => run(w, cwd));
  return runs.includes("heavy") ? "heavy" : runs.includes("free") ? "free" : undefined;
}
