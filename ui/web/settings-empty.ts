import type { AccountSetting, ProjectSettings } from "../kit/index.ts";

// What Settings draws before any sample or answer: nothing. Kept apart so the first scripts do not carry the samples.

export interface SettingsData {
  projects: ProjectSettings[];
  accounts?: AccountSetting[];
  showPaused?: boolean;
}

export const emptySettings: SettingsData = { projects: [] };
