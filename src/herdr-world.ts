import { readdirSync, readFileSync } from "node:fs";
import { herdrArgv } from "./herdr.ts";
import { userInfo } from "node:os";
import type { HerdrFacts, HerdrServer, HerdrWorkspace } from "./herdr-health.ts";
import type { World } from "./world.ts";

type Run = (cmd: string[]) => { code: number; out: string; err: string };

const TICKS_PER_SECOND = 100; // Linux clock ticks in /proc/<pid>/stat
// the unit herdr runs under: the owner's own, or the one the installer writes when herdr has none
const UNITS = ["herdr.service", "lineclear-herdr.service"];

/** Every plain `herdr server` in /proc; one in any unit of UNITS counts as in the service. */
export function readServers(units: string[] = UNITS): HerdrServer[] {
  const out: HerdrServer[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const argv = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      if (!/(^|\/)herdr$/.test(argv[0] ?? "") || argv[1] !== "server" || argv.slice(2).some((a) => a !== "")) continue; // a server with options is another session's
      // the fields after the command's closing parenthesis: utime and stime are the 12th and 13th
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cpuSeconds = (Number(fields[11]) + Number(fields[12])) / TICKS_PER_SECOND;
      const rss = /^VmRSS:\s+(\d+) kB/m.exec(readFileSync(`/proc/${entry}/status`, "utf8"));
      out.push({
        pid: Number(entry),
        cpuSeconds,
        ...(rss ? { rssMb: Math.round(Number(rss[1]) / 1024) } : {}),
        inService: readFileSync(`/proc/${entry}/cgroup`, "utf8")
          .split("\n")
          .some((l) => units.some((u) => l.endsWith(`/${u}`))),
      });
    } catch {}
  }
  return out;
}

function readWorkspaces(run: Run): HerdrWorkspace[] {
  const r = run(herdrArgv(["workspace", "list"]));
  if (r.code !== 0) return [];
  try {
    const list = JSON.parse(r.out).result.workspaces as {
      workspace_id: string;
      worktree?: { checkout_path: string; is_linked_worktree: boolean; repo_root: string };
    }[];
    return list.map((w) => ({
      id: w.workspace_id,
      ...(w.worktree?.is_linked_worktree ? { repo: w.worktree.repo_root, checkout: w.worktree.checkout_path } : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * The herdr side of the world. Only on the real install, in the owner's own home: a test or try instance has its own
 * LINECLEAR_CONFIG and a cold start its own HOME, and neither may restart the herdr that runs the owner's agents.
 * `mayStop` gives the pids of this install's servers: no other pid is ever signalled, so a faked unit cannot kill a real herdr.
 */
export function herdrWorld(
  run: Run,
  env: NodeJS.ProcessEnv,
  mayStop: () => number[],
  serviceUnits: string[] = UNITS,
): Pick<World, "herdr" | "restartHerdr" | "closeWorkspace"> {
  if (env.LINECLEAR_CONFIG || env.HOME !== userInfo().homedir) return {};
  const unitOf = (): string | undefined => UNITS.find((u) => run(["systemctl", "--user", "show", u, "-p", "LoadState"]).out.includes("LoadState=loaded")); // undefined when herdr has no unit: nothing is stopped then
  const failure = (r: ReturnType<Run>) => (r.code === 0 ? undefined : (r.err || r.out).trim() || `exit ${r.code}`);
  return {
    herdr(): HerdrFacts | undefined {
      const unit = unitOf();
      if (!unit) return undefined;
      const show = run(["systemctl", "--user", "show", unit, "-p", "ActiveState,NRestarts"]).out;
      const get = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(show)?.[1] ?? "";
      return {
        unit,
        servers: readServers(serviceUnits),
        service: { state: get("ActiveState") || "unknown", restarts: Number(get("NRestarts")) || 0 },
        workspaces: readWorkspaces(run),
      };
    },
    restartHerdr() {
      const unit = unitOf();
      if (!unit) return "herdr has no systemd unit to restart it under";
      const allowed = mayStop();
      for (const s of readServers(serviceUnits).filter((x) => !x.inService && allowed.includes(x.pid))) {
        try {
          process.kill(s.pid, "SIGTERM");
        } catch (e) {
          return `could not stop herdr ${s.pid}: ${(e as Error).message}`;
        }
      }
      return failure(run(["systemctl", "--user", "restart", unit]));
    },
    closeWorkspace: (id) => failure(run(herdrArgv(["workspace", "close", id]))),
  };
}
