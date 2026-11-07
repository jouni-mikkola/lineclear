import { type Account, readAccounts } from "./full.ts";
import { type AskBefore, askBefore, listProjectNames, readSettings, type Role } from "./project.ts";
import { secretNames } from "./secrets.ts";
import type { MachineView } from "./machines.ts";
import type { Env } from "./web-guard.ts";

/** A project as the Settings view shows it: its commands, its model lists, and its secrets by name only. */
export interface ProjectSettings {
  name: string;
  repo: string;
  check: string;
  health?: string;
  models: Record<Role, string[]>;
  secrets: string[];
  askBefore: AskBefore;
}

export interface SettingsData {
  machines: MachineView[];
  projects: ProjectSettings[];
  /** Each account Lineclear knows with what its subscription costs a month, when the owner set it. */
  accounts: AccountSetting[];
  /** Paused projects and the test space show on Home and in the places list. */
  showPaused: boolean;
}

export interface AccountSetting {
  account: string;
  kind: Account["kind"];
  price?: number;
  currency?: string;
  /** The owner stopped using it: it is left out. */
  retired?: boolean;
}

/** The accounts with a price or a retirement noted, as the owner set them. One with no price, no use and no retirement is not listed. */
export function accountSettings(env: Env): AccountSetting[] {
  const noted = readAccounts(env as NodeJS.ProcessEnv);
  return Object.keys(noted)
    .sort()
    .filter((account) => noted[account]?.price !== undefined || noted[account]?.retired)
    .map((account) => {
      const a = noted[account];
      return {
        account,
        kind: a?.kind ?? "subscription",
        ...(a?.price !== undefined && a.currency ? { price: a.price, currency: a.currency } : {}),
        ...(a?.retired ? { retired: true } : {}),
      };
    });
}

export function projectSettings(env: Env): ProjectSettings[] {
  const out: ProjectSettings[] = [];
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv);
    if (typeof s === "string") continue;
    const models = { worker: s.models?.worker ?? [], reviewer: s.models?.reviewer ?? [], planner: s.models?.planner ?? [] };
    out.push({
      name,
      repo: s.repo,
      check: s.check,
      ...(s.health ? { health: s.health } : {}),
      models,
      secrets: secretNames(name, env),
      askBefore: askBefore(s),
    });
  }
  return out;
}
