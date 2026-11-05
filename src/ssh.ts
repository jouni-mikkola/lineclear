type Env = Record<string, string | undefined>;

// Running commands on another machine over SSH. `LINECLEAR_SSH` names another `ssh`, which a test uses to stand in
// for a machine.

const ssh = (env: Env) => env.LINECLEAR_SSH ?? "ssh";
export const sshArgs = (env: Env, host: string, command: string) => [ssh(env), "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, command];
export const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** The PATH install.sh and the service use. A non-interactive SSH shell has neither folder, so no remote command may rely on its own PATH. */
export const REMOTE_PATH = 'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"';
export const LINECLEAR = `${REMOTE_PATH}; "$HOME/.local/bin/lineclear"`;

export interface Ran {
  code: number;
  lines: string[];
  /** The command's own output, with no error text. */
  stdout: string;
}

export async function run(cmd: string[], stdin: string | undefined, timeoutMs: number, env: Env): Promise<Ran> {
  try {
    const p = Bun.spawn(cmd, { stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe", env: env as Record<string, string> });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    clearTimeout(timer);
    const lines = `${out}\n${err}`
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(Boolean);
    return { code: p.signalCode ? 124 : code, lines, stdout: out };
  } catch (e) {
    return { code: 127, lines: [`${cmd[0]}: ${(e as Error).message}`], stdout: "" };
  }
}

/** `lineclear <args>` on a machine. */
export const remoteLineclear = (host: string, args: string[], env: Env, timeoutMs = 60_000) =>
  run(sshArgs(env, host, `${LINECLEAR} ${args.map(quote).join(" ")}`), undefined, timeoutMs, env);

/** The same, and the caller waits: for the command line, which has nothing else to do meanwhile. */
export function remoteLineclearSync(host: string, args: string[], env: Env, timeoutMs = 30_000): { code: number; stdout: string } {
  try {
    const p = Bun.spawnSync(sshArgs(env, host, `${LINECLEAR} ${args.map(quote).join(" ")}`), {
      stdin: "ignore",
      stderr: "ignore",
      timeout: timeoutMs,
      env: env as Record<string, string>,
    });
    return { code: p.exitCode ?? 124, stdout: p.stdout.toString() };
  } catch {
    return { code: 127, stdout: "" };
  }
}
