import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir } from "../pi/config.ts";
import { ENDLESS, scriptRunner } from "./project-detect.ts";

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
  /** Other machines (SSH hosts) that may run this project's steps when this one has no room. */
  machines?: string[];
  /** False keeps the project off this machine: it starts only on its `machines`. True if unset. */
  local?: boolean;
  /** False: this machine's loop starts no step for the repo and only runs what it is given. True if unset. */
  starts?: boolean;
  /** What waits for the owner. Missing means the default: plans off, releases and spending on. */
  askBefore?: Partial<AskBefore>;
  /** Paused: the rules start none of its steps. Missing means Running. */
  paused?: boolean;
  /** False turns the step check's model call off; the form rule stays. Missing means on. */
  stepCheck?: boolean;
  /** Which checks run when: missing means what `proposeTiers` reads from the repo. */
  tiers?: Partial<Record<Tier, Partial<TierSpec>>>;
};

/** One tier of checks: its commands, run in turn, and the seconds they may take together on an idle machine. */
export type Tier = "inner" | "merge" | "heavy";

export interface TierSpec {
  commands: string[];
  budgetS: number;
}

export type Tiers = Record<Tier, TierSpec>;

export const tierNames: readonly Tier[] = ["inner", "merge", "heavy"];
/** inner runs on the changed files while working, merge once per task in the merge lane, heavy the slow rest, run after a merge. */
const BUDGET_S: Record<Tier, number> = { inner: 30, merge: 180, heavy: 3600 };

/** What the owner is asked before: a plan or roadmap change, a release (what leaves for the public), spending beyond the budget. */
export interface AskBefore {
  plans: boolean;
  releases: boolean;
  spending: boolean;
}

export const askBeforeKeys = ["plans", "releases", "spending"] as const;
export const ASK_BEFORE_DEFAULT: AskBefore = { plans: false, releases: true, spending: true };

/** The owner's choices with the defaults filled in. */
export const askBefore = (s: Pick<Settings, "askBefore">): AskBefore => ({ ...ASK_BEFORE_DEFAULT, ...s.askBefore });

/** Asks one question and returns the answer. Null means nobody can be asked. */
export type Ask = ((question: string) => Promise<string>) | null;

export const NAME = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function projectsDir(env = process.env): string {
  return join(configDir(env), "projects");
}

/** The cards the rules told, kept per project. Before it had this name the file held every card ever told; those ids are dropped on the next tick. */
export function toldPath(project: string, env = process.env): string {
  const file = join(projectsDir(env), project, "asks-told.json");
  const old = join(projectsDir(env), project, "asks-routed.json");
  if (!existsSync(file) && existsSync(old)) renameSync(old, file);
  return file;
}

export const settingsPath = (name: string, env = process.env) => join(projectsDir(env), name, "settings.json");

const storePath = (env = process.env) => join(configDir(env), "settings.json");

/** The store from before settings.json: read once to migrate, then deleted. */
const legacySetupPath = (env = process.env) => join(configDir(env), "setup.json");

/** The machine store's format. A file with no `version` is version 1. */
const STORE_VERSION = 2;

type Store = { version: number; setup: Setup };

/** Reads a JSON object, or throws a message that names the file: a bad file is never read as empty, so no later save writes over it. */
function readObject(file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} cannot be read as JSON (${(e as Error).message}); fix or remove the file, it is left unchanged`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${file} is not a JSON object; fix or remove the file, it is left unchanged`);
  return value as Record<string, unknown>;
}

/** The machine store, migrated to the current version: the old file is kept as settings.json.v<n>.bak and the new one written atomically. */
function readStore(env: NodeJS.ProcessEnv): Store {
  const file = storePath(env);
  if (!existsSync(file)) return { version: STORE_VERSION, setup: {} };
  const raw = readObject(file);
  const version = raw.version === undefined ? 1 : raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1)
    throw new Error(`${file} has an unknown settings version ${JSON.stringify(version)}`);
  if (version > STORE_VERSION) throw new Error(`${file} is settings version ${version}, newer than this Lineclear reads (${STORE_VERSION}); update Lineclear`);
  const setup = (raw.setup ?? {}) as Setup;
  if (version === STORE_VERSION) return { version, setup };
  writeAtomic(`${file}.v${version}.bak`, readFileSync(file, "utf8"));
  writeAtomic(file, `${JSON.stringify({ version: STORE_VERSION, setup }, null, 2)}\n`);
  return { version: STORE_VERSION, setup };
}

/** The settings version the machine store is in, after any migration. Throws when the file cannot be read. */
export const storeVersion = (env = process.env): number => readStore(env).version;

/** Writes the role models into the one store, the file Settings writes. */
export function writeSetup(next: Setup, env = process.env): void {
  mkdirSync(configDir(env), { recursive: true });
  writeAtomic(storePath(env), `${JSON.stringify({ version: STORE_VERSION, setup: next }, null, 2)}\n`);
}

/** The model chosen for each role: the machine's defaults, which a project's own `models` override. */
export function readSetup(env = process.env): Setup {
  const legacy = legacySetupPath(env);
  const stored = readStore(env).setup;
  if (!existsSync(legacy)) return stored;
  const merged = { ...(readObject(legacy) as Setup), ...stored };
  writeSetup(merged, env);
  rmSync(legacy, { force: true });
  return merged;
}

/** Saves the chosen models over the earlier ones. A reviewer of the worker's company is refused, and nothing is saved. */
export function saveSetup(choice: Setup, companyOf: (model: string) => string, env = process.env): string | undefined {
  const next = { ...readSetup(env), ...choice };
  if (next.worker && next.reviewer && companyOf(next.worker) === companyOf(next.reviewer))
    return `the reviewer ${next.reviewer} is from the worker's company, choose a reviewer from another company`;
  writeSetup(next, env);
  return undefined;
}

/** The line that stops `run` and `project add` until every role has a model, or undefined when none is missing. */
export function setupGate(env = process.env): string | undefined {
  let chosen: Setup;
  try {
    chosen = readSetup(env);
  } catch (e) {
    return (e as Error).message;
  }
  const missing = setupRoles.filter((r) => !chosen[r]);
  return missing.length ? `no model chosen for the ${missing.join(", ")}: run 'lineclear setup'` : undefined;
}

/** A script light enough to run on every change: types, or a lint or test marked fast (also in Finnish: nopea, kevyt). */
const FAST_SCRIPT = /^(types|typecheck|tsc|(lint|test|unit|types):(fast|quick|changed|nopea|kevyt)|[\w-]+:(fast|quick|changed|nopea|kevyt))$/;
/** A script for the heavy run, by its name: coverage, browser suites, mutation tests, duplication scans, whole-repo verifies. */
const SLOW_SCRIPT = /(coverage|kattavuus|e2e|playwright|cypress|mutation|mutaatio|stryker|jscpd|verify|bench|:full$|ui:test)/;

/**
 * The tiers a repo's package.json suggests. A repo that names them (`check:inner`, `check:heavy`)
 * gets those; else inner takes the fast scripts, merge the check, and heavy the scripts it is too slow for.
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
  const heavy = (n: string) => n !== "check" && `${runner} ${n}` !== check && SLOW_SCRIPT.test(n);
  return {
    inner: { commands: named("inner") ?? names.filter((n) => FAST_SCRIPT.test(n)).map((n) => `${runner} ${n}`), budgetS: BUDGET_S.inner },
    // the merge tier is the project's check, so the merge lane and a changed check never part
    merge: { commands: [check], budgetS: BUDGET_S.merge },
    heavy: { commands: named("heavy") ?? names.filter(heavy).map((n) => `${runner} ${n}`), budgetS: BUDGET_S.heavy },
  };
}

/** A project's tiers: its own, with what it leaves out filled in from the repo and the default budgets. */
export function tiersOf(s: Pick<Settings, "repo" | "check" | "tiers">): Tiers {
  let proposed: Tiers | undefined;
  const one = (t: Tier): TierSpec => {
    // a settings file written before the rename keeps its heavy tier under the old name
    const own = s.tiers?.[t] ?? (t === "heavy" ? (s.tiers as Record<string, TierSpec> | undefined)?.nightly : undefined);
    if (!own?.commands) proposed = proposed ?? proposeTiers(s.repo, s.check);
    const commands = own?.commands ?? (proposed as Tiers)[t].commands;
    return { commands, budgetS: own?.budgetS ?? BUDGET_S[t] };
  };
  return { inner: one("inner"), merge: one("merge"), heavy: one("heavy") };
}

export const splitHeavy = (text: string) => [
  ...new Set(
    text
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean),
  ),
];

/** A role the project names no model for starts on the machine's chosen one. */
function withSetupModels(s: Settings, env: NodeJS.ProcessEnv): Settings {
  const setup = readSetup(env);
  const models = { ...s.models };
  for (const role of roles) if (!models[role]?.length && setup[role]) models[role] = [setup[role]];
  return { ...s, models: models as Settings["models"] };
}

export function readProjectFile(name: string, env: NodeJS.ProcessEnv): Settings | string {
  const file = settingsPath(name, env);
  if (!existsSync(file)) return `no project named '${name}'`;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Settings;
  } catch {
    return `settings of '${name}' are not valid JSON: ${file}`;
  }
}

export function readSettings(name: string, env: NodeJS.ProcessEnv = process.env): Settings | string {
  const s = readProjectFile(name, env);
  if (typeof s === "string") return s;
  try {
    return withSetupModels(s, env);
  } catch (e) {
    return (e as Error).message;
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
