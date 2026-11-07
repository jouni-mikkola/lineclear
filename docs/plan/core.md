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
  `extends`), so most steps touch the same hub files and collide.
- **Timers stand in for events.** `settleSoon` waits 4 s and `ANSWER_GRACE` 6 s after a turn ends (18 lines across
  `engine/`), though the pi RPC agent (L509) already reports `agent_start` and `agent_settled`
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

### L700 The core loop has one test
Result: One test adds two steps to a plain repo, a fake pi builds each, a review passes, each merges once and the next step starts.
- why: no test runs add, build, review, merge and next step end to end, so a refactor of the engine can break the loop unseen.
- done when: `server/test/core-loop.test.ts` passes on GitHub in under 20 s with a scratch repo (no remote, no workflow) and a fake pi RPC agent; it kills the server once in each of 6 phases and still sees 2 steps merged, 2 tasks made, 0 started twice; the cases that fail today are marked with the step id that fixes them. Tests: new files only.
- locks: core-loop-test
- after: none
- files: server/test/core-loop.test.ts, server/test/fake-pi.ts

### L701 Tasks are rows in the store
Result: Tasks and their briefs are rows of `store.sqlite`, and the snapshot, change log, cold log and brief files are gone.
- why: tasks live in a JSON snapshot, a hot log, a cold log and 561 brief files beside a `store.sqlite` with no task row, so no change can commit with its claim or its jobs.
- done when: `task-store.ts`, `briefs.ts`, the task half of `cold.ts` and `src/hot-log.ts` are deleted; old files are imported once by `importOnce`; a test kills the writer 1000 times mid-save and every reload holds each acknowledged change; `src/tasks-kept.ts` reads the rows readonly. Tests: deletes `server/test/task-store.test.ts`, `engine-briefs.test.ts`, the task cases of `store-cold.test.ts`; moves `engine-retire.test.ts` into `task-rows.test.ts`.
- locks: task-rows, file-server-server-live-engine-engine-state-ts, file-server-server-live-engine-cold-ts, file-server-server-live-engine-retire-ts, file-server-server-live-engine-briefs-ts, file-src-tasks-kept-ts
- after: L503
- files: server/server/live/engine/task-rows.ts, server/server/live/engine/engine-state.ts, server/server/live/engine/task-store.ts, server/server/live/engine/briefs.ts, server/server/live/engine/cold.ts, server/server/live/engine/retire.ts, src/tasks-kept.ts, src/hot-log.ts, src/doctor-task-ids.ts, src/measure.ts

### L702 A task has one phase
Result: A task's status comes from one named phase, and a table lists every allowed move.
- why: `status.ts` reads 16 flags and 3 live lookups in 15 ordered ifs, and nothing refuses a combination that cannot be.
- done when: `engine/phase.ts` exports the phases, the events and `move()`; a test feeds every (phase, event) pair and sees the next phase or a refusal; `rawStatus` is gone and `status.ts` maps a phase to a status with 0 calls into agents or chats. Tests: `server/test/status.test.ts` rewritten on phases; new `phase.test.ts`.
- locks: task-phase, file-server-server-live-engine-status-ts
- after: none
- files: server/server/live/engine/phase.ts, server/server/live/engine/status.ts

### L703 A closed task closes its PR
Result: A merged or closed task is Done only once its PR, remote branch, local branch, worktree and agent are gone.
- why: `close()` closes no PR and `putAway` deletes only the local branch: 59 duplicate PRs, 136 stale worktrees and 147 remote branches stayed.
- done when: `engine/jobs.ts` runs jobs from a `jobs` table after their commit, each idempotent, retried at 1, 5 and 30 minutes, then a card; a test closes 10 tasks with PRs on a fake gh and sees 10 PRs closed, 0 remote and 0 local branches, 0 worktrees; a restart halfway ends with each job run once; `grep -c "\.catch(() =>" engine/worktrees.ts engine/engine-handoff.ts` prints 0. Tests: new `put-away.test.ts`; `kept` cases of `engine-b.test.ts` deleted.
- locks: put-away, file-server-server-live-engine-worktrees-ts, file-server-server-live-engine-engine-handoff-ts
- after: none
- files: server/server/live/engine/jobs.ts, server/server/live/engine/put-away.ts, server/server/live/engine/worktrees.ts, server/server/live/engine/engine-handoff.ts

### L704 Stalls run on deadlines
Result: A stalled task is named at the minute its wait ran out, from one deadline table, not three loops over every task.
- why: `stalls.ts` walks all tasks 3 times a minute with a status call each (about 1,700 a minute at 561 tasks) and dedupes with 3 flags.
- done when: a `deadlines` row is set when a wait starts and cleared by the next move; with 561 tasks and 45 working, a quiet minute makes 0 status calls (about 1,700 today); a fake clock at each deadline (stall 20 min, silent 5 min, ready 20 min) opens one card, none early, none twice. Tests: `server/test/stalls.test.ts` moved to `deadlines.test.ts`.
- locks: stall-deadlines, file-server-server-live-engine-stalls-ts
- after: none
- files: server/server/live/engine/deadlines.ts, server/server/live/engine/stalls.ts

### L705 Ready tasks join a merge queue
Result: `lineclear merge` puts the task in its repo's queue and answers at once; the queue lands each task once, across restarts.
- why: the lane is 6 Maps and Sets in memory, a restart ends every merge on its way, and the agent waits for the merge with its slot held.
- done when: `landings` rows hold the queue; `lineclear merge` answers in under 0.5 s with a position; a test queues 10 tasks, restarts the server mid-queue and sees 10 merged once each in order; `merging`, `landings`, `callerLeft`, `cut`, `runOf`, `frees`, `endLostMerges` and `landReady` are gone; `grep -c "Bun.sleep" engine/merge.ts` prints 0 (4 today). Tests: deletes `engine-land-ready.test.ts`; moves the drain and lost-merge cases of `engine-merge*.test.ts` into `merge-queue.test.ts`.
- locks: merge-queue, file-server-server-live-engine-merge-ts, file-server-server-live-engine-engine-ts
- after: none
- files: server/server/live/engine/merge-queue.ts, server/server/live/engine/merge.ts, server/server/live/engine/lane.ts, server/server/live/engine/engine.ts

### L706 A store copy is one file
Result: An hourly copy is one `VACUUM INTO` file of a few MB, a point in time, and a failed copy shows in doctor.
- why: 56 copies take 1,068 MB, and files copied one by one while the board writes are not one moment.
- done when: a copy is one file under 5 MB (34 MB today); secrets and push keys are not in it; `restoreCopy` puts one file back; a test breaks the copy folder and sees the line in `lineclear doctor`. Tests: `test/store-copies.test.ts` rewritten.
- locks: store-copy, file-src-store-copies-ts, file-src-rules-ts
- after: none
- files: src/store-copies.ts, src/rules.ts

### L707 One id series in the store
Result: Task ids come from a table of `store.sqlite`, and `task-ids.sqlite` is gone.
- why: ids live in a second database file beside the store, so a task and its id never commit together.
- done when: after one start `ls ~/.lineclear/task-ids.sqlite*` lists nothing and its rows are in `store.sqlite`; two processes take 1000 ids and get 1000 distinct ones. Tests: `server/test/task-ids*.test.ts` kept, on the new table.
- locks: task-ids, file-server-server-live-task-ids-ts
- after: none
- files: server/server/live/task-ids.ts

### L708 A step is claimed by a row
Result: Two adds of one step, from two processes or across a restart, make one task and one refusal.
- why: `StepClaims` is a Map in memory; 795 tasks were made for 37 steps in one hour.
- done when: a partial unique index on open tasks' (project, step) refuses the second insert; a test races 2 processes on one store 100 times and sees 100 times exactly 1 task; `StepClaims` is deleted. Tests: the Map cases of `server/test/step-once.test.ts` move to a two-process test.
- locks: step-claim, file-server-server-live-engine-step-once-ts, file-server-server-live-source-task-words-ts
- after: L701
- files: server/server/live/engine/step-once.ts, server/server/live/source-task-words.ts

### L709 The phase is stored
Result: Every change of a task is a move that writes its phase and a history line, and a restart in any phase shows the same status.
- why: `settleOne` sets flags and saves; the phase of L702 is still derived from them.
- done when: `tasks.phase` and a `moves(task, at, from, to, event)` table are written in one transaction per move; a test restarts in each phase and sees the same status; `TaskRec` loses `reported`, `merged`, `closed`, `told`, `posted` (60 fields today, 55 or fewer). Tests: restart cases of `engine-b.test.ts` move to `phase.test.ts`.
- locks: phase-store, file-server-server-live-engine-engine-state-ts, file-server-server-live-engine-engine-helpers-ts
- after: L701, L702
- files: server/server/live/engine/engine-state.ts, server/server/live/engine/engine-helpers.ts

### L710 The start waits for pi's word
Result: A task is Working when pi says `agent_start`, and its go and brief are jobs that run once.
- why: `starting`, `briefing` and `handing` are Sets lost on restart; `BRIEF_WAIT` (120 s) resends a brief, `resumeQueue` resends a go, 4 sends swallow errors.
- done when: `grep -n "briefResent\|BRIEF_WAIT\|resumeQueue\|briefLate\|ORPHAN_AFTER" server/server/live` lists none; a restart in `starting` sends the brief once (a test counts 1); 45 held tasks released make 0 status scans of other tasks (about 25,000 today). Tests: brief-resend cases of `engine-queue*.test.ts` deleted.
- locks: start-phase, file-server-server-live-engine-engine-launch-ts, file-server-server-live-engine-engine-start-ts
- after: L703, L709
- files: server/server/live/engine/engine-launch.ts, server/server/live/engine/engine-start.ts

### L711 Turns end by pi's word
Result: A task shows Ready or Needs you the moment pi says `agent_settled`, with no 4 to 6 second wait.
- why: `settleSoon` (4 s) and `ANSWER_GRACE` (6 s) guess what `agent_settled` says.
- done when: `grep -n "settleSoon\|ANSWER_GRACE" server/server/live` lists none (18 lines today); a test sends `agent_settled` and sees the move in the same tick (4000 ms today); with `aborted` no Ready card. Tests: the fake-timer cases of `engine.test.ts` for the grace are deleted.
- locks: turn-end, file-server-server-live-engine-engine-tidy-ts, file-server-server-live-quiet-ts, file-server-server-live-engine-engine-launch-ts, file-server-server-live-engine-merge-ts
- after: L705, L710
- files: server/server/live/engine/engine-tidy.ts, server/server/live/quiet.ts, server/server/live/engine/engine-launch.ts, server/server/live/engine/merge.ts

### L712 The queue checks the real head
Result: Main only moves to a commit whose checks passed on main's tip, so two steps that pass alone and fail together never land both.
- why: PRs merge on a stale base with the changed tests only; main went red 6 times today; `holdWhileRed` sleeps with no limit and `/^fix\b/i` opens it.
- done when: the lane rebases the head on main's tip, pushes it, waits for the repo's required checks at that commit through `RepoWatch`, merges with `--match-head-commit`; a repo with no GitHub runs the project's check command and fast-forwards; a fake-gh test of 10 tasks with 2 pairs that fail together sees main at 0 red commits and the 2 later ones sent back; `holdWhileRed`, `RedMainWatch` and the title regex are gone; 20 merges on this repo after it show 0 failed runs on main. Tests: deletes `red-stops-merges.test.ts` and the red-main cases of `engine-lane-watch.test.ts`.
- locks: queue-check, file-server-server-live-engine-engine-pr-ts, file-server-server-live-engine-engine-merge-ts, file-server-server-live-engine-merge-queue-ts
- after: L705
- files: server/server/live/engine/merge-queue.ts, server/server/live/engine/engine-pr.ts, server/server/live/engine/engine-merge.ts

### L713 The queue lands in trains
Result: Up to 4 ready tasks are checked as one train, so a busy repo lands about 4 times as many tasks an hour.
- why: one check per task at 47 s median caps a repo at about 50 merges an hour, below what 45 agents make.
- done when: with a fake gh at 60 s per check, 20 ready tasks land in 8 simulated minutes or less (about 25 serial); a train with one red task lands the other 3 with at most 2 extra runs and sends the red one back. Tests: new `merge-train.test.ts`.
- locks: queue-train, file-server-server-live-engine-merge-queue-ts
- after: L712
- files: server/server/live/engine/train.ts, server/server/live/engine/merge-queue.ts

### L714 A merge step can be stopped
Result: A hung git or gh call in the lane ends at its own timeout with its process group, and no `/proc` scan guesses at it.
- why: `HeadWatch` reads every `/proc/*/stat` each minute and kills by directory after 15 minutes of no CPU.
- done when: each lane call takes an `AbortSignal` and a timeout; a test plants a step that never ends and sees it aborted with `pgrep` of its group at 0; `HeadWatch`, `workIn` and `killWork` are gone. Tests: HeadWatch cases of `engine-lane-watch.test.ts` deleted.
- locks: lane-abort, file-server-server-live-engine-lane-watch-ts, file-server-server-live-engine-machine-ts
- after: L712
- files: server/server/live/engine/lane-watch.ts, server/server/live/engine/machine.ts, server/server/live/engine/git.ts

### L715 Merge has one setting
Result: Settings has no "wait for GitHub checks" switch: every merge goes through the queue's check.
- why: `waitChecks` is a second way to merge that skips the check on the merged result.
- done when: `grep -rn "waitChecks" server/server src` lists none (6 files today); the agent brief says "merge queues it". Tests: waitChecks cases in the settings tests deleted.
- locks: merge-setting, file-server-server-live-settings-store-ts, file-server-server-live-prompts-ts, file-server-server-live-engine-engine-helpers-ts
- after: L712
- files: server/server/live/settings-store.ts, server/server/live/prompts.ts, server/server/live/engine/engine-helpers.ts

### L716 Leftovers are swept
Result: At start, every worktree, branch and PR of Lineclear's that no open task owns is put away, and doctor prints what is left.
- why: 136 stale worktrees (9 GB), 162 local branches, 147 remote branches and 59 open duplicate PRs outlived their tasks.
- done when: a test plants 136 orphan worktrees, 162 branches and 59 PRs beside 3 live tasks and after one sweep sees only the 3 live ones; on a real machine `git worktree list | wc -l` is at most open tasks + 1. Tests: new `sweep.test.ts`; sweep cases of `engine-b.test.ts` deleted.
- locks: sweep
- after: L703
- files: server/server/live/engine/sweep.ts

### L717 A task stops at its budget
Result: A task that spends its token budget is told once to finish, then stopped with a card, and its tokens show on the task.
- why: an agent's new input ranges from 36 k to 379 k per task with no limit; no step enforces a budget.
- done when: the budget per role comes from Settings; a `budget` deadline fires on pi's session stats; a test passes a fake agent over budget and sees one note and then a stop; `lineclear task show` prints tokens used and the budget. Tests: new `budget.test.ts`.
- locks: task-budget
- after: L704, L709
- files: server/server/live/engine/budget.ts, server/server/live/engine/deadlines.ts

### L718 Any repo runs the loop
Result: The core loop test passes on a second small repo with a plain GitHub PR check and on one with no remote, with no Lineclear setup.
- why: the flow is proven on Lineclear's own repo only, whose check is special.
- done when: `server/test/core-loop-any.test.ts` runs L700's loop on a repo with a fake gh and a plain PR check, and on a repo with only `make test`; both merge 2 steps once each. Tests: new file.
- locks: any-repo-test
- after: L700, L712
- files: server/test/core-loop-any.test.ts

### L719 Old record fixes are gone
Result: The engine no longer rewrites old task shapes at every start; the import of L701 did it once.
- why: `engine.ts` fixes `stage`, `gist`, `after` strings and `readyNudged` on every start for records long migrated.
- done when: the loop in the `Engine` constructor is gone; a test imports an old `tasks.json` once and sees the same tasks. Tests: old-shape cases of `engine.test.ts` move to `task-rows.test.ts`.
- locks: old-shapes, file-server-server-live-engine-engine-ts
- after: L701, L705
- files: server/server/live/engine/engine.ts

### L720 The engine is composed
Result: The engine is a few modules with one job each, and no class inherits from another.
- why: a chain of 11 classes puts every member in reach of every layer and makes parallel steps collide on hub files.
- done when: `grep -c "extends Engine" server/server/live/engine/*.ts` prints 0 (10 today); no file of `engine/` is over 400 lines (575 today); `TaskRec` has 30 fields or fewer (60); the engine tests pass unchanged on GitHub.
- locks: engine-compose, file-server-server-live-engine-engine-ts, file-server-server-live-engine-engine-state-ts
- after: L708, L709, L710, L711, L712, L713, L714, L715, L716, L717, L719
- files: server/server/live/engine/engine.ts, server/server/live/engine/engine-state.ts, server/server/live/engine/engine-tidy.ts, server/server/live/engine/engine-merge.ts, server/server/live/engine/engine-handoff.ts, server/server/live/engine/github.ts

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
