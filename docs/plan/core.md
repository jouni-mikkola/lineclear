# Plan v0.2: core engine

The task lifecycle, the engine and its state: one phase per task, one store with transactions, a merge queue, and a
closed task that leaves no PR, branch or worktree. It merges the open steps of [stores.md](../audit/stores.md) and
[engine.md](../audit/engine.md) into one order. Ranks by the owner's priorities are in [release.md](../release.md).
Paths are from main at `bd32de3`. `engine/` is `server/server/live/engine/`.

## What is wrong today

- **Two task stores.** L520 made tasks a JSON snapshot plus a change log (`engine/task-store.ts`, 204 lines, with
  `cold.ts` 147, `briefs.ts` 66, `retire.ts` 65 and `src/hot-log.ts`). L540 opened `store.sqlite`, which holds no task
  row (4 KB here). Ids live in a third file, `task-ids.sqlite`. 14 CLI files read the task files directly
  (`src/tasks-kept.ts`, `src/kept-read.ts`).
- **A step claim is a Map in memory.** `engine/step-once.ts` `StepClaims` forgets on a restart and is per process.
  795 tasks were made for 37 steps in one hour across machines before LIN-1366.
- **No state machine.** `TaskRec` has 60 fields (`engine/engine-helpers.ts:6-119`). 26 in-memory Maps and Sets in
  `engine/` hold state a restart loses, and repair code rebuilds it (`resumeQueue`, `endLostMerges`, `briefLate`).
  `engine/status.ts` derives the status from flags in 15 ordered ifs. The engine is a chain of 11 classes (10
  `extends Engine…`), so most steps touch the same hub files and collide.
- **Timers stand in for events.** `settleSoon` waits 4 s and `ANSWER_GRACE` 6 s after a turn ends (10 lines in
  `server/server/live/`), though the pi RPC agent (L509) already reports `agent_start` and `agent_settled`
  (`server/server/live/agent-rpc.ts:106`). Stalls are 3 loops over every task each minute (`engine/stalls.ts`).
- **Main goes red.** The repo's rules require the job `check` with `strict` off, and on a PR that job runs the changed
  tests only (`.github/workflows/check.yml`); the full check runs after the merge, on main. `mergeOnGitHub`
  (`engine/merge.ts`) rebases only on a textual conflict, so a PR lands on a base it was never tested on. A red main
  is held by a 10 s `Bun.sleep` loop with no limit (`holdWhileRed`) and is opened by a title that starts with "Fix"
  (`/^fix\b/i`). Main went red 6 times today. GitHub's merge queue is for organization repos only
  ([docs](https://github.com/github/docs/blob/main/data/reusables/gated-features/merge-queue.md)); this repo is a
  user's, so Lineclear needs its own.
- **A merge lives in memory.** `merging`, `landings`, `callerLeft`, `cut`, `runOf`, `frees` (`engine/engine-state.ts`)
  hold the lane; 5 `Bun.sleep` loops wait in `merge.ts` and `engine-pr.ts`; a restart ends every merge on its way.
- **A closed task leaves its PR open.** `close()` (`engine/engine-handoff.ts`) closes no PR and deletes no remote
  branch; `putAway` (`engine/worktrees.ts`) deletes the local branch only, and keeps any worktree with unmerged work
  for good. Measured: 59 duplicate PRs open, 136 stale worktrees (9 GB) and 162 local branches on one machine; origin
  holds 147 branches for 3 open PRs.
- **54 swallowed errors** in `engine/` (30 `.catch(() =>`, 24 `catch {`), among them 7 sends of a go or a note to
  an agent.

## Target design

**One store.** Everything a task is lives in `~/.lineclear/store.sqlite` (WAL, `BEGIN IMMEDIATE`, already opened by
`server/server/store.ts`): a `tasks` row with its brief, the id series, a `moves` history, a `jobs` table and a
`landings` queue. The server is the one writer; the CLI opens it `readonly`
([bun:sqlite](https://bun.sh/docs/runtime/sqlite)). A step is claimed by a partial unique index on (project, step)
over open tasks ([SQLite partial indexes](https://www.sqlite.org/partialindex.html)), so a second add fails inside the
same transaction. A copy is `VACUUM INTO` ([SQLite](https://www.sqlite.org/lang_vacuum.html#vacuuminto)).

**One phase per task.** `engine/phase.ts` is a pure table: `queued, starting, working, waiting, ready, landing,
merged, closed, done`, with `move(phase, event)` returning the next phase and its jobs, or a refusal. Events are
facts: `task add`, pi's `agent_start` and `agent_settled`, a card, `lineclear ready`, a queue result, `task close`,
a deadline. A move writes the row, a `moves` line and its jobs in one transaction. Jobs (send a go, open a card, close
a PR, remove a worktree) run after the commit, are idempotent, retry at 1, 5 and 30 minutes, then set `trouble` and
open one card. A restart loses nothing: it reads the phases and runs the jobs not done. Each stall is a deadline row
set by the move that starts the wait.

**A merge queue per repo.** `lineclear merge` adds a `landings` row and answers at once; the agent's process ends, so
its slot frees. One lane per repo takes the head, rebases it on main's tip, pushes it to its PR, waits for the repo's
own required checks at that exact commit (the shared `RepoWatch` of L524), and merges with `--match-head-commit`
([gh pr merge](https://cli.github.com/manual/gh_pr_merge)). A repo with no GitHub runs the project's check command on
the rebased head and fast-forwards main. Red goes back to the agent with the failing tests; main only moves to a
commit whose checks passed. Later the lane tests up to 4 heads as one train and splits a red train in halves.

**A closed task leaves nothing.** Merged or closed, a task moves to `done` only after its jobs are verified: PR
merged or closed with a comment, remote and local branch deleted, worktree removed, agent ended. GitHub keeps a closed
PR's commits and can restore its branch
([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/deleting-and-restoring-branches-in-a-pull-request)).
A sweep at start puts away every worktree, branch and PR of Lineclear's that no open task owns.

**Out of this plan:** agent records and outbox rows (L503, in flight), pi sessions and `~/.lineclear/workers` disk,
the 420 MB per agent and coordinator tokens (the agents and machines plan), the loop side of claims (L583).

## Steps

Wave 1 (L700 to L707) has disjoint files and can run at once. Each later step names its `after`.

Each step is in [ROADMAP.md](../ROADMAP.md), or dropped with the step that does its job.

- L700 The core loop has one test: in ROADMAP.md.
- L701 Tasks are rows in the store: in ROADMAP.md as "The task change log is gone", the part L541 (merged) left.
- L702 A task has one phase: dropped, L521 did it (merged).
- L703 A closed task closes its PR: dropped, L793 closes the PR and L750 removes the rest (ROADMAP.md).
- L704 Stalls run on deadlines: dropped, L523 did it (merged).
- L705 Ready tasks join a merge queue: in ROADMAP.md.
- L706 A store copy is one file: dropped, L546 did it (merged).

- L707 One id series in the store: in ROADMAP.md.
- L708 A step is claimed by a row: dropped, L583 does it (ROADMAP.md).
- L709 The phase is stored: dropped, L521 keeps the phase across a restart (merged).
- L710 The start waits for pi's word: in ROADMAP.md, cut to the part L522 (merged) left.
- L711 Turns end by pi's word: dropped, L522 did it (merged).
- L712 The queue checks the real head: dropped, L791 does it (ROADMAP.md).
- L713 The queue lands in trains: dropped, L792 does it (ROADMAP.md).
- L714 A merge step can be stopped: dropped, L525 did it (merged).
- L715 Merge has one setting: in ROADMAP.md, split in two: L721 (the engine) and L715 (the setting).
- L716 Leftovers are swept: in ROADMAP.md.
- L717 A task stops at its budget: dropped, L798 does it (ROADMAP.md).

- L718 Any repo runs the loop: in ROADMAP.md, after L791 in place of L712.

- L719 Old record fixes are gone: in ROADMAP.md.
- L720 The engine is composed: dropped, L529 does it (ROADMAP.md).

## The audit steps this replaces

| Audit step | Now |
| --- | --- |
| L541 | L701 |
| L546 | L706 |
| L521 | L702, L709 |
| L522 | L710, L711 |
| L523 | L704 |
| L525 | L705, L712, L714 |
| L529 | L720 |
| L520, L524, L527, L528, L540 | merged |
| L542 | L503, in flight |
| L543 | dropped: a post writes 4.5 KB on average |
| L544, L545 | dropped: L584 keeps models safe, the spaces race went with `repo-spaces.json` |
| L547 | dropped: L469 keeps `decisions.jsonl` under 20 KB an hour |
| L548 | dropped: item files are atomic; L602 cuts the Inbox to 3 kinds |
| L549 | dropped: L586 deletes `last.json` |

## Not proven

- That a required check from the PR's own workflow at the rebased commit is enough to keep this repo's main green: its
  PR job runs the changed tests only. L712's 20 merges measure it.
- The fields of pi's `get_session_stats` (L717) were not read; [rpc.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) names the command only.
- The train speedup of L713 is computed from the check time, not measured.
