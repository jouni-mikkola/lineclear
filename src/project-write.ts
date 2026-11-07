import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { changeSettings } from "./project-change.ts";
import { detectCheck, detectHeavy, detectSpace } from "./project-detect.ts";
import {
  type Ask,
  ASK_BEFORE_DEFAULT,
  type AskBefore,
  askBeforeKeys,
  NAME,
  projectsDir,
  type Role,
  roles,
  type Settings,
  settingsPath,
  splitHeavy,
  type Tier,
  type TierSpec,
  tierNames,
} from "./project.ts";

const parseModels = (text: string) =>
  text
    .split(/[,\s]+/)
    .map((m) => m.trim())
    .filter(Boolean);

/** The tier flags of `project set`: --heavy already names the project's heavy tools, so the heavy tier is --after-merge. */
const tierFlagNames = ["inner", "merge", "after-merge"];
const tierFlagOf = (t: Tier) => (t === "heavy" ? "after-merge" : t);

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
    ...tierFlagNames,
    ...tierFlagNames.map((t) => `${t}-budget`),
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
    const many = key === "heavy" || tierFlagNames.includes(key);
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
  const tierFlag = Object.keys(flags).find((f) => tierFlagNames.includes(f.replace(/-budget$/, "")));
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

/** The tier flags of `project set` as a change, or why they are wrong. */
function tierFlags(flags: Record<string, string | undefined>): Partial<Record<Tier, Partial<TierSpec>>> | string {
  const tiers: Partial<Record<Tier, Partial<TierSpec>>> = {};
  for (const t of tierNames) {
    const flag = tierFlagOf(t);
    const commands = flags[flag];
    const budget = flags[`${flag}-budget`];
    if (budget !== undefined && !/^\d+$/.test(budget)) return `--${flag}-budget takes whole seconds`;
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
      "usage: lineclear project set <name> [--check CMD] [--health CMD] [--heavy CMD]... [--worker M,M] [--reviewer M,M] [--planner M,M] [--ask-plans on|off] [--ask-releases on|off] [--ask-spending on|off] [--inner CMD]... [--merge CMD]... [--after-merge CMD]... [--inner-budget S] [--merge-budget S] [--after-merge-budget S] [--paused on|off] [--step-check on|off]",
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
