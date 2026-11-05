// The one way to ask a model a question; below the planner and the done proof so neither imports the other.

/** What the step checkers may read and write, in tokens. */
export const INPUT_MAX_TOKENS = 6000;
export const ANSWER_MAX_TOKENS = 400;

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
