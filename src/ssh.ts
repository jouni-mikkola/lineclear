type Env = Record<string, string | undefined>;

// Running commands on another machine over SSH. `LINECLEAR_SSH` names another `ssh`, which a test uses to stand in
// for a machine.

const ssh = (env: Env) => env.LINECLEAR_SSH ?? "ssh";
export const sshArgs = (env: Env, host: string, command: string) => [ssh(env), "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", host, command];
export const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** The PATH install.sh and the service use. A non-interactive SSH shell has neither folder, so no remote command may rely on its own PATH. */
export const REMOTE_PATH = 'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"';
