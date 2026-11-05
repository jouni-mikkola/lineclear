import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Env, type Harness, type SessionFolder, stallFromText } from "./harness.ts";
import type { Usage } from "./session-text.ts";

const home = (env: Env) => join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode");

/** opencode's JSON store: `storage/session/<project>/ses_*.json`, its messages in `storage/message/<session>/`. */
const sessionsRoot = (h: string) => join(h, "storage", "session");

const jsonIn = (folder: string): string[] => {
  try {
    return readdirSync(folder)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(folder, f));
  } catch {
    // missing: no sessions
    return [];
  }
};

const projects = (env: Env): string[] => {
  const root = sessionsRoot(home(env));
  return existsSync(root) ? readdirSync(root) : [];
};

const directoryOf = (file: string): string | undefined => {
  try {
    return JSON.parse(readFileSync(file, "utf8"))?.directory;
  } catch {
    return undefined;
  }
};

const sessionFiles = (worktree: string, env: Env) =>
  worktree
    ? projects(env)
        .flatMap((p) => jsonIn(join(sessionsRoot(home(env)), p)))
        .filter((f) => directoryOf(f) === worktree)
    : [];

/** A session as lines: its info, then each message of it, one JSON per line. */
function sessionText(file: string, env: Env): string {
  const id = file.slice(file.lastIndexOf("/") + 1, -".json".length);
  const lines = [file, ...jsonIn(join(home(env), "storage", "message", id))].map((f) => JSON.stringify(JSON.parse(readFileSync(f, "utf8"))));
  return `${lines.join("\n")}\n`;
}

function usage(text: string): Usage[] {
  const out: Usage[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"tokens"')) continue;
    try {
      const m = JSON.parse(line);
      if (m?.role !== "assistant" || !m.tokens) continue;
      out.push({
        model: String(m.modelID ?? ""),
        provider: String(m.providerID ?? ""),
        input: m.tokens.input ?? 0,
        output: m.tokens.output ?? 0,
        cacheRead: m.tokens.cache?.read ?? 0,
        cacheWrite: m.tokens.cache?.write ?? 0,
      });
    } catch {
      // a half-written line counts nothing
    }
  }
  return out;
}

export const opencodeHarness: Harness = {
  name: "opencode",
  start: (model, prompt) => ["opencode", ...(model ? ["--model", model] : []), "--prompt", prompt],
  home,
  sessionsRoot,
  sessionFolderPath: (_worktree, env) => sessionsRoot(home(env)),
  sessionFiles,
  readSessions: (worktree, env) => sessionFiles(worktree, env).map((f) => sessionText(f, env)),
  allSessionFolders: (env): SessionFolder[] => projects(env).map((name) => ({ name, files: jsonIn(join(sessionsRoot(home(env)), name)) })),
  usage,
  stallSignal: stallFromText,
};
