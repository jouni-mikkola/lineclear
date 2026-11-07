import { existsSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { DEFAULT_ROUNDS, fill, stepBrief, template } from "./brief.ts";
import { testOf } from "./doneproof.ts";
import { ownerStepItem } from "./owner-steps.ts";
import { stepHeld } from "./parts.ts";
import { company } from "./company.ts";
import { projectsDir, type Settings } from "./project.ts";
import { checkRoadmap, closedSteps, doneIds, isFrozen, resultFlag, type StepStatus, type Task } from "./roadmap.ts";
import { statusesFrom, stepInputs } from "./task-steps.ts";
import type { Decision, State } from "./rules.ts";
import { askMachines, type Candidate, mostRoom, type Room, roomLack } from "./spread.ts";
import { routineWorker } from "./routine.ts";
import { askKey, availability, climbStalls, revertLast, reviewerFor, serviceAccounts } from "./stalls.ts";
import { THIS_MACHINE } from "./start-failures.ts";
import { bindStarts, claimStart, liveSteps, recordStart, lockWhy, reservedLocks, settleLockWaits } from "./starts.ts";
import type { Wait } from "./waits.ts";
import type { World } from "./world.ts";

type MainInfo = Exclude<ReturnType<World["main"]>, string>;
type Parsed = ReturnType<typeof checkRoadmap>["parsed"];
type Step = Parsed["steps"][number];
type StepState = StepStatus;
type Note = (kind: Decision["kind"], reason: string, step?: string, machine?: string) => void;

/** What every part of one project's tick needs. */
interface Tick {
  name: string;
  settings: Settings;
  world: World;
  state: State;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  note: Note;
}

/** What a tick read about the project: its roadmap, main and tasks. Undefined (with a skip noted) when one cannot be read. */
function readProject(t: Tick) {
  const { settings, world, state, dryRun, note } = t;
  if (!dryRun) world.fetch(settings.repo);
  const roadmapFile = join(settings.repo, "docs", "ROADMAP.md");
  const text = world.roadmap(settings.repo) ?? (existsSync(roadmapFile) ? readFileSync(roadmapFile, "utf8") : undefined);
  if (text === undefined) {
    state.roadmapErrors = [`${roadmapFile}: no such file`];
    note("skip", "no roadmap yet, nothing starts");
    return undefined;
  }
  const { parsed, errors } = checkRoadmap(text);
  state.roadmapErrors = errors.map((e) => `${roadmapFile}:${e.line}: ${e.message}`);
  if (errors.length > 0) {
    note("skip", `roadmap is broken, nothing starts (${state.roadmapErrors[0]})`);
    return undefined;
  }
  const main = world.main(settings.repo);
  if (typeof main === "string") {
    note("skip", main);
    return undefined;
  }
  const tasks = world.tasks(settings.space);
  if (typeof tasks === "string") {
    note("skip", tasks);
    return undefined;
  }
  return { text, parsed, main, tasks };
}

/** The second failure in a row: new starts stop and the merge that broke main is reverted. */
function stopForHealth(t: Tick, main: MainInfo) {
  const { name, settings, world, state, env, note } = t;
  state.stopped = true;
  // The merge that first broke main, when it was a task's; else the last merge.
  const first = state.firstFailed;
  const broke = first && /^[A-Za-z][A-Za-z0-9]*-\d+: /.test(first.subject) ? first : { head: main.head, subject: main.commits[0]?.subject ?? "" };
  const undone = revertLast(name, settings, world, broke.head, broke.subject, env);
  note("skip", `health command failed twice in a row on ${main.head.slice(0, 7)}, new starts stopped; ${undone}`);
}

/** The first failure: a task to fix it. */
function startHealthFix(t: Tick, main: MainInfo, output: string, health: string) {
  const { settings, world, state, note } = t;
  const brief = fill(template("fix-brief.md", settings.repo), {
    health,
    head: main.head.slice(0, 7),
    output: output.slice(-4000).trimEnd(),
    check: settings.check,
  });
  const err = world.addTask(settings.space, `Fix health ${main.head.slice(0, 7)}`, brief, []);
  if (err) {
    // Try the same head again next tick.
    state.healthFailures -= 1;
    state.healthHead = undefined;
    note("skip", `health failed and the fix task did not start: ${err}`);
  } else note("start", `health command failed on ${main.head.slice(0, 7)}, started a fix task`);
}

/** Health: only after main moved. One failure starts a fix, a second one in a row stops new starts. */
function checkHealth(t: Tick, main: MainInfo, overloaded: boolean) {
  const { settings, world, state, dryRun, note } = t;
  if (!settings.health || overloaded || main.head === "" || main.head === state.healthHead) return;
  if (main.checkedOut !== main.head) {
    note("skip", `health not run: the repo folder is not at origin/main (${main.head.slice(0, 7)})`);
    return;
  }
  if (dryRun) {
    note("skip", `would run the health command, main moved to ${main.head.slice(0, 7)}`);
    return;
  }
  const h = world.health(settings.repo, settings.health);
  state.healthHead = main.head;
  if (h.ok) {
    Object.assign(state, { healthFailures: 0, firstFailed: undefined, stopped: false });
    return;
  }
  state.healthFailures += 1;
  if (state.healthFailures === 1) state.firstFailed = { head: main.head, subject: main.commits[0]?.subject ?? "" };
  if (state.healthFailures >= 2) stopForHealth(t, main);
  else startHealthFix(t, main, h.output, settings.health);
}

/**
 * A step closed with nothing to merge is done for good, so it is never restarted. Its named test runs once; when it
 * fails the tick says so (it is recorded already, so this runs once per step).
 */
function proveClosed(t: Tick, step: Step) {
  const { settings, world } = t;
  const cmd = testOf(step);
  if (cmd === undefined) return;
  const r = world.health(settings.repo, cmd);
  if (!r.ok) t.note("skip", `${step.id}: closed with nothing to merge, but its test fails now: ${cmd}`, step.id);
}

/** Each step's state from main, the tasks and the other machines, and the locks the working steps hold. */
function stepStates(t: Tick, steps: Step[], main: MainInfo, tasks: Task[], remote: Task[]) {
  const { state, dryRun, note, settings, env } = t;
  const closed = state.closedSteps ?? {};
  for (const [step, task] of closedSteps(steps, tasks, state.taskSteps, remote)) {
    if (closed[step] !== undefined) continue;
    note("close", `step ${step} is done: ${task} closed with nothing to merge, its step was already done on main`, step);
    if (!dryRun) {
      state.closedSteps = { ...state.closedSteps, [step]: task };
      proveClosed(t, steps.find((s) => s.id === step) as Step);
    }
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

/** The slots here and on the other machines. `free` falls as steps start. */
interface Capacity {
  max: number | undefined;
  active: number;
  queued: boolean;
  offHere: boolean;
  overloaded: boolean;
  overloadNote: string;
  free: number;
  /** Slots left on each other machine, in the order the settings list them. */
  remoteFree: Map<string, number>;
  /** Tasks started here in this tick: each counts as a load of 1 before the load average shows it. */
  startedHere: number;
  remoteLack: string[];
}

function capacityOf(t: Tick, tasks: Task[], waits: Wait[], rooms: Map<string, Room>, overloaded: boolean, limit: number): Capacity {
  const { settings, world } = t;
  // A task asleep in an `until` wait holds no slot.
  const asleep = new Set(waits.filter((w) => w.kind === "until" && w.stopped).map((w) => w.task));
  const active = tasks.filter((x) => x.status === "work" && !(x.id !== undefined && asleep.has(x.id))).length;
  // A task queued only to wait for another task ("After LIN-55") holds no slot back.
  const queued = tasks.some((x) => x.status === "queued" && !x.sub?.startsWith("After "));
  const max = world.maxTasks(settings.space);
  // `local: false` keeps the project off this machine: it starts only on the machines it lists.
  const offHere = settings.local === false;
  const free = max === undefined || offHere ? 0 : queued ? 0 : Math.max(0, max - active);
  // Room is checked once per tick.
  const remoteFree = new Map<string, number>();
  const remoteLack: string[] = [];
  for (const [host, r] of rooms) {
    const lack = roomLack(r);
    if (lack) remoteLack.push(`${host}: ${lack}`);
    else remoteFree.set(host, (r.max ?? 0) - r.working);
  }
  return {
    max,
    active,
    queued,
    offHere,
    overloaded,
    overloadNote: `load average is above the limit of ${limit}, no new task starts`,
    free,
    remoteFree,
    startedHere: 0,
    remoteLack,
  };
}

/** The worker model, chosen when the first step is about to start, not before. */
function workerPicker(t: Tick, offered: () => Set<string> | undefined) {
  const { settings, world, dryRun, env, note } = t;
  let pick: { workers: string[]; worker: string | undefined } | undefined;
  return () => {
    if (pick) return pick;
    const set = offered();
    const workers = settings.models.worker.filter((m) => set === undefined || set.has(m));
    // A full account is passed over. A paid key waits for your leave in the Inbox.
    const worker = workers.find((m) => availability(m, env, world.now()) === "ok");
    // Ask for a key only when nothing before it in the list has room.
    const keyed = workers.find((m) => availability(m, env, world.now()) !== "out");
    const asked = worker === undefined && keyed !== undefined && !dryRun ? askKey(keyed, world, world.now(), env) : undefined;
    if (asked) note("skip", asked);
    pick = { workers, worker };
    return pick;
  };
}

/** Why no slot here, or undefined when there is one. */
function noSlotHere(t: Tick, c: Capacity) {
  if (c.offHere) return "the project is kept off this machine (local: false)";
  if (c.overloaded) return c.overloadNote;
  if (c.max === undefined) return "cannot read the space's slots from the server";
  if (c.free <= 0) return `no free slot in space '${t.settings.space}' (${c.active} of ${c.max} working${c.queued ? ", others queued" : ""})`;
  return undefined;
}

/** Everything the loop over the ready steps shares. */
interface Starting {
  t: Tick;
  text: string;
  commits: MainInfo["commits"];
  steps: Step[];
  status: StepState[];
  byId: Map<string, Step>;
  held: Map<string, string>;
  cap: Capacity;
  rooms: Map<string, Room>;
  limit: number;
  picked: ReturnType<typeof workerPicker>;
  offered: () => Set<string> | undefined;
}

/** Why a ready step does not start now, or undefined when it does. */
function whyNotStart(s: Starting, step: Step, reserved: Map<string, string>) {
  const { t, cap, held } = s;
  if (t.state.stopped) return "new starts are stopped: the health command failed twice in a row";
  const locked = lockWhy(step, held, reserved);
  if (locked) return locked;
  const here = noSlotHere(t, cap);
  if (here && ![...cap.remoteFree.values()].some((n) => n > 0)) return [here, ...cap.remoteLack].join("; ");
  const { workers, worker } = s.picked();
  if (!worker) return workers.length > 0 ? "no worker model has room, or its paid key is not allowed yet" : "pi offers none of the worker models";
  return undefined;
}

/** Makes the task of a step, here or on `host`. Returns an error text, or undefined. */
function addStepTask(s: Starting, step: Step, host: string | undefined, worker: string, reviewer: string) {
  const { t } = s;
  const { settings, world } = t;
  const title = `${step.id} ${step.title}`;
  const brief = stepBrief(step, settings, reviewer, worker, { repo: settings.repo, roadmap: s.text }, s.status.find((x) => x.id === step.id)?.unproven);
  const flags = [
    "--agent",
    "pi",
    "--model",
    worker,
    "--reviewer",
    "pi",
    "--reviewer-model",
    reviewer,
    "--set",
    `review.rounds=${settings.reviewRounds ?? DEFAULT_ROUNDS}`,
    ...resultFlag(step),
  ];
  if (host === undefined) return world.addTask(settings.space, title, brief, flags);
  return world.addTaskOn ? world.addTaskOn(host, settings, title, brief, flags, t.name) : `this world cannot start tasks on ${host}`;
}

/**
 * Just before a start, reads the tasks here and on every other machine, and main, again: the list of this tick may be
 * minutes old. A step with a task that is not done anywhere, or merged on origin/main, is never started twice. A
 * machine that cannot be reached still holds what it last ran.
 */
function whyStale(s: Starting, step: Step): string | undefined {
  const { t } = s;
  const { settings, world, state } = t;
  world.fetch(settings.repo);
  const main = world.main(settings.repo);
  if (typeof main === "string") return `main cannot be read again: ${main}`;
  if (!step.reopened && doneIds(main.commits, new Set([step.id])).has(step.id)) return "it is merged on origin/main already";
  const here = world.tasks(settings.space);
  if (typeof here === "string") return `its tasks cannot be read again: ${here}`;
  const remote: Task[] = [];
  for (const host of settings.machines ?? []) {
    const r = world.room?.(host, settings.space);
    remote.push(...(r === undefined || typeof r === "string" ? (state.remoteSeen?.[host] ?? []) : r.tasks));
  }
  const open = [...here, ...remote].find(
    (x) => x.status !== "done" && (x.title.startsWith(`${step.id} `) || (x.id !== undefined && state.taskSteps?.[x.id] === step.id)),
  );
  if (open) return `${open.id ?? open.title} for this step is not done (${open.status}), so it does not start twice`;
  return undefined;
}

/** Starts one ready step, or notes why not. Returns whether it started (or would, in a dry run). */
function startStep(s: Starting, step: Step): boolean {
  const { t, cap, limit } = s;
  const { settings, world, state, dryRun, note, env } = t;
  // A routine step (docs, tests, baselines) starts on the cheapest worker model that has room; the stall ladder moves it back after two failed checks.
  const cheap = routineWorker(step, s.picked().workers, env, (m) => availability(m, env, world.now()) === "ok");
  const worker = cheap ?? (s.picked().worker as string);
  const reviewer = reviewerFor(worker, settings, world, s.offered(), env);
  if (!reviewer) return (note("skip", `no reviewer model that pi offers has room`, step.id), false);
  // The machine with the most free room, this one and the linked ones alike.
  const localRoom = !cap.offHere && !cap.overloaded && cap.max !== undefined && cap.free > 0;
  const candidates: Candidate[] = [
    ...(localRoom ? [{ host: undefined, load: world.load() + cap.startedHere, loadLimit: limit, free: cap.free }] : []),
    ...[...cap.remoteFree]
      .filter(([, n]) => n > 0)
      .flatMap(([h, n]) => {
        const r = s.rooms.get(h);
        return r ? [{ host: h, load: r.load, loadLimit: r.loadLimit, free: n }] : [];
      }),
  ];
  const host = mostRoom(candidates)?.host;
  const remoteRoom = host === undefined ? undefined : s.rooms.get(host);
  const where =
    remoteRoom === undefined
      ? ""
      : ` on ${host} (load ${remoteRoom.load.toFixed(1)} of ${remoteRoom.loadLimit} there, ${world.load().toFixed(1)} of ${limit} here)`;
  if (dryRun) {
    note("start", `would start${where} with worker ${worker}, reviewer ${reviewer}`, step.id);
  } else {
    const release = claimStart(join(projectsDir(env), t.name), step.id, Date.now());
    if (!release) {
      note("skip", "another start of this step is in progress, so it does not start twice", step.id);
      return false;
    }
    let stale: string | undefined;
    let err: string | undefined;
    try {
      stale = whyStale(s, step);
      if (!stale) err = addStepTask(s, step, host, worker, reviewer);
    } finally {
      release();
    }
    if (stale) {
      note("skip", stale, step.id);
      return false;
    }
    if (err) {
      note("skip", `task add failed: ${err}`, step.id, host ?? THIS_MACHINE);
      return false;
    }
    state.models[step.id] = worker;
    if (cheap) (state.cheap ??= []).push(step.id);
    if (host === undefined) recordStart(state, `${step.id} ${step.title}`, step.id);
    const same = company(reviewer) === company(worker) ? " (same company: no other company has room, a different model reviews with a fresh context)" : "";
    const on = `${cheap ? `routine step on the cheap worker model ${cheap}; ` : ""}worker ${worker}`;
    note("start", `ready, locks free, slot free${where}; ${on}, reviewer ${reviewer}${same}`, step.id);
  }
  if (host === undefined) {
    cap.free -= 1;
    cap.startedHere += 1;
  } else {
    if (remoteRoom) remoteRoom.load += 1;
    cap.remoteFree.set(host, (cap.remoteFree.get(host) ?? 0) - 1);
    // Remembered at once: if that machine is down next tick, its new task still holds its step and locks.
    state.remoteSeen ??= {};
    const seen = state.remoteSeen;
    if (!dryRun) seen[host] = [...(seen[host] ?? []), { title: `${step.id} ${step.title}`, status: "work", sub: `on ${host}` }];
  }
  for (const l of stepHeld(step)) s.held.set(l, step.id);
  return true;
}

/**
 * A reopened step whose task merged after its Reopened line was added kept the line: starting it again would loop. It
 * gets one Fix task instead, and nothing more until the line is gone. Returns whether the step was handled here.
 */
function refileReopened(s: Starting, step: Step): boolean {
  const { t } = s;
  const { settings, world, note } = t;
  const line = (step.fields["done when"]?.more ?? []).find((l) => /^\s+- Reopened: /.test(l));
  const since = line === undefined ? undefined : world.commitsSince?.(settings.repo, line);
  if (line !== undefined && since === undefined) {
    note("skip", "its Reopened line cannot be placed in main's history: nothing starts", step.id);
    return true;
  }
  if (since === undefined || !doneIds(s.commits.slice(0, since), new Set([step.id])).has(step.id)) return false;
  note("skip", "a task merged but the Reopened line stayed: nothing starts until the line is deleted", step.id);
  return true;
}

function startReadySteps(s: Starting) {
  const skipped = new Set<string>();
  const reserved = reservedLocks(s.status, s.byId, s.t.state.lockWaits);
  for (const st of s.status) {
    if (st.state !== "ready") continue;
    const step = s.byId.get(st.id) as Step;
    if (isFrozen(step) || (step.ownerOnly && ownerStepItem(s.t, step))) continue;
    if (step.reopened && refileReopened(s, step)) continue;
    const why = whyNotStart(s, step, reserved);
    if (why) s.t.note("skip", why, step.id);
    else startStep(s, step);
    if (why?.startsWith("lock '")) skipped.add(step.id);
  }
  if (!s.t.dryRun) settleLockWaits(s.t.state, skipped);
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
  const note: Note = (kind, reason, step, machine) => {
    out.push({ time, project: name, step, kind, reason, ...(machine === undefined ? {} : { machine }) });
  };
  const t: Tick = { name, settings, world, state, dryRun, env, note };
  const project = readProject(t);
  if (!project) return out;
  const { text, parsed, main, tasks } = project;

  const overloaded = world.load() > limit;
  checkHealth(t, main, overloaded);
  // The list of offered models costs seconds of CPU: read it only when a stall or a start needs it, once per tick.
  let list: { set: Set<string> | undefined } | undefined;
  const offered = () => {
    list ??= { set: world.offered(world.now()) };
    return list.set;
  };
  // The project's other machines: asked once per tick. One that cannot be reached is skipped and noted.
  const { rooms, remote } = askMachines(
    settings.machines ?? [],
    state,
    world.now().getTime(),
    (host) => world.room?.(host, settings.space) ?? "this world cannot reach other machines",
    (host, why) => note("skip", why, `machine:${host}`, host),
  );
  bindStarts(state, tasks);
  const stallArgs = { project: name, settings, world, state, dryRun, waits, tasks, steps: parsed.steps, offered, note, env };
  serviceAccounts(stallArgs);
  climbStalls(stallArgs);
  const { status, byId, held } = stepStates(t, parsed.steps, main, tasks, remote);

  if (settings.paused) {
    note("skip", "the project is paused, no step starts");
    return out;
  }
  const cap = capacityOf(t, tasks, waits, rooms, overloaded, limit);
  if (overloaded && (settings.machines ?? []).length === 0) {
    note("skip", cap.overloadNote);
    return out;
  }
  startReadySteps({ t, text, commits: main.commits, steps: parsed.steps, status, byId, held, cap, rooms, limit, picked: workerPicker(t, offered), offered });
  return out;
}
