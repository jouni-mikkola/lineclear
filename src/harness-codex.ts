import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Env, type Harness, jsonlFiles, type SessionFolder, stallFromText } from "./harness.ts";
import type { Usage } from "./session-text.ts";

const home = (env: Env) => env.CODEX_HOME ?? join(homedir(), ".codex");

const sessionsRoot = (h: string) => join(h, "sessions");

/** Codex files its sessions by date, `sessions/YYYY/MM/DD/rollout-*.jsonl`; a "folder" here is one day. */
function dayFolders(root: string): string[] {
  const dirs = (d: string) => {
    try {
      return readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(d, e.name))
        .sort();
    } catch {
      // missing: no sessions
      return [];
    }
  };
  return dirs(root).flatMap(dirs).flatMap(dirs);
}

const allFiles = (env: Env) => dayFolders(sessionsRoot(home(env))).flatMap(jsonlFiles);

/** The working folder a session was started in, from its first line. */
function cwdOf(text: string): string | undefined {
  try {
    return JSON.parse(text.slice(0, text.indexOf("\n") < 0 ? undefined : text.indexOf("\n")))?.payload?.cwd;
  } catch {
    return undefined;
  }
}

const mine = (worktree: string, env: Env) =>
  worktree
    ? allFiles(env)
        .map((file) => ({ file, text: readFileSync(file, "utf8") }))
        .filter((s) => cwdOf(s.text) === worktree)
    : [];

function usage(text: string): Usage[] {
  const out: Usage[] = [];
  let model = "";
  let last = "";
  for (const line of text.split("\n")) {
    try {
      const e = JSON.parse(line);
      if (e?.type === "turn_context" && e.payload?.model) model = String(e.payload.model);
      const info = e?.type === "event_msg" && e.payload?.type === "token_count" ? e.payload.info : undefined;
      if (!info?.last_token_usage) continue;
      // codex repeats a token_count event; the running total tells a repeat
      const total = JSON.stringify(info.total_token_usage ?? info.last_token_usage);
      if (total === last) continue;
      last = total;
      const u = info.last_token_usage;
      out.push({
        model,
        provider: "openai",
        input: Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)),
        output: u.output_tokens ?? 0,
        cacheRead: u.cached_input_tokens ?? 0,
        cacheWrite: 0,
      });
    } catch {
      // a half-written last line counts nothing
    }
  }
  return out;
}

export const codexHarness: Harness = {
  name: "codex",
  start: (model, prompt) => ["codex", ...(model ? ["--model", model] : []), prompt],
  home,
  sessionsRoot,
  sessionFolderPath: (_worktree, env) => sessionsRoot(home(env)),
  sessionFiles: (worktree, env) => mine(worktree, env).map((s) => s.file),
  readSessions: (worktree, env) => mine(worktree, env).map((s) => s.text),
  allSessionFolders(env): SessionFolder[] {
    const root = sessionsRoot(home(env));
    if (!existsSync(root)) return [];
    return dayFolders(root).map((d) => ({ name: d.slice(root.length + 1), files: jsonlFiles(d) }));
  },
  usage,
  stallSignal: stallFromText,
};
