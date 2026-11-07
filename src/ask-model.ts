import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { piDir } from "./paths.ts";

// The one way to ask a model a question; below the planner and the done proof so neither imports the other.

/** What the step checkers may read and write, in tokens. */
export const INPUT_MAX_TOKENS = 6000;
export const ANSWER_MAX_TOKENS = 400;

/** Extension files and package folders pi would discover: the agent's own extensions and the packages of its settings. */
function extensionRoots(dir: string): string[] {
  const own = join(dir, "extensions");
  const roots = existsSync(own)
    ? readdirSync(own)
        .sort()
        .map((f) => join(own, f))
    : [];
  try {
    const packages: unknown = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).packages;
    for (const p of Array.isArray(packages) ? packages : []) {
      if (typeof p === "string" && p.startsWith("npm:")) roots.push(join(dir, "npm", "node_modules", p.slice(4).replace(/@[^/@]*$/, "")));
    }
  } catch {
    // no settings: only the agent's own extensions
  }
  return roots;
}

function sourceFiles(path: string, depth = 2): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return path.endsWith(".ts") ? [path] : [];
  if (depth === 0) return [];
  return readdirSync(path)
    .sort()
    .flatMap((name) => (name === "node_modules" ? [] : sourceFiles(join(path, name), depth - 1)));
}

/** The provider extensions, when the model's provider comes from one. With --no-extensions pi lists only its built-in providers, so these are loaded by path. All of them load: an account variant of the bridge calls the bridge's own provider at run time. */
function providerExtensions(model: string | undefined, env: NodeJS.ProcessEnv): string[] {
  if (!model?.includes("/")) return [];
  const provider = model.split("/")[0];
  const texts = extensionRoots(piDir(env)).map((root) => ({ root, sources: sourceFiles(root).map((f) => readFileSync(f, "utf8")) }));
  const registering = texts.filter((t) => t.sources.some((s) => s.includes("registerProvider")));
  return registering.some((t) => t.sources.some((s) => s.includes(`"${provider}"`))) ? registering.map((t) => t.root) : [];
}

/** One model call. `command` is a shell command that reads the question on stdin and gets the model in `modelVar`; unset, pi -p without tools or a session: a tool-using agent answers with calls and an empty text. */
export function askModel(question: string, model: string | undefined, command: string | undefined, modelVar: string, env: NodeJS.ProcessEnv) {
  if (command) return Bun.spawnSync(["sh", "-c", command], { stdin: Buffer.from(question), env: { ...env, [modelVar]: model ?? "" }, timeout: 300_000 });
  return Bun.spawnSync(
    [
      env.PI_BIN ?? "pi",
      "-p",
      "--no-tools",
      "--no-session",
      "--no-extensions",
      ...providerExtensions(model, env).flatMap((e) => ["-e", e]),
      "--no-context-files",
      "--no-skills",
      ...(model ? ["--model", model] : []),
      question,
    ],
    {
      stdin: "ignore",
      env,
      timeout: 300_000,
    },
  );
}
