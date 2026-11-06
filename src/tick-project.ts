import { existsSync, readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { DEFAULT_ROUNDS, fill, stepBrief, template } from "./brief.ts";
import { CHECKS_PER_TICK, type ProveTools, missingItem, needsProof, testOf } from "./doneproof.ts";
import { type FixSpec, fileFix } from "./self-fix.ts";
import { ownerStepItem, ownerStepsDone } from "./owner-steps.ts";
import { overStartLimit, recordStepStart, START_LIMIT, startsInDay } from "./start-limit.ts";
import { placeHeld } from "./held.ts";
import { criticalSteps, firstByRoom } from "./pace.ts";
import { noWorkerNote, startAccountNote } from "./quota.ts";
import { stepHeld } from "./parts.ts";
import { company } from "./company.ts";
import type { Settings } from "./project.ts";
import { checkRoadmap, closedSteps, doneIds, isFrozen, resultFlag, stepOfTask, stepStatuses, type Task } from "./roadmap.ts";
import type { Decision, State } from "./rules.ts";
import { askMachines, type Room, roomLack } from "./spread.ts";
import { routineWorker } from "./routine.ts";
import { askKey, availability, revertLast, reviewerFor, serviceStalls } from "./stalls.ts";
import { bindStarts, liveSteps, recordStart, lockWhy, reservedLocks, settleLockWaits } from "./starts.ts";
import type { TickFacts } from "./stall-ladder.ts";
import type { Wait } from "./waits.ts";
import type { World } from "./world.ts";

type MainInfo = Exclude<ReturnType<World["main"]>, string>;
type Parsed = ReturnType<typeof checkRoadmap>["parsed"];
type Step = Parsed["steps"][number];
type StepState = ReturnType<typeof stepStatuses>[number];
type Note = (kind: Decision["kind"], reason: string, step?: string) => void;

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

function proveTools(t: Tick): ProveTools {
  const { env, world } = t;
  return {
    available: (model) => availability(model, env, world.now()) === "ok",
  };
}

/** A fix of a step's own: one ledger entry per project, step and kind, and a title that starts with the step id. */
type FixKind = "closed" | "reopened" | "unproven" | "faulted";
function stepFix(t: Tick, step: Step, kind: FixKind, brief: string, evidence: string[], basis?: string, title?: string): FixSpec {
  return {
    key: `${t.name}:${step.id}:${kind}`,
    title: title ?? `${step.id} Fix: ${step.title}`.slice(0, 80),
    project: { name: t.name, settings: t.settings },
    brief,
    evidence,
    basis,
  };
}

/** Files a step's fix and logs one decision with the step's id: a `start` naming the kind, or a `skip` with the reason it was held. */
export function fileStepFix(t: Tick, step: Step, kind: FixKind, why: string, brief: string, evidence: string[], basis?: string, title?: string) {
  const got = fileFix(t.world, stepFix(t, step, kind, brief, evidence, basis, title), t.env);
  if (got.filed) t.note("start", `${step.id}: ${why}, started one ${kind} fix task`, step.id);
  else t.note("skip", `${step.id}: ${why}, and no ${kind} fix task started: ${got.why}`, step.id);
  return got;
}

/**
 * A step closed with nothing to merge is done for good, so it is never restarted. Its named test runs once; when it
 * fails the step gets one Fix task instead (it is recorded already, so this runs once per step).
 */
function proveClosed(t: Tick, step: Step) {
  const { settings, world } = t;
  const cmd = testOf(step);
  if (cmd === undefined) return;
  const r = world.health(settings.repo, cmd);
  if (r.ok) return;
  const brief = `Step ${step.id} ${step.title} was closed with nothing to merge: its work is on main. The test its done-when names fails now.

Command: \`${cmd}\`

Its output (the end of it):

\`\`\`
${r.output.slice(-4000).trimEnd()}
\`\`\`

Fix the cause, run \`${settings.check}\` before you merge, then rebase on main and merge it yourself.
`;
  fileStepFix(t, step, "closed", "its test failed", brief, [`${cmd}: ${r.output.slice(-300).trim()}`]);
}

/**
 * Has the independent checker read the `done when` of each merged step that has no current record, a few per tick. A
 * step the checker found a false item for is unproven: not done, and started again (see `restartUnproven`). Returns
 * step id to its first unproven item. A world with no checker proves nothing and no step is unproven.
 */
function proveMerged(t: Tick, steps: Step[], merged: Set<string>, head: string): Map<string, string> {
  const { settings, world, state, dryRun, note } = t;
  state.proofTried ??= {};
  const tried = state.proofTried;
  const unproven = new Map<string, string>();
  if (!world.proofs || !world.proveStep) return unproven;
  const records = world.proofs(settings.repo);
  let asked = 0;
  for (const step of steps) {
    if (!merged.has(step.id) || step.dropped) continue;
    const lastTry = tried[step.id] ?? 0;
    if (!dryRun && asked < CHECKS_PER_TICK && world.now().getTime() - lastTry >= RETRY_MS && needsProof(step, records[step.id], head)) {
      asked += 1;
      tried[step.id] = world.now().getTime();
      const got = world.proveStep(settings, step, head, proveTools(t));
      // a checker that did not answer is asked again in half an hour, and says nothing meanwhile
      if (typeof got !== "string") {
        records[step.id] = got;
        const bad = missingItem(got);
        note(
          bad === undefined ? "close" : "skip",
          bad === undefined ? `${step.id} is proven: every done-when item is true` : `${step.id} is merged, unproven: ${bad}`,
          step.id,
        );
      }
    }
    const record = records[step.id];
    const missing = record && missingItem(record);
    if (missing !== undefined) unproven.set(step.id, missing);
  }
  return unproven;
}

/** Each step's state from main, the tasks and the other machines, and the locks the working steps hold. */
function stepStates(t: Tick, steps: Step[], main: MainInfo, tasks: Task[], remote: Task[], restarted: Set<string>, facts: TickFacts) {
  const { state, dryRun, note } = t;
  const byStep = new Set(steps.map((s) => s.id));
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
  const mergedIds = doneIds(main.commits, byStep);
  for (const step of Object.keys(closed)) if (byStep.has(step)) mergedIds.add(step);
  const unproven = proveMerged(t, steps, new Set([...mergedIds, ...closedSteps(steps, tasks, state.taskSteps, remote).keys()]), main.head);
  for (const id of ownerStepsDone(t, steps)) mergedIds.add(id);
  const status = stepStatuses(steps, mergedIds, tasks, state.taskSteps, remote, unproven).map((s) =>
    restarted.has(s.id) ? { ...s, state: "work" as const } : s,
  );
  const byId = new Map(steps.map((s) => [s.id, s]));
  facts.tasks = tasks;
  facts.done = new Set(status.filter((s) => s.state === "done").map((s) => s.id));
  facts.stepOf = (task) => stepOfTask(steps, task, state.taskSteps)?.id;
  const held = new Map<string, string>();
  const live = liveSteps(steps, [...tasks, ...remote], remote, state.taskSteps, restarted);
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
    remoteLack,
  };
}

/** The worker model, chosen when the first step is about to start, not before. */
function workerPicker(t: Tick, offered: () => Set<string> | undefined) {
  const { settings, world, dryRun, env, note } = t;
  let pick: { workers: string[]; worker: string | undefined; ahead: boolean } | undefined;
  return () => {
    if (pick) return pick;
    const set = offered();
    const workers = settings.models.worker.filter((m) => set === undefined || set.has(m));
    // A full account is passed over, and the one with the most room a day left goes first. A paid key waits for your leave in the Inbox.
    const { worker, ahead } = firstByRoom(workers, (m) => availability(m, env, world.now()) === "ok", env, world.now());
    // Ask for a key only when nothing before it in the list has room.
    const keyed = workers.find((m) => availability(m, env, world.now()) !== "out");
    const asked = worker === undefined && keyed !== undefined && !dryRun ? askKey(keyed, world, world.now(), env) : undefined;
    if (asked) note("skip", asked);
    pick = { workers, worker, ahead: ahead && settings.pace === "even" };
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
  const { workers, worker, ahead } = s.picked();
  if (!worker) return workers.length > 0 ? noWorkerNote(workers, t.env, t.world.now()) : "pi offers none of the worker models";
  if (ahead && !criticalSteps(s.steps, s.status).has(step.id)) return "every account is ahead of its weekly pace: only the critical path starts";
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
  const unproven = s.status.some((x) => x.id === step.id && x.state === "unproven");
  if (!step.reopened && !unproven && doneIds(main.commits, new Set([step.id])).has(step.id)) return "it is merged on origin/main already";
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
  if (overStartLimit({ ...t, space: settings.space }, step, START_LIMIT)) return false;
  // A routine step (docs, tests, baselines) starts on the cheapest worker model that has room; the stall ladder moves it back after two failed checks.
  const cheap = routineWorker(step, s.picked().workers, env, (m) => availability(m, env, world.now()) === "ok");
  const worker = cheap ?? (s.picked().worker as string);
  const reviewer = reviewerFor(worker, settings, world, s.offered(), env);
  if (!reviewer) return (note("skip", `no reviewer model that pi offers has room`, step.id), false);
  // The local machine first; another only when this one has no room.
  const localRoom = !cap.offHere && !cap.overloaded && cap.max !== undefined && cap.free > 0;
  const host = localRoom ? undefined : [...cap.remoteFree].find(([, n]) => n > 0)?.[0];
  const remoteRoom = host === undefined ? undefined : s.rooms.get(host);
  const where =
    remoteRoom === undefined
      ? ""
      : ` on ${host} (load ${remoteRoom.load.toFixed(1)} of ${remoteRoom.loadLimit} there, ${world.load().toFixed(1)} of ${limit} here)`;
  if (dryRun) {
    note("start", `would start${where} with worker ${worker}, reviewer ${reviewer}`, step.id);
  } else {
    const stale = whyStale(s, step);
    if (stale) {
      note("skip", stale, step.id);
      return false;
    }
    const err = addStepTask(s, step, host, worker, reviewer);
    if (err) {
      note("skip", `task add failed: ${err}`, step.id);
      return false;
    }
    state.models[step.id] = worker;
    if (cheap) (state.cheap ??= []).push(step.id);
    recordStepStart(state, step.id, world.now());
    if (host === undefined) recordStart(state, `${step.id} ${step.title}`, step.id);
    const same = company(reviewer) === company(worker) ? " (same company: no other company has room, a different model reviews with a fresh context)" : "";
    const on = `${cheap ? `routine step on the cheap worker model ${cheap}; ` : ""}${startAccountNote(s.picked().workers, worker, env, world.now())}`;
    note("start", `ready, locks free, slot free${where}; ${on}, reviewer ${reviewer}${same}`, step.id);
  }
  if (host === undefined) cap.free -= 1;
  else {
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
 * gets one Fix task instead, and nothing more until the line is gone, unless the limit is reached: a Fix task is a start too. Returns whether the step was handled here.
 */
function refileReopened(s: Starting, step: Step): boolean {
  const { t } = s;
  const { settings, world, dryRun, note } = t;
  if (overStartLimit({ ...t, space: settings.space }, step, START_LIMIT)) return true;
  const line = (step.fields["done when"]?.more ?? []).find((l) => /^\s+- Reopened: /.test(l));
  const since = line === undefined ? undefined : world.commitsSince?.(settings.repo, line);
  if (line !== undefined && since === undefined) {
    note("skip", "its Reopened line cannot be placed in main's history: nothing starts", step.id);
    return true;
  }
  if (since === undefined || !doneIds(s.commits.slice(0, since), new Set([step.id])).has(step.id)) return false;
  if (dryRun) {
    note("start", "would file one Fix task: a task merged, but the Reopened line stayed", step.id);
    return true;
  }
  const brief = `Step ${step.id} ${step.title} is reopened, but a task for it merged after its Reopened line was added, and the line stayed in docs/ROADMAP.md. The runner would start the step again and again.

Check whether the proof its done-when names is in docs/numbers.md. If it is, delete the Reopened line of ${step.id} in docs/ROADMAP.md in the same commit as the proof. If it is not and you can record it here, record it and delete the line. If it needs something you cannot do here (a real machine, a login), leave the line and say so in your facts: never write a proof that did not happen.

Run \`${settings.check}\` before you merge, then rebase on main and merge it yourself.
`;
  const last = s.commits[0]?.subject;
  fileStepFix(t, step, "reopened", "a task merged but the Reopened line stayed", brief, [last ?? "a task merged, the Reopened line stayed"], line);
  return true;
}

const RETRY_MS = 30 * 60_000;

/**
 * A merged step with an unproven item starts again with that item as the brief: twice in 24 hours at most. After that
 * it gets a Fix task instead. Returns whether the step should start now.
 */
function restartUnproven(s: Starting, step: Step, item: string): boolean {
  const { settings, world, state, dryRun, note } = s.t;
  // A restart that merged since the last reading is not judged yet: wait for the checker to read the new main.
  const main = world.main(settings.repo);
  if (typeof main !== "string" && world.proofs?.(settings.repo)[step.id]?.head !== main.head) return false;
  const list = world.tasks(settings.space);
  const n = startsInDay(state, step.id, world.now(), typeof list === "string" ? [] : list);
  if (n < START_LIMIT) return true;
  if (dryRun) return (note("start", `would file one Fix task: ${step.id} is still unproven after ${n} starts in 24 hours`, step.id), false);
  const brief = `Step ${step.id} ${step.title} is merged, but this item of its done-when is not proven: ${item}

The step was started ${n} times in 24 hours and the independent checker still records the item false. Find out why and make it true. An action outside the repo (a tag, a GitHub release, a recorded run) is proven by a command the checker runs (\`git ls-remote --tags origin\`, \`gh release view\`), not by text. If it needs something you cannot do here, say so in your facts and do not claim it.

Run \`${settings.check}\` before you merge, then rebase on main and merge it yourself.
`;
  fileStepFix(s.t, step, "unproven", `unproven after ${n} starts in 24 hours`, brief, [item], item);
  return false;
}

function startReadySteps(s: Starting) {
  const skipped = new Set<string>();
  const reserved = reservedLocks(s.status, s.byId, s.t.state.lockWaits);
  for (const st of s.status) {
    if (st.state !== "ready" && st.state !== "unproven") continue;
    const step = s.byId.get(st.id) as Step;
    if (isFrozen(step) || (step.ownerOnly && ownerStepItem(s.t, step))) continue;
    const held = st.unproven !== undefined && !restartUnproven(s, step, st.unproven);
    if (held || (step.reopened && refileReopened(s, step))) continue;
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
  facts: TickFacts = {},
): Decision[] {
  const out: Decision[] = [];
  const time = world.now().toISOString();
  const note: Note = (kind, reason, step) => {
    out.push({ time, project: name, step, kind, reason });
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
    (host, why) => note("skip", why, `machine:${host}`),
  );
  bindStarts(state, tasks);
  const restarted = serviceStalls({ project: name, settings, world, state, dryRun, waits, tasks, steps: parsed.steps, offered, note, env });
  const { status, byId, held } = stepStates(t, parsed.steps, main, tasks, remote, restarted, facts);

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
  // A task made by hand that waits for a slot here goes where there is room.
  state.placed ??= {};
  placeHeld(
    {
      world,
      settings,
      project: name,
      tasks,
      remote: [...(state.remoteSeen ? Object.values(state.remoteSeen).flat() : [])],
      stepIds: parsed.steps.map((x) => x.id),
      free: cap.remoteFree,
      dryRun,
      note: (reason, task) => note("start", reason, task),
    },
    state.placed,
  );
  return out;
}
