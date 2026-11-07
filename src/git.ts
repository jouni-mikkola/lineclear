export interface GitRun {
  ok: boolean;
  /** Standard output as git wrote it. */
  out: string;
  /** Standard error, trimmed. */
  err: string;
}

export interface GitOptions {
  env?: Record<string, string | undefined>;
  timeout?: number;
}

/** How long a tick waits for one read of the world. */
export const READ_TIMEOUT_MS = 10_000;

/** `git -C cwd <args>` with the given environment or time limit. */
export function gitWith(options: GitOptions, cwd: string, ...args: string[]): GitRun {
  const p = Bun.spawnSync(["git", "-C", cwd, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", ...options });
  const err = p.exitedDueToTimeout ? `git timed out after ${(options.timeout ?? 0) / 1000} s` : p.stderr.toString().trim();
  return { ok: p.exitCode === 0, out: p.stdout.toString(), err };
}

/** The text of a failed git run, or undefined when it worked. */
export const gitFailure = (r: GitRun) => (r.ok ? undefined : r.err || r.out.trim() || "git failed");

/** `git -C cwd <args>`: the one way Lineclear runs git. */
export const git = (cwd: string, ...args: string[]) => gitWith({}, cwd, ...args);

/** Like `git`, stopped after ten seconds with a timeout text: for a read a tick waits for. */
export const gitLimited = (cwd: string, ...args: string[]) => gitWith({ timeout: READ_TIMEOUT_MS }, cwd, ...args);

/** Like `git`, for a commit made where no git identity is set. */
export const gitAsLineclear = (cwd: string, ...args: string[]) => git(cwd, "-c", "user.name=Lineclear", "-c", "user.email=lineclear@localhost", ...args);

/** The trimmed output of `git -C cwd <args>`, or undefined when git fails. */
export function gitText(cwd: string, ...args: string[]): string | undefined {
  const r = git(cwd, ...args);
  return r.ok ? r.out.trim() : undefined;
}
