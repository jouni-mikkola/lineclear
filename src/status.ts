import { decisionsSince } from "./decisions-store.ts";
import { HOUR_MS } from "./time.ts";
// `lineclear status`: what stops each project and each task, short enough for a chat or a phone.
import { IDLE_TEXT } from "./cards.ts";
import { projectsData, type HomeProject } from "./home-data.ts";
import { listProjectNames, readSettings } from "./project.ts";
import { lineclearTasks } from "./roadmap-source.ts";
import { readState } from "./rules.ts";
import { notReached, silentMachines } from "./spread.ts";
import { countWaiting, waitingForYou } from "./waiting.ts";
import { readWaits, type Wait, waitsForOwner } from "./waits.ts";

const describeWait = (w: Wait) =>
  `${w.task} ${waitsForOwner(w) ? "waits" : "paused, waits"} for ${w.kind === "until" ? `${w.until}` : w.kind === "task" ? `task ${w.for}` : w.kind}: ${w.reason}`;

/** The most an all-projects status says: about 1500 tokens, counting 3 characters to a token to stay under 2000. */
export const STATUS_MAX_CHARS = 4500;
const LINE_MAX = 160;

/** The tasks of a project that wait for you, by `lineclear task list`, each with what it says it waits for. */
function needing(project: string, env: NodeJS.ProcessEnv): string[] {
  const settings = readSettings(project, env);
  const tasks = typeof settings === "string" ? [] : lineclearTasks(settings.space, env);
  if (typeof tasks === "string") return [];
  const silent = silentMachines(env);
  const paused = new Set(
    readWaits(env)
      .filter((w) => !waitsForOwner(w))
      .map((w) => w.task),
  );
  return (
    tasks
      // another machine's line carries an "on <machine>" tail that is not part of what the task says
      .map((t) => ({ ...t, sub: t.sub?.replace(/(?: · )?on [^ ]+$/, "") || undefined }))
      .filter((t) => !silent.has(String(t.id).split("@")[1] ?? "") && t.status === "need" && t.sub !== IDLE_TEXT && !paused.has(t.id ?? ""))
      .map((t) => `${t.id} waits for you${t.sub ? `: ${t.sub}` : ""}`)
  );
}

/** The lane's releases of the last hour: each task once, with its reason, newest first. */
function recentReleases(env: NodeJS.ProcessEnv, now: number): { task: string; reason: string }[] {
  const seen = new Set<string>();
  const out: { task: string; reason: string }[] = [];
  for (const d of decisionsSince(env, now - HOUR_MS).reverse()) {
    const m = d.kind === "stall" ? /^(?:released|restarted) (\S+)'s merge: (.*)$/.exec(d.reason) : null;
    if (!m?.[1] || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ task: m[1], reason: m[2] ?? "" });
  }
  return out;
}

const lanes = new WeakMap<object, HomeProject[]>();

/** A head stuck on the merge line. The projects are read once per run, from this machine's files. */
function laneLines(name: string, env: NodeJS.ProcessEnv): string[] {
  const projects = lanes.get(env) ?? projectsData(env);
  lanes.set(env, projects);
  const stuck = (projects.find((p) => p.name === name)?.tasks ?? []).filter((t) => t.lane?.startsWith("Stuck"));
  return stuck.map((t) => `merge line: ${t.id} ${t.lane?.replace(/^S/, "s")}`);
}

/** What stops one project, or nothing when it runs. */
function problemsOf(name: string, env: NodeJS.ProcessEnv): string[] {
  const state = readState(name, env);
  return [
    ...state.roadmapErrors.map((e) => `roadmap broken, nothing starts: ${e}`),
    ...(state.stopped ? ["new starts stopped: the health command failed twice in a row"] : []),
    ...laneLines(name, env),
    ...readWaits(env)
      .filter((w) => w.project === name)
      .map(describeWait),
    ...needing(name, env),
  ];
}

/** Prints the lines that fit the cap, then how many did not. */
function printCapped(lines: string[], out: (l: string) => void) {
  let used = 0;
  let shown = 0;
  for (const l of lines) {
    if (used + l.length + 1 > STATUS_MAX_CHARS - LINE_MAX) break;
    used += l.length + 1;
    shown++;
  }
  for (const l of lines.slice(0, shown)) out(l);
  if (shown < lines.length) out(`... ${lines.length - shown} more lines, ask for one project: lineclear status <project>`);
}

/** What stops each project and each task. With a project name, only that project and without the cap. */
export function status(out: (l: string) => void, env = process.env, only?: string): number {
  const all = listProjectNames(env);
  if (only !== undefined && !all.includes(only)) {
    out(`lineclear status: no project named '${only}'`);
    return 1;
  }
  const names = only === undefined ? all : [only];
  const clip = (l: string) => (only !== undefined || l.length <= LINE_MAX ? l : `${l.slice(0, LINE_MAX - 3)}...`);
  const lines: string[] = [];
  const okNames: string[] = [];
  if (all.length === 0) lines.push("no projects, add one with 'lineclear project add <repo>'");
  const rest: string[] = [];
  for (const name of names) {
    const problems = problemsOf(name, env);
    if (problems.length === 0) okNames.push(name);
    for (const p of problems) rest.push(clip(`${name}  ${p}`));
  }
  for (const r of recentReleases(env, Date.now())) rest.push(clip(`-  ${r.task} released from the merge line in the last hour: ${r.reason}`));
  if (only !== undefined) {
    if (okNames.length > 0) lines.push(`${okNames[0]}  ok`);
    for (const l of [...lines, ...rest]) out(l);
    return 0;
  }
  for (const [host, good] of silentMachines(env)) rest.push(clip(`-  ${notReached(host, good)}`));
  for (const w of readWaits(env).filter((w) => w.project === undefined || !all.includes(w.project))) rest.push(clip(`-  ${describeWait(w)}`));
  // The count comes first too: it is the same list as Home's headline and the Inbox badge.
  const n = countWaiting(waitingForYou(env));
  if (n > 0) lines.push(`${n} ${n === 1 ? "thing waits" : "things wait"} for you`);
  // The healthy projects come first, so the cap never drops them.
  if (okNames.length > 0) lines.push(`ok: ${okNames.join(" ")}`);
  printCapped([...lines, ...rest], out);
  return 0;
}
