import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Usage } from "./session-text.ts";

export type Env = Record<string, string | undefined>;

/** A fault a harness's own text names, by kind. */
type StallSignal = "usage-limit";

/** A folder of session files the harness keeps for one working folder. */
export interface SessionFolder {
  name: string;
  /** Session file paths, oldest name first. */
  files: string[];
}

/**
 * What the core asks of an agent harness (pi is the first). Everything that is specific to one harness, the folder its
 * sessions live in, the command that starts it and the words of its faults, is behind this interface.
 */
export interface Harness {
  name: string;
  /** The argv that starts an agent on `model` with `prompt`. */
  start(model: string | undefined, prompt: string): string[];
  /** The harness's own folder; `models-store.json` and the like live there. */
  home(env: Env): string;
  /** Where the session files of a harness folder `home` are. */
  sessionsRoot(home: string): string;
  /** The folder that holds the session files of a working folder (it may not exist). */
  sessionFolderPath(worktree: string, env: Env): string;
  /** The session files of a working folder, none when it has no sessions. */
  sessionFiles(worktree: string, env: Env): string[];
  /** The text of each session file of a working folder. */
  readSessions(worktree: string, env: Env): string[];
  /** Every session folder the harness keeps. */
  allSessionFolders(env: Env): SessionFolder[];
  /** The assistant messages of one session text, with their tokens. */
  usage(sessionText: string): Usage[];
  /** The fault kind a message names, or undefined. */
  stallSignal(text: string): StallSignal | undefined;
}

const USAGE_LIMIT = /usage limit|quota|\b429\b.*(limit|too many|rate)|(limit|too many|rate).*\b429\b/i;

/** The fault words every harness shares. */
export const stallFromText = (text: string): StallSignal | undefined => (USAGE_LIMIT.test(text) ? "usage-limit" : undefined);

/** The `.jsonl` files of a folder, by name; none when it is missing or not a folder. */
export function jsonlFiles(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .map((f) => join(folder, f));
  } catch {
    // missing, or a stray file where a folder should be: no sessions
    return [];
  }
}
