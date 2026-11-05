import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cutStats, logFile } from "../pi/parts/cut-output.ts";
import { writeAtomic } from "../pi/atomic.ts";
import { type Effect, APP, type Kit, kitDiff, kitMarkdown, kitOthers, readKit, wantedKit } from "./kit.ts";
import { readMachines } from "./machine-list.ts";
import { measureMain } from "./measure-main.ts";
import { remoteLineclearSync } from "./ssh.ts";

type Env = Record<string, string | undefined>;
type Out = (line: string) => void;

/** Each part's measured effect: the pack's numbers from `lineclear measure`, or none when no project is named. */
function effects(project: string | undefined, since: string, env: Env): Effect[] {
  if (!project) return [];
  const lines: string[] = [];
  if (measureMain(["--json", "--since", since, project], (l) => lines.push(l), env) !== 0) return [];
  try {
    return JSON.parse(lines.join("\n")).parts ?? [];
  } catch {
    return [];
  }
}

/** How the cut-output part's cuts were met: through the saved file as told, or by running the command again (the waste). */
export function cutLine(env: Env): string {
  let lines: string[] = [];
  try {
    lines = readFileSync(logFile(env), "utf8").split("\n").filter(Boolean);
  } catch {
    // no log: nothing was cut yet
  }
  const x = cutStats(lines);
  if (x.cuts === 0) return "cut-output: no cut logged yet";
  const percent = (n: number) => Math.round((100 * n) / x.cuts);
  return `cut-output: ${x.cuts} cuts, ${x.reread - x.rerun} read through the saved file only, ${x.rerun} (${percent(x.rerun)} %) ran the command again`;
}

/** The kits of the other saved machines, read over SSH; null for one that cannot be reached. */
function remoteKits(env: Env): { host: string; kit: Kit | null }[] {
  return readMachines(env).map((m) => {
    const r = remoteLineclearSync(m.host, ["kit", "--json"], env);
    try {
      return { host: m.host, kit: r.code === 0 ? (JSON.parse(r.stdout) as Kit) : null };
    } catch {
      return { host: m.host, kit: null };
    }
  });
}

/** The other machines' kits and how each differs from the release (a line when one cannot be read). */
export function remoteKitDiffs(env: Env = process.env): { host: string; diff: string[] | null; own?: string[] }[] {
  const want = wantedKit();
  return remoteKits(env).map(({ host, kit }) => ({ host, diff: kit ? kitDiff(kit, want) : null, ...(kit ? { own: kitOthers(kit) } : {}) }));
}

const fail = (out: Out) => {
  out(USAGE);
  return 2;
};
const USAGE = "usage: lineclear kit [--json | --write [<project> --since <date>]]";

/** The project and the date `kit --write` measures from; null when the arguments are wrong. */
export function writeOptions(args: string[]): { project: string | undefined; since: string } | null {
  const sinceAt = args.indexOf("--since");
  const given = sinceAt >= 0 ? args[sinceAt + 1] : undefined;
  if (sinceAt >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(given ?? "")) return null;
  const rest = args.filter((_, i) => sinceAt < 0 || (i !== sinceAt && i !== sinceAt + 1));
  if (rest.length > 1 || rest.some((a) => a.startsWith("--"))) return null;
  return { project: rest[0], since: given ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) };
}

/** `lineclear kit`: what pi loads here; `--write` makes docs/kit.md for every machine. */
export function kitMain(args: string[], out: Out, env: Env = process.env, app = APP): number {
  const kit = readKit(env);
  if (args.length === 0 || args[0] === "--json") {
    if (args.length > 1) return fail(out);
    if (args[0] === "--json") {
      out(JSON.stringify(kit));
      return 0;
    }
    const want = wantedKit(app, env);
    out(kitMarkdown([{ name: "this machine", kit }], want, [], undefined, [cutLine(env)]));
    return 0;
  }
  if (args[0] !== "--write") return fail(out);
  const rest = args.slice(1);
  const opts = writeOptions(rest);
  if (!opts) return fail(out);
  const { project, since } = opts;
  const machines = [{ name: "this machine", kit }, ...remoteKits(env).map((r) => ({ name: r.host, kit: r.kit }))];
  const text = kitMarkdown(machines, wantedKit(app, env), effects(project, since, env), since, [cutLine(env)]);
  writeAtomic(join(app, "docs", "kit.md"), text);
  out(`docs/kit.md written`);
  return 0;
}
