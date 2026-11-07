import { writeAtomic } from "../pi/atomic.ts";
import {
  type AskBefore,
  askBeforeKeys,
  NAME,
  type Role,
  readProjectFile,
  roles,
  type Settings,
  settingsPath,
  splitHeavy,
  type Tier,
  type TierSpec,
  tierNames,
  tiersOf,
} from "./project.ts";

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
  if (typeof change !== "object" || change === null) return "the tiers must be inner, merge and heavy";
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
  const s = NAME.test(name) ? readProjectFile(name, env) : `no project named '${name}'`;
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
