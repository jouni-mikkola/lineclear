# Roadmap

What Lineclear has to do is in [idea.md](idea.md); which code serves it is in [scope.md](scope.md). What the next
release must reach, the owner's priorities and the rule that keeps parallel steps off each other's files are in
[release.md](release.md). This file lists what is left to build, the core loop first. Done and dropped steps live in
git history: a step's id is in its commit subject. The rules read this file, so it follows its own format.

**How to read it.**

- A step starts once every step in its `after` is done and no running step holds one of its files. A step with
  `locks: none` holds the paths of its `files` line while it runs, a folder every path under it.
- Each step is `### <id> <title>` (at most 32 characters), a `Result:` line (one sentence of at most 140 characters
  on what the owner sees or can do), then `why`, `done when`, `locks`, `after` and `files`. `lineclear roadmap check`
  checks the form with no AI.
- A step is done when a commit on main has the subject `<TASK>: <id> ...` or a line `Step: <id>`; a revert of that
  commit opens it again.
- The steps of the plans in `docs/plan/` come in batches as each plan lands.
- New ideas never go into this file.

## The core loop (P1)

The steps that make add, build, review, merge and the next step work with nothing stalling, crashing or running
twice: the core, flow and agents plans of `docs/plan/` in the rank of
[release.md](release.md). A plan step that repeated an audit step or another plan's step is dropped; its plan names
the step that does its job.

### L700 The core loop has one test
Result: One test adds two steps to a plain repo, a fake pi builds each, a review passes, each merges once and the next step starts.
- why: no test runs add, build, review, merge and next step end to end, so a refactor of the engine can break the loop unseen.
- done when: `server/test/core-loop.test.ts` passes on GitHub in under 20 s with a scratch repo (no remote, no workflow) and a fake pi RPC agent; it kills the server once at each of 6 points (after add, start, ready, review, queue, merge) and still sees 2 steps merged, 2 tasks made, 0 started twice; the cases that fail today are marked with the step id that fixes them. Tests: new files only.
- locks: none
- after: none
- files: server/test/core-loop.test.ts, server/test/fake-pi.ts

### L705 Ready tasks join a merge queue
Result: `lineclear merge` puts the task in its repo's queue and answers at once; the queue lands each task once, across restarts.
- why: the lane is 6 Maps and Sets in memory, a restart ends every merge on its way, and the agent waits for the merge with its slot held.
- done when: `landings` rows hold the queue; `lineclear merge` answers in under 0.5 s with a position; a test queues 10 tasks, restarts the server mid-queue and sees 10 merged once each in order; `merge.ts` uses none of `merging`, `landings`, `callerLeft`, `cut`, `runOf`, `frees` (their declarations in `engine-state.ts` go with L529), and `endLostMerges` and `landReady` are gone. Tests: deletes `engine-land-ready.test.ts`; moves the drain and lost-merge cases of `engine-merge.test.ts` into `merge-queue.test.ts`.
- locks: none
- after: none
- files: server/server/live/engine/merge-queue.ts, server/server/live/engine/merge.ts, server/server/live/engine/lane.ts, server/server/live/engine/engine.ts, server/test/engine-land-ready.test.ts, server/test/engine-merge.test.ts, server/test/merge-queue.test.ts

### L790 A lane label runs the full check
Result: A pull request labelled `lane` runs the full sharded check on its head, and main reruns nothing already checked.
- why: today the full suite runs only after a merge, on main, and every merge spends 9 of the 20 runners GitHub gives the repo.
- done when: `check.yml` runs the 8 full shards on `pull_request` when the PR has the label `lane` (on `labeled` and `synchronize`), and the `changed` job otherwise; a push to main whose tree a green `lane` run checked runs 1 job of 10 s or less, else the full check; `test/light-checks.test.ts` gains a case for both and still holds every job at 5 minutes.
- locks: none
- after: none
- files: .github/workflows/check.yml, test/light-checks.test.ts

### L791 The lane merges a checked rebase
Result: A task merges only after GitHub's full check passed on its branch rebased on main's current tip, so a merge never turns main red.
- why: `mergeOnGitHub` rebases only on a text conflict and merges before any check with Merge "on its own"; 31 of 50 runs on main failed in one day.
- done when: the lane rebases every branch on `origin/main`, labels its PR `lane`, waits on the repo watch for the full check on that head and merges with `--match-head-commit` only while main is still the commit it rebased on; a test merges 2 branches that pass alone and break together and sees the second sent back with the failing test named and main unchanged; the `waitChecks` path is gone from `merge.ts`; over 20 merges after the step `gh run list --workflow check.yml --branch main --limit 20 --json conclusion` lists 0 `failure`. The cases of `server/test/engine-merge-b.test.ts` that merge without waiting are deleted.
  - Owner only: set `strict_required_status_checks_policy` to true in the `main` ruleset (a change to the public repo's rules).
- locks: none
- after: L705, L790
- files: server/server/live/engine/merge.ts, server/server/live/engine/lane.ts, server/server/live/engine/merge-queue.ts, server/server/live/engine/engine-pr.ts, server/test/engine-merge-b.test.ts

### L792 The lane tests 4 at once
Result: With many tasks ready in one repo, the lane checks up to 4 rebased branches as one candidate and finds a bad one by halves.
- why: one full check per merge caps a repo near 60 merges an hour, and 45 agents on 10 minute tasks make about 270; GitHub's merge queue is not offered to a repo owned by a user.
- done when: a new `batch.ts` stacks up to 4 queued branches on main's tip and merges them in order once the candidate's check is green; a test queues 8 with 1 bad and sees 7 merged, 1 sent back with its failing test, and 6 or fewer full runs; a test with 45 simulated ready tasks keeps the lane wait at 5 minutes or less at p90; `merge.ts` and `batch.ts` stay under 600 lines.
- locks: none
- after: L791
- files: server/server/live/engine/batch.ts, server/server/live/engine/merge.ts, server/test/merge-batch.test.ts

### L793 A closed task closes its PR
Result: Closing or discarding a task closes its pull request and deletes its branch on GitHub and here, so no duplicate PR stays open.
- why: 59 duplicate PRs stayed open because `close` never closes the task's PR, and 162 local branches are left on one machine.
- done when: `close` closes the task's PR with a comment and deletes its remote and local branch, once; a test closes a task with an open PR and sees it closed and both branches gone, and a task with unmerged work kept as today; a one-time sweep closes the open PRs of Done tasks, after which `gh pr list --state open` lists only PRs of open tasks.
- locks: none
- after: none
- files: server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-pr.ts, server/test/task-close.test.ts

### L794 One light review call
Result: `lineclear review <task> --json` reviews a diff under 80 lines with 3 lines of context and short rules, in 15 k tokens or less.
- why: the reviewer reads 73 k new input at the median for diffs that are mostly small, and the call has no output a program can read.
- done when: `review-call.ts` picks the light form for a diff of fewer than 80 changed lines that deletes no test, and the full form otherwise; `--json` prints the findings and the input size; a test reviews a 20-line and a 300-line diff and sees an input of 15 k or less and 50 k or less; `test/review-call.test.ts` keeps its cases for the full form.
- locks: none
- after: none
- files: src/review-call.ts, test/review-call.test.ts

### L795 The lane reviews, then merges
Result: Lineclear reviews each task once at `ready`, on the head the lane will merge, and sends must-fix findings back as one message.
- why: today the agent reviews itself in its own session for up to 540 s a round, holding a slot, and `lineclear review` is a second way nobody calls.
- done when: a new `review-stage.ts` runs `lineclear review <id> --json` as a child under a timeout when a task enters the lane; findings at or above Must fix go to the agent in one message and count a round; after Review rounds the Dispatcher's chat gets one card; a test sees a clean review pass to the lane and a major finding sent back once.
- locks: none
- after: L791, L794
- files: server/server/live/engine/review-stage.ts, server/server/live/engine/merge.ts, server/test/review-stage.test.ts

### L769 One prompt file per role
Result: Each role's prompt is its own file, so its size per role can be read and budgeted.
- why: `prompts.ts` holds every role's text; 11 PRs in 3 days changed it, 2 with a conflict.
- done when: `server/skill/prompts/<role>.md` holds each role's text; `prompts.ts` only fills them in and is at most 60 lines; `wc -c server/skill/prompts/*.md` prints one size per role; the prompt tests pass.
- locks: none
- after: none
- files: server/server/live/prompts.ts, server/skill/prompts/

### L796 The brief ends at ready
Result: A task's brief and skill say: build, run the quick tests, `lineclear ready`; Lineclear does the PR, the review, the checks and the merge.
- why: the skill still has the agent review itself, wait for checks and merge, three jobs the server now does.
- done when: `SKILL.md` has no review procedure and no `lineclear checks` wait, and is 70 lines or less (114 today); the Settings lines of the agent prompt in `server/skill/prompts/` say the review and the merge are Lineclear's and name no Merge "after GitHub checks"; the brief cases of `server/test/live-b.test.ts`, `live-c.test.ts` and `source-b.test.ts` change with them.
- locks: none
- after: L769, L795
- files: server/skill/prompts/, server/skill/lineclear-agent/SKILL.md, server/skill/lineclear-agent/START.md, server/test/live-b.test.ts, server/test/live-c.test.ts, server/test/source-b.test.ts

### L721 The engine reads no waitChecks
Result: The engine never asks whether to wait for GitHub's checks: the lane's check is the only way a task merges.
- why: `waitChecks` is a second way to merge that skips the check on the merged result; L791 removes its path from `merge.ts`.
- done when: `git grep -n waitChecks server/server/live/engine` lists none (3 files besides `merge.ts` today); the engine tests pass unchanged on GitHub.
- locks: none
- after: L791
- files: server/server/live/engine/engine-helpers.ts, server/server/live/engine/engine-launch.ts, server/server/live/engine/engine-pr.ts

### L715 Merge has one setting
Result: Settings has no "wait for GitHub checks" switch: every merge goes through the lane's check.
- why: once the engine reads no `waitChecks` (L721), the setting and its prompt line only mislead.
- done when: `git grep -n waitChecks server/server src` lists none (6 files today); the waitChecks cases of `live-b.test.ts`, `live-c.test.ts` and `source-b.test.ts` are deleted.
- locks: none
- after: L721, L769, L796
- files: server/server/live/settings-store.ts, server/server/live/settings-ways.ts, server/server/live/prompts.ts, server/test/live-b.test.ts, server/test/live-c.test.ts, server/test/source-b.test.ts

### L797 An agent stops at ready
Result: A task waiting for review, checks or merge has no running agent; a finding starts it again from its session within 20 seconds.
- why: an agent takes about 420 MB, and today it stays up through review and checks while it does nothing.
- done when: `ready` ends the task's pi process and keeps its session file; a review finding or a failed check starts it with `--session` and that one message; a test with 45 tasks of which 15 wait in the lane counts 30 pi processes or fewer; a test sees the resumed agent's first tool call within 20 s.
- locks: none
- after: L793, L795
- files: server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-launch.ts, server/test/agent-stop.test.ts

### L710 The start waits for pi's word
Result: A task's go and brief are sent once from its stored phase, with no queue resumed on a timer and no orphan guess after two hours.
- why: L522 removed the brief timer, but `resumeQueue` still runs on a timer and `ORPHAN_AFTER` guesses at a dead agent after 2 hours.
- done when: `git grep -n "resumeQueue\|ORPHAN_AFTER" server/server/live` lists none; a restart in `starting` sends the brief once (a test counts 1); a task whose agent died is named from its exit event, not after 2 hours.
- locks: none
- after: none
- files: server/server/live/engine/engine-launch.ts, server/server/live/engine/engine.ts, server/test/start-once.test.ts

### L701 The task change log is gone
Result: The CLI reads tasks from the store's rows, and the change log file and its reader are gone.
- why: L541 made tasks rows, but `src/hot-log.ts` and the file readers of `src/tasks-kept.ts` remain, a second way to read a task.
- done when: `src/hot-log.ts` is deleted; `src/tasks-kept.ts` reads the `tasks` rows readonly; `git grep -n "hot-log" src server` lists none; a CLI read of 561 tasks opens no file but `store.sqlite`.
- locks: none
- after: none
- files: src/hot-log.ts, src/tasks-kept.ts, test/kept-read.test.ts

### L733 Agents resume after a restart
Result: After a server restart every live task's agent runs again within 10 s from its own session, and a cut turn gets one "continue".
- why: an RPC child dies with its server and `rpcEnded` drops it (`agents-delivery.ts`). The resume runs from `revive.ts` at server start through the existing start call with the record's session id, so `agents-delivery.ts` is not touched.
- done when: a test with 5 live RPC agents restarts the server and sees 5 spawns with `--session-id` within 10 s; an agent whose last event was `agent_settled` gets 0 prompts, one cut mid-turn gets 1; 3 failed resumes in an hour stop with a card; `server/test/revive.test.ts` pane cases are deleted.
- locks: none
- after: none
- files: server/server/live/revive.ts, server/server/live/agent-resume.ts, server/test/revive.test.ts

### L735 Each agent has a memory cap
Result: Each RPC agent runs in its own systemd user scope with a memory cap, so a runaway test ends that agent only.
- why: an agent needs about 420 MB and nothing caps it; 45 agents and their test runs can exhaust a machine.
- done when: the spawn argv is `systemd-run --user --scope -p MemoryHigh=450M -p MemoryMax=700M ...` when systemd is there, plain otherwise; a test reads the argv; a test child that allocates 1 GB is killed while a second agent keeps running; `server/test/agent-rpc.test.ts` covers both argv forms.
- locks: none
- after: none
- files: server/server/live/agent-scope.ts, server/server/live/agent-rpc.ts, server/test/agent-rpc.test.ts

### L738 One agent host per machine
Result: A small host program starts pi RPC children on its machine and carries their JSONL frames, tagged by task, over one stdio.
- why: remote agents still type into panes (the `!BOX` gate of `agents-delivery.ts`); one ssh per agent passes sshd's default `MaxSessions` of 10.
- done when: `server/helper/agent-host.ts` takes `spawn`, `send`, `stop` frames on stdin and writes `event`, `exit` and `room` (cores, load, MemAvailable, running) frames; a test spawns 12 stand-in pi children through one host and sees each one's events under its key and 12 exits; it imports only `shared`.
- locks: none
- after: none
- files: server/helper/agent-host.ts, server/test/agent-host.test.ts

### L740 Remote agents are RPC
Result: An agent on another machine runs as an RPC child of that machine's host, with no herdr pane and no typed text.
- why: the pane path keeps every patch of audit agents A and B alive for 2 of 3 machines.
- done when: the `!BOX` gates of `agents-delivery.ts` and `source-upkeep.ts` are gone; a task on a stand-in remote machine starts, takes its brief and ends with 0 herdr calls and 1 ssh session for 12 agents; its first event arrives within 3 s of the spawn frame.
- locks: none
- after: L735, L738
- files: server/server/live/agent-link.ts, server/server/live/agent-rpc.ts, server/server/live/agents-delivery.ts, server/server/live/source-upkeep.ts, server/test/agent-link.test.ts

### L716 Leftovers are swept
Result: At start, every worktree, branch and PR of Lineclear's that no open task owns is put away, and doctor prints what is left.
- why: 136 stale worktrees (9 GB), 162 local branches, 147 remote branches and 59 open duplicate PRs outlived their tasks.
- done when: a test plants 136 orphan worktrees, 162 branches and 59 PRs beside 3 live tasks and after one sweep sees only the 3 live ones; on a real machine `git worktree list | wc -l` is at most open tasks + 1. Tests: new `sweep.test.ts`.
- locks: none
- after: L793
- files: server/server/live/engine/sweep.ts, server/test/sweep.test.ts

### L739 Doctor counts leftovers
Result: `lineclear doctor` prints worktrees, branches, sessions and panes that belong to no live task, and fails while any is left.
- why: 136 stale worktrees, 162 branches and 3,690 sessions were found by hand.
- done when: `src/doctor-leftovers.ts` prints four counts; a test plants one of each and sees 4 lines and a non-zero exit, and a clean fixture prints 0s and exits 0.
- locks: none
- after: none
- files: src/doctor-leftovers.ts, src/doctor.ts, test/doctor-leftovers.test.ts

### L798 Each role has a token budget
Result: A task agent compacts at 80 % of its budget, is told to finish at 100 %, and stops at its cap with a card in the project chat.
- why: no budget is enforced: a task agent reads 195 k new input at p90 and 16.7 M cache reads, and nothing stops a runaway.
- done when: a new `pi/budget.ts` sums `message.usage` at `turn_end` and applies the budget table of `docs/plan/flow.md` per role (`LINECLEAR_BUDGET_<ROLE>` overrides); a test feeds turns past 80 %, 100 % and the cap and sees one compaction, one message and one abort; a chat role never aborts.
- locks: none
- after: none
- files: pi/budget.ts, pi/extension.ts, pi/config.ts, test/pi-budget.test.ts

### L750 A task end leaves nothing
Result: Every task end stops its agent, removes its worktree and branch, and keeps its token sum on the task.
- why: 136 stale worktrees (9 GB) and 162 branches on one machine; L793 closes the PR and L716 sweeps what is already left.
- done when: a test ends tasks as merged, closed and failed and sees for each: 0 live child, 0 worktree, 0 local branch, a token sum on the row; `lineclear doctor` (L739) prints 0s after one sweep (L716) on a fixture of today's leftovers.
- locks: none
- after: L716, L739, L793, L798
- files: server/server/live/engine/retire.ts, server/server/live/engine/worktrees.ts, server/server/live/engine/task-rows.ts, server/test/task-end.test.ts

### L757 45 agents on 3 machines
Result: A test runs 45 steps on 3 stand-in machines to the end: each claimed once, placed within memory, and nothing left after.
- why: the proof of v0.2 for agents and machines: nothing stalls, nothing runs twice, nothing stays behind.
- done when: with machines of 10, 12 and 25 slots and 45 ready steps, 45 tasks start within 5 simulated minutes, 0 steps have 2 tasks, no machine passes its slots or memory, and after all end there are 0 children, 0 worktrees, 0 branches and 0 claims.
- locks: none
- after: L581, L583, L586, L750, L797
- files: server/test/plane-45.test.ts

## Clean-up and layout (P2)

The steps that remove what the core loop left behind and give the code the layout of `docs/plan/layout.md`: the core,
flow, agents and layout plans of `docs/plan/` in rank 2 of [release.md](release.md).

### L707 One id series in the store
Result: Task ids come from a table of `store.sqlite`, and `task-ids.sqlite` is gone.
- why: ids live in a second database file beside the store, so a task and its id never commit together.
- done when: after one start `ls ~/.lineclear/task-ids.sqlite*` lists nothing and its rows are in `store.sqlite`; two processes take 1000 ids and get 1000 distinct ones. Tests: `task-ids.test.ts`, `task-ids-unique.test.ts` and `task-ids-machine-b.test.ts` are kept, on the new table.
- locks: none
- after: none
- files: server/server/live/task-ids.ts, src/store-copies.ts, src/doctor-task-ids.ts, server/scripts/store-formats.ts, server/test/task-ids.test.ts, server/test/task-ids-unique.test.ts, server/test/task-ids-machine-b.test.ts

### L719 Old record fixes are gone
Result: The engine no longer rewrites old task shapes at every start; the import of L701 did it once.
- why: `engine.ts` fixes `stage`, `gist`, `after` strings and `readyNudged` on every start for records long migrated.
- done when: the loop in the `Engine` constructor is gone; a test imports an old `tasks.json` once and sees the same tasks. Tests: old-shape cases of `engine.test.ts` move to `task-rows.test.ts`.
- locks: none
- after: L701, L705, L529
- files: server/server/live/engine/engine.ts, server/test/engine.test.ts, server/test/task-rows.test.ts

### L802 The loop promotes green main
Result: The rule loop installs the newest green main as stable at set hours, so no outside script promotes or copies an install.
- why: `watch.sh` and `promote-main.sh` promote main outside Lineclear, and `watch.sh` copies `install.sh` to other machines with `scp`.
- done when: the loop calls `scripts/promote.ts` for the newest main commit whose `check` is green, at most once in 30 minutes and only while no merge is running; a test with a red, a pending and a green head promotes only the green one; the other machines follow through L591, not through `scp`. Tests: a case in `test/rules.test.ts`.
- locks: none
- after: none
- files: src/rules.ts, scripts/promote.ts, test/rules.test.ts

### L804 No timer outside Lineclear
Result: `lineclear doctor` fails while a systemd timer or a cron line runs lineclear, herdr or pi outside the service, and none is left.
- why: five timers and two cron lines on the owner's machine do the loop's jobs untested, one of them calls a model every few minutes.
- done when: a new `doctor-timers.ts` lists such units from `systemctl --user list-timers` and `crontab -l` and doctor exits non-zero with their names; a test feeds a fake list with `lc-watch.timer` and sees its line; on the owner's machine doctor passes after `lc-watch`, `lineclear-keeper`, `night-watch` and `lineclear-promote-main` are disabled and the 2 cron lines are removed.
- locks: none
- after: L802, L739
- files: src/doctor-timers.ts, src/doctor.ts, test/doctor-timers.test.ts

### L805 Sessions of gone tasks go
Result: pi session folders of worktrees that no longer exist go after 7 days, so `~/.pi/agent/sessions` stays under 300 MB.
- why: 1,748 session folders take 2.1 GB on one machine, 1,725 of them for worktrees, most of them retired.
- done when: the temp sweep deletes a session folder whose worktree path is gone and whose newest file is over 7 days old; a test plants a live, a gone-new and a gone-old folder and sees only the last removed; `du -sm ~/.pi/agent/sessions` prints 300 or less on that machine a day after the merge.
- locks: none
- after: none
- files: src/tmpdirs.ts, test/tmpdirs.test.ts

### L737 Idle chat panes close
Result: A coordinator pane idle for 20 minutes closes and opens again on the next message with its session.
- why: 10 idle `pi` panes older than 3 h hold 584 MB on one machine today.
- done when: a test with a fake clock closes a pane idle 20 min and keeps one idle 19 min; the next message to a closed chat starts it with its session id; `pgrep -c pi` of idle panes older than 1 h prints 0 on a machine one hour after the merge. Tests: new `chat-idle.test.ts`.
- locks: none
- after: none
- files: server/server/live/chat-idle.ts, server/server/live/restart.ts, server/test/chat-idle.test.ts

### L746 The loop starts by the plane
Result: The rule loop starts a step with one call to the main server; the git ref claim and the copy of other machines' tasks are gone.
- why: three ways to know a task and two claims (`src/claims.ts`, `remoteSeen`, per-machine stores).
- done when: `src/claims.ts` and `test/claims.test.ts` are deleted; `grep -rn "remoteSeen\|machineReads\|serverJson\|SILENT_DROP_MS" src server` prints 0; a tick with 5 ready steps and 3 machines makes 1 HTTP call per start and 0 `spawnSync`. Tests: the cases go in a new `test/spread-plane.test.ts`.
- locks: none
- after: L581, L582, L583
- files: src/spread.ts, src/claims.ts, test/claims.test.ts, test/spread-plane.test.ts

### L760 Tests may sit beside code
Result: A test file next to its module runs in the check, so a step changes one folder, not two.
- why: `src/` and `test/` are two trees (125 and 127 files); `scripts/changed.ts` picks only `test/*.test.ts`.
- done when: `src/x/y.test.ts` beside `y.ts` runs in `lineclear check --changed` and in the full check's shards; knip's entry globs cover `src/**/*.test.ts`, `src/cli/words/*.ts`, `server/server/live/words/*.ts` and `src/doctor/*.ts`; `test/changed.test.ts` plants a test beside a module and sees it picked.
- locks: none
- after: L790
- files: scripts/changed.ts, scripts/check.ts, scripts/load-map.ts, knip.jsonc, .github/workflows/check.yml, test/changed.test.ts

### L761 Borders live in each folder
Result: A new module states its own border in its folder; nobody edits a central table to add one.
- why: `docs/architecture.md` was changed by 17 PRs in 3 days, 2 of them with a conflict, because its table lists every module.
- done when: `scripts/gates/borders.ts` reads `Owns`, `May import` and `Lines` from the first lines of a folder's `README.md`; architecture.md keeps only the layer rules (0 table rows); a new `test/borders.test.ts` adds a folder with a README and sees a forbidden import fail with no edit to architecture.md.
- locks: none
- after: none
- files: scripts/gates/borders.ts, docs/architecture.md, test/borders.test.ts

### L762 The roadmap reads step files
Result: A project's steps are read from one file per step, so two plans never edit the same file.
- why: `docs/ROADMAP.md` is one file for every step; 3 plan tasks write it at once today.
- done when: `roadmapSource` reads `docs/roadmap/<id>.md` when the folder exists (joined in id order, so the parser is unchanged) and `docs/ROADMAP.md` otherwise; `lineclear roadmap check .` checks the folder; a test reads 3 step files and checks one with a bad title.
- locks: none
- after: none
- files: src/roadmap-source.ts, src/roadmap-cli.ts, test/roadmap.test.ts

### L763 Plans write step files
Result: A plan that applies adds or edits one file per step, in any repo, even one with no docs folder.
- why: a plan apply rewrites the whole roadmap file, which collides with every other plan.
- done when: plan apply writes `docs/roadmap/<id>.md` per changed step and deletes the file of a dropped step; on a second small repo with no `docs/`, a plan creates the folder; a test applies two plans with disjoint steps and sees no conflict.
- locks: none
- after: L762
- files: src/plan-apply.ts, src/add-project.ts, test/autoplan-apply.test.ts, test/plan.test.ts

### L766 One file per CLI word
Result: A new `lineclear` word is one new file; `src/cli.ts` no longer changes with every command.
- why: `src/cli.ts` was changed by 32 PRs in 3 days, 3 with a conflict: one `commands` table and an import of each command.
- done when: `src/cli/words/<word>.ts` exports `about` and `run`; `src/cli/cli.ts` loads the word's file by name and is at most 80 lines; `lineclear --help` lists the folder; a test adds a word file in a temp copy and sees it in help.
- locks: none
- after: L760
- files: src/cli.ts, src/cli/, bin/lineclear, test/cli.test.ts

### L767 One file per board word
Result: A new board word is one new file; the board's word object is gone.
- why: `source-cli.ts` (278 lines) was changed by 16 PRs, 2 with a conflict.
- done when: `server/server/live/words/<word>.ts` holds each word; `source-cli.ts` and `source-subcommands.ts` are deleted; the board loads a word by name; `server/test/cli.test.ts` passes unchanged.
- locks: none
- after: L760
- files: server/server/live/source-cli.ts, server/server/live/source-subcommands.ts, server/server/live/words/

### L768 Doctor checks one file each
Result: A new doctor check is one new file; `src/doctor.ts` only runs them.
- why: `src/doctor.ts` (422 lines) was changed by 18 PRs, 3 with a conflict.
- done when: each check is `src/doctor/<check>.ts`; `src/doctor/doctor.ts` runs every file of the folder and is at most 100 lines; `test/doctor.test.ts` passes and adds a check file in a temp copy.
- locks: none
- after: L760, L739, L804
- files: src/doctor.ts, src/doctor-task-ids.ts, src/doctor/, test/doctor.test.ts

### L770 Wire types per domain
Result: A type change touches its domain's types file, not one shared catalog.
- why: `types-core.ts` (319 lines) and `types-snapshot.ts` were changed by 19 PRs, 2 with a conflict.
- done when: `server/shared/types/<domain>.ts` holds each domain's types; `types-core.ts`, `types.ts` and `types-snapshot.ts` are gone; no file in `server/shared/types/` is over 150 lines; `bun run types` is green on GitHub.
- locks: none
- after: none
- files: server/shared/types-core.ts, server/shared/types.ts, server/shared/types-snapshot.ts, server/shared/types-chat.ts, server/shared/types/

### L771 Source tests by module
Result: The live source's tests are named by the module they test, so two steps rarely edit one test file.
- why: 6 lettered files `source-b` to `source-g` plus `source-fixture.ts` collect tests by when they were written.
- done when: `ls server/test | grep -cE 'source-[b-g]\.test\.ts'` prints 0; each test file names one module; the test count is the same or lower with no case lost (a list of `test(` names before and after).
- locks: none
- after: L715, L796
- files: server/test/source.test.ts, server/test/source-b.test.ts, server/test/source-c.test.ts, server/test/source-d.test.ts, server/test/source-e.test.ts, server/test/source-f.test.ts, server/test/source-g.test.ts, server/test/source-fixture.ts

### L772 Engine tests by module
Result: The engine's tests are named by module, so engine steps edit their own test file.
- why: 8 lettered files (`engine-b`, `engine-merge-b` to `-d`, `engine-queue-b`, `-c`, `live-b`, `-c`) split tests by size.
- done when: `ls server/test | grep -cE '^(engine|live).*-[b-h]\.test\.ts'` prints 0; no case lost (a list of `test(` names before and after). The two `live-*` files are L811's.
- locks: none
- after: L715, L791, L796
- files: server/test/engine-b.test.ts, server/test/engine-c.test.ts, server/test/engine-merge-b.test.ts, server/test/engine-merge-c.test.ts, server/test/engine-merge-d.test.ts, server/test/engine-queue-b.test.ts, server/test/engine-queue-c.test.ts

### L811 Live tests by module
Result: The live server's tests are named by module, not by a letter.
- why: `live-b.test.ts` and `live-c.test.ts` split tests by size, the same fault as the engine's lettered files.
- done when: `ls server/test | grep -cE '^live.*-[b-h]\.test\.ts'` prints 0; no case lost (a list of `test(` names before and after).
- locks: none
- after: L772
- files: server/test/live-b.test.ts, server/test/live-c.test.ts

### L775 The fork's leftovers are gone
Result: The repo has one set of docs and guidance; the fork's own docs are gone.
- why: `server/docs/` (9 files, 593 lines), `server/README.md`, `server/AGENTS.md` and `server/CLAUDE.md` describe the fork, not Lineclear.
- done when: `git ls-files server/docs server/README.md server/AGENTS.md server/CLAUDE.md` lists none; `server/LICENSE` and `server/NOTICE` stay; `git grep -n "server/docs"` lists none.
- locks: none
- after: none
- files: server/docs/, server/README.md, server/AGENTS.md, server/CLAUDE.md

### L776 One package, one lock file
Result: The repo has one package, one lock file and one test runner.
- why: `server/` repeats `package.json`, `bun.lock`, `tsconfig.json` and a 215-line test runner; each conflicted in the last 3 days.
- done when: `git ls-files server/package.json server/bun.lock server/tsconfig.json server/bunfig.toml` lists none; the root `bun test` runs the server's tests; the full check on GitHub is green with the same test count. `server/scripts/test.ts` goes with L810.
- locks: none
- after: L760, L790
- files: server/package.json, server/bun.lock, server/tsconfig.json, server/bunfig.toml, package.json, tsconfig.json, bun.lock, .github/workflows/check.yml

### L810 The server test runner is gone
Result: `server/scripts/test.ts` is deleted, and the root test command is the only runner.
- why: the 215-line runner repeats what the root `bun test` does once L776 joins the packages.
- done when: `git ls-files server/scripts/test.ts` lists none and `git grep -n "scripts/test.ts"` lists none; the full check on GitHub is green with the same test count.
- locks: none
- after: L776
- files: server/scripts/test.ts

## Open steps from the audits

The open steps of the audits of `docs/audit/` and `docs/roles.md`, in the order stores, engine, agents, loop,
machines, roles. The findings stay in the audit files.

### L543 Chat logs are rows
Result: A card or an answer in a chat is one row inserted, not the whole log of that chat written again.
- why: S4: 421 chat files, each rewritten whole on every post or answer.
- done when: `chatlog` is a table; `saveLog` and the `chatlog/` folder are gone; a test posts 100 cards to one chat and sees under 100 KB written (about 2.5 MB when each rewrite grows to 50 KB).
- locks: none
- after: none
- files: server/server/live/chats-logs.ts, server/server/live/chats.ts, src/task-detail.ts, src/measure.ts

### L529 The engine is composed
Result: The engine is a few modules with one job each, and no class inherits from another eight.
- why: finding 48: nine classes in one inheritance line, split by line count, with every member visible to every layer.
- done when: `grep -c "extends Engine" server/server/live/engine/*.ts` prints 0 (8 today); no file of `engine/` is over 400 lines (520 today); the engine's tests pass unchanged on GitHub.
- locks: none
- after: none
- files: server/server/live/engine/engine.ts, server/server/live/engine/engine-launch.ts, server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-tidy.ts, server/server/live/engine/engine-merge.ts, server/server/live/engine/engine-state.ts

### L502 Start has no retry or timer
Result: A task agent's start is one spawn that succeeds or exits; its log file and route come with it.
- why: B1-B8: an 8-try loop, a 750 ms sleep, three start timers, a perl route binder and five log-scan timers guess at a pane being ready.
- done when: `launch` has no loop and no `setTimeout` (0 timers in the function, 3 today); `follow`, `discoverLog` and `repairRoutes` are gone, and the session file comes from `get_state`; `route.pl --bind` is not spawned for RPC agents; a start of 45 tasks in a test makes 0 herdr snapshots and 0 perl processes.
- locks: none
- after: none
- files: server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/readers/find.ts

### L564 Plans settle on events
Result: A plan applies once, at the moment its project allows it, and `lineclear plan` never reads the whole task list to learn the board is up.
- why: `settlePlans` runs a model and a merge inside the tick before any project's lock, a second path to what `autoApply` already does; `plan.ts` spawns a 123 KB task list as a ping.
- done when: `settlePlans` is deleted and a test with a waiting plan sees the tick make 0 model calls (1 today); `grep -c "serverIsDown\|startsWith(\"Cannot" src/plan.ts` prints 0 (4 today); `mergeTask` spawns 3 git processes or fewer for a 40 commit merge (42 today); `grep -n "Bun.spawnSync" src/plan.ts src/autoplan.ts` lists only calls with a `timeout`.
- locks: none
- after: none
- files: src/autoplan.ts, src/plan.ts, src/rules.ts

### L567 The dead proof checker is gone
Result: No code reads or writes a proof file nobody makes, and the done-when proof is the reviewer's, named in scope.md.
- why: `proveStep` has no caller outside tests, while `unprovenOf` parses a proof file on every tick and every Home read.
- done when: `git ls-files src/doneproof-run.ts` prints nothing and `git grep -n "unprovenOf\|readProofs\|saveProof\|commandsFor\|testOf" src` lists nothing; `doneItems` lives in `roadmap.ts`; `wc -l` of the deleted files (295 in scope.md) is gone from `bun run gates` knip's list; the GitHub check is green.
- locks: none
- after: none
- files: src/doneproof.ts, src/doneproof-run.ts, src/task-steps.ts, src/owner-steps.ts, src/task-work.ts, src/roadmap.ts, src/brief.ts, docs/scope.md

### L581 Place by CPU and memory
Result: A task goes to the machine with the most free slots, CPU and memory, and ten starts in one tick never overbook a machine.
- why: placement checks memory only as a 1 GiB floor and reads the room once per tick, so 10 starts see the same room (findings 7).
- done when: a test with machines of 10, 12 and 25 slots, 8 GiB free on the first, and 45 ready steps starts at most `floor((free - reserve) / per-agent)` on each; no machine passes its slots or memory in the test; `mostRoom` has 0 callers that do not subtract placed tasks.
- locks: none
- after: none
- files: src/spread.ts, src/tick-project.ts, src/rules.ts

### L582 One task store
Result: Tasks, settings and push subscriptions live in one SQLite store of the main server, with no per-machine `tasks.json` or `remoteSeen` copy.
- why: 18 stores are written whole and 3 boards cause double steps; `remoteSeen` rewrites about 45 KB per project per tick and `writeJson` shares a fixed tmp name between processes (findings 5, 10, 11, 13).
- done when: `grep -rn "remoteSeen\|machineReads" src server | wc -l` prints 0; a test writes 1000 tasks from 4 concurrent callers and reads 1000 intact; `workers/*/tasks.json` is no longer created.
- locks: none
- after: none
- files: server/server/store.ts, server/server/push.ts, src/spread.ts, server/server/live/machines-helpers.ts

### L583 Atomic step claims
Result: A step is claimed by one insert, so two loops get one task and one refusal, and a silent machine's claim ends by lease.
- why: `startOn` sends secrets, clones and adds a task with no claim taken first; L455 and L443 ran twice; `SILENT_DROP_MS` holds a dead machine's locks 24 h (findings 8, 9).
- done when: a test starts one step from 2 racing loops 100 times and sees 100 times exactly 1 task; a claim whose worker closed its socket is released within 30 s in a test.
- locks: none
- after: L582
- files: src/spread.ts, src/starts.ts, src/task-steps.ts, src/real-world.ts

### L586 Workers hold no state
Result: A worker is an executor with no store, no rule loop and no `last.json`; the main server reads its state from the worker when it connects.
- why: `keep` rewrites each machine's whole chat set every 5 s, `kept.ts` migrates it on every start, and each worker is a full second server (findings 14, 15, 34).
- done when: `server/server/live/kept.ts` no longer exists; a restart of the main server shows each machine's chats after the first worker snapshot with 0 files under `machines/`; the worker's resident memory is at most 150 MB in a measured run of `bun scripts/core-baseline.ts` (record the value in `docs/numbers.md`).
- locks: none
- after: L582
- files: server/server/live/kept.ts, server/server/live/machines-links.ts, server/server/main.ts, server/server/live/worker-process.ts

### L589 The tunnel has no heartbeat
Result: The tunnel has no `sleep 10` on the machine, no `rm -f` first and no `chown`; the worker connects out and agents use a local socket.
- why: each machine runs a shell poll every 10 s only to keep a forward alive (finding 33).
- done when: `grep -c "sleep" server/server/live/tunnel.ts` prints 0; a test kills the link and the agents' `lineclear` on the fake machine reaches the main server again within 5 s.
- locks: none
- after: L586
- files: server/server/live/tunnel.ts, helper/lineclear

### L591 Updates drain a machine
Result: The plane has one version; a worker is updated only when it has no working task, one machine at a time.
- why: every machine updates in the same minute on the 15 s sync, with no check for work in flight beyond `MERGE_DEADLINE` (finding 38); `sync()` also runs 8 herdr process starts a minute and treats a failed read as an empty list (finding 17).
- done when: a test with 3 machines, one with a working task, sees the busy one updated last and never two updating at once; `herdr machine list` is started at most once per start and once per change in a 10-minute run; a failed read keeps every worker.
- locks: none
- after: none
- files: server/server/live/machines.ts, server/server/live/install.ts, server/server/live/machines-links.ts

### L593 Actions to a machine are kept
Result: An action for a machine that is out of reach is stored with an id and delivered once; a failure shows in the machine's state.
- why: `forward().catch(() => waiting.push(a))` retries forever in memory and loses the list on a restart; four empty catches wait for the doctor (findings 24, 25).
- done when: a test queues 3 actions while a worker is down, restarts the main server, and sees each delivered exactly once when the worker is back; `grep -c "catch {" server/server/live/link-poll.ts` prints 0.
- locks: none
- after: L582
- files: server/server/live/link-poll.ts, server/server/live/machines-links.ts, server/server/live/machines-actions.ts

### L604 A plan applies without the owner
Result: A plan that passes the rule checks applies by itself and can be undone from the chat, with no approval card.
- why: 9 of 14 plan items were approved without a note and 5 applied by themselves; none was rejected.
- done when: `plansAreAuto` is gone and a plan that passes `planProblems` merges; a rejected check sends it back to the Dispatcher; `lineclear undo` of an applied plan is reachable from the chat card; a test sees no Inbox item for a plan.
- locks: none
- after: none
- files: src/autoplan.ts, src/dispatcher.ts

### L605 The Inbox view is gone
Result: The web UI has no Inbox page: `/inbox` and `/inbox/<ask>` land on the Dispatcher chat with the card.
- why: 3% of the items need the owner, and the chat shows those cards.
- done when: `ui/web/inbox-strip.tsx` and `ui/kit/inbox-card.tsx` no longer hold a view; `View` in `ui/web/routes.ts` has no `inbox`; an old `/inbox/7` link opens `/chat` on that card; `bun run ui:test` has no Inbox page screenshot.
- locks: none
- after: none
- files: ui/web/routes.ts, ui/web/app.tsx, ui/web/inbox-strip.tsx, ui/kit/inbox-card.tsx

### L606 Home shows one Needs you line
Result: Home shows a single "Needs you" line when a login, money, an outward action or a product choice waits, and nothing when none does.
- why: the ask strip of 345 lines was built for 201 items in 7 hours; the owner's need is 1 or 2 a day.
- done when: `ui/web/home.tsx` shows the line with a link to the chat card; `wc -l ui/web/inbox-strip.tsx` is 120 or less or the file is deleted; the screenshot at 1440 and 390 px has the line, the empty state and 3 items.
- locks: none
- after: L605
- files: ui/web/home.tsx, ui/web/home-table.tsx, ui/web/home-rows.ts

### L609 Swarm against one agent
Result: A table shows merged steps per hour and tokens per merged step on the devbox, swarm against one agent, and names roles that cost too much.
- why: parallel work is worth keeping only if it merges more steps an hour for no more tokens each; no number says so today.
- done when: a doc in `docs/numbers.md` has two runs on the devbox on the same 10 steps with disjoint files: the swarm as it runs and one pi agent in a row with the same model and review setting; each run lists merged steps per hour and tokens per merged step summed over every role, and says whether the swarm merges at least 2 times as many steps an hour for no more tokens
each (R18 of `release.md`); then the swarm run repeated with the coordinator, the night watch and the Inbox off one at a time. Each role whose run costs more tokens or time per merged step than it saves gets a step that deletes it.
- locks: none
- after: none
- files: docs/numbers.md, src/measure.ts

## Open steps for the web

The open steps of [web-audit.md](web-audit.md), listed after the core steps.

### W22 State changes have named motion
Result: Route changes, tab switches, list additions and the Dispatcher panel each play a named motion from the kit, and none under reduced motion.
- why: F34: only the kit handles reduced motion, and the web pages have almost no motion.
- done when: Each of the four has a motion id in `ui/kit/motion.ts`; a test with `prefers-reduced-motion: reduce` sees none play; a performance trace of each stays at 60 fps and a recording of each is stored.
- locks: none
- after: none
- files: ui/kit/motion.ts, ui/kit/kit.css, ui/web/app.tsx, ui/test/kit.pw.ts

## Frozen by the owner 5 Nov 2026

Core steps the owner froze until the release is green. The rule loop never starts a step under this heading. Moving
a step out of it is the owner's call.

### L95 A machine needs no install
Result: You add a machine without installing Lineclear on it.
- why: every Lineclear install on another machine is one more copy to update; herdr already reaches machines over SSH.
- done when: `lineclear machine add <host>` runs `herdr machine add`, installs pi, bun, git and gh there and clones the projects that may run there. The helper (`server/helper/`, `install.ts`, `tunnel.ts`, `box.ts`) is deleted.
- locks: none
- after: none
- files: src/spread.ts, server/server/live/install.ts, server/server/live/box.ts, server/server/live/tunnel.ts, server/helper/

### L172 A power cut leaves work intact
Result: A pulled plug on a machine ends no work for good: tasks resume and no half-written file is read.
- why: only a real power cut tests what an orderly reboot cannot, and it ends the work of every task on that machine, so the owner chooses when.
- done when: After the owner pulls the plug of a machine with working tasks and it boots, every task that was working is working again within 10 minutes with no message from the owner, and `lineclear doctor` reports no unreadable store file. The owner pulls the plug; an agent only waits for it.
- locks: none
- after: none
- files: docs/stalls.md

### U43 Release gate
Result: The web UI is finished and proved before a release goes out.
- why: a user judges Lineclear by its web UI, so a missing picture, a vague label or a dead button breaks trust in all of it.
- done when: `bun run ui:test` passes at 1440 and 390 px, and `docs/numbers.md` under "U43" lists one screenshot for each view of idea.md (Home, Inbox, Roadmap, step page, Agent browsers, Settings) in each of its states (empty, loading, error, 200 items).
- locks: none
- after: none
- files: ui/web/, ui/kit/, docs/numbers.md
