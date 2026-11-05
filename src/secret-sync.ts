import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { secretsFolder } from "./secrets.ts";
import { remoteLineclearSync, run, sshArgs } from "./ssh.ts";

type Env = Record<string, string | undefined>;

// The login secrets folder is the same on every machine, so an agent anywhere can answer a login with its stored
// TOTP instead of handing the owner a push to approve. The server's copy is the source; a newer file on a machine wins.

const REMOTE = ".config/control-center/secrets";

/**
 * Copies the folder to a machine over SSH with rsync: files 0600, folders 0700, the newer file winning, nothing
 * deleted. Returns what went wrong, or undefined. Nothing is printed: rsync is not verbose and a value is never in its words.
 */
export async function pushSecrets(host: string, env: Env = process.env): Promise<string | undefined> {
  const dir = secretsFolder(env);
  if (!existsSync(dir)) return undefined;
  const make = await run(sshArgs(env, host, `umask 077; mkdir -p ~/${REMOTE} && chmod 700 ~/.config/control-center ~/${REMOTE}`), undefined, 30_000, env);
  if (make.code !== 0) return `its secrets folder could not be made: ${make.lines.at(-1) ?? `exit ${make.code}`}`;
  const shell = `${env.LINECLEAR_SSH ?? "ssh"} -o BatchMode=yes -o ConnectTimeout=10`;
  const sent = await run(["rsync", "-rtp", "--update", "--chmod=D700,F600", "-e", shell, `${dir}/`, `${host}:${REMOTE}/`], undefined, 120_000, env);
  return sent.code === 0 ? undefined : `its secrets did not arrive: ${sent.lines.at(-1) ?? `rsync exit ${sent.code}`}`;
}

/** The secret names a machine holds (never a value), or null when it cannot be read. */
export function remoteSecretNames(host: string, env: Env = process.env): string[] | null {
  const r = remoteLineclearSync(host, ["secrets", "names"], env);
  return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : null;
}

/** The folder's files with their size and time: it changes when this changes. */
function fingerprint(dir: string): string {
  const parts: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else {
        const s = statSync(f);
        parts.push(`${f}:${s.mtimeMs}:${s.size}`);
      }
    }
  };
  try {
    walk(dir);
  } catch {
    return "";
  }
  return parts.sort().join("\n");
}

const sent = new Map<string, string>();
let sending = false;

/** Sends the folder to each host it was not sent to since it last changed. A failure is tried again next time. */
export async function syncSecretsIfChanged(hosts: string[], env: Env = process.env): Promise<void> {
  const print = fingerprint(secretsFolder(env));
  const due = hosts.filter((h) => sent.get(h) !== print);
  if (sending || print === "" || due.length === 0) return;
  sending = true;
  try {
    for (const h of due) if ((await pushSecrets(h, env)) === undefined) sent.set(h, print);
  } finally {
    sending = false;
  }
}
