import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Env, type Harness, jsonlFiles, type SessionFolder, stallFromText } from "./harness.ts";
import type { Usage } from "./session-text.ts";

const home = (env: Env) => env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

const sessionsRoot = (h: string) => join(h, "projects");

/** Claude Code keeps a folder of sessions per working folder: its path with every non-alphanumeric as `-`. */
const folderPath = (worktree: string, env: Env) => join(sessionsRoot(home(env)), worktree.replace(/[^a-zA-Z0-9]/g, "-"));

const sessionFiles = (worktree: string, env: Env) => (worktree ? jsonlFiles(folderPath(worktree, env)) : []);

/** One assistant message is written once per content block; the message id counts it once. */
function usage(text: string): Usage[] {
  const seen = new Set<string>();
  const out: Usage[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"usage"')) continue;
    try {
      const m = JSON.parse(line)?.message;
      if (m?.role !== "assistant" || !m.usage) continue;
      if (m.id) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
      }
      out.push({
        model: String(m.model ?? ""),
        provider: "anthropic",
        input: m.usage.input_tokens ?? 0,
        output: m.usage.output_tokens ?? 0,
        cacheRead: m.usage.cache_read_input_tokens ?? 0,
        cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
      });
    } catch {
      // a half-written last line counts nothing
    }
  }
  return out;
}

export const claudeHarness: Harness = {
  name: "claude",
  start: (model, prompt) => ["claude", ...(model ? ["--model", model] : []), prompt],
  home,
  sessionsRoot,
  sessionFolderPath: folderPath,
  sessionFiles,
  readSessions: (worktree, env) => sessionFiles(worktree, env).map((f) => readFileSync(f, "utf8")),
  allSessionFolders(env): SessionFolder[] {
    const root = sessionsRoot(home(env));
    if (!existsSync(root)) return [];
    return readdirSync(root).map((name) => ({ name, files: jsonlFiles(join(root, name)) }));
  },
  usage,
  stallSignal: stallFromText,
};
