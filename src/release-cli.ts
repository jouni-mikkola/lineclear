import { lineclearServer, readSnapshot } from "./lineclear-client.ts";
import { checkWord, type ReleaseCheck, type ReleaseView } from "./release-view.ts";
import { resolveProject } from "./resolve.ts";
import { fitTitle } from "./roadmap.ts";
import { roadmapData } from "./roadmap-view.ts";
import type { MachineRow } from "./spread.ts";
import { findProject } from "./waits.ts";

type Out = (line: string) => void;

const USAGE = "usage: lineclear release [<project>]";
/** How much of a check's rule fits its line; the whole rule is in docs/release.md. */
const MUST_SHOWN = 72;

const gib = (kb: number) => `${(kb / 1024 / 1024).toFixed(1)} GiB`;

/** One machine's room and how full it is, or why it says none. */
function machineLine(m: MachineRow): string {
  if (!m.room || !m.slots) return `  ${m.machine}: has not reported its room`;
  const { working, max } = m.slots;
  const slots = max === null ? `${working} agents working, no slot limit` : `${working} of ${max} slots working${working >= max ? " (full)" : ""}`;
  const free = m.room.totalKb ? `${gib(m.room.freeKb)} of ${gib(m.room.totalKb)} memory free` : `${gib(m.room.freeKb)} memory free`;
  return `  ${m.machine}: ${slots}, ${free}, load ${m.room.load.toFixed(1)} on ${m.room.cores} cores`;
}

/** A check in two lines: how it stands, then as much of its rule as fits. */
const checkLines = (c: ReleaseCheck) => {
  const must = fitTitle(c.must, MUST_SHOWN);
  return [`  ${c.id.padEnd(4)}${checkWord(c)}`, `      ${must}${must.length < c.must.length ? "…" : ""}`];
};

const stepLine = (s: ReleaseView["now"][number]) => `  ${s.title}${s.result ? `: ${s.result}` : ""}`;

/** The release's parts, its checks and its steps now and next, as `lineclear release` prints them. */
export function releaseLines(r: ReleaseView): string[] {
  const width = Math.max(...r.parts.map((p) => p.name.length), 14) + 2;
  const part = (name: string, done: number, total: number) => `  ${(name.charAt(0).toUpperCase() + name.slice(1)).padEnd(width)}${done} of ${total}`;
  const tally = (state: ReleaseCheck["state"]) => r.checks.filter((c) => c.state === state).length;
  return [
    `Release ${r.version}: where it stands`,
    "",
    "Parts (steps done of all)",
    ...r.parts.map((p) => part(p.name, p.done, p.total)),
    ...(r.unranked.total > 0 ? [part("not ranked yet", r.unranked.done, r.unranked.total)] : []),
    "",
    `Checks: ${tally("holds")} hold, ${tally("fails")} fail, ${tally("unmeasured")} not measured yet`,
    ...r.checks.flatMap(checkLines),
    "",
    "Running now",
    ...(r.now.length ? r.now.map(stepLine) : ["  nothing"]),
    "",
    "Next, waiting",
    ...(r.next.length ? r.next.map(stepLine) : ["  nothing"]),
  ];
}

/** `lineclear release [<project>]`: where the project's next release stands, then each machine's room. */
export async function releaseMain(args: string[], out: Out, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<number> {
  if (args.length > 1 || args[0]?.startsWith("-")) return (out(USAGE), args[0] === "--help" || args[0] === "-h" ? 0 : 2);
  let project = findProject(cwd, env);
  if (args[0] !== undefined) {
    const r = resolveProject(args[0], env);
    if ("error" in r) return (out(`lineclear release: ${r.error}`), 1);
    project = r.name;
  }
  if (project === undefined) return (out(`lineclear release: this folder is no project's; name one: ${USAGE}`), 1);
  const read = roadmapData(project, env);
  if ("error" in read) return (out(`lineclear release: ${read.error}`), 1);
  if (!read.ok.release) return (out(`lineclear release: ${project} has no docs/release.md with a "# Release <version>" heading and checks`), 1);
  releaseLines(read.ok.release).forEach((l) => out(l));
  out("");
  out("Machines (room: agents working of the slots it has, and what it has free)");
  const base = lineclearServer(env);
  const snap = base ? await readSnapshot(base) : undefined;
  const machines = (snap as { machines?: MachineRow[] } | undefined)?.machines;
  if (!machines?.length) out("  Lineclear's server does not answer, so no machine's room can be read");
  else machines.forEach((m) => out(machineLine(m)));
  return 0;
}
