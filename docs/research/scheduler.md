# Research: scheduler and truth

How popular projects solve scheduling, locks and status truth, compared with what Lineclear does today. Read:
`docs/architecture.md`, `docs/parts/rules.md`, `docs/stalls.md`, the Phase 27 part of `docs/ROADMAP.md`. Sources are
docs and READMEs fetched on 4 Nov 2026; links below. Not read in depth: Linear, Vercel and Grafana's home (closed
source or no public design doc), so those are named only where a public page says something.

## What Lineclear does today

- One rule loop (`lineclear run`) ticks, reads roadmap, tasks on every machine and main, decides, writes the decision
  to `decisions.jsonl` first, then acts. No AI decides what starts.
- Locks are a step's `locks` plus its `parts`; two open steps never hold the same one. L151 lets a step's own locks
  narrow its part (a step without `locks` still holds each part whole).
- Machines have check slots and one check line per repo and machine; a stuck head is detected and shown (`stuckHeads`), not released.
- Stalls are named classes with a ladder (reminder, restart, next model, Inbox item); the quiet ladder reads Shepherdr cards, the rest is timed by the loop.
- "Done" is a commit on main with the step id, plus `done when` text a model checks by hand in review.
- Status truth: `/api/home` answers from the last value of a worker that reads projects every second
  (`src/projects-worker.ts`, `src/web.ts`) and pushes updates to the page. The snapshot is in memory only, shows no
  age, and Phase 27 fixes lies one by one (spaces shown as projects, why work waits).
- Waste is measured after the fact by `lineclear measure` (ask count, wait, cost per step), not alerted on.

## Projects (3 to 6 lines each)

**Kubernetes controllers** ([controllers.md](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/controllers.md),
[workqueue](https://github.com/kubernetes/client-go/blob/master/util/workqueue/doc.go)). A controller loops "desired vs
current, then change". Level driven, not edge driven: it must work if it missed events, and records what it last
decided in `status` (api-conventions: `observedGeneration`). Work is one key per object in a queue that is *stingy*: the same key added twice before it is
taken runs once, and never on two workers at once. Lineclear's tick is the same loop, but it is one global pass, not
per-step keys.

**Kubernetes conditions and readiness gates** ([api-conventions](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api-conventions.md),
[pod-lifecycle](https://github.com/kubernetes/website/blob/main/content/en/docs/concepts/workloads/pods/pod-lifecycle.md)).
Status is a list of typed conditions (`type`, `status` True/False/Unknown, `reason`, `message`, last transition).
A controller writes each condition on first visit, even as Unknown, so "not yet checked" differs from "fine".
Readiness gates add extra conditions a Pod must have before it counts as Ready. Done is the AND of named checks.

**Temporal** ([workflow-lifecycle](https://github.com/temporalio/temporal/blob/main/docs/architecture/workflow-lifecycle.md)).
Every state change is an event appended to a durable history; mutable state, a transfer queue and a timer queue
are written in the same persistence transaction. A crashed worker replays history to the same state. Lesson: write
the decision and its follow-up task in one atomic step, then act from the queue.

**Nomad** ([scheduler README](https://github.com/hashicorp/nomad/blob/main/scheduler/README.md)). An *evaluation*
goes through feasibility (hard filters), then ranking (score), then a *plan*. Many schedulers plan in parallel
against a snapshot; the plan applier on the leader accepts or rejects each plan, so conflicts show up as a
rejected plan and a retry, not as a lock. Lineclear locks first and plans later.

**Kueue** ([README](https://github.com/kubernetes-sigs/kueue/blob/main/README.md)). Quota per queue, borrowing
between cohorts, preemption, admission checks that hold a workload until an outside check passes, and
all-or-nothing admission. Every held workload carries a reason in its status (a condition with a
message). Matches Lineclear's U69 "why work waits".

**Argo Workflows synchronization** ([synchronization.md](https://github.com/argoproj/argo-workflows/blob/main/docs/synchronization.md)).
Mutexes and semaphores, named, per workflow or per template, local or in a database for many controllers. A mutex
is a semaphore of size 1. Waiting items queue by creation time. The lock is on a *named resource*, not on the code
area the step touches. Lineclear's parts are coarse resources; L151 moves toward this.

**Buildkite concurrency groups** ([docs](https://github.com/buildkite/docs/blob/main/pages/pipelines/configure/workflows/controlling_concurrency.md)).
A group is a queue with a limit. `ordered` runs by original scheduling time; a retry keeps its original timestamp
so it does not go to the back; `eager` lets ready jobs pass jobs that are not ready. A state `limited` is shown for
a job waiting on its group. Lesson: a retry (our restart, rung 2 and 3) must keep its place.

**Airflow sensors and pools** ([sensors](https://github.com/apache/airflow/blob/main/airflow-core/docs/core-concepts/sensors.rst),
[pools](https://github.com/apache/airflow/blob/main/airflow-core/docs/administration-and-deployment/pools.rst)).
A sensor in `poke` mode holds a worker slot while it waits; in `reschedule` mode it frees the slot and sleeps.
Pools cap parallelism on a shared resource, with a choice whether deferred tasks count. Lesson: a waiting agent
should not hold a slot. (Lineclear already does this with declared waits and `lineclear wait`.)

**Dagster asset checks and declarative automation** ([asset-checks](https://github.com/dagster-io/dagster/blob/master/docs/docs/guides/test/asset-checks.md),
[declarative automation](https://github.com/dagster-io/dagster/blob/master/docs/docs/guides/automate/declarative-automation/index.md)).
Each asset has small checks, one property each, with a severity; results show next to the asset. Work starts from
*conditions* (`eager`, `on_cron`, "upstream updated and not in progress"), evaluated by one sensor, instead of a
hand-made schedule. Our `done when` bullets are the checks; they are not machine-run or shown per bullet.

**Argo CD health** ([health.md](https://github.com/argoproj/argo-cd/blob/master/docs/operator-manual/health.md)).
Each resource kind has a health rule (Healthy, Progressing, Degraded, Missing, Suspended); custom rules in Lua.
An app is as healthy as its worst resource. A pod that should never finish can be marked so it does not stay
"Progressing" for ever. Lesson: one tiny, named rule per kind of thing; the roll-up is the worst child.

**Prometheus alerting rules** ([alerting_rules.md](https://github.com/prometheus/prometheus/blob/main/docs/configuration/alerting_rules.md)).
An alert is an expression on own metrics; `for: 10m` keeps it *pending* until it held that long, and
`keep_firing_for` stops flapping. Lesson: alert on own throughput (merged per day, median wait) with a hold time,
so a blip does not nag and a lasting drop does.

**Grafana Mimir ruler** ([ruler](https://github.com/grafana/mimir/blob/main/docs/sources/mimir/references/architecture/components/ruler/index.md)).
Rules are evaluated on a schedule by a service, results stored as new series; dashboards read the stored result
instead of recomputing it. This is the precomputed-snapshot pattern: compute on a timer, read cheaply.

**DORA Four Keys** (archived since 2024, the metrics still stand; [README](https://github.com/dora-team/fourkeys/blob/main/README.md)). Deployment frequency, lead
time for changes, time to restore, change failure rate; from events (PR merged, deploy, incident) collected into
one table. Lineclear's analogues are merges per day, ready to merge time, stall to recovery time, and share of
merged steps reopened or reverted. We have the data; `measure` shows only a part.

**Hatchet** ([README](https://github.com/hatchet-dev/hatchet/blob/main/README.md)). Postgres as the single durable
store; fair scheduling by dynamic concurrency keys (a limit per key, e.g. per project); worker slots so a worker
cannot take more than it can handle. Placement is central; slots only cap a worker. It is no work stealing, and neither do we need it.

## Table

| Topic | Lineclear today | What they do | Gap | Recommendation | Expected gain | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Reconcile | One tick, global pass; decision logged before act | k8s: per-key queue, level-driven, status records last decision | A tick that crashes midway redoes everything; no per-step "last observed" | Keep the loop; write each step's observed state (`blocked-by`, `since`) to one status file each tick | Faster restart, one place to read why | Low |
| Atomic decision | `decisions.jsonl` then act | Temporal: state and next task in one transaction | Act can fail after the log line, with no record of the outcome | Log `intent` then `done`/`failed` for each start; the next tick finishes open intents | No lost or doubled start after a kill | Low |
| Locks | Parts plus `locks`; L151 narrows | Argo/Hatchet: named resource locks with a limit; Nomad: plan then verify | Part names are code areas, not real resources; many steps still wait on a part | Make `locks` the only lock; parts only describe. Optional limit per lock (`ui-shell: 1`, `server-tests: 2`) | More parallel steps | Medium |
| Optimistic start | Lock first, read again before start | Nomad: plan on a snapshot, reject on conflict | Two loops (two machines) can race | Keep "read again before start"; add a start token (step id plus tick id) in the task record | Safe if a second loop ever runs | Low |
| Retry order | Restart or handover is a new start | Buildkite: retry keeps original timestamp | A restarted step may wait behind new work | A handover keeps the step's original queue time and goes first | Less wait after a failure | Low |
| Waiting | Declared waits free the slot | Airflow `reschedule`, Kueue reasons | Already matches; reasons are not one list | Give every held step a `reason` condition (see done) | Home says why | Low |
| Work across machines | Spread by room per machine; checks in a line per machine | Hatchet slots; Nomad bin-pack score | Pick is "has room", not "best machine" | Score machines (free slots, repo already cloned, check queue length), pick the top | Shorter wait, fewer clones | Medium |
| Done | Commit subject on main plus a model's read of `done when` | Dagster asset checks, k8s readiness gates | Not machine-checked per bullet; "done" can be claimed | Each step's `done when` bullets get an id and a check command or "manual"; the loop stores True/False/Unknown per bullet | Truth audit by machine | Medium |
| Status model | Many ad hoc fields in Home, stalls, waits | k8s Conditions; Argo CD worst-child health | Each view recomputes its own truth | One `conditions` list per task (`Started`, `Checked`, `Reviewed`, `Merged`, `Waiting`) with reason and last change; Home reads it | One truth for Home, Inbox, status | Medium |
| Home speed | Computed on request | Mimir ruler, Grafana: compute on a timer, read the result | In-memory snapshot only, no age shown, lost on restart | Write the snapshot to `home.json` (atomic rename) with `at`; `/api/home` returns `age`; Home marks a stale one | Honest age, instant Home after restart | Low |
| Waste alerts | `measure` after the fact | Prometheus `for` and `keep_firing_for`; DORA | Nobody is told throughput fell | Rules on own metrics (merged per day, median wait, share of steps restarted); pending then firing; one Inbox item | Waste found in hours | Medium |
| Flow metrics | Ask count, wait, cost | DORA four keys | No change-failure or restore time (lane time, review to merged, exists) | Add: reverted or reopened share, stall to recovery time | Honest goal tracking | Low |

## Top 5 recommendations

Each is written to become a roadmap step.

1. **Home snapshot with an age** (`home` lock, parts ui, rules). Home already answers from the projects worker's
   last value. Add what is missing: the worker writes it to `home.json` atomically with `at`, `/api/home` returns
   `age`, and Home marks a snapshot older than 3 ticks as stale. Done when: with 1000 tasks `/api/home` answers in
   under 50 ms in a test; a restart serves the last file at once; a killed worker shows "stale". Gain: Home that
   cannot lie about its age. Cost: low.

2. **Task conditions** (parts rules, ui). Each task has typed conditions in one file: `Started`, `Checked`,
   `Reviewed`, `Merged`, `Waiting`, each `True/False/Unknown` with `reason` and `since`. The loop writes all five
   on its first visit as Unknown. Home, `lineclear status` and the Inbox read only these. Done when: a test of
   every held-step reason in U69 comes out of conditions, and no view recomputes a wait. Gain: one truth. Cost:
   medium. This is the base for 3 and 4.

3. **Done as checked bullets** (parts planner, rules). Each `done when` bullet in the roadmap may name a check
   (`check: bun test test/x.test.ts`) or `manual`. When a step is merged, the loop runs the named checks and stores
   a condition per bullet; a step whose bullet is False or Unknown shows as "merged, not proven" and the loop adds an
   `Reopened:` item to the step in `docs/ROADMAP.md` (new: today that is written by hand). Done when: a test step with one failing check is reopened; `lineclear roadmap check`
   warns on a bullet with no check and no `manual`. Gain: machine-made truth audit. Cost: medium.

4. **Named resource locks with limits** (parts rules, planner). L151 is merged, so only the rest is new. `parts` only describes once
   a step names real `locks` (`locks: none` still holds its parts). A file `locks.json` can give a lock a limit above 1 (like an Argo semaphore). A handover or restart
   keeps the step's original queue time (Buildkite rule). Done when: a lock with limit 2 admits two; a restarted step is ahead of newer ready steps. Gain:
   more steps in parallel, shorter waits. Cost: medium.

5. **Throughput alerts and flow metrics** (parts measure, inbox). Rules on own metrics
   in a config file, for example "merged per day below the 7-day median for 24 h" with `for` and `keep_firing_for`. They
   raise one Inbox item of a new kind `waste`, not a push. `measure` adds reverted or
   reopened share and stall-to-recovery time (DORA analogues). Done when: a test with a 3-day flat run raises one
   item once and clears it after recovery. Gain: waste found in hours. Cost: medium.

Next in line, smaller: log `intent` then `done` for each start (finish open intents next tick); score machines
for placement.

## What we should NOT copy

- **A full workflow engine (Temporal, Hatchet).** Replaying histories and a Postgres or Cassandra store solve
  long-running code with deterministic replay. Our work is steps in git; the roadmap plus the tick log is the
  history. A second store would break "one task store".
- **Optimistic parallel schedulers (Nomad).** Many schedulers and a plan applier pay off with thousands of nodes
  and a heavy placement problem. We have a handful of machines and one loop; a lock plus a re-read before start is
  enough, and easier to explain.
- **Kubernetes watches and informers.** They exist to cut API load across many controllers. One loop reading files
  at a tick, with an idle cost near zero (L153), needs no event cache. Watches would bring missed-event bugs
  back; the level-driven tick avoids them.
- **Fair-share quotas, borrowing and preemption (Kueue).** Built for many teams sharing one pool. One owner sets
  the order in the roadmap; preemption would kill agents' work for little gain.
- **Lua or code-defined health rules (Argo CD).** Code per kind of thing invites drift. Typed conditions with a
  fixed small list are enough.
- **Asset-style auto-run on every upstream change (Dagster `eager`).** It re-runs work whenever anything changes.
  A step runs once; reruns would burn tokens. Use the conditions for *showing* freshness, not for starting work.
- **Full alert stack (Alertmanager routing, silences, on-call).** One owner and one Inbox: only `for` and
  `keep_firing_for` are worth taking.
- **Airflow `poke`.** A waiting agent that holds a slot is the thing the declared waits already removed.
