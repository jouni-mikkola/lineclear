import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toolRun } from "../pi/heavy-tool.ts";
import { boardSpaces } from "./board-store.ts";

/** The space whose folder is this repo, from the board's store, or undefined. */
export function detectSpace(repo: string, env = process.env): string | undefined {
  return boardSpaces(env).find((s) => s.path === repo)?.name;
}

/**
 * The check command: a `check` script in package.json or a `check` target in a Makefile, else the repo's own test
 * command (a `test` script, a Makefile `test` target, cargo, go or pytest), so a repo with tests needs no answer.
 */
export function detectCheck(repo: string): string | undefined {
  const has = (f: string) => existsSync(join(repo, f));
  let scripts: Record<string, unknown> = {};
  try {
    if (has("package.json")) scripts = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"))?.scripts ?? {};
  } catch {
    // an unreadable package.json detects nothing
  }
  const make = has("Makefile") ? readFileSync(join(repo, "Makefile"), "utf8") : "";
  if (typeof scripts.check === "string") return `${scriptRunner(repo, "")} run check`;
  if (/^check\s*:/m.test(make)) return "make check";
  // npm's placeholder test script only fails
  if (typeof scripts.test === "string" && !scripts.test.includes("no test specified")) return `${scriptRunner(repo, "")} run test`;
  if (/^test\s*:/m.test(make)) return "make test";
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("pyproject.toml") || has("pytest.ini") || has("setup.py")) return "python3 -m pytest";
  return undefined;
}

/** A package.json script that loads every core for a while: by its name, or by the tool it runs. */
const HEAVY_SCRIPT = /^(test|e2e|unit|verify|lint|build|svelte|playwright|cypress|(test|e2e|ui|unit|lint|build|web):.+|.+:(test|build|e2e))$/;
/** A script that never ends (a watch, a dev server) would hold its slot for good, so it never takes one. */
export const ENDLESS = /(^|:)(watch|dev|serve|start|preview)($|:)/;

/**
 * The check command and the scripts of package.json that test, build or lint the whole project (or a Makefile test
 * target): each runs in a check slot.
 */
export function detectHeavy(repo: string, check: string): string[] {
  const list = [check, ...heavyScripts(repo, check)];
  const make = join(repo, "Makefile");
  if (existsSync(make) && /^test\s*:/m.test(readFileSync(make, "utf8"))) list.push("make test");
  return [...new Set(list)];
}

/** The package manager that runs this repo's scripts: the check's own, else the one its lock file names. */
export function scriptRunner(repo: string, check: string): string {
  const known = /^(bun|pnpm|yarn|npm) run /.exec(check)?.[1];
  if (known) return known;
  if (existsSync(join(repo, "bun.lock")) || existsSync(join(repo, "bun.lockb"))) return "bun";
  if (existsSync(join(repo, "pnpm-lock.yaml"))) return "pnpm";
  return existsSync(join(repo, "yarn.lock")) ? "yarn" : "npm";
}

/** Is this package.json script a heavy run that ends (not the check itself, not a watcher or a server)? */
function heavyScript(n: string, body: unknown, repo: string): boolean {
  if (n === "check" || typeof body !== "string") return false;
  if (ENDLESS.test(n) || /(^|\s)--watch(All)?\b/.test(body)) return false;
  const tool = toolRun(body, repo);
  return tool === "heavy" || (tool === undefined && HEAVY_SCRIPT.test(n));
}

/** The heavy scripts of the repo's package.json, each as the command that runs it. */
function heavyScripts(repo: string, check: string): string[] {
  const pkg = join(repo, "package.json");
  if (!existsSync(pkg)) return [];
  try {
    const scripts = JSON.parse(readFileSync(pkg, "utf8"))?.scripts ?? {};
    const runner = `${scriptRunner(repo, check)} run`;
    return Object.keys(scripts)
      .filter((n) => heavyScript(n, scripts[n], repo))
      .map((n) => `${runner} ${n}`);
  } catch {
    // an unreadable package.json detects nothing more
    return [];
  }
}
