import { existsSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { stepHeld } from "./parts.ts";
import type { Settings } from "./project.ts";
import { checkRoadmap, closedSteps, type Task } from "./roadmap.ts";
import { statusesFrom, stepInputs } from "./task-steps.ts";
import { kindOf } from "./decision-code.ts";
import type { Decision, State } from "./rules.ts";
import { askMachines } from "./spread.ts";
import { machineTasks } from "./task-read.ts";
import { climbStalls, serviceAccounts } from "./stalls.ts";
import { bindStarts, liveSteps } from "./starts.ts";
import { capacityOf, type MainInfo, type Note, startReadySteps, type Tick, workerPicker } from "./tick-start.ts";
import type { Wait } from "./waits.ts";
import type { World } from "./world.ts";

type Step = ReturnType<typeof checkRoadmap>["parsed"]["steps"][number];

/** What a tick read about the project: its roadmap, main and tasks. Undefined (with a skip noted) when one cannot be read. */
function readProject(t: Tick) {
  const { settings, world, state, dryRun, note } = t;
  if (!dryRun) world.fetch(settings.repo);
  const roadmapFile = join(settings.repo, "docs", "ROADMAP.md");
  const text = world.roadmap(settings.repo) ?? (existsSync(roadmapFile) ? readFileSync(roadmapFile, "utf8") : undefined);
  if (text === undefined) {
    state.roadmapErrors = [`${roadmapFile}: no such file`];
    note("broken", "no roadmap yet, nothing starts");
    return undefined;
  }
  const { parsed, errors } = checkRoadmap(text);
  state.roadmapErrors = errors.map((e) => `${roadmapFile}:${e.line}: ${e.message}`);
  if (errors.length > 0) {
    note("broken", `roadmap is broken, nothing starts (${state.roadmapErrors[0]})`);
    return undefined;
  }
  const main = world.main(settings.repo);
  if (typeof main === "string") {
    note("broken", main);
    return undefined;
  }
  const tasks = world.tasks(settings.space);
  if (typeof tasks === "string") {
    note("broken", tasks);
    return undefined;
  }
  return { text, parsed, main, tasks };
}

/** Each step's state from main, the tasks and the other machines, and the locks the working steps hold. */
function stepStates(t: Tick, steps: Step[], main: MainInfo, tasks: Task[], remote: Task[]) {
  const { state, dryRun, note, settings, env } = t;
  const closed = state.closedSteps ?? {};
  for (const [step, task] of closedSteps(steps, tasks, state.taskSteps, remote)) {
    if (closed[step] !== undefined) continue;
    note("close", `step ${step} is done: ${task} closed with nothing to merge, its step was already done on main`, step);
    if (!dryRun) state.closedSteps = { ...state.closedSteps, [step]: task };
    closed[step] = task;
  }
  const inputs = stepInputs(steps, main.commits, { local: tasks, remote }, settings.repo, env, { state: { ...state, closedSteps: closed } });
  const status = statusesFrom(steps, inputs);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const held = new Map<string, string>();
  const live = liveSteps(steps, [...tasks, ...remote], remote, state.taskSteps);
  for (const s of status) if (s.state === "work" && live.has(s.id)) for (const l of stepHeld(byId.get(s.id) as Step)) held.set(l, s.id);
  return { status, byId, held };
}

/** One tick for one project. Returns its decisions; with `dryRun` it writes and starts nothing. */
export function tickProject(
  name: string,
  settings: Settings,
  world: World,
  state: State,
  dryRun: boolean,
  waits: Wait[] = [],
  limit = cpus().length,
  env = process.env,
): Decision[] {
  const out: Decision[] = [];
  const time = world.now().toISOString();
  const note: Note = (code, reason, step, machine) => {
    const d: Decision = { time, project: name, step, kind: kindOf(code), code, reason, ...(machine === undefined ? {} : { machine }) };
    out.push(d);
    return d;
  };
  const t: Tick = { name, settings, world, state, dryRun, env, note };
  const project = readProject(t);
  if (!project) return out;
  const { text, parsed, main, tasks } = project;

  const overloaded = world.load() > limit;
  // The board marks a head of main red; the tick reads that mark and runs nothing of the project's.
  const red = world.mainRed(settings.repo, main.head);
  state.stopped = red;
  // The list of offered models costs seconds of CPU: read it only when a stall or a start needs it, once per tick.
  let list: { set: Set<string> | undefined } | undefined;
  const offered = () => {
    list ??= { set: world.offered(world.now()) };
    return list.set;
  };
  // The project's other machines: asked once per tick. One that cannot be reached is skipped and noted.
  const { rooms, remote } = askMachines(
    settings.machines ?? [],
    (host) => world.room?.(host, settings.space) ?? "this world cannot reach other machines",
    (host) => machineTasks(env, settings.space, host),
    (host, why) => note("unreachable", why, `machine:${host}`, host),
  );
  bindStarts(state, tasks);
  const stallArgs = { project: name, settings, world, state, dryRun, waits, tasks, steps: parsed.steps, offered, note, env };
  serviceAccounts(stallArgs);
  climbStalls(stallArgs);
  const { status, byId, held } = stepStates(t, parsed.steps, main, tasks, remote);

  if (settings.paused) {
    note("paused", "the project is paused, no step starts");
    return out;
  }
  if (!dryRun) {
    const claimed = world.claimedSteps?.(settings.repo) ?? [];
    world.releaseSteps?.(
      settings.repo,
      status.filter((st) => st.state === "done" && claimed.includes(st.id)).map((st) => st.id),
    );
  }
  if (settings.starts === false) {
    note("paused", "this machine does not start steps for the repo (starts: false), it only runs what it is given");
    return out;
  }
  const cap = capacityOf(t, tasks, waits, rooms, overloaded, limit);
  if (overloaded && (settings.machines ?? []).length === 0) {
    note("no-room", cap.overloadNote);
    return out;
  }
  const known = [...tasks, ...remote];
  const starting = { t, text, commits: main.commits, tasks: known, status, byId, held, cap, rooms, limit, picked: workerPicker(t, offered), offered };
  startReadySteps(starting, red);
  return out;
}
