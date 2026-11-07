import { join } from "node:path";
import { writeAtomic } from "../pi/atomic.ts";
import { configDir, readJson } from "../pi/config.ts";

/** What the owner chose to see in the web pages. */
export interface Prefs {
  /** Paused projects and the test space show on Home and in the places list. */
  showPaused?: boolean;
}

/** The projects Home and the places list show: not the paused ones, unless the owner asked for them. */
export const shownProjects = <T extends { project?: string; paused?: boolean }>(list: T[], prefs: Prefs): T[] =>
  prefs.showPaused ? list : list.filter((p) => !p.paused);

const prefsPath = (env: NodeJS.ProcessEnv) => join(configDir(env), "prefs.json");

export const readPrefs = (env = process.env): Prefs => readJson(prefsPath(env)) ?? {};

/** Saves the choice; returns the problem when it is not a yes or no. */
export function setShowPaused(on: unknown, env = process.env): string | undefined {
  if (typeof on !== "boolean") return "showPaused must be true or false";
  writeAtomic(prefsPath(env), `${JSON.stringify({ ...readPrefs(env), showPaused: on }, null, 2)}\n`);
  return undefined;
}
