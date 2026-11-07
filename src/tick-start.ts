import { DEFAULT_ROUNDS, stepBrief } from "./brief.ts";
import { company } from "./company.ts";
import { type DecisionCode, kindOf } from "./decision-code.ts";
import { ownerStepItem } from "./owner-steps.ts";
import { stepHeld } from "./parts.ts";
import type { Settings } from "./project.ts";
import { type checkRoadmap, doneIds, isFrozen, resultFlag, type StepStatus, type Task } from "./roadmap.ts";
import { routineWorker } from "./routine.ts";
import type { Decision, State } from "./rules.ts";
import { type Candidate, mostRoom, type NewTask, type Room, roomLack } from "./spread.ts";
import { askKey, availability, reviewerFor } from "./stalls.ts";
import { THIS_MACHINE } from "./start-failures.ts";
import { lockWhy, recordStart, reservedLocks, settleLockWaits } from "./starts.ts";
import type { Wait } from "./waits.ts";
import type { World } from "./world.ts";

export type MainInfo = Exclude<ReturnType<World["main"]>, string>;
type Step = ReturnType<typeof checkRoadmap>["parsed"]["steps"][number];
export type Note = (code: DecisionCode, reason: string, step?: string, machine?: string) => Decision;

/** What every part of one project's tick needs. */
export interface Tick {
  name: string;
  settings: Settings;
  world: World;
  state: State;
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
  note: Note;
}

/** The slots here and on the other machines. `free` falls as steps start. */
export interface Capacity {
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

export function capacityOf(t: Tick, tasks: Task[], waits: Wait[], rooms: Map<string, Room>, overloaded: boolean, limit: number): Capacity {
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
export function workerPicker(t: Tick, offered: () => Set<string> | undefined) {
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
    if (asked) note("owner", asked);
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
export interface Starting {
  t: Tick;
  text: string;
  commits: MainInfo["commits"];
  /** The tasks here and on the other machines, as the tick read them. */
  tasks: Task[];
  status: StepStatus[];
  byId: Map<string, Step>;
  held: Map<string, string>;
  cap: Capacity;
  rooms: Map<string, Room>;
  limit: number;
  picked: ReturnType<typeof workerPicker>;
  offered: () => Set<string> | undefined;
}

/** Why a ready step finds no slot or worker, or undefined when it does. */
function whyNoRoom(s: Starting) {
  const { t, cap } = s;
  const here = noSlotHere(t, cap);
  if (here && ![...cap.remoteFree.values()].some((n) => n > 0)) return [here, ...cap.remoteLack].join("; ");
  const { workers, worker } = s.picked();
  if (!worker) return workers.length > 0 ? "no worker model has room, or its paid key is not allowed yet" : "pi offers none of the worker models";
  return undefined;
}

/** A step this tick starts: where, and with which models. */
interface Planned {
  step: Step;
  host: string | undefined;
  worker: string;
  reviewer: string;
  cheap: string | undefined;
  where: string;
  /** Its line in the tick's decisions, written as it is planned so the lines keep the steps' order; its outcome comes once the starts ran. */
  decision: Decision;
}

/** Fills in a planned step's line once its start ran. */
const settle = (p: Planned, code: DecisionCode, reason: string, machine?: string) =>
  Object.assign(p.decision, { kind: kindOf(code), code, reason }, machine === undefined ? {} : { machine });

/** The task of a planned step, here or on its host. */
function stepTask(s: Starting, { step, host, worker, reviewer }: Planned): NewTask {
  const { settings } = s.t;
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
    // the board refuses a step that already landed; a reopened one is meant to run again
    ...(step.reopened ? ["--reopened", "true"] : []),
  ];
  return { host, title, brief, extra: flags };
}

/**
 * What holds a ready step that its state does not show, or undefined. The state marks a task here only through the
 * rules' record of its start: a task just added may not be listed yet, and one titled for the step may have no record.
 * Main and every machine's tasks were read once, as the tick began; the claim on the repo stops a start another loop made since.
 */
function whyHeldUnrecorded(s: Starting, step: Step): string | undefined {
  const { state } = s.t;
  if (Object.values(state.pendingStarts ?? {}).includes(step.id))
    return "a task was just added for this step and is not listed yet, so it does not start twice";
  const open = s.tasks.find((x) => x.status !== "done" && x.title.startsWith(`${step.id} `));
  if (open) return `${open.id ?? open.title} for this step is not done (${open.status}), so it does not start twice`;
  return undefined;
}

/**
 * Picks the machine and the models of a ready step, and books its slot and its locks for the rest of the tick. Each
 * machine is judged by its own load and slots: this one's load only keeps starts off this one. Returns undefined, with
 * the reason noted, when it does not start.
 */
function planStep(s: Starting, step: Step): Planned | undefined {
  const { t, cap, limit } = s;
  const { settings, world, note, env } = t;
  const held = whyHeldUnrecorded(s, step);
  if (held) return (note("blocked", held, step.id), undefined);
  // A routine step (docs, tests, baselines) starts on the cheapest worker model that has room; the stall ladder moves it back after two failed checks.
  const cheap = routineWorker(step, s.picked().workers, env, (m) => availability(m, env, world.now()) === "ok");
  const worker = cheap ?? (s.picked().worker as string);
  const reviewer = reviewerFor(worker, settings, world, s.offered(), env);
  if (!reviewer) return (note("no-room", `no reviewer model that pi offers has room`, step.id), undefined);
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
  if (host === undefined) {
    cap.free -= 1;
    cap.startedHere += 1;
  } else {
    if (remoteRoom) remoteRoom.load += 1;
    cap.remoteFree.set(host, (cap.remoteFree.get(host) ?? 0) - 1);
  }
  for (const l of stepHeld(step)) s.held.set(l, step.id);
  return { step, host, worker, reviewer, cheap, where, decision: note("start", "", step.id) };
}

/** What the tick keeps of a step whose task was added. */
function recordStarted(s: Starting, p: Planned) {
  const { step, host, worker, reviewer, cheap, where } = p;
  const { state } = s.t;
  state.models[step.id] = worker;
  if (cheap) (state.cheap ??= []).push(step.id);
  if (host === undefined) recordStart(state, `${step.id} ${step.title}`, step.id);
  const same = company(reviewer) === company(worker) ? " (same company: no other company has room, a different model reviews with a fresh context)" : "";
  const on = `${cheap ? `routine step on the cheap worker model ${cheap}; ` : ""}worker ${worker}`;
  settle(p, "start", `ready, locks free, slot free${where}; ${on}, reviewer ${reviewer}${same}`);
}

/**
 * Starts the planned steps together: every claim at once, then every task at once. One claim per repo, taken before
 * the task: the space names differ per machine, the repo's refs do not. A task that cannot be added gives its claim back at once.
 */
function startPlanned(s: Starting, planned: Planned[]) {
  const { settings, world, name } = s.t;
  const claims =
    world.claimSteps?.(
      settings.repo,
      planned.map((p) => p.step.id),
    ) ?? [];
  const claimed = planned.filter((p, i) => {
    const claim = claims[i];
    if (claim)
      settle(
        p,
        claim === "held" ? "blocked" : "broken",
        claim === "held" ? "another loop holds this step's claim on the repo" : `its claim cannot be made: ${claim}`,
      );
    return !claim;
  });
  const errors = world.addTasks(
    settings,
    claimed.map((p) => stepTask(s, p)),
    name,
  );
  const failed = claimed.filter((p, i) => {
    const err = errors[i];
    if (err === undefined) recordStarted(s, p);
    else settle(p, "broken", `task add failed: ${err}`, p.host ?? THIS_MACHINE);
    return err !== undefined;
  });
  world.releaseSteps?.(
    settings.repo,
    failed.map((p) => p.step.id),
  );
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
    note("blocked", "its Reopened line cannot be placed in main's history: nothing starts", step.id);
    return true;
  }
  if (since === undefined || !doneIds(s.commits.slice(0, since), new Set([step.id])).has(step.id)) return false;
  note("blocked", "a task merged but the Reopened line stayed: nothing starts until the line is deleted", step.id);
  return true;
}

/** Plans every ready step that fits (free slots, disjoint locks and files), then starts them all together. */
export function startReadySteps(s: Starting, red: boolean) {
  const skipped = new Set<string>();
  const planned: Planned[] = [];
  const reserved = reservedLocks(s.status, s.byId, s.t.state.lockWaits);
  for (const st of s.status) {
    if (st.state !== "ready") continue;
    const step = s.byId.get(st.id) as Step;
    if (isFrozen(step) || (step.ownerOnly && ownerStepItem(s.t, step))) continue;
    if (step.reopened && refileReopened(s, step)) continue;
    const locked = red ? undefined : lockWhy(step, s.held, reserved);
    const room = red || locked ? undefined : whyNoRoom(s);
    const why = red ? "main is red: new starts are stopped" : (locked ?? room);
    if (locked) skipped.add(step.id);
    if (why) s.t.note(room ? "no-room" : "blocked", why, step.id);
    else {
      const p = planStep(s, step);
      if (p) planned.push(p);
    }
  }
  if (s.t.dryRun) {
    for (const p of planned) settle(p, "start", `would start${p.where} with worker ${p.worker}, reviewer ${p.reviewer}`);
    return;
  }
  startPlanned(s, planned);
  settleLockWaits(s.t.state, skipped);
}
