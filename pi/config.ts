import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Lineclear's config folder (`LINECLEAR_CONFIG`, else `~/.config/lineclear`): the one place that says where it is. */
export const configDir = (env: Record<string, string | undefined> = process.env): string =>
  env.LINECLEAR_CONFIG || join(env.HOME ?? homedir(), ".config", "lineclear");

/** Reads a JSON file. Undefined when it is missing or not valid JSON, so a caller falls back to its default. */
export const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

/** Where the rule loop logs its choices. */
export const decisionsPath = (env: Record<string, string | undefined> = process.env): string => join(configDir(env), "decisions.jsonl");
