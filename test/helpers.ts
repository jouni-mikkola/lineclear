import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.ts";
import { testedHerdr } from "../src/doctor.ts";
import { PAGE_TOKEN } from "../src/web-guard.ts";
import { webApi } from "../src/web.ts";
import { Vault } from "../server/server/live/secrets.ts";

/** Keeps a secret in the vault under `LINECLEAR_MAIN_HOME` at a level (`all`, `m:<machine>` or `p:<machine>:<space>`). */
export function keepSecret(env: Record<string, string | undefined>, level: string, name: string, value: string): void {
  const kept = new Vault(env.LINECLEAR_MAIN_HOME as string).set(level, name, value);
  if (!kept.ok) throw new Error(kept.error);
}

/** Chooses a model for every role in a config folder, so `run` and `project add` are not stopped by the first-run setup. */
export function chooseModels(configFolder: string): void {
  mkdirSync(configFolder, { recursive: true });
  writeFileSync(join(configFolder, "setup.json"), JSON.stringify({ worker: "a/x", reviewer: "b/z", planner: "c/w", stepChecker: "c/w" }));
}

/** Records, as the rules do when they start a task, the step of each task by id (project "demo"). */
export function recordTaskSteps(config: string, taskSteps: Record<string, string>) {
  mkdirSync(join(config, "projects", "demo"), { recursive: true });
  writeFileSync(join(config, "projects", "demo", "state.json"), JSON.stringify({ taskSteps }));
}

export function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `lineclear-${prefix}-`));
}

/** A web API on a fresh config, its board server at `url` (none: not running). */
export function freshWebApi(url?: string) {
  const dir = tmp("web");
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "lineclear"), { recursive: true });
  const env = {
    LINECLEAR_CONFIG: join(dir, "config"),
    LINECLEAR_HOME: join(dir, "lineclear"),
    HOME: dir,
    ...(url ? { LINECLEAR_URL: url } : {}),
  };
  return { dir, env, handle: webApi(env) };
}

export function sh(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const p = Bun.spawnSync(cmd, { cwd: opts.cwd, env: opts.env, stdin: "ignore" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

/** Stand-ins for herdr, pi and systemctl, so no test touches the real ones. They log every call to <state>/<tool>.log. */
export function makeStubs(root: string): { bin: string; state: string } {
  const bin = join(root, "stubs");
  const state = join(root, "state");
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  const stub = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\necho "$*" >> "${state}/${name}.log"\n${body}\n`);
    chmodSync(path, 0o755);
  };
  stub("pi", "exit 0");
  stub("tailscale", "exit 0");
  stub(
    "herdr",
    `case "$1 $2 $3" in
  "--version  ") echo "herdr ${testedHerdr()}" ;;
  "plugin list --json")
    if [ -f "${state}/lineclear" ]; then
      echo '{"result":{"plugins":[{"plugin_id":"herdr-projects","version":"2.0.0","enabled":true}]}}'
    else echo '{"result":{"plugins":[]}}'; fi ;;
  "plugin list "*)
    if [ -f "${state}/lineclear" ]; then echo "1 plugin installed:"; echo "- herdr-projects (Lineclear) enabled [github:x]"; else echo "No plugins installed"; fi ;;
  "plugin install "*) touch "${state}/lineclear" ;;
esac`,
  );
  stub(
    "systemctl",
    `case "$2" in
  enable) touch "${state}/active" ;;
  disable) rm -f "${state}/active" ;;
  set-environment) echo "$3" >> "${state}/manager-env" ;;
  unset-environment) rm -f "${state}/manager-env" ;;
  show-environment) cat "${state}/manager-env" 2>/dev/null; true ;;
  is-active) if [ -f "${state}/active" ]; then echo active; else echo inactive; exit 3; fi ;;
esac`,
  );
  // Lingering is on once enable-linger ran, unless the stub is told it needs root (a file "linger-needs-root").
  stub(
    "loginctl",
    `case "$1" in
  show-user) if [ -f "${state}/linger" ]; then echo Linger=yes; else echo Linger=no; fi ;;
  enable-linger) if [ -f "${state}/linger-needs-root" ]; then exit 1; fi; touch "${state}/linger" ;;
esac`,
  );
  // A runner may have a real passwordless sudo; the stub keeps the "needs root" case failing there too.
  stub(
    "sudo",
    `if [ -f "${state}/linger-needs-root" ]; then exit 1; fi
[ "$1" = "-n" ] && shift
exec "$@"`,
  );
  return { bin, state };
}

/** Waits until `condition` holds and throws "never came: <what>" at the deadline. The limit only stops a hang: a busy machine may take long. */
export async function waitFor(condition: () => boolean | Promise<boolean>, what: string, limit = 60_000): Promise<void> {
  const end = Date.now() + limit;
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`never came: ${what}`);
    await Bun.sleep(20);
  }
}

/** Runs the CLI in this process with `env` set on process.env for the call, and returns its exit code and its lines. */
export async function runCli(env: Record<string, string | undefined>, args: string[], ask: ((q: string) => Promise<string>) | null = null) {
  const out: string[] = [];
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const code = await main(args, (l) => out.push(l), ask);
    return { code, out: out.join("\n") };
  } finally {
    for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** The environment of a test that runs bin/lineclear: the folders, port and name of a board's server (it has them) cannot reach it. */
export function ownEnv(root: string, extra: Record<string, string>): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) };
  for (const k of ["LINECLEAR_PORT", "LINECLEAR_WEB_PORT", "LINECLEAR_MACHINE", "LINECLEAR_MAIN_HOME", "LINECLEAR_SHARED_HOME", "LINECLEAR_TASK"])
    delete env[k];
  return { ...env, LINECLEAR_HOME: join(root, "home"), ...extra };
}

/** A POST to the web API as one of Lineclear's own pages sends it, unless other headers are given. */
export const json = (path: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json", "x-lineclear-token": PAGE_TOKEN }) =>
  new Request(`http://127.0.0.1:7420${path}`, { method: "POST", headers, body: JSON.stringify(body) });

/** A temp folder laid out as the web tests need it: an inbox folder and a Lineclear folder with the space "web-shop". */
export function webShopDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, "config", "inbox"), { recursive: true });
  mkdirSync(join(dir, "lineclear"), { recursive: true });
  writeFileSync(join(dir, "lineclear", "spaces.json"), JSON.stringify([{ key: "WEB", name: "web-shop", path: join(dir, "none") }]));
  return dir;
}
