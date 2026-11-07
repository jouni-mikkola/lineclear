# Roadmap

What Lineclear has to do is in [idea.md](idea.md). This file lists the open steps and when each can start. Done steps
live in git history: a step's id is in its commit subject. The rules read this file, so it follows its own format.

**Done means.** Lineclear is done when every line below holds.

- Every step in this file is done or dropped.
- No later release goes out before the web UI is finished and proved, the release gate (U43).
- One product: one name, one web UI, one port and one data folder on every machine (L69 to L71).
- One server and one task store run every machine through herdr, and other machines need no Lineclear install (L95, L96).
- A reboot, a killed service, a full disk or a power cut comes back with no loss and no manual step (L172).
- The tests hold on a loaded machine, and the check stays fast (L116, L402 to L413).
- A check goes red only for a real break: a flaky test is fixed at its cause or quarantined with a fix task, never weakened (L434 to L438).
- A task costs under 400k input tokens and 10 minutes to ready, and a machine runs 3 agents per core, 12 on 4 cores and 8 GB (L416 to L433).

**How to read it.**

- A step starts as soon as every step in its `after` is done and its locks are free. There is no other order.
- The UI has no one `ui` lock. A UI step locks the areas whose files it changes: `home` (the Home page and its data), `line`
  (the line and its lanes), `task-row` (the table of working tasks and its open row), `chat`, `usage-mark` (the usage mark and its sheet),
  `settings`, and `shell` (the frame, the router, the tokens and the shared kit parts: only a step that changes these).
  Steps on different areas run in parallel.
- A step holds the locks on its `locks` line and not its parts as wholes, so two steps on one part run side by side
  when their locks differ. A step with no `locks` line, or `locks: none`, holds each of its parts whole.
- Each step is `### <id> <title>` with a `result` line and four lines of brief: `why`, `done when`, `locks` and `after`.
  The title names the result and has at most 32 characters. The `result` line is one sentence of at most 140
  characters on what the owner or a user can see or do once the step lands. `lineclear roadmap check` and
  `lineclear plan submit` check both with no AI. The `after` line lists
  ids or says `none`. A step may add a `files` line: the paths or folders it
  is likely to touch, separated by commas. A step without it stays valid. A step that is no longer wanted gets a
  `dropped: <reason>` line. It then counts as done for the steps after it.
- A step is done when a commit on main has a subject `<TASK>: <id> ...`, or a line `Step: <id>` in its message.
  A commit `Revert "<that subject>"` undoes it, so a reverted step is open again.
- A step whose `done when` asks for a run in `docs/numbers.md` is not done while that section says "Not yet
  recorded" for it: `lineclear roadmap check` fails until its `done when` gets an item `Reopened: <why>`, and a reopened
  step is open again.
- A step that needs you asks once and waits: `lineclear ask` until L7, then `lineclear ask`.
- There are no time trials. A step is done when its checks pass, and the owner reviews the result.
- New ideas go to [backlog.md](backlog.md), never into this file.
- The section "Frozen by the owner 5 Nov 2026" holds open steps the rule loop never starts. Moving a step out of it is the owner's call.
- An `after` names only a step whose code the later step needs, so as many steps as possible are ready at once.

## Open steps

### L436 Flaky tests quarantined
Result: A test that flakes on GitHub stops blocking merges within one run and gets its own fix task; it leaves quarantine only once fixed.
- why: the check reruns a failed test alone only in steps named `tests` (`scripts/check.ts`), so a server test that flakes is never rerun, and the quarantine of `src/check-runs.ts` reads only the machine's own log, which a GitHub runner lacks.
- done when: The server suite's failures are rerun alone from `server/` like the others. A test that fails and then passes alone on the same commit is a flake: the server adds it to `test/quarantine.json` on main with its fix task's id and files that task (`flakeFixIn`, its brief asks for the cause and forbids a weaker test). The check, here and on GitHub, still runs a quarantined test and prints its result, but its failure alone does not fail the run; a quarantined test that also fails alone is a break and fails the check. The fix task's merge takes the test out. At most 5 tests are in quarantine; a 6th pauses the merge line and asks the owner. A test plants a flake that fails 10 runs in a row, a break and a 6th flake.
- parts: checks, server, rules
- locks: quarantine
- after: none
- files: scripts/check.ts, scripts/failures.ts, src/check-runs.ts, src/check-tier.ts, test/quarantine.json, test/check-runs.test.ts

### L438 Tests hold under parallel load
Result: Every test shard passes with 4 copies running at once on one GitHub runner, each test in its own folder and ports.
- why: agents run several checks at once on one machine; a test that sleeps a fixed time, binds a fixed port or shares a path passes alone and fails then.
- done when: One helper `waitFor(condition, what)` in `test/helpers.ts` (and its server twin `until`) waits on an event to a deadline and names what never came. A gate fails a test that binds a fixed port, writes outside its temp folder or polls with a fixed count of sleeps. A nightly job per shard runs 4 copies of that shard at once within the 5-minute job limit, untimed like the other GitHub jobs; every shard is green 5 nights in a row.
- parts: checks, server
- locks: server-tests, gates
- after: none
- files: test/helpers.ts, server/test/source-fixture.ts, scripts/gates/, .github/workflows/check.yml

### L417 A small start context
Result: A task's agent starts with a short card of rules instead of two whole skills, and reads a skill only when a command sends it there.
- why: an agent reads about 6k tokens of skills at its start, and they ride along in every later call: about 240k tokens in a task of 40 calls.
- done when: The launch prompt and the start card together are at most 3k tokens; a command that refuses names the skill section to read. The start context of 10 tasks, measured by L416, is under 3k tokens each.
- parts: server, pi
- locks: briefs, launch
- after: none
- files: server/server/live/prompts.ts, server/server/live/engine/briefs.ts, server/server/live/engine/engine-launch.ts, server/skill/

### L418 A brief names its files
Result: Each task's brief lists the files to change and the few to read first, so its agent reads those and not the repo.
- why: about half of a task's model calls only read (find, grep, cat), most of them an agent finding its way, and each such call pays for the whole context so far.
- done when: `lineclear task add` and the planner put a `files` and a `read first` list in every brief, from the step's `files` line or the planner's split (L427). Over 10 tasks measured by L416, the median task makes at most 10 calls that only read.
- parts: planner, server
- locks: briefs
- after: none
- files: src/plan-brief.ts, src/brief.ts, server/server/live/engine/briefs.ts

### L420 Compaction comes early
Result: A task agent compacts its context near 50k tokens, keeping its brief, its files and its decisions.
- why: compaction aims near 150k today and never fires: a task's largest call is about 40k tokens in the median and up to 81k, and each call pays for the whole history again.
- done when: `pi/compaction.ts` sets the task agent's target to 50k tokens and the coordinator's to 100k; a test checks the reserve per model. Over 10 tasks measured by L416, no model call of a task agent has over 60k input tokens.
- parts: pi
- locks: pi-context
- after: none
- files: pi/compaction.ts,

### L421 A small model for chores
Result: Mechanical work (a clean rebase, a merge retry, a ready report, a nudge) runs on the smallest model, not on the coder's.
- why: `lineclear setup` already picks a worker, reviewer, planner and step checker, but every call of a task's agent, a rebase or a status line too, runs on the worker's model.
- done when: Setup has a fifth role, mechanic, with the smallest logged-in model as its default; the server starts it for a clean rebase, a merge retry and a nudge, and `decisions.jsonl` names its model; the reviewer stays from another company than the worker. Over 10 tasks measured by L416, 90 % of the calls for rebases, merge retries and nudges run on the mechanic.
- parts: server, rules
- locks: role-models, launch
- after: none
- files: src/setup.ts, src/models.ts, src/harness-pi.ts, server/server/live/engine/engine-launch.ts, test/models.test.ts

### L422 Review is one call on the diff
Result: A review is one model call that gets the brief, the diff and the repo's rules, and answers with tagged findings.
- why: a review is a whole agent today, with about 6 calls and 11 % to 17 % of a task's input tokens, most of it reading files the diff already shows.
- done when: `lineclear review <task>` sends the brief, `git diff` against the base with 20 lines of context and the repo's rules in one call to the reviewer model, with no tools, and stores its findings as JSON (severity, file, line, why). Over 10 tasks measured by L416, review is one call per round and under 5 % of input tokens.
- parts: server, checks
- locks: merge-line
- after: L421
- files: src/candidate-check.ts, server/server/live/engine/engine-merge.ts, test/review-call.test.ts

### L424 Agents run with no pane
Result: A task's agent runs as one headless process, and a live pane opens only while you watch it.
- why: each agent holds a herdr pane and a shell besides its own processes, and old panes stay open after their task, which costs memory and herdr's CPU.
- done when: The server starts a task agent without a herdr pane, keeps its state from the process itself and streams its log; opening the task's view attaches a pane, closing it detaches. A run of 3 agents per core is recorded in `docs/numbers.md`: no agent pane, load under the core count, and memory per agent no higher than the measured pi and model bridge.
- parts: server, install
- locks: headless, launch
- after: L267
- files: server/server/live/engine/engine-launch.ts, server/server/live/engine/worktrees.ts, src/herdr.ts

### L425 One install of dependencies
Result: A new worktree is ready in under 5 seconds and adds under 50 MB of disk, from one shared install per lock file.
- why: every worktree runs its own install; Bun's download cache is shared, but the time and disk of each install are not measured, and many agents multiply them.
- done when: `docs/numbers.md` records the install seconds and new disk of 10 worktrees. When either is over its limit, a new worktree links `node_modules` from a store keyed by the hash of the lock file, and a changed lock file makes a new entry; a test checks the key and the link. 10 more worktrees then meet both limits.
- parts: server
- locks: deps
- after: none
- files: server/server/live/engine/git.ts, server/server/live/engine/worktrees.ts, docs/numbers.md

### L426 The Dispatcher uses few tokens
Result: The Dispatcher answers each request from a fresh small context, so its day costs a tenth of today's.
- why: the Dispatcher keeps one session, so each request carries the history of every request before it; on a busy day it can spend nearly as much as all reviewers together.
- done when: The Dispatcher starts each request with the request and the board's summary only, on the smallest model that keeps `bun run dispatcher:eval` at 95 % or more. On a day with 30 tasks or more it spends under 5M input tokens.
- parts: dispatcher
- locks: dispatcher
- after: none
- files: src/dispatcher.ts, test/dispatcher-eval/

### L427 A goal splits by files
Result: The planner turns a goal into tasks that touch separate files, so they run side by side and merge without conflicts.
- why: two tasks on one file wait on each other or conflict at merge, which costs a rebase and a check each time.
- done when: `lineclear plan submit` refuses a plan whose parallel tasks share a file in their `files` lists. Over 10 planned goals, no two tasks that ran at the same time changed the same file (from `git diff --name-only`), and no merge conflicted.
- parts: planner
- locks: planner
- after: L418
- files: src/plan.ts, src/autoplan.ts, test/plan.test.ts

### L428 Green branches merge together
Result: Ready branches merge in batches under one check, so main gets one GitHub run per batch and none is cancelled.
- why: each merge starts a GitHub check that the next merge cancels (17 of 53 main runs in one day), and each branch pays a full check of its own.
- done when: The merge line takes up to 4 ready branches whose files do not overlap, merges them in order onto main as one candidate and runs one check. A test with 4 green branches makes one check run and 4 merges. Over a day, GitHub runs are at most one per 3 merged tasks, and none is cancelled.
- parts: server, checks
- locks: merge-line
- after: L427, L436
- files: server/server/live/engine/lane.ts, server/server/live/engine/merge.ts, server/server/live/engine/check-queue.ts

### L429 A red main is bisected
Result: A red batch or a red main finds the branch that broke it by itself, sends that one back and merges the rest.
- why: today a red main bounces every waiting branch with a failure it did not cause, and someone has to find the cause.
- done when: A red batch checks its halves until one branch is left, returns it to its agent with the failing lines (L423) and merges the others; a red main pauses the line and Home names the cause until the fix merges. A test with 4 branches, one breaking, merges 3 and returns 1 in at most 3 check runs.
- parts: server, checks, rules
- locks: merge-line
- after: L428
- files: server/server/live/engine/lane.ts, server/server/live/engine/merge.ts, src/rules.ts

### L430 Needs you means a question
Result: A task shows Needs you only when it asks you something; one that stopped without a question is resumed by itself.
- why: a task whose turn ends without a question still shows Needs you, so the Inbox hides the real questions among them.
- done when: A task is in Needs you only with an open card or `lineclear wait owner`; a turn that ends with neither gets one nudge from the smallest model and, if still quiet, a restart. Over a day, the Inbox holds no task without a question.
- parts: server, rules
- locks: stall-check
- after: L421
- files: server/server/live/engine/stalls.ts, src/stalls.ts, src/inbox.ts

### L431 One status view
Result: One view lists every agent at work: its task, machine, phase, tokens so far and minutes, and what it waits for.
- why: what runs where and what it costs is split between Home, the panes and the logs today.
- done when: Home's task table and `lineclear top` show, from one function in `src/agent-status.ts`, each running agent's task, machine, phase (L416's names), input tokens, minutes and wait; a test reads both on the same board and finds the same rows.
- parts: ui, measure
- locks: home
- after: none
- files: src/agent-status.ts, src/home-data.ts, ui/web/

### L433 The biggest CPU user is cut
Result: Whatever uses the most CPU per task in L416's table (tests, servers or the agent's own processes) uses half as much.
- why: a machine runs more agents only when each costs less CPU, and the CPU of tests and servers a task starts is not yet measured per task.
- done when: `docs/numbers.md` names the kind with the most CPU minutes per task over 30 tasks, from L416. A change to that kind (a shared server per project, tests run only for changed files, or what the table points at) halves its median CPU minutes per task over 30 more tasks, recorded under "Cost per phase".
- parts: measure, checks, server
- locks: cpu-cut
- after: L252
- files: docs/numbers.md

### L432 Targets hold for a day
Result: A day of real work meets the targets: 400k tokens and 10 minutes per task, 3 agents per core, 1 GitHub run per 3 merges.
- why: each step above proves its own part; only a day of normal work shows they add up.
- done when: `docs/numbers.md` has a day of at least 30 tasks, measured by L416, with: median input under 400k tokens per task and the largest under 1.5M, a median under 10 minutes from start to ready on every machine, 3 agents per core with load under the core count, at most one GitHub run per 3 merged tasks, no task in Needs you without a question, under 5 % of main checks red (L434) and none red from a flaky test, and a run of 12 tasks on the measured machine held to 4 cores and 8 GB (a systemd slice with `AllowedCPUs` and `MemoryMax`) where all 12 reach ready with no out-of-memory kill and load under 4.
- parts: measure
- locks: numbers
- after: L417, L420, L422, L424, L425, L426, L429, L430, L431, L433, L438
- files: docs/numbers.md

### L267 The rule loop spawns no herdr
Result: The rule loop learns whether a task's agent started or stalled from the server, without starting a herdr command for it.
- why: `agentStart` in `src/starts.ts` and `agentLastError` in `src/stalls.ts` spawn `herdr agent get` and `herdr agent read` for each task on each tick, about 65 a minute on a busy board.
- done when: The server's `/api/snapshot` carries, for each task's agent, a `herdr` field kept from L266's events: `status` (herdr's `agent_status`), `session` (the path of its pi session file, as `agent.get` gives it today) and `pasted` (true while its pane still shows the pasted brief), with `at`, the time of the last event or snapshot it came from.
- parts: rules, server
- locks: starts, herdr-events
- after: none
- files: src/starts.ts, src/stalls.ts, server/server/live/agents-state.ts, test/starts.test.ts, test/stalls.test.ts

### L252 A pass cache per step
Result: A rebase onto an unrelated main change reads a step's earlier pass instead of running its tests again.
- why: the merge check reruns tests only because main moved, and 30.6 h of 47.9 h merge time went to checks.
- done when: A step's pass is stored in the check log under a hash of the test file, the files the load map lists for it, the lock file and the runtime version.
- parts: checks, gates, measure
- locks: none
- after: none
- files: scripts/check.ts, src/check-runs.ts, test/contracts/checks.test.ts

### L264 No lock wait on another area
Result: For a day of normal runs, no step of this repo is recorded waiting on a lock it does not share with the holder.
- why: the tests of L261 and L263 plant the stall, but only a day of real starts shows the class does not come back.
  The task only reads the log and writes one entry, so it holds `numbers` for minutes; started before the day is
  over, it writes nothing, the step stays unproven and the rule loop starts it again later.
- done when: `decisions.jsonl` in Lineclear's config folder (`$LINECLEAR_CONFIG`, else `~/.config/lineclear/`) has, in the 24 hours after L263 merges while the rule loop starts this repo's open steps as usual, no `stall` line of the class `lock-held` for this repo whose holder and waiter share no lock and no file and neither holds a part of the other whole: a wait on the same area, or on a part one of them needs whole, is real contention.
- parts: measure
- locks: numbers
- after: none
- files:

### L308 A closed herdr call is retried
Result: When herdr closes a connection before its reply, the call is retried once and any failure reads "herdr closed the connection".
- why: a closed connection means the request arrived late, not that herdr is down, and calling it "isn't answering" restarts agents that are running.
- done when: `send()` in `server/server/live/herdr.ts` retries a call once when herdr closed the socket before the reply (ECONNRESET, EPIPE, an early end); a second close fails with "herdr closed the connection".
- parts: server
- locks: herdr-send
- after: none
- files: server/server/live/herdr.ts, server/server/live/agents-state.ts, server/test/herdr-contract.test.ts, server/test/herdr-send.test.ts

### L310 Done tasks leave the hot store
Result: Done tasks move out of `tasks.json` into the cold file, so the hot file holds only open work.
- why: every change rewrites `tasks.json`, so a file holding 410 tasks costs more than one holding the few that are open.
- done when: A task done or closed for more than a day moves from `tasks.json` to `tasks-cold.jsonl`, and a read of it by id still finds it.
- parts: server, measure
- locks: task-store
- after: none
- files: server/server/store.ts, server/server/live/engine/, server/test/store-cold.test.ts

### L70 One web UI, one port
Result: Lineclear has one web UI on one address to open and to secure.
- why: while the old UI serves on its own port, there are two UIs and two addresses to secure.
- done when: The fork's API answers on Lineclear's port, beside Lineclear's own, and agents' commands, remote helpers and the sandbox relay reach it there or on a socket under `~/.lineclear`.
- parts: server, install
- after: none
- dropped: Split into L164 to L167, each small enough for one task: links, no old pages, the code deleted, the lines counted.

### L214 One status for every reader
Result: `lineclear roadmap status`, Home, the roadmap view and the rule loop give the same state for every step.
- why: the loop reads main, the hand entries, other machines' tasks and proof records, while the CLI and views call `stepStatuses` with less, so the owner can read `ready` while the loop says `work` (red-team F6).
- done when: One function returns the inputs of `stepStatuses` and every caller uses it.
- parts: rules, core
- locks: none
- after: none
- files: src/status.ts, src/tick-project.ts, test/rules.test.ts

### L315 Task ids are unique everywhere
Result: `lineclear task show <id>` and `close <id>` find the one task with that id, on any machine, and no two tasks share an id.
- why: the same id on two machines lets a command act on the wrong task, which closed a finished task and left a stale one open.
- done when: A test with two stores that both hold a task `OMA-91` finds the later one renamed to a new id of the space's series, its old id kept as an alias that names the machine (`machine-b:OMA-91`), and `show` and `close` by either form reaching the right task.
- parts: server, core, install
- locks: task-ids
- after: none
- files: server/server/live/task-ids.ts, server/server/live/machines.ts, src/doctor.ts, src/doctor-task-ids.ts, test/contracts/server.test.ts, server/server/live/machines-links.ts, server/server/live/source.ts, server/server/live/source-views.ts, server/server/live/source-cli.ts, server/server/live/engine/engine-state.ts, server/server/live/engine/engine-helpers.ts, server/server/live/engine/engine-launch.ts, server/shared/types-core.ts, server/test/task-ids-unique.test.ts, test/doctor.test.ts, docs/parts/install.md, server/test/loop-board.ts

### L316 One store, read over the link
Result: Each machine keeps one task store; other machines read it over the link and keep no copy, so a task's state cannot differ between machines.
- why: a mirrored copy of another machine's tasks can go stale and disagree, and the board then shows two truths.
- done when: `~/.lineclear/machines/<machine>/tasks.json` is no longer written; an update removes the old mirrors, and a test finds none after it.
- parts: server, core, install
- locks: task-store
- after: L315
- files: server/server/live/machines.ts, server/server/live/source.ts, src/machines.ts, test/contracts/server.test.ts

### L317 A task stays on its machine
Result: A task's agent, its worker check, merge check, reviews, step check and done proof all run on the machine it was started on.
- why: work sent back to the main machine loads it and makes the offload pointless; one task on two machines is also hard to follow.
- done when: A test starts a task on machine B and finds its agent, `lineclear check`, merge check, review runs, step check and done proof all running on B (`whereRun` names B in `check-runs.jsonl` and `decisions.jsonl`), and none on the main machine.
- parts: checks, server, rules, install, planner
- locks: check-where
- after: L316
- files: src/check-runs.ts, src/candidate-check.ts, src/stepcheck.ts, src/doneproof-run.ts, server/server/live/engine/lane.ts, test/contracts/checks.test.ts

### L271 A fix loop files its own fix
Result: A step whose fix tasks end twice with no merge gets no third; one planning fix on Lineclear itself looks for the cause.
- why: a fix that ends empty twice will end empty again, and the cause is in Lineclear, not in the step.
- done when: A fix task ends with no merge when its status is `closed`, or `done` with `closed` set (`endedUnmerged` in `src/self-fix.ts`). After the step's last two fix tasks in a row end so, with no fix of it merged between them, `fileFix` files no third for that step; a merged fix starts the count again. The two ends are one stall of a new class `fix-loop` (`src/stall-class.ts`), which `fileFixes` files once as a planning fix on Lineclear's own project, under its day cap, with both tasks as evidence.
- parts: rules
- locks: fixes
- after: none
- files: src/self-fix.ts, src/stall-class.ts, test/stall-class.test.ts

### U27 Usage page
Result: One Usage page shows each account's limit, reset time and share.
- why: usage is one share-of-tokens bar on Home and again in Settings, with no limit, no reset time, nothing per
  project and nothing per merged step. Whether more work can start, and what it costs, is a question you ask often,
  and the plain facts answer it better than a verdict.
- done when: `/usage` has no call-out headline such as "Work can start now". It opens with each account's use, limit and reset time, then each machine as a siding with its free and busy slots, as the board's Usage frames (U51) draw it. Machines leave Settings. L46 adds when a full account frees up.
- parts: ui, measure
- locks: usage, home
- after: none
- dropped: Usage is no page. Its account facts and spend are in Home's usage sheet and the per-agent cost is in the opened row (U62); the per-project and per-day figures stay in `lineclear measure`.

### U52 Usage per agent
Result: You see each running agent, where it runs and what it costs now.
- why: to know what the work costs and where it stands right now, you need to see each agent that runs, on which
  model and account, and how much it has used, not only totals per day.
- done when: `/usage` lists each running agent with its task title, model, account, role (worker, reviewer or planner), context in %, tokens and dollars so far and time running, as the board's frames (U51) draw it. Each account's use shows with its limit and reset time from the same data.
- parts: ui, measure
- locks: usage
- after: U27
- dropped: Each running agent is a row of Home's table with its model, account and context in the opened row (U62), not a Usage page.

### U28 Home shows all work first
Result: Home shows the state of all work first, then the line, and each decision once.
- why: Home says "3 things wait for you" and then shows spend and usage, so a decision sits in two places and Home
  does not say how the work goes. A project shows a progress bar, a station strip and a text list, three pictures of
  one thing. A fresh install is three empty cards with the mark as their icon.
- done when: The headline gives the state of all work in one plain line, such as "Line clear. 7 at work, 3 merged today, next merge in about 20 min", from the shared status code. It never says "N things wait for you", and Home has no ask and no answer button. What waits for you shows only as the count on the Inbox tab (U26) and a lamp on the step in its track. A test reads Home in every state and fails on either.
- parts: ui
- locks: home
- after: none
- dropped: Home is rebuilt as the command center (U62), which replaces this headline-and-tracks design.

## Frozen by the owner 5 Nov 2026

The owner froze every open step that is not tier 1 (platform stability) or tier 2 (efficiency). The rule loop never starts a step under this heading. Moving a step out of it is the owner's call.

### L69 Lineclear's own names inside
Result: Variables, classes and file names inside the code say Lineclear, not Lineclear.
- why: environment variables, CSS classes (`lineclear-dark`) and file and function names in `server/`, `src/`, `pi/`, `scripts/` and `install.sh` still say
  Lineclear, and a user sees them in errors.
- done when: Every environment variable, CSS class, event, meta tag, path (the sandbox's `/run/lineclear` too) and name in the code is named Lineclear (`LINECLEAR_*`, `lineclear-*`).
- parts: server, ui, core, install, pi
- after: none
- locks: server, ui, core, install, pi

### L71 What no one uses is gone
Result: Code nobody uses is removed, so there is less to read and keep up.
- why: unused code is read, tested and kept up to date for nothing.
- done when: `server/herdr-plugin.toml`, its scripts, each plugin no feature uses and the code nothing calls are deleted. The commit lists each part removed and why no one used it.
- parts: server
- locks: none
- files: server/herdr-plugin.toml, server/plugins.json, server/plugins
- after: none

### L139 Server settings in small files
Result: The server's settings code is split into files under the size limit.
- why: the server has the worst part health, and both builds read the settings it keeps, so its 807-line settings
  file is where a format change hides.
- done when: As the first file of L88's split, `server/server/live/settings.ts` is split by job into files under 600 lines, each function under 80, with no entry left for it in the size baseline, and `bun run gates --lower` lowered it.
- parts: server (health)
- locks: none
- after: L71
- files: server/server/live/settings.ts

### L95 A machine needs no install
Result: You add a machine without installing Lineclear on it.
- why: every Lineclear install is one more copy to update, with its own PATH, port and folders to break.
- done when: `lineclear machine add <host>` runs `herdr machine add`, installs pi, bun, git, gh and the agent kit there, and clones the projects that may run there. It installs no Lineclear server, and says so.
- files: src/machines.ts, src/spread.ts, server/server/live/install.ts
- parts: install, rules, server
- after: none

### L96 No leftovers on other machines
Result: Old panes, folders and rule loops are gone from every other machine.
- why: an old coordinator pane, an old helper folder or an old rule loop on another machine keeps running, spends
  memory and can act on old state.
- done when: `lineclear doctor` names each leftover on every machine: a Lineclear coordinator pane, a `lineclear run` or a server, the old data folder's helper.
- files: src/doctor.ts
- parts: install
- after: L95

### L108 One secrets store, with codes
Result: Secrets live in one store, and an agent gets a login code from it.
- why: the server keeps secrets in its vault (Settings > Secrets, `lineclear secret`), while `lineclear secrets`
  kept them in files of its own, so a secret set in one place was missing in the other. Agents also need the code of
  a login that asks for one.
- done when: `lineclear secrets set`, `list` and `env` use the vault. `env` gives the folder's chain: its space, this machine and Everywhere, the most specific first. `set --all` sets one for Everywhere.
- parts: install, pi, server
- locks: none
- files: src/secrets.ts, src/totp.ts, pi/extension.ts
- after: none

### L172 A power cut leaves work intact
Result: A pulled plug on a machine with lingering on ends no work for good: tasks resume and no half-written file is read.
- why: only a real power cut tests what an orderly reboot cannot, and it ends the work of every task on that machine, so the owner chooses when.
- done when: Owner only: pulling the plug is a hand test, and an agent can only wait for it.
- parts: rules, measure
- locks: none
- after: none
- files: docs/stalls.md

### U71 Task table keeps its edge gap
Result: The last column of the Home task table sits inside the card with the card's padding.
- why: the U39 review found the last column flush with the card edge, which reads as cut off.
- done when: A test in `bun run ui:test` measures at 390 and 1440 px that the last cell's right edge is at least the card padding from the card edge.
- parts: ui
- locks: task-row
- after: L271
- files: ui/web/home-table.tsx, ui/kit/table.tsx, ui/kit/kit.css

### L269 The UI's interface has a test
Result: A change that breaks a name the UI part offers other parts fails `bun run test` at once.
- why: ui is the one part of the worst health whose debt is a missing contract test, so a change across its interface has nothing to hold it.
- done when: `test/contracts/ui.test.ts` calls `webAddress`, `roadmapData`, `lineOfRoadmap`, `projectsData`, `describeSessions` and `webApi` (with a temp repo and env, no server or herdr) and checks the shape each returns.
- parts: ui (health)
- locks: none
- after: L271
- files: test/contracts/ui.test.ts, docs/parts/ui.md

### L414 Composer out of chat.tsx
Result: The chat's composer lives in its own kit file, and `ui/kit/chat.tsx` has room under the 600-line limit.
- why: `ui/kit/chat.tsx` is at 577 of 600 lines, and typing a message is a job apart from showing the thread.
- done when: `Composer`, its `Tray` of attached files and `useKeyboardInset` move from `ui/kit/chat.tsx` to `ui/kit/composer.tsx`; `ui/kit/index.ts` exports them from there and every importer still builds.
- parts: ui (health)
- locks: kit-chat
- after: none
- files: ui/kit/chat.tsx, ui/kit/composer.tsx, ui/kit/index.ts

### U43 Release gate
Result: The web UI is finished and proved before a release goes out.
- why: a user judges Lineclear by its web UI, so a release with a missing picture, a vague label or a dead button
  breaks trust in all of it.
- done when: Every main concept of `docs/idea.md` and `docs/brand.md` is on screen and drawn as brand.md says: the line, stations (steps), trains (tasks) moving between them, signals (waits, locks, check slots), the Inbox as one decision at a time, and usage and spend. A list in `docs/numbers.md` under "U43" maps each concept to the view and the screenshot from `bun run shots` (U42) that shows it.
- parts: ui
- locks: kit, shell, words, ui-test, layout-test, motion
- after: none

### L402 First install test holds on load
Result: The install test "install adds Lineclear, the extension and the service, and doctor passes" passes on a loaded machine.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when: The test is the one named in the title, in `test/install.test.ts`; the name goes in the commit message. It passes on main when the machine is idle, so the cause is load.
- parts: install, pi (health)
- locks: install-test
- after: none
- files: test/install.test.ts

### L406 Roadmap test holds on load
Result: The test "this repo's roadmap passes" passes on a loaded machine, by a fix of its cause.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when: The test is the one named in the title, in `test/roadmap.test.ts`; the name goes in the commit message. It passes on main when the machine is idle, so the cause is load.
- parts: planner, pi (health)
- locks: roadmap-test
- after: none
- files: test/roadmap.test.ts

### L409 Format test holds on load
Result: The release-formats test "the stable build reads this tree's roadmap and store files" passes on a loaded machine.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when: The test is the one named in the title, in `test/release-formats.test.ts`; the name goes in the commit message. It passes on main when the machine is idle, so the cause is load.
- parts: install, pi (health)
- locks: install-test
- after: none
- files: test/release-formats.test.ts

### L411 A quiet task's cause is fixed
Result: A task that goes quiet gets its cause named and fixed, so the same task is not called "no sign of life" again within a day.
- why: the ladder (a reminder, a restart, the next model, the Inbox) treats every quiet task alike and leaves the cause, so the same tasks are called stuck again every 12 to 30 minutes.
- done when: The cause is written in `docs/stalls.md` under no sign of life: from the session log and heartbeat of one task in `decisions.jsonl` (LIN-1096, OMA-258 or OMA-269), what the server saw and what the agent was doing.
- parts: server, rules, pi
- locks: stall-check
- after: none
- files: server/server/live/engine/stalls.ts, server/test/stalls.test.ts, src/stalls.ts, test/stalls.test.ts, pi/extension.ts, docs/stalls.md

### L413 Red-cause tests hold on load
Result: The tests "the red share is counted by first cause" and "a gate, a test and a timeout are each named in the red run" pass under load.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when: The tests are the two named in the Result, in `test/red-causes.test.ts`; both names go in the commit message.
- parts: checks
- locks: red-causes-test
- after: none
- files: test/red-causes.test.ts

### L116 It scales
Result: Ten projects and 1000 tasks keep the loop and Home fast, and no data file grows without bound.
- why: more projects and more tasks must not make the loop or Home slow, and files that only grow fill a disk.
- done when: A test with 10 projects and 1000 tasks keeps the rule loop's tick and `/api/home` under their time limits.
- parts: rules, server
- after: none
- locks: rules, server
