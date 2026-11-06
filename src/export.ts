import { codeCommit } from "./paths.ts";
import { type Export, fetchExportSync } from "./remotes.ts";
import { readMachines } from "./machine-list.ts";
import { listProjectNames } from "./project.ts";
import { remoteLineclearSync } from "./ssh.ts";
import { describeSessions, openSessions } from "./browsers.ts";
import { localProjects } from "./home-data.ts";
import { inboxMain } from "./inbox-answer.ts";
import { isOpen, readItems } from "./inbox.ts";
import { cpus, loadavg } from "node:os";
import { loadLimit } from "./waits.ts";
import { status } from "./status.ts";

type Env = Record<string, string | undefined>;

/** What this machine holds, for the machine that shows all of them. Plain code, no AI. */
async function exportData(env: Env = process.env, now = Date.now()): Promise<Omit<Export, "host">> {
  const lines: string[] = [];
  status((l) => lines.push(l), env as NodeJS.ProcessEnv);
  let browsers: Export["browsers"] = [];
  try {
    browsers = describeSessions(
      (await openSessions(env)).map((s) => s.name),
      env,
      new Map(),
      new Set(),
    );
  } catch {
    // no playwright-cli here, or no browser open: none to show
  }
  return {
    commit: codeCommit(),
    load: { load: Math.round((loadavg()[0] ?? 0) * 100) / 100, limit: loadLimit(env) || cpus().length },
    projects: localProjects(env, now),
    inbox: readItems(env).filter(isOpen),
    status: lines,
    browsers,
  };
}

export async function exportMain(out: (l: string) => void, env: Env = process.env): Promise<number> {
  out(JSON.stringify(await exportData(env)));
  return 0;
}

/**
 * `lineclear status` for every machine: this one's lines, with each other machine's waiting items counted in, then
 * the lines each machine gives for itself under its name. A machine that cannot be reached says so.
 */
export function statusAll(out: (l: string) => void, env: Env = process.env, only?: string, local = false): number {
  if (only !== undefined) {
    // a project of another machine is told by that machine
    if (listProjectNames(env as NodeJS.ProcessEnv).includes(only)) return status(out, env as NodeJS.ProcessEnv, only);
    for (const host of local ? [] : readMachines(env).map((m) => m.host)) {
      const r = remoteLineclearSync(host, ["status", "--local", only], env);
      if (r.code === 0)
        return (
          r.stdout
            .split("\n")
            .filter(Boolean)
            .forEach((l) => out(`${host}  ${l}`)),
          0
        );
    }
    return status(out, env as NodeJS.ProcessEnv, only);
  }
  const hosts = readMachines(env).map((m) => m.host);
  const read = hosts.map((host) => ({ host, e: fetchExportSync(host, env) }));
  const code = status(
    out,
    env as NodeJS.ProcessEnv,
    undefined,
    read.flatMap((r) => (r.e ? [r.e] : [])),
  );
  for (const { host, e } of read) {
    if (!e) out(`${host}  cannot be reached over SSH`);
    else for (const l of e.status) out(`${host}  ${l}`);
  }
  return code;
}

/** `lineclear inbox` for every machine: this one's items, then each other machine's open ones under its name. */
export function inboxAll(out: (l: string) => void, env: Env = process.env): number {
  const code = inboxMain([], out, env);
  for (const host of readMachines(env).map((m) => m.host)) {
    const e = fetchExportSync(host, env);
    if (!e) out(`${host}  cannot be reached over SSH`);
    else
      for (const i of e.inbox.filter(isOpen))
        out(`${host}  ${i.question} (${i.choices.join(" / ")}) from task ${i.task}; answer there: lineclear inbox answer ${i.n} <choice>`);
  }
  return code;
}
