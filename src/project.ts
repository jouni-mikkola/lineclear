import { serverBin } from "./paths.ts";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir } from "../pi/config.ts";
import { toolRun } from "../pi/heavy-tool.ts";
import { basename, join, resolve } from "node:path";
import type { Tier } from "./check-runs.ts";

export const roles = ["worker", "reviewer", "planner"] as const;
export type Role = (typeof roles)[number];

/** The roles the owner chooses a model for on first run, one model each and none by default. */
export const setupRoles = ["worker", "reviewer", "planner", "stepChecker"] as const;
export type SetupRole = (typeof setupRoles)[number];
export type Setup = Partial<Record<SetupRole, string>>;

export type Settings = {
  repo: string;
  space: string;
  check: string;
  health?: string;
  /** Commands that load the machine (the check, test and browser suites). The pi extension runs them in a check slot. */
  heavy?: string[];
  models: Record<Role, string[]>;
  /** Review rounds a worker may use before the step asks the owner. 2 if unset. */
  reviewRounds?: number;
  /** `spend` (default) holds no step for pace, only for a full account; `even` holds off-critical steps when every account is ahead of its weekly pace. */
  pace?: "spend" | "even";
  /** Other machines (SSH hosts) that may run this project's steps when this one has no room. */
  machines?: string[];
  /** False keeps the project off this machine: it starts only on its `machines`. True if unset. */
  local?: boolean;
  /** What waits for the owner. Missing means the default: plans off, releases and spending on. */
  askBefore?: Partial<AskBefore>;
  /** Paused: the rules start none of its steps. Missing means Running. */
  paused?: boolean;
  /** False turns the step check's model call off; the form rule stays. Missing means on. */
  stepCheck?: boolean;
  /** `release.promote`: `ask` waits for the owner's tap before a checked build becomes stable; missing means it promotes by itself. */
  release?: { promote?: "auto" | "ask" };
  /** Lineclear's own project: the one its fix steps go to. Found by its package name when no project says so. */
  self?: boolean;
  /** Which checks run when: missing means what `proposeTiers` reads from the repo. */
  tiers?: Partial<Record<Tier, Partial<TierSpec>>>;
};

/** One tier of checks: its commands, run in turn, and the seconds they may take together on an idle machine. */
interface TierSpec {
  commands: string[];
  budgetS: number;
}

export type Tiers = Record<Tier, TierSpec>;

export const tierNames: readonly Tier[] = ["inner", "merge", "nightly"];
/** inner runs on the changed files while working, merge once per task in the merge lane, nightly the heavy rest. */
const BUDGET_S: Record<Tier, number> = { inner: 30, merge: 180, nightly: 3600 };

/** What the owner is asked before: a plan or roadmap change, a release (what leaves for the public), spending beyond the budget. */
export interface AskBefore {
  plans: boolean;
  releases: boolean;
  spending: boolean;
}

export const askBeforeKeys = ["plans", "releases", "spending"] as const;
const ASK_BEFORE_DEFAULT: AskBefore = { plans: false, releases: true, spending: true };

/** The owner's choices with the defaults filled in. */
export const askBefore = (s: Pick<Settings, "askBefore">): AskBefore => ({ ...ASK_BEFORE_DEFAULT, ...s.askBefore });

/** Asks one question and returns the answer. Null means nobody can be asked. */
export type Ask = ((question: string) => Promise<string>) | null;

export const NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function projectsDir(env = process.env): string {
  return join(configDir(env), "projects");
}

const settingsPath = (name: string, env = process.env) => join(projectsDir(env), name, "settings.json");

const setupPath = (env = process.env) => join(configDir(env), "setup.json");

export function readSetup(env = process.env): Setup {
  try {
    return JSON.parse(readFileSync(setupPath(env), "utf8")) as Setup;
  } catch {
    return {};
  }
}

/** Saves the chosen models over the earlier ones. A reviewer of the worker's company is refused, and nothing is saved. */
export function saveSetup(choice: Setup, companyOf: (model: string) => string, env = process.env): string | undefined {
  const next = { ...readSetup(env), ...choice };
  if (next.worker && next.reviewer && companyOf(next.worker) === companyOf(next.reviewer))
    return `the reviewer ${next.reviewer} is from the worker's company, choose a reviewer from another company`;
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(setupPath(env), `${JSON.stringify(next, null, 2)}\n`);
  return undefined;
}

/** The line that stops `run` and `project add` until every role has a model, or undefined when none is missing. */
export function setupGate(env = process.env): string | undefined {
  const chosen = readSetup(env);
  const missing = setupRoles.filter((r) => !chosen[r]);
  return missing.length ? `no model chosen for the ${missing.join(", ")}: run 'lineclear setup'` : undefined;
}

/** The space whose folder is this repo, from `shepherdr space list`, or undefined. */
export function detectSpace(repo: string, env = process.env): string | undefined {
  let listing: string;
  try {
    const p = Bun.spawnSync([serverBin(env), "space", "list"], { stderr: "ignore" });
    if (p.exitCode !== 0) return undefined;
    listing = p.stdout.toString();
  } catch {
    return undefined; // no shepherdr to ask
  }
  for (const line of listing.split("\n")) {
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length >= 2 && cols.includes(repo)) return cols[0];
  }
  return undefined;
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
const ENDLESS = /(^|:)(watch|dev|serve|start|preview)($|:)/;

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
function scriptRunner(repo: string, check: string): string {
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

/** A script light enough to run on every change: types, or a lint or test marked fast (also in Finnish: nopea, kevyt). */
const FAST_SCRIPT = /^(types|typecheck|tsc|(lint|test|unit|types):(fast|quick|changed|nopea|kevyt)|[\w-]+:(fast|quick|changed|nopea|kevyt))$/;
/** A script for the nightly run, by its name: coverage, browser suites, mutation tests, duplication scans, whole-repo verifies. */
const NIGHTLY_SCRIPT = /(coverage|kattavuus|e2e|playwright|cypress|mutation|mutaatio|stryker|jscpd|verify|bench|:full$|ui:test|cold-start|one-name)/;

/**
 * The tiers a repo's package.json suggests. A repo that names them (`check:inner`, `check:nightly`)
 * gets those; else inner takes the fast scripts, merge the check, and nightly the heavy scripts it is too slow for.
 */
export function proposeTiers(repo: string, check: string): Tiers {
  let scripts: Record<string, unknown> = {};
  try {
    scripts = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"))?.scripts ?? {};
  } catch {
    // no package.json: the check alone, in the merge tier
  }
  const runner = `${scriptRunner(repo, check)} run`;
  const names = Object.keys(scripts).filter((n) => typeof scripts[n] === "string" && !ENDLESS.test(n));
  const named = (tier: Tier) => (names.includes(`check:${tier}`) ? [`${runner} check:${tier}`] : undefined);
  const nightly = (n: string) => n !== "check" && `${runner} ${n}` !== check && NIGHTLY_SCRIPT.test(n);
  return {
    inner: { commands: named("inner") ?? names.filter((n) => FAST_SCRIPT.test(n)).map((n) => `${runner} ${n}`), budgetS: BUDGET_S.inner },
    // the merge tier is the project's check, so the merge lane and a changed check never part
    merge: { commands: [check], budgetS: BUDGET_S.merge },
    nightly: { commands: named("nightly") ?? names.filter(nightly).map((n) => `${runner} ${n}`), budgetS: BUDGET_S.nightly },
  };
}

/** A project's tiers: its own, with what it leaves out filled in from the repo and the default budgets. */
export function tiersOf(s: Pick<Settings, "repo" | "check" | "tiers">): Tiers {
  let proposed: Tiers | undefined;
  const one = (t: Tier): TierSpec => {
    const own = s.tiers?.[t];
    if (!own?.commands) proposed = proposed ?? proposeTiers(s.repo, s.check);
    const commands = own?.commands ?? (proposed as Tiers)[t].commands;
    return { commands, budgetS: own?.budgetS ?? BUDGET_S[t] };
  };
  return { inner: one("inner"), merge: one("merge"), nightly: one("nightly") };
}

const splitHeavy = (text: string) => [
  ...new Set(
    text
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean),
  ),
];

const parseModels = (text: string) =>
  text
    .split(/[,\s]+/)
    .map((m) => m.trim())
    .filter(Boolean);

type Flags = Record<string, string>;

function parseFlags(args: string[]): { flags: Flags; rest: string[] } | string {
  const flags: Flags = {};
  const rest: string[] = [];
  const known = [
    "name",
    "space",
    "check",
    "health",
    "heavy",
    "paused",
    "step-check",
    ...roles,
    ...askBeforeKeys.map((k) => `ask-${k}`),
    ...tierNames,
    ...tierNames.map((t) => `${t}-budget`),
  ];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const key = a.slice(2);
    const value = args[i + 1];
    if (!known.includes(key)) return `unknown option '${a}'`;
    if (value === undefined) return `'${a}' needs a value`;
    const many = key === "heavy" || (tierNames as readonly string[]).includes(key);
    flags[key] = many && flags[key] !== undefined ? `${flags[key]}\n${value}` : value;
    i++;
  }
  return { flags, rest };
}

export async function addProject(args: string[], ask: Ask, out: (l: string) => void, env = process.env): Promise<number> {
  const parsed = parseFlags(args);
  if (typeof parsed === "string") return fail(out, parsed);
  const { flags, rest } = parsed;
  if (flags.paused !== undefined) return fail(out, "a new project is Running: pause it with 'lineclear project set <name> --paused on'");
  if (rest.length !== 1)
    return fail(
      out,
      "usage: lineclear project add <repo> [--name N] [--space S] [--check CMD] [--health CMD] [--heavy CMD]... [--worker M,M] [--reviewer M,M] [--planner M,M]",
    );
  const tierFlag = Object.keys(flags).find((f) => (tierNames as readonly string[]).includes(f.replace(/-budget$/, "")));
  if (tierFlag) return fail(out, `add proposes the tiers from the repo; change them after with 'lineclear project set <name> --${tierFlag} ...'`);
  const repo = resolve(rest[0]!);
  if (!existsSync(repo) || !statSync(repo).isDirectory()) return fail(out, `no such folder: ${repo}`);

  const name =
    flags.name ??
    basename(repo)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+/, "");
  if (!NAME.test(name)) return fail(out, `'${name}' is not a usable project name, pass --name (lowercase letters, numbers, - and _)`);
  if (existsSync(settingsPath(name, env))) return fail(out, `project '${name}' already exists, remove it first`);

  const missing: string[] = [];
  const need = async (flag: string, find: (() => string | undefined) | undefined, question: string): Promise<string> => {
    const have = flags[flag] ?? find?.();
    if (have !== undefined && parseModels(have).length > 0) return have;
    if (ask) {
      const answer = (await ask(question)).trim();
      if (parseModels(answer).length > 0) return answer;
    }
    missing.push(`--${flag}`);
    return "";
  };

  const space = await need("space", () => detectSpace(repo, env), "Name the space of this repo: ");
  if (space === "dispatcher") return fail(out, "the space 'dispatcher' is the Dispatcher's chat and holds no tasks, use the project's own space");
  const check = await need("check", () => detectCheck(repo), "Check command: ");
  const models = {} as Record<Role, string[]>;
  for (const role of roles) {
    const text = await need(role, undefined, `Models for the ${role}, best first, comma separated: `);
    models[role] = parseModels(text);
  }
  if (missing.length > 0) return fail(out, `cannot fill in ${missing.join(", ")}: pass ${missing.length > 1 ? "them" : "it"} as an option`);

  const settings: Settings = {
    repo,
    space,
    check,
    askBefore: { ...ASK_BEFORE_DEFAULT },
    ...(flags.health ? { health: flags.health } : {}),
    heavy: flags.heavy !== undefined ? splitHeavy(flags.heavy) : detectHeavy(repo, check),
    models,
  };
  mkdirSync(join(projectsDir(env), name), { recursive: true });
  writeAtomic(settingsPath(name, env), `${JSON.stringify(settings, null, 2)}\n`);
  out(`added project '${name}': ${settingsPath(name, env)}`);
  return 0;
}

export function readSettings(name: string, env = process.env): Settings | string {
  const file = settingsPath(name, env);
  if (!existsSync(file)) return `no project named '${name}'`;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Settings;
  } catch {
    return `settings of '${name}' are not valid JSON: ${file}`;
  }
}

export function listProjectNames(env = process.env): string[] {
  const dir = projectsDir(env);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((n) => existsSync(settingsPath(n, env)))
        .sort()
    : [];
}

/** What `project set` and the Settings view may change. An empty health removes it. */
export interface SettingsChange {
  check?: string;
  health?: string;
  heavy?: string[];
  models?: Partial<Record<Role, string[]>>;
  askBefore?: Partial<AskBefore>;
  /** Paused: the rules start none of its steps. Running: they do. */
  paused?: boolean;
  stepCheck?: boolean;
  tiers?: Partial<Record<Tier, Partial<TierSpec>>>;
}

/** The tiers with a change put in, or why the change cannot be. */
function changedTiers(s: Settings, change: NonNullable<SettingsChange["tiers"]>): Settings["tiers"] | string {
  if (typeof change !== "object" || change === null) return "the tiers must be inner, merge and nightly";
  // only the tiers the owner set are kept: the rest follow the repo and the check as they change
  const next: NonNullable<Settings["tiers"]> = { ...s.tiers };
  for (const [t, spec] of Object.entries(change)) {
    if (!(tierNames as readonly string[]).includes(t)) return `there is no tier '${t}'`;
    const tier = t as Tier;
    if (spec.commands !== undefined) {
      if (!Array.isArray(spec.commands) || !spec.commands.every((c) => typeof c === "string")) return `the ${t} tier's commands must be a list of text`;
      next[tier] = { ...next[tier], commands: splitHeavy(spec.commands.join("\n")) };
    }
    if (spec.budgetS !== undefined) {
      if (typeof spec.budgetS !== "number" || !Number.isFinite(spec.budgetS) || spec.budgetS <= 0) return `the ${t} tier's budget must be a number of seconds`;
      next[tier] = { ...next[tier], budgetS: spec.budgetS };
    }
  }
  if (tiersOf({ ...s, tiers: next }).merge.commands.length === 0) return "the merge tier needs a command";
  return next;
}

const MODEL = /^[^\s,]{1,200}$/;

/** Applies the plain fields of a change to `next`. Returns why one is wrong. */
function applyChange(next: Settings, change: SettingsChange): string | undefined {
  if (change.check !== undefined) {
    if (typeof change.check !== "string" || !change.check.trim()) return "the check command cannot be empty";
    next.check = change.check.trim();
  }
  if (change.health !== undefined) {
    if (typeof change.health !== "string") return "the health command must be text";
    if (change.health.trim()) next.health = change.health.trim();
    else delete next.health;
  }
  if (change.heavy !== undefined) {
    if (!Array.isArray(change.heavy) || !change.heavy.every((c) => typeof c === "string")) return "the heavy commands must be a list of text";
    next.heavy = splitHeavy(change.heavy.join("\n"));
  }
  return (
    changeModels(next, change.models) ?? changeAskBefore(next, change.askBefore) ?? changePaused(next, change.paused) ?? changeStepCheck(next, change.stepCheck)
  );
}

function changeModels(next: Settings, models: SettingsChange["models"]): string | undefined {
  for (const [role, list] of Object.entries(models ?? {})) {
    if (!(roles as readonly string[]).includes(role)) return `there is no role '${role}'`;
    if (!Array.isArray(list) || list.length === 0 || !list.every((m) => typeof m === "string" && MODEL.test(m)))
      return `the ${role}'s models must be a list of model names`;
    if (new Set(list).size !== list.length) return `the ${role}'s list names a model twice`;
    next.models[role as Role] = list;
  }
  return undefined;
}

function changeAskBefore(next: Settings, askBeforeChange: SettingsChange["askBefore"]): string | undefined {
  if (askBeforeChange === undefined) return undefined;
  const given = askBeforeChange as Record<string, unknown>;
  if (typeof given !== "object" || given === null) return "ask me before must be plans, releases and spending";
  for (const [k, v] of Object.entries(given)) {
    if (!(askBeforeKeys as readonly string[]).includes(k)) return `there is nothing to ask before called '${k}'`;
    if (typeof v !== "boolean") return `ask me before ${k} must be on or off`;
  }
  next.askBefore = { ...next.askBefore, ...askBeforeChange };
  return undefined;
}

function changeStepCheck(next: Settings, stepCheck: boolean | undefined): string | undefined {
  if (stepCheck === undefined) return undefined;
  if (typeof stepCheck !== "boolean") return "step check must be true or false";
  Object.assign(next, { stepCheck: stepCheck ? undefined : false });
  return undefined;
}

function changePaused(next: Settings, paused: boolean | undefined): string | undefined {
  if (paused === undefined) return undefined;
  if (typeof paused !== "boolean") return "paused must be true or false";
  if (paused) next.paused = true;
  else delete next.paused;
  return undefined;
}

/** Changes a project's settings in its settings.json, the file the CLI and the rules read. Returns why it cannot. */
export function changeSettings(name: string, change: SettingsChange, env = process.env): Settings | string {
  const s = NAME.test(name) ? readSettings(name, env) : `no project named '${name}'`;
  if (typeof s === "string") return s;
  const next: Settings = { ...s, models: { ...s.models } };
  const problem = applyChange(next, change);
  if (problem) return problem;
  const tiers = change.tiers === undefined ? next.tiers : changedTiers(next, change.tiers);
  if (typeof tiers === "string") return tiers;
  next.tiers = tiers;
  writeAtomic(settingsPath(name, env), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** The tier flags of `project set` as a change, or why they are wrong. */
function tierFlags(flags: Record<string, string | undefined>): Partial<Record<Tier, Partial<TierSpec>>> | string {
  const tiers: Partial<Record<Tier, Partial<TierSpec>>> = {};
  for (const t of tierNames) {
    const commands = flags[t];
    const budget = flags[`${t}-budget`];
    if (budget !== undefined && !/^\d+$/.test(budget)) return `--${t}-budget takes whole seconds`;
    if (commands !== undefined || budget !== undefined)
      tiers[t] = { ...(commands !== undefined ? { commands: splitHeavy(commands) } : {}), ...(budget !== undefined ? { budgetS: Number(budget) } : {}) };
  }
  return tiers;
}

export function setProject(args: string[], out: (l: string) => void, env = process.env): number {
  const parsed = parseFlags(args);
  if (typeof parsed === "string") return fail(out, parsed);
  const { flags, rest } = parsed;
  if (rest.length !== 1 || flags.name || flags.space || Object.keys(flags).length === 0) {
    return fail(
      out,
      "usage: lineclear project set <name> [--check CMD] [--health CMD] [--heavy CMD]... [--worker M,M] [--reviewer M,M] [--planner M,M] [--ask-plans on|off] [--ask-releases on|off] [--ask-spending on|off] [--inner CMD]... [--merge CMD]... [--nightly CMD]... [--inner-budget S] [--merge-budget S] [--nightly-budget S] [--paused on|off] [--step-check on|off]",
    );
  }
  const paused = flags.paused;
  if (paused !== undefined && paused !== "on" && paused !== "off") return fail(out, "--paused takes on or off");
  const stepCheck = flags["step-check"];
  if (![undefined, "on", "off"].includes(stepCheck)) return fail(out, "--step-check takes on or off");
  const ask: Partial<AskBefore> = {};
  for (const k of askBeforeKeys) {
    const v = flags[`ask-${k}`];
    if (v === undefined) continue;
    if (v !== "on" && v !== "off") return fail(out, `--ask-${k} takes on or off`);
    ask[k] = v === "on";
  }
  const models: Partial<Record<Role, string[]>> = {};
  for (const role of roles) if (flags[role] !== undefined) models[role] = parseModels(flags[role]);
  const tiers = tierFlags(flags);
  if (typeof tiers === "string") return fail(out, tiers);
  const r = changeSettings(
    rest[0]!,
    {
      check: flags.check,
      health: flags.health,
      heavy: flags.heavy === undefined ? undefined : splitHeavy(flags.heavy),
      models,
      ...(Object.keys(ask).length ? { askBefore: ask } : {}),
      ...(paused ? { paused: paused === "on" } : {}),
      ...(stepCheck ? { stepCheck: stepCheck === "on" } : {}),
      ...(Object.keys(tiers).length ? { tiers } : {}),
    },
    env,
  );
  if (typeof r === "string") return fail(out, r);
  out(`saved project '${rest[0]}': ${settingsPath(rest[0]!, env)}`);
  if (paused) out(`${rest[0]} is ${paused === "on" ? "Paused: the rules start none of its steps" : "Running: the rules start its next steps"}`);
  return 0;
}

export function removeProject(name: string, out: (l: string) => void, env = process.env): number {
  if (!NAME.test(name) || !existsSync(settingsPath(name, env))) return fail(out, `no project named '${name}'`);
  rmSync(join(projectsDir(env), name), { recursive: true });
  out(`removed project '${name}' (its repo is untouched)`);
  return 0;
}

export function fail(out: (l: string) => void, message: string): number {
  out(`lineclear project: ${message}`);
  return 1;
}
