import type { AccountSetting, Machine, ProjectSettings } from "../kit/index.ts";

// What Settings draws before any sample or answer: this machine alone. Kept apart so the first scripts do not carry the samples.

export interface SettingsData {
  machines: Machine[];
  projects: ProjectSettings[];
  accounts?: AccountSetting[];
  showPaused?: boolean;
}

export const DOCTOR_OK = [
  "ok     git",
  "ok     bun",
  "ok     herdr",
  "ok     pi",
  "ok     board server",
  "ok     lineclear files",
  "ok     lineclear command",
  "ok     PATH",
  "ok     pi extension",
  "ok     service",
  "All well.",
];
export const here: Machine = { host: "workstation", local: true, state: "ready", doctor: DOCTOR_OK, load: 1.42, limit: 8, slots: { total: 4, busy: 3 } };

export const emptySettings: SettingsData = { machines: [here], projects: [] };
