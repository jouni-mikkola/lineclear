# Plan v0.2: the development flow

The part of v0.2 that takes a step from `ready` to merged: checks, review, the merge lane, token budgets, the measure
that parallel work pays, and the night watch. Steps L790 to L809. In flight and planned around: L540 L520 L524 L526
L527 L528 L504 L505 L560 L565 L566 L569 L587 L592 L607. L524, L560, L569, L592, L607 and L504 are merged: their commits are on main, though ROADMAP.md still lists them.
So are L453, L464, L494 and L601, which makes the open steps L525 and L608 startable now. The red-main gate needs no
step here: L525 drops the title test, and the fix task passes by `by: main-green` (`merge.ts:281`).

## What is wrong today

Measured on 2026-11-07 with `gh` and `git` on this repo and on the owner's machine.

- **Main is red most of the day.** 31 of the last 50 `check.yml` runs on main failed (11:04 to 14:08 UTC), and 10 of the
  203 commits on main today are a fix of red main or a revert. Causes:
  - `mergeOnGitHub` rebases a branch only on a text conflict (`server/server/live/engine/merge.ts:322-330`: "a clash
    that merges cleanly but breaks is caught by the checks on main"), and with Merge "on its own" it does not wait for
    any check (`merge.ts:361`, `waitChecks`).
  - A pull request runs only the tests of what it changed (`check.yml`, job `changed`); the full suite runs only after
    the merge, on main.
  - The `main` ruleset requires the check `check` with `strict_required_status_checks_policy: false`, so GitHub merges
    a branch that was never tested on the current main.
  - GitHub's merge queue is not offered to a repo owned by a user, only by an organization
    ([docs](https://github.com/github/docs/blob/main/data/reusables/gated-features/merge-queue.md)). The `merge_group`
    trigger of `check.yml` never fires. Lineclear's lane has to be the queue.
- **Checks.** A full run on main: 8 shards of 15 to 39 s, about 10 s of each is setup (checkout 3 s, setup-bun 2 s,
  cache 3 to 4 s). Whole run 44 s median, 51 s p90 (last 17 runs on main); `changed tests` 37 s median, 47 s worst
  (18 PR runs). During the 11:04 burst the median run took 290 s: the Free plan runs 20 jobs at once
  ([limits](https://docs.github.com/en/actions/reference/limits)), a main run takes 9 and every merge starts one.
- **Review costs a working slot.** The agent reviews its own change in its own session (`server/skill/lineclear-agent/SKILL.md`
  step 3: `timeout 540 pi -p` with tools, or a subagent), up to 2 rounds, while its pi process (about 420 MB) stays up.
  A second way exists: `src/review-call.ts`, one call with no tools (`lineclear review`), which the flow does not use.
  Reviewer new input is 73 k median and 133 k p90 per task (`docs/numbers.md`), for diffs that are mostly small.
- **Duplicates and leftovers.** 59 duplicate pull requests stayed open: `close` (`engine-handoff.ts:208`) never closes
  the task's PR; `closePr` is called only for work already on main (`merge.ts:334`). 66 of the last 364 PRs were closed
  without a merge. `deleteBranchOnMerge` is off. On the owner's machine: 162 local branches, 136 stale worktrees (9 GB),
  1,748 pi session folders (2.1 GB), 1,725 of them for worktrees.
- **No token budget is enforced.** Only chats compact at a set size (`pi/compact-chats.ts`). A task agent has no cap:
  76 k new input median, 195 k p90, cache reads 16.7 M p90. Coordinator input p90 is 12.7 M a session.
- **No number says parallel work pays.** `docs/roles.md` defines the test and L609 names it; no script runs it.
  Today's rate is 203 commits on main in 16 hours, with no tokens per merged step.
- **The night watch lives outside Lineclear.** On the owner's machine: `lc-watch.timer` every 5 min runs
  `~/.config/lineclear/dispatcher/watch/watch.sh` (113 lines: ssh to two machines, `gh pr list`, `gh run list`, merges
  every Ready to merge task, promotes green main, installs it on the other machines with `scp`, and calls a Sonnet
  model through `pi -p` on each new issue: 160 of 391 rounds since 02:09 had one); `lineclear-keeper.timer` every 15 min
  (`keeper.sh`, 60 lines: restarts herdr, approves a fixed list of plans); `night-watch.timer` (`nudge.sh`, meant to end
  on 2 Nov, still scheduled); `lineclear-promote-main.timer`; and two cron lines (hourly store copy, `/tmp` cleaner).
  None is in a repo or tested. Each job is the rule loop's: land (L494), revert red main (L453), claim once (L493),
  promote (L454), copy the store (L608).

## The target

**One path from `ready` to main.** The agent builds and runs only the quick tests of what it changed, then
`lineclear ready` ends its pi process; its session file stays. The server takes over: it pushes and opens the PR (the
`changed` run, 2 jobs), runs one review call, then puts the task in the repo's lane. When a check or a review finds
something, the agent starts again from its session with that one message. An agent lives only while it builds, so 45
tasks need far fewer than 45 agents' 420 MB.

**The lane is the merge queue.** One lane per repo in the server. It rebases each queued branch on main's tip, labels the
PR `lane`, and GitHub runs the full check on that exact head. It squash-merges only that head, and only while main
is still at the commit it rebased on. At 45 agents it tests up to 4 branches as one candidate and splits a red one in
halves to find the cause. Main's push run checks nothing a lane run already checked on the same tree. A main that goes
red anyway (an owner's push) holds the lane, and only the fix task passes (by its `fixes` field, never by its title).
The revert of L453 stays the last guard.

**Checks run on GitHub only.** Each job takes 60 s or less at p90 (the limit stays 5 minutes). A full run takes 60 s or
less at p90, and waits for a runner 30 s or less at p90 with 45 agents. The owner's machine runs no suite.

**Review is one call and light for a small diff.** From another company than the worker, on the head the lane will
merge. Under 80 changed lines it gets the diff with 3 lines of context and the rule files cut to 4 k characters; above that, 8 lines of context and
the rule files. At most Review rounds (2), then the Dispatcher decides. Targets: new input 15 k median, 50 k p90.

**Budgets by role.** Measured from session usage, per role and per merged step, enforced in the pi extension
(`turn_end` carries `message.usage`, and `ctx.compact()` and `ctx.abort()` exist:
[extensions.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)).

| Role | Budget (new input) | At the budget |
| --- | --- | --- |
| Task agent | 150 k a task, cap 400 k | compact at 80 %, one message to finish or wait, stop at the cap and post a card to the project chat |
| Reviewer | 15 k small diff, 50 k cap | the diff is cut; never a second call for one head |
| Project chat | 1 M a session | compact (L488), then a new session |
| Dispatcher | 500 k a session | compact (L458) |
| Rule loop, night | 0 model calls on a quiet night | one Dispatcher message per new stall class (L569) |

**The measure.** It runs on this repo. Two base branches are cut from one main commit, `measure/<date>-swarm` and
`measure/<date>-one`, and the same 6 roadmap steps with disjoint locks are added to each with `--base`. The swarm arm
runs v0.2's flow with 6 tasks at once. The one arm runs one pi agent that does the 6 steps one after the other, with the
same model, the same review call and the same lane. Per arm the script reports merged steps per hour (first start to
last merge), tokens per merged step (every role's session usage summed: agent, reviewer, project chat, Dispatcher, night)
and GitHub job minutes. A step counts only if the full check is still green on its base an hour later. Each arm runs
twice. Parallel passes when the swarm merges at least 3 times as many steps an hour and spends at most 1.2 times the
tokens per merged step. A role that does not pay gets a step that deletes it (roles.md).

**No night watch of its own.** The loop (one process, L560) lands, reverts, promotes green main and copies the store.
The Dispatcher hears only of a stall the rules cannot name (L569). The outside timers and cron lines go, and doctor
fails while any timer or cron line runs `lineclear`, `herdr` or `pi` outside the service.

## Rank by the owner's priorities

Order: (1) core loop, (2) simple and clean, (3) token budgets, (4) any project, (5) theme in every view.

| Rank | Steps |
| --- | --- |
| 1 core loop | L525 (open, now startable), L790, L791, L795, L796, L797, L792 |
| 2 simple, clean | L793, L805, L608 (open, now startable), L802, L804 |
| 3 tokens | L794, L798, L799, L800, L801, L803 |
| 4 any project | L806, L807, L808 |
| 5 theme, in the web | L809 |

**The flow's part of v0.2 starts with these 10, all at once, on disjoint files:** L525, L790, L793, L805, L608, L794,
L798, L799, L800, L806. L807 is the 11th. L809 starts once L799 is merged.

## Steps

Each step is in [ROADMAP.md](../ROADMAP.md), or dropped with the step that does its job.

- L790 A lane label runs the full check: in ROADMAP.md.
- L791 The lane merges a checked rebase: in ROADMAP.md.
- L792 The lane tests 4 at once: in ROADMAP.md.
- L793 A closed task closes its PR: in ROADMAP.md.
- L794 One light review call: in ROADMAP.md.
- L795 The lane reviews, then merges: in ROADMAP.md.
- L796 The brief ends at ready: in ROADMAP.md.
- L797 An agent stops at ready: in ROADMAP.md.
- L798 Each role has a token budget: in ROADMAP.md.

### L799 Tokens per merged step
Result: `bun scripts/core-baseline.ts step-tokens 20` prints the tokens of each role per merged step over the last 20 merges.
- why: tokens are counted per task today, not per merged step, so the review, the chats and retries of a step are not added up.
- done when: the command sums agent, reviewer, project chat and Dispatcher usage for each merged step and prints median and p90 per role; a test reads a fake store of 3 steps, one with a retried task, and sees the sums; `measure.ts` stays under 200 lines.
- locks: step-tokens, file-src-measure-ts, file-scripts-core-baseline-ts
- after: none
- files: src/measure.ts, scripts/core-baseline.ts, test/core-baseline.test.ts

### L800 The swarm measure is a script
Result: `bun scripts/swarm-measure.ts <swarm-base> <one-base>` prints merged steps per hour, tokens per merged step and job minutes per arm.
- why: roles.md's first measure has no script, so no run of it is comparable with another.
- done when: the script reads the board's tasks of each base branch, their sessions and their `check.yml` runs and prints one row per arm; it counts a step only if its base is still green an hour after the merge; a test with two fake arms prints the pass or fail of the rule (3 times the steps an hour, at most 1.2 times the tokens).
- locks: swarm-measure
- after: none
- files: scripts/swarm-measure.ts, test/swarm-measure.test.ts

- L801 The swarm arm is measured: dropped, L609 measures both arms (ROADMAP.md).
- L803 One agent arm and the verdict: dropped, L609 measures both arms (ROADMAP.md).

- L802 The loop promotes green main: in ROADMAP.md.
- L804 No timer outside Lineclear: in ROADMAP.md.
- L805 Sessions of gone tasks go: in ROADMAP.md.

### L806 Any repo gets a check
Result: Adding a project with no GitHub check opens its first task: a `lineclear-check.yml` workflow that runs the project's check command.
- why: the lane needs a full check on GitHub, and a repo with no special setup has none, so v0.2's flow would work for Lineclear alone.
- done when: `lineclear project add` on a repo with no workflow adds a task whose brief adds `templates/check.yml` with the detected check command, shards 1, 5 minutes a job and the `lane` label rule; a test adds a scratch repo and sees the task and the file text; a repo that has a workflow gets no task.
- locks: project-add, file-src-add-project-ts
- after: none
- files: src/add-project.ts, templates/check.yml, test/add-project.test.ts

### L807 The lane reads the repo's check
Result: The lane waits for the check name the repo's own ruleset requires, not for a job called `check`.
- why: `github.ts` reads checks by this repo's job name, so another project's lane would wait for a check that never comes.
- done when: the required check names come from `gh api repos/<repo>/rulesets` once per repo watch, with `check` only when the repo has none; a test with a fake ruleset requiring `build` waits for `build`.
- locks: github-read, file-server-server-live-engine-github-ts
- after: none
- files: server/server/live/engine/github.ts

### L808 The flow runs on a second repo
Result: A small second repo with no special setup goes through 3 steps: add, build, review, lane and merge, with no hand step.
- why: the owner's priority 4: the flow must serve any project, and only a real second repo proves it.
- done when: `docs/numbers.md` lists the repo, its 3 tasks and their times from add to merge, with 0 hand steps and 0 red runs on its main.
  - Owner only: create the second small repo on GitHub (it leaves the machine).
- locks: swarm-measure, file-docs-numbers-md
- after: L806, L807, L791, L795
- files: docs/numbers.md

- L809 Usage shows tokens per step: dropped, W118 of the web plan does it.

## Not in this plan

- The roadmap check that two steps able to run at once share no file: the lead's or the code layout part's (LIN-1378, LIN-1379).
- Stale worktrees (136, 9 GB): L491 is merged and they remain; the code layout part owns the sweep.
- Machines on one build: L591.
