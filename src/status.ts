// `lineclear status`: what stops each project and each task, short enough for a chat or a phone.
import { IDLE_TEXT } from "./cards.ts";
import { listProjectNames, readSettings } from "./project.ts";
import type { Export } from "./remotes.ts";
import { shepherdrTasks } from "./roadmap-source.ts";
import { readState } from "./rules.ts";
import { countWaiting, waitingForYou } from "./waiting.ts";
import { projectCheckLines, readWaits, type Wait, waitsForOwner } from "./waits.ts";

const describeWait = (w: Wait) =>
  `${w.task} ${waitsForOwner(w) ? "waits" : "paused, waits"} for ${w.kind === "until" ? `${w.until}` : w.kind === "task" ? `task ${w.for}` : w.kind}: ${w.reason}`;

/** The most an all-projects status says: about 1500 tokens, counting 3 characters to a token to stay under 2000. */
export const STATUS_MAX_CHARS = 4500;
const LINE_MAX = 160;

/** The tasks of a project that wait for you, by `shepherdr task list`, each with what it says it waits for. */
function needing(project: string, env: NodeJS.ProcessEnv): string[] {
  const settings = readSettings(project, env);
  const tasks = typeof settings === "string" ? [] : shepherdrTasks(settings.space, env);
  if (typeof tasks === "string") return [];
  const paused = new Set(
    readWaits(env)
      .filter((w) => !waitsForOwner(w))
      .map((w) => w.task),
  );
  return tasks
    .filter((t) => t.status === "need" && t.sub !== IDLE_TEXT && !paused.has(t.id ?? ""))
    .map((t) => `${t.id} waits for you${t.sub ? `: ${t.sub}` : ""}`);
}

/** What stops one project, or nothing when it runs. */
function problemsOf(name: string, env: NodeJS.ProcessEnv): string[] {
  const state = readState(name, env);
  return [
    ...state.roadmapErrors.map((e) => `roadmap broken, nothing starts: ${e}`),
    ...(state.stopped ? ["new starts stopped: the health command failed twice in a row"] : []),
    ...projectCheckLines(name, env),
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
export function status(out: (l: string) => void, env = process.env, only?: string, remote: Export[] = []): number {
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
  if (only !== undefined) {
    if (okNames.length > 0) lines.push(`${okNames[0]}  ok`);
    for (const l of [...lines, ...rest]) out(l);
    return 0;
  }
  for (const w of readWaits(env).filter((w) => w.project === undefined || !all.includes(w.project))) rest.push(clip(`-  ${describeWait(w)}`));
  // The count comes first too: it is the same list as Home's headline and the Inbox badge.
  const n = countWaiting(waitingForYou(env, remote));
  if (n > 0) lines.push(`${n} ${n === 1 ? "thing waits" : "things wait"} for you`);
  // The healthy projects come first, so the cap never drops them.
  if (okNames.length > 0) lines.push(`ok: ${okNames.join(" ")}`);
  printCapped([...lines, ...rest], out);
  return 0;
}
