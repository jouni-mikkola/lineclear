# Roadmap

What Lineclear has to do is in [idea.md](idea.md); which code serves it is in [scope.md](scope.md). This file lists
only what is left to build for the core, in order. Done and dropped steps live in git history: a step's id is in its
commit subject. The rules read this file, so it follows its own format.

**Done means.** Every step below is done, and every module in scope.md is kept or gone as it says.

**How to read it.**

- A step starts once every step in its `after` is done and its locks are free. Steps on different locks run in parallel.
- Each step is `### <id> <title>` (at most 32 characters), a `Result:` line (one sentence of at most 140 characters
  on what the owner sees or can do), then `why`, `done when`, `locks`, `after` and `files`. `lineclear roadmap check`
  checks the form with no AI.
- A step is done when a commit on main has the subject `<TASK>: <id> ...` or a line `Step: <id>`; a revert of that
  commit opens it again.
- New ideas never go into this file.

## Open steps

### L442 Old board screen parts gone
Result: The server holds no code of the old board screen: no sidebar order, unread marks, folder picker, slash commands, side panel or activity.
- why: area D3 of scope.md: about 1800 lines that no page of `ui/web/` reads are still read, tested and kept up to date.
- done when: The nine files below are deleted with their routes, snapshot fields and tests; `git ls-files` lists none of them, and `bun run gates` (knip) and the check are green on GitHub.
- locks: server-screen
- after: none
- files: server/server/live/activity.ts, server/server/live/commands.ts, server/server/live/folders.ts, server/server/live/readers/steps.ts, server/server/live/unread.ts, server/server/live/worktree.ts, server/shared/activity.ts, server/shared/attention.ts, server/shared/order.ts

### L443 The catalog lists pi only
Result: The server's agent catalog names pi alone, so no setting, menu or command offers another agent CLI.
- why: area D2 of scope.md: pi runs every agent, but `settings-catalog.ts` still describes every CLI herdr can start.
- done when: `settings-catalog.ts` has one agent kind, pi, and is under 120 lines; `lineclear task add --agent claude` is refused with a line that names pi; a test checks both.
- locks: settings
- after: none
- files: server/server/live/settings-catalog.ts, server/server/live/settings-store.ts, server/server/live/args.ts

### L430 Needs you means a question
Result: A task shows Needs you only when it asks you something; one that stopped without a question is resumed by itself.
- why: a task whose turn ends without a question still shows Needs you, so the Inbox hides the real questions among them.
- done when: A task is in Needs you only with an open card or `lineclear wait owner`; a turn that ends with neither gets one nudge and, if still quiet, a restart. A test ends a turn with no question and sees no Inbox item.
- locks: stall-check
- after: none
- files: server/server/live/engine/status.ts, src/stalls.ts, src/inbox.ts

### L436 Flaky tests quarantined
Result: A test that flakes on GitHub stops blocking merges within one run and gets its own fix task; it leaves quarantine only once fixed.
- why: merge happens only on green, and a flaky server test is never rerun alone, so one flake holds every merge.
- done when: The server suite's failures are rerun alone like the root's. A test that fails and then passes alone on one commit goes to `test/quarantine.json` with its fix task's id; its failure alone no longer fails the check, a failure alone too still does. At most 5 tests are in quarantine. A test plants a flake, a break and a 6th flake.
- locks: quarantine
- after: none
- files: scripts/check.ts, scripts/failures.ts, src/check-runs.ts, test/quarantine.json

## Speed and stability

The goal: the fastest AI development system with the fewest bugs, light and with no old code. Baselines are in
[numbers.md](numbers.md) under "Speed and stability baseline". Every step here has `after: none` and its own lock, so
the steps run in parallel across the machines. Both builds count: the stable install and the dev repo's main, and only
a green main is promoted to stable. A step's number is met when its `done when` command prints it on the commit that
merges the step.

### L450 The snapshot is small
Result: The board loads from a snapshot of at most 200 KB, so a phone gets the first task title in 100 ms or less.
- why: today `GET /api/snapshot` sends 24.5 MB (median 0.19 s, p90 0.28 s on the same machine), which every page and every refresh pays.
- done when: `bun scripts/core-baseline.ts snapshot http://127.0.0.1:<board port>` prints a size of 0.2 MB or less and a p90 of 0.05 s or less on a board with 190 tasks; a test fails when the snapshot of the fake world is over 200 KB.
- locks: snapshot
- after: none
- files: server/server/app.ts, server/server/live/source-views.ts, src/lineclear-client.ts

### L451 An agent starts in 10 seconds
Result: A task's agent makes its first tool call at most 10 s after `lineclear task add`, median, and 30 s at p90.
- why: from add to first tool call takes 23 s (median) and 131 s (p90) today, and 22 of 194 tasks needed their brief sent again.
- done when: `bun scripts/core-baseline.ts start 20` prints a median of 10 s or less and a p90 of 30 s or less over 20 new tasks; the brief-resent count of `bun scripts/core-baseline.ts stalls` over those tasks is 0.
- locks: agent-start
- after: none
- files: server/server/live/engine/engine-launch.ts, server/server/live/engine/briefs.ts, src/starts.ts

### L452 The CLI answers in 100 ms
Result: `lineclear task list`, `lineclear show` and `lineclear room` each finish in 0.1 s or less, p90.
- why: `task list` takes 0.23 s, `show` 0.09 s and `room` 0.47 s (p90 0.68 s) today, and every agent calls them many times a task.
- done when: `bun scripts/core-baseline.ts time 7 lineclear room` and the same for `task list` and `show` print a p90 of 0.1 s or less; `bun test test/cli.test.ts` has a case that fails above it.
- locks: cli-speed
- after: none
- files: src/cli.ts, src/task-read.ts, src/herdr.ts

### L453 Main is never red
Result: Every commit on main gets a finished `check.yml` run, and a commit that turns main red is reverted within 10 minutes.
- why: of the last 50 runs on main 14 failed and 15 were cancelled by the next push (its `concurrency` group cancels in progress), so main's state is often unknown.
- done when: `check.yml` does not cancel a run on main; a merge that turns main red is reverted by the merge lane within 10 minutes and gets a fix task. `gh run list --workflow check.yml --branch main --limit 50 --json conclusion` lists 0 `failure` and 0 `cancelled` for runs after the step's merge; a test plants a red main and sees the revert.
- locks: main-green
- after: none
- files: .github/workflows/check.yml, server/server/live/engine/lane.ts, server/server/live/engine/lane-watch.ts

### L454 Stable follows green main only
Result: The stable install updates only to a commit whose GitHub `check` is green on main, and it names that commit.
- why: the machines run the stable install, and a promotion of a red or unchecked commit puts every machine on a bug.
- done when: `lineclear update` refuses a commit without a green `check` run and prints the commit it installed otherwise; a test updates to a red, a pending and a green commit and sees refuse, refuse, install.
- locks: promotion
- after: none
- files: src/builds.ts, src/published.ts, src/main-branch.ts

### L455 GitHub check in 45 seconds
Result: The whole `check.yml` run on main finishes in 45 s or less, median, and 60 s at p90.
- why: merge waits for the check, which takes 66 s (median) and 86 s (p90) today; jobs 1/4 and 3/4 take 24 s and 22 s while 2/4 and 4/4 take 46 s and 57 s.
- done when: `bun scripts/core-baseline.ts gh 20` prints a run median of 45 s or less and a p90 of 60 s or less over 20 runs on main; the slowest of the 4 jobs is at most 1.5 times the fastest.
- locks: check-ci
- after: none
- files: scripts/check-speed.ts, scripts/load-map.ts, test/check-speed.test.ts

### L456 Waiting for a lock is no stall
Result: A step that waits for a lock another step holds shows as waiting and raises no stall line.
- why: `lock-held` is 552 of the 2614 stall lines in `decisions.jsonl` (21 %), though the wait is the rule loop working as designed.
- done when: a `lock-held` wait writes no `stall` line and `lineclear roadmap locks` still lists it; a test holds a lock for 10 minutes and finds 0 stall lines. `grep -c '"kind":"stall"'` over a day of `decisions.jsonl` has 0 `lock-held`.
- locks: lock-waits
- after: none
- files: src/waits.ts, src/home-waits.ts

### L457 Every stall has a class
Result: Each stall line names one cause, so no stall line is `unknown`, and each cause has a remedy that clears it.
- why: 545 of 2614 stall lines are `unknown` and 386 are `no-sign-of-life`, so the loop restarts what it cannot name.
- done when: a day of `decisions.jsonl` after the merge holds 0 `stall unknown` lines and at most 2 stall lines per hour; a test feeds each of the 9 classes of numbers.md and sees its one remedy.
- locks: stall-classes
- after: none
- files: src/stall-class.ts, src/heal.ts, src/health.ts

### L458 Agents read less
Result: A task agent spends at most 40 k new input tokens at the median and 150 k at p90, with its prompt and skills trimmed to match.
- why: a task agent spends 55 k new input tokens (median) and 276 k (p90), and 798 k cache reads (p90 10.5 M).
- done when: `bun scripts/core-baseline.ts tokens 20` over 20 new tasks prints agent new input of 40 k or less (median) and 150 k or less (p90); the agent prompt text of `prompts.ts` is at most 70 % of its size today.
- locks: agent-prompt
- after: none
- files: server/server/live/prompts.ts, server/skill/lineclear-agent/SKILL.md, src/brief.ts

### L459 Chats compact before they grow
Result: The coordinator and the Dispatcher compact at a set size, so a session never passes 1 M new input tokens.
- why: a coordinator session reaches 12.7 M new input tokens (p90) and a Dispatcher session 2.8 M, against 227 k and 38 k at the median.
- done when: `bun scripts/core-baseline.ts chat-tokens 20` over 20 new sessions prints a p90 of new input of 1000 k or less for the coordinator and 500 k or less for the Dispatcher; `bun test test/chat-limits.test.ts` ends a long session and sees a compaction.
- locks: chat-context
- after: none
- files: src/chat-limits.ts, src/dispatcher.ts, src/chat.ts

### L460 Failed starts per machine
Result: `lineclear doctor` lists each machine's failed starts of the last 24 hours with their cause.
- why: the board keeps no failed-start record per machine, so a machine that fails starts looks the same as one that does not.
- done when: `lineclear doctor` prints one line per machine with its failed-start count and causes (brief unsent 32 and machine unreachable 4 per week today are the baseline); a test fails a start on one of two machines and sees only that machine's line change.
- locks: start-record
- after: none
- files: src/doctor.ts, src/home-doctor.ts, src/measure.ts

### L461 45 agents work at once
Result: With 45 ready steps on disjoint locks, 45 agents are working within 5 minutes across machines of 10, 12 and 25 slots.
- why: one machine ran 2 tasks at the baseline and the rule loop wrote 6 `no-room` stall lines in a week, so the slots are not yet shown to fill.
- done when: a test with 3 fake machines of 10, 12 and 25 slots and 45 ready steps starts 45 within 5 simulated minutes and never more than a machine's slots; `lineclear roadmap locks` on this file lists every step of this section as startable together.
- locks: slots
- after: none
- files: src/rules.ts, src/tick-project.ts, src/spread.ts

## Frozen by the owner 5 Nov 2026

Core steps the owner froze until the release is green. The rule loop never starts a step under this heading. Moving
a step out of it is the owner's call.

### L95 A machine needs no install
Result: You add a machine without installing Lineclear on it.
- why: every Lineclear install on another machine is one more copy to update; herdr already reaches machines over SSH.
- done when: `lineclear machine add <host>` runs `herdr machine add`, installs pi, bun, git and gh there and clones the projects that may run there. The helper (`server/helper/`, `install.ts`, `tunnel.ts`, `box.ts`) is deleted.
- locks: machines
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
- locks: kit, shell, ui-test
- after: none
- files: ui/web/, ui/kit/, docs/numbers.md
