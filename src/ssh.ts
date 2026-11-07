type Env = Record<string, string | undefined>;

// Running commands on another machine over SSH. `LINECLEAR_SSH` names another `ssh`, which a test uses to stand in
// for a machine. Every SSH command line in Lineclear is built here.

const ssh = (env: Env) => env.LINECLEAR_SSH ?? "ssh";
export const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

interface SshOptions {
  /** a terminal for the command */
  tty?: boolean;
  /** options that go first: ssh keeps the first value it is given */
  extra?: string[];
  /** the shared connection's socket path: the calls to one machine then reuse one connection */
  control?: string;
}

/** `script` runs under /bin/sh on the machine, whatever its login shell is. */
export function sshArgs(env: Env, host: string, script: string, opts: SshOptions = {}): string[] {
  const shared = opts.control
    ? [
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=4",
        "-o",
        "ControlMaster=auto",
        "-o",
        "ControlPersist=600",
        "-o",
        `ControlPath=${opts.control}`,
      ]
    : [];
  return [
    ssh(env),
    ...(opts.extra ?? []),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    ...shared,
    opts.tty ? "-tt" : "-T",
    "--",
    host,
    `/bin/sh -c ${quote(script)}`,
  ];
}

/** The PATH install.sh and the service use. A non-interactive SSH shell has neither folder, so no remote command may rely on its own PATH. */
export const REMOTE_PATH = 'export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"';
