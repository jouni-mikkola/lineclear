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

## Batch 1: the core loop

Twelve steps that make add, build, review, merge and the next step work with nothing stalling, crashing or running
twice. Their files are disjoint and each has `after: none`, so all of them start at once.

### L521 A task has one phase
Result: A task is in exactly one named phase, moves only by listed transitions, and keeps its phase across a restart.
- why: findings 1 to 4, 7, 33, 49, 50: 58 fields and 19 in-memory sets decide the status through 15 ordered ifs, and repair code rebuilds what a restart loses.
- done when: `TaskRec` has a `phase` and 20 or fewer remaining fields that are state (58 today, 16 flags); one `transitions` table lists every move and a test feeds each pair of (phase, event) and sees either the next phase or a refusal; `starting`, `briefing`, `handing` and `cleaning` sets are gone; a test restarts the engine in each phase and sees the same status; one `settle()` with 45 held tasks and 561 stored makes 0 status scans of other tasks (25,000 today).
- locks: none
- after: none
- files: server/server/live/engine/engine-state.ts, server/server/live/engine/status.ts, server/server/live/engine/engine-helpers.ts, server/server/live/engine/phase.ts, server/server/live/restart.ts

### L525 A merge waits on events
Result: A merge waits for a turn, a red main or a queue by awaiting an event, can be cancelled, and is never held by its title.
- why: findings 14, 15, 17, 21, 22, 38 (git half), 39, 45: five sleep loops (one with no limit), a `/proc` scan to guess a hung step, and `/^fix\b/` on a title that opens the red-main gate.
- done when: `grep -n "Bun.sleep" server/server/live/engine/merge.ts server/server/live/engine/lane-watch.ts` lists none (4 today); `machine.ts` and `HeadWatch` are gone; a test plants a step that never ends and sees it aborted at its own timeout with its process group dead; a task titled "Fix typo" is held by a red main; a test holds 10 merges on a red main for 30 simulated minutes and counts 0 `gh` spawns of its own (1 per 10 s each today).
- locks: none
- after: none
- files: server/server/live/engine/merge.ts, server/server/live/engine/lane.ts, server/server/live/engine/lane-watch.ts, server/server/live/engine/machine.ts

### L510 Prompts go in by RPC
Result: A message to a task agent is one RPC prompt that says if it started, was queued or was handled; nothing is typed into a screen.
- why: A1-A11 and C4: eight tuning knobs, a paste watcher and a 1.5 s sleep per delivered item exist because the input is a screen.
- done when: `paste-watch.ts` is deleted; `untilReady`, `submitted`, `typeIntoPane`, `giveUpOnBriefs`, `holdFrom` and `deliveryFailed` are gone from `agents-state.ts` and `agents-delivery.ts`; a brief of 3 items is in the agent in under 1 s (was 4.5 s plus 3 snapshots); a test sends while the agent works and sees `queued`; the 2 s `settle` interval is gone (0 `setInterval` in the three agent files).
- locks: none
- after: none
- files: server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/agents-sending.ts, server/server/live/agents-helpers.ts, server/server/live/paste-watch.ts

### L508 Revival from the exit event
Result: An agent whose process ended is started again from the exit event, with a limit, and a stale one is known by its launch hash.
- why: C6, C7: `pane.process_info` and two sha256 file reads per agent per pass find what an exit event says.
- done when: `paneWrong`, `staleFlag`, `hashOf`, `sameValue` and `logLoop` are gone from `revive.ts` (under 60 lines, 136 today); `wrong()` makes 0 herdr calls for an RPC agent; a test kills an agent's process and sees one restart after the grace and none after 3 in an hour.
- locks: none
- after: none
- files: server/server/live/revive.ts, server/server/live/recovery.ts

### L506 Worktrees without herdr spaces
Result: A task's worktree is made and removed by git alone, and a done task's folder is put away even when herdr is down.
- why: D3, E1-E6: 18 swallowed errors, two ways to remove a folder, a shared JSON file and two guessing timers.
- done when: `worktrees.ts` has 0 empty catches (18 today) and is under 150 lines (332); `repo-spaces.json` is gone; `agentPane`, `idleShells`, `busy` and `closeRepoSpace` are gone; `settleSoon` and the `BRIEF_WAIT` timer are replaced by `agent_settled` and the prompt response; a test ends a task with herdr stopped and the worktree is removed.
- locks: none
- after: none
- files: server/server/live/engine/worktrees.ts, server/server/live/engine/engine-launch.ts

### L561 One tick reads facts once
Result: A tick reads main and the tasks once, never runs the project's tests, and a step never starts twice for want of a second look.
- why: `whyStale` re-reads fetch, main, the task list and two ssh calls per machine before every start and tests one fact twice, `checkHealth` and `proveClosed` run tests on the owner's machine next to the board's own red mark, and `startsWith("lock '")` steers the loop by its own sentence.
- done when: A test with 5 ready steps and 1 other machine counts the spawned commands of one tick and sees 15 or fewer (about 45 today); `grep -n "health\|proveClosed\|whyStale\|startsWith(\"lock" src/tick-project.ts` lists nothing; a test with main marked red by the board sees new starts stop and 0 health commands run; `wc -l src/tick-project.ts` prints 340 or less (468 today).
- locks: none
- after: none
- files: src/tick-project.ts

### L587 One way to run on a machine
Result: One `ssh.ts` builds every SSH command and quotes it, and `runSync`, `tellRunBy` and the 2 s git read cache are gone.
- why: five places build an SSH command line and three copy `quote`; `runSync` freezes the server for the round trip (an estimated 100 ms each, 4.5 s for 45; not measured); `tellRunBy` fires an unchecked ssh on every probe (findings 26-30).
- done when: `grep -rn "Bun.spawnSync" server/server/live/box.ts` prints 0; `grep -rln "sshArgs" src server | wc -l` shows one definition; a test of 45 reads of a file on a fake box blocks the loop for under 50 ms in total.
- locks: none
- after: none
- files: server/server/live/box.ts, src/ssh.ts, server/server/live/install.ts, src/spread.ts

### L600 Questions go to the project chat
Result: A question from a task lands in its project's chat first, and the Dispatcher chat gets it only when the project chat does not answer.
- why: 195 of 201 Inbox items in the measured burst were answerable by the Dispatcher, and 137 closed because the owner wrote to the task.
- done when: `lineclear ask` and `lineclear wait owner` from a task put a card in its project's chat, not the Inbox view; a test asks a question the roadmap answers and sees no owner push.
- locks: none
- after: none
- files: src/asks.ts, src/cards.ts

### L602 The Inbox keeps three kinds
Result: The Inbox has login, outward and choice items only, so a stuck task or a plan never becomes an item.
- why: of 201 items in the measured burst 168 were stuck, 14 plan and 12 step, and 97% of all were answered without the owner.
- done when: `src/inbox.ts` has the kinds `login`, `outward` and `choice`; `KIND_LABEL` and the code of `stuck`, `plan`, `step` and `release` are deleted with their tests; `wc -l` of `src/inbox.ts`, `src/inbox-answer.ts` and `src/notify.ts` is 400 or less in all (561 today).
- locks: none
- after: none
- files: src/inbox.ts, src/inbox-answer.ts, src/notify.ts

### L603 The Dispatcher plans itself
Result: A plan is written by the Dispatcher in its own chat, so no separate planning task starts and Settings has no planner model.
- why: `lineclear plan` starts a task agent only to write steps, which costs a worktree, a start and tokens that the Dispatcher already has in context.
- done when: `lineclear plan <project> "<goal>"` hands the goal to the Dispatcher chat and starts no task; `lineclear plan submit` and the rule checks run unchanged; `templates/plan.md` is read by the Dispatcher, and `models.planner` is gone from settings. A test plans a goal and sees no new task in `lineclear task list`.
- locks: none
- after: none
- files: src/plan.ts, src/plan-brief.ts, src/requests.ts, templates/plan.md, ui/web/roadmap/since.tsx

### L549 Small stores read loud
Result: Machine caches, secrets and push keys are written on change only, read once, and a failed write is an error, not a swallowed catch.
- why: S10, S19: `last.json` hides a full disk, `secrets.read()` parses on every call, and `push.json` is rewritten whole.
- done when: `machines-links.ts` and `machines-helpers.ts` hold 0 empty catches (`grep` prints 0, 2 today); `secrets.read()` parses the file once per change of its mtime (a test counts 1 read for 100 calls); a full disk makes the next write fail with the path named.
- locks: none
- after: none
- files: server/server/live/machines-links.ts, server/server/live/machines-helpers.ts, server/server/live/secrets.ts, server/server/push.ts

### L546 A copy is one file
Result: A store copy is one consistent `VACUUM INTO` file of 3 MB, so a restore returns the store as it was at one moment.
- why: S16, S17: 56 copies take 1,068 MB, and copying files one by one is not a point in time.
- done when: `copyStore` writes one file with `VACUUM INTO` and holds under 5 MB per copy (34 MB today); `restoreCopy` puts one file back; secrets and push keys are not in the copy; the copy error is not swallowed (a test breaks the folder and sees the line in `doctor`).
- locks: none
- after: none
- files: src/store-copies.ts, src/rules.ts

## Open steps from the audits

The open steps of the audits of `docs/audit/` and `docs/roles.md`, in the order stores, engine, agents, loop,
machines, roles. The findings stay in the audit files.

### L541 Tasks are rows, not a whole file
Result: A task's change is one row written, so a status line writes under 2 KB instead of the 678 KB of `tasks.json`.
- why: S1, S13, S14, S15: `save()` rewrites every hot task 10 times in 30 s with 9 agents, about 1.1 MB/s at 45.
- done when: `tasks` rows hold tasks, briefs and retired marks; `cold.ts` (the task part) and `briefs.ts` are deleted; a test with 45 tasks reporting 100 status lines counts 100 row updates and under 200 KB of writes (`wc -c` of the WAL), against 67 MB today; `retire.ts` marks rows in one transaction.
- locks: none
- after: none
- files: server/server/live/engine/engine-state.ts, server/server/live/engine/cold.ts, server/server/live/engine/briefs.ts, server/server/live/engine/retire.ts, server/server/live/engine/engine-tidy.ts, server/server/live/task-ids.ts, src/kept-read.ts, src/doctor-task-ids.ts

### L542 Agents and outbox are rows
Result: A message to an agent and a change of its record write one row each, not the 424 KB of `agents.json` and the 170 KB of `typed.json`.
- why: S2, S3, S20: 15 save sites rewrite 131 agent records, and each delivered message rewrites 200 sent items.
- done when: `agents`, `outbox` and `typed` are tables; `ColdAgents` is deleted; `requested-news.ts` reads the table, not `agents.json`; a test delivers 100 messages and sees under 300 KB written (about 17 MB today).
- locks: none
- after: L541
- files: server/server/live/agents-state.ts, server/server/live/agents-delivery.ts, server/server/live/agents-sending.ts, server/server/live/requested-news.ts

### L543 Chat logs are rows
Result: A card or an answer in a chat is one row inserted, not the whole log of that chat written again.
- why: S4: 421 chat files, each rewritten whole on every post or answer.
- done when: `chatlog` is a table; `saveLog` and the `chatlog/` folder are gone; a test posts 100 cards to one chat and sees under 100 KB written (about 2.5 MB when each rewrite grows to 50 KB).
- locks: none
- after: L541
- files: server/server/live/chats-logs.ts, server/server/live/chats.ts, src/task-detail.ts, src/measure.ts

### L544 Settings and places in the store
Result: Settings, spaces, names and health live in the store, and the migrations of old settings shapes are gone.
- why: S5, S6, S9: three whole files for places, two `settings.json` of the same name, and a migration that runs at every start.
- done when: `settings`, `spaces`, `names` and `health` are tables; `settings-store.ts` is under 120 lines (about 250 today, `wc -l`); `worktrees.ts` no longer reads and writes `spaces.json`; a test sets a value from two processes at once and sees both.
- locks: none
- after: none
- files: server/server/live/settings-store.ts, server/server/live/places.ts, server/server/live/engine/worktrees.ts, server/server/live/source-state.ts, server/server/live/health.ts

### L545 One settings reader
Result: The CLI reads the project settings and models from the store, not from a second `settings.json` and a spawned `lineclear space list`.
- why: S6, S7, S21: `readSetup` parses a file and checks a legacy path on each of 42 calls, and `detectSpace` blocks about 100 ms on a child process.
- done when: `project.ts` has no `spawnSync` and no `setup.json` path (`grep` prints 0); `src/serve.ts` reads the same table; a test counts 0 child processes started by `project add`.
- locks: none
- after: L544
- files: src/project.ts, src/serve.ts, src/wait-service.ts, src/requests.ts

### L547 Decisions in the store
Result: The decisions log is a table with an index on time, written by one statement from the server, the rule loop and every agent's CLI.
- why: S11: four writers append to one 939 KB file, readers parse all of it, and a daily cut moves lines between files.
- done when: `decisions` is a table; `cutDecisionsDaily`, `rotateDecisions`, `readDecisionsSince` file reads and the `lastWritten` dedupe are deleted; `lineclear status` reads one `WHERE time >` query in under 10 ms with 100,000 rows (a test measures it).
- locks: none
- after: none
- files: src/stall-class.ts, src/task-work.ts, src/plan.ts, server/server/live/engine/lane-watch.ts, src/status.ts, src/start-failures.ts, src/home-waits.ts

### L548 Inbox and waits in the store
Result: Inbox items, waits and requests are rows, so the rule loop reads them with one query and a new item needs no retry on a taken number.
- why: S12: `readItems` lists and parses every item file on each of 23 calls, and `addItem` loops on `EEXIST`.
- done when: `inbox`, `waits` and `requests` are tables; `createAtomic` is used by 0 callers and deleted from `pi/atomic.ts` if nothing else uses it; `addItem` has no loop (a test adds 50 items from 5 processes and sees 50 distinct numbers).
- locks: none
- after: none
- files: src/inbox.ts, src/waits.ts, src/requests.ts, src/inbox-answer.ts, pi/atomic.ts

### L522 Turns end by pi's word
Result: A task shows Ready or Needs you the moment pi says its turn is settled, with no wait of 4 to 6 seconds and no resent brief.
- why: findings 5, 8, 9, 10, 31, 33, 42, 44: `settleSoon` (4 s), `ANSWER_GRACE` (6 s) and the 120 s brief timer guess what `agent_settled` and `agent_start` say.
- done when: `grep -n "settleSoon\|ANSWER_GRACE\|BRIEF_WAIT\|briefResent"` in `server/server/live/` lists none; a test sends `agent_settled` and sees the phase change within one tick (4000 ms today); a test sends `agent_settled` with `aborted` and sees no Ready card; a failed `agents.send` for a go leaves the task in a phase with `trouble` set and a card, 0 silent catches in the three files.
- locks: none
- after: L521
- files: pi/extension.ts, server/server/live/engine/engine-launch.ts, server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-tidy.ts, server/server/live/quiet.ts

### L523 Stall checks run on deadlines
Result: A stalled task is named at the minute its wait ran out, and the engine's six timers are one.
- why: findings 11 to 13: three loops over every task each minute, an hourly sweep, and three fixed first-run delays stand in for deadlines and for herdr's first snapshot.
- done when: `engine.ts` has no `setInterval`; the engine holds one timer, for the earliest deadline; a test advances a fake clock to each deadline (stall 20 min, silent 5 min, ready 20 min) and sees one card, none before and none twice; with 561 tasks and 45 working, `checkStalls` makes 0 status calls per minute while nothing is due (about 1,700 today).
- locks: none
- after: L521
- files: server/server/live/engine/stalls.ts, server/server/live/engine/engine.ts, server/server/live/engine/deadlines.ts

### L529 The engine is composed
Result: The engine is a few modules with one job each, and no class inherits from another eight.
- why: finding 48: nine classes in one inheritance line, split by line count, with every member visible to every layer.
- done when: `grep -c "extends Engine" server/server/live/engine/*.ts` prints 0 (8 today); no file of `engine/` is over 400 lines (520 today); the engine's tests pass unchanged on GitHub.
- locks: none
- after: L521, L522, L523, L525
- files: server/server/live/engine/engine.ts, server/server/live/engine/engine-launch.ts, server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-tidy.ts, server/server/live/engine/engine-merge.ts, server/server/live/engine/engine-state.ts

### L502 Start has no retry or timer
Result: A task agent's start is one spawn that succeeds or exits; its log file and route come with it.
- why: B1-B8: an 8-try loop, a 750 ms sleep, three start timers, a perl route binder and five log-scan timers guess at a pane being ready.
- done when: `launch` has no loop and no `setTimeout` (0 timers in the function, 3 today); `follow`, `discoverLog` and `repairRoutes` are gone, and the session file comes from `get_state`; `route.pl --bind` is not spawned for RPC agents; a start of 45 tasks in a test makes 0 herdr snapshots and 0 perl processes.
- locks: none
- after: L510
- files: server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/readers/find.ts

### L503 One module per agent job
Result: Agent records and the outbox are written as rows, not as two files rewritten whole, and the three-file class is split by job.
- why: D1, D2, F1: `agents.json` (424 KB) is rewritten for every launch step and `typed.json` (170 KB) for every delivered item, about 118 MB per 45-start burst (est.).
- done when: A save writes bytes in proportion to the record changed (a test changes one record of 131 and sees under 8 KB written, 424 KB today); `typed.json` and `requested-news-receipts.json` are gone; no file of `agents*.ts` is over 300 lines and no `protected` field is shared across files; `bun run gates` is green.
- locks: none
- after: L502
- files: server/server/live/agents-state.ts, server/server/live/agents-delivery.ts, server/server/live/agents-sending.ts, server/server/live/engine/cold.ts

### L562 The world's reads are exact
Result: Every read of the world is bounded, typed and cached by what changed, and no tool's text output is parsed with a regex.
- why: `run` waits 600 s for every command, `git log` reads all of main every tick, `maxTasks`, `reviewerSetting` and the model list are cut from text, and an unreadable list means "every model is offered".
- done when: `grep -c "HEALTH_TIMEOUT_MS" src/real-world.ts` prints 2 (the constant and the detached merge only; 3 today); a test with a `git` that never answers sees the tick end its read in 10 s or less and note a timeout; a test with refs unchanged between ticks counts 0 `git log` spawns on the second tick (1 per tick today); `grep -n 'machine\.maxTasks\|reviewer\.model' src/real-world.ts` lists nothing; `pi --list-models` runs 0 times in a 20 tick test with a pi RPC double that answers `get_available_models`.
- locks: none
- after: L561
- files: src/world.ts, src/real-world.ts, src/task-read.ts

### L563 Decisions carry a code
Result: A skip is one line when it starts and one when it ends, written from a code, with no text parsing on the way.
- why: every tick rewrites the same skip text and `freshDecisions` removes repeats by replacing numbers; the loop also reads its own sentence to decide what to do.
- done when: `Decision` has a `code` (a union of at most 12) and `freshDecisions` compares codes: `grep -c "replace(/" src/decision-dedupe.ts` prints 0 (1 today); a 100 tick test of one blocked step writes 2 lines (start and end of the skip), the same as today's output; `grep -c 'startsWith("skip:")' src/decision-dedupe.ts` prints 0 (1 today).
- locks: none
- after: L561
- files: src/decision-dedupe.ts, src/rules.ts

### L564 Plans settle on events
Result: A plan applies once, at the moment its project allows it, and `lineclear plan` never reads the whole task list to learn the board is up.
- why: `settlePlans` runs a model and a merge inside the tick before any project's lock, a second path to what `autoApply` already does; `plan.ts` spawns a 123 KB task list as a ping.
- done when: `settlePlans` is deleted and a test with a waiting plan sees the tick make 0 model calls (1 today); `grep -c "serverIsDown\|startsWith(\"Cannot" src/plan.ts` prints 0 (4 today); `mergeTask` spawns 3 git processes or fewer for a 40 commit merge (42 today); `grep -n "Bun.spawnSync" src/plan.ts src/autoplan.ts` lists only calls with a `timeout`.
- locks: none
- after: L563
- files: src/autoplan.ts, src/plan.ts, src/rules.ts

### L567 The dead proof checker is gone
Result: No code reads or writes a proof file nobody makes, and the done-when proof is the reviewer's, named in scope.md.
- why: `proveStep` has no caller outside tests, while `unprovenOf` parses a proof file on every tick and every Home read.
- done when: `git ls-files src/doneproof-run.ts` prints nothing and `git grep -n "unprovenOf\|readProofs\|saveProof\|commandsFor\|testOf" src` lists nothing; `doneItems` lives in `roadmap.ts`; `wc -l` of the deleted files (295 in scope.md) is gone from `bun run gates` knip's list; the GitHub check is green.
- locks: none
- after: L561, L562
- files: src/doneproof.ts, src/doneproof-run.ts, src/task-steps.ts, src/owner-steps.ts, src/task-work.ts, src/roadmap.ts, src/brief.ts, docs/scope.md

### L580 Machine room from the worker
Result: A machine's load, free memory and cores come from its worker's snapshot, with no herdr tab, no regex and no spawned CLI.
- why: `room()` costs up to 29 herdr calls and 5 s per machine per tick and flashes a tab; `readRoom` blocks the loop with 2 process starts of up to 40 s per machine per project (findings 1-4).
- done when: a test with 3 fake workers asserts a tick makes 0 `tab.create` calls and 0 `Bun.spawnSync` calls for the room, and `grep -c "ROOM" server/server/live/herdr-forward.ts` prints 0; the room of a macOS fake machine is read.
- locks: none
- after: none
- files: server/server/live/herdr-forward.ts, src/spread.ts, src/real-world.ts, src/tick-project.ts

### L581 Place by CPU and memory
Result: A task goes to the machine with the most free slots, CPU and memory, and ten starts in one tick never overbook a machine.
- why: placement checks memory only as a 1 GiB floor and reads the room once per tick, so 10 starts see the same room (findings 7).
- done when: a test with machines of 10, 12 and 25 slots, 8 GiB free on the first, and 45 ready steps starts at most `floor((free - reserve) / per-agent)` on each; no machine passes its slots or memory in the test; `mostRoom` has 0 callers that do not subtract placed tasks.
- locks: none
- after: L580
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

### L585 The link is one socket
Result: Each worker has one WebSocket and no 5 s snapshot poll, no file poll for its port, and no restart timer.
- why: `pollAll` fetches the full snapshot 12 times a minute per machine beside an open WebSocket, `look` reads a file every 300 ms for up to 60 s, and `WorkerHealth` restarts after 3 minutes instead of reconnecting (findings 16, 18, 19, 23).
- done when: a test with a fake worker counts 1 snapshot fetch in 60 s of idle (12 today per machine); `grep -c "setInterval" server/server/live/machines*.ts server/server/live/link-poll.ts` prints 0 apart from the sync timer; a killed link is back within 5 s in a test.
- locks: none
- after: none
- files: server/server/live/machines.ts, server/server/live/machines-links.ts, server/server/live/link-poll.ts, server/server/live/recovery.ts

### L586 Workers hold no state
Result: A worker is an executor with no store, no rule loop and no `last.json`; the main server reads its state from the worker when it connects.
- why: `keep` rewrites each machine's whole chat set every 5 s, `kept.ts` migrates it on every start, and each worker is a full second server (findings 14, 15, 34).
- done when: `server/server/live/kept.ts` no longer exists; a restart of the main server shows each machine's chats after the first worker snapshot with 0 files under `machines/`; the worker's resident memory is at most 150 MB in a measured run of `bun scripts/core-baseline.ts` (record the value in `docs/numbers.md`).
- locks: none
- after: L582, L585
- files: server/server/live/kept.ts, server/server/live/machines-links.ts, server/server/main.ts, server/server/live/worker-process.ts

### L588 Workers start without scraping
Result: A worker prints its address when it serves, a stopped one is awaited as a child process, and one is adopted only when its token matches.
- why: `setInterval(300)` waits for a port file, `running()` polls `kill(pid, 0)` every 2 s forever, and `commandOf` matches `ps` output (findings 18, 20-22).
- done when: `grep -c "setInterval" server/server/live/worker-process.ts` prints 0; a test starts a worker and sees its address with no file read; a reused pid is not adopted.
- locks: none
- after: L585
- files: server/server/live/worker-process.ts, server/server/live/machines-links.ts, server/server/main.ts

### L589 The tunnel has no heartbeat
Result: The tunnel has no `sleep 10` on the machine, no `rm -f` first and no `chown`; the worker connects out and agents use a local socket.
- why: each machine runs a shell poll every 10 s only to keep a forward alive (finding 33).
- done when: `grep -c "sleep" server/server/live/tunnel.ts` prints 0; a test kills the link and the agents' `lineclear` on the fake machine reaches the main server again within 5 s.
- locks: none
- after: L586
- files: server/server/live/tunnel.ts, helper/lineclear

### L590 The helper goes in atomically
Result: The helper is extracted into a folder named by its version and switched by one symlink; the probe returns JSON from a script on the machine.
- why: `rm -rf bin skill; tar xf` leaves a window with no `lineclear` for an agent starting; `PROBE` scrapes `key=value` lines and a login shell's PATH with sed and a regex (findings 31, 32).
- done when: a test starts 50 `lineclear` calls while the helper updates and sees 0 failures; `grep -c "match(" server/server/live/install.ts` prints 0.
- locks: none
- after: L587
- files: server/server/live/install.ts, helper/lineclear

### L591 Updates drain a machine
Result: The plane has one version; a worker is updated only when it has no working task, one machine at a time.
- why: every machine updates in the same minute on the 15 s sync, with no check for work in flight beyond `MERGE_DEADLINE` (finding 38); `sync()` also runs 8 herdr process starts a minute and treats a failed read as an empty list (finding 17).
- done when: a test with 3 machines, one with a working task, sees the busy one updated last and never two updating at once; `herdr machine list` is started at most once per start and once per change in a 10-minute run; a failed read keeps every worker.
- locks: none
- after: L585
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
- after: L603, L602
- files: src/autoplan.ts, src/dispatcher.ts

### L605 The Inbox view is gone
Result: The web UI has no Inbox page: `/inbox` and `/inbox/<ask>` land on the Dispatcher chat with the card.
- why: 3% of the items need the owner, and the chat shows those cards.
- done when: `ui/web/inbox-strip.tsx` and `ui/kit/inbox-card.tsx` no longer hold a view; `View` in `ui/web/routes.ts` has no `inbox`; an old `/inbox/7` link opens `/chat` on that card; `bun run ui:test` has no Inbox page screenshot.
- locks: none
- after: L602
- files: ui/web/routes.ts, ui/web/app.tsx, ui/web/inbox-strip.tsx, ui/kit/inbox-card.tsx

### L606 Home shows one Needs you line
Result: Home shows a single "Needs you" line when a login, money, an outward action or a product choice waits, and nothing when none does.
- why: the ask strip of 345 lines was built for 201 items in 7 hours; the owner's need is 1 or 2 a day.
- done when: `ui/web/home.tsx` shows the line with a link to the chat card; `wc -l ui/web/inbox-strip.tsx` is 120 or less or the file is deleted; the screenshot at 1440 and 390 px has the line, the empty state and 3 items.
- locks: none
- after: L605
- files: ui/web/home.tsx, ui/web/home-table.tsx, ui/web/home-rows.ts

### L608 Watch and backup are loop jobs
Result: The night watch is one message the rule loop sends only on a stall, and the hourly store copy is a plain rule-loop job.
- why: the rule loop already finds a stalled task and an unstarted step, so a model checklist every 2 hours at night costs tokens for what a program knows.
- done when: `src/night-watch.ts` is deleted or under 30 lines; a night tick with nothing stalled sends nothing; a test stalls a task at night and sees one Dispatcher message. `src/store-copies.ts` stays and is called from `rules.ts` only.
- locks: none
- after: none
- files: src/night-watch.ts, src/rules.ts, src/store-copies.ts

### L609 Swarm against one agent
Result: A table shows merged steps per hour and tokens per merged step on the devbox, swarm against one agent, and names roles that cost too much.
- why: parallel work is worth keeping only if it merges more steps an hour for no more tokens each; no number says so today.
- done when: a doc in `docs/numbers.md` has two runs on the devbox on the same 10 steps with disjoint files: the swarm as it runs and one pi agent in a row with the same model and review setting; each run lists merged steps per hour and tokens per merged step summed over every role, and says whether the swarm merges at least 2 times as many steps an hour for no more tokens
each (R18 of `release.md`); then the swarm run repeated with the coordinator, the night watch and the Inbox off one at a time. Each role whose run costs more tokens or time per merged step than it saves gets a step that deletes it.
- locks: none
- after: L603, L608
- files: docs/numbers.md, src/measure.ts

## Open steps for the web

Steps W1 to W22 from [web-audit.md](web-audit.md), listed after the core steps. They hold the same `file-` locks.

### W11 A missing page says so
Result: A roadmap, task or view that cannot load shows its state inside the frame with a way back, never a black screen or another page.
- why: F27, F29: a 404 roadmap is blank, `/browsers` draws Home, and the not-found task marks Inbox.
- done when: `/<project>/roadmap` for an unknown project, a failed API call and `/browsers` with no session each show a named state in the frame at 1440 and 390 px; the not-found page marks no view as current; a test covers each.
- locks: none
- after: none
- files: ui/web/app.tsx, ui/web/routes.ts, ui/web/frame.tsx, ui/test/errors.pw.ts

### W12 The line never cuts a project
Result: Home's line shows every project whole, however many there are.
- why: F23: the fifth project's track is cut in half at the region's edge.
- done when: With `?state=many` and `?state=tasks200` no track is cut by its region at 1440 and 390 px; a region that scrolls has a visible edge; screenshots at both widths.
- locks: none
- after: none
- files: ui/web/home.tsx, ui/kit, ui/test/home-line.pw.ts

### W13 The table says what it cuts
Result: A cut value in the table can be read in full, and Time is how long the task has run.
- why: F25: ellipsised state, model and last line with no way to read them; "7 days" for a running task.
- done when: Each cut cell has the full text in its title and in the row's detail; Time is the run time of the task; a test with a 200-character `Last` reads it in full.
- locks: none
- after: none
- files: ui/web/home-table.tsx, ui/web/home-rows.ts, ui/test/home.pw.ts

### W14 The table head sorts
Result: At 390 px the table head is a labelled sort control and the first row of what needs me is above the fold.
- why: F26: three unlabelled grey boxes and a table 900 px down.
- done when: The head says "Sort by" with the current key; with `?state=many` at 390 px the first table row starts above 700 px; screenshot at 390 px.
- locks: none
- after: W12, W13
- files: ui/web/home-table.tsx, ui/web/home.tsx, ui/test/home.pw.ts

### W15 The chat folds repeats
Result: The Dispatcher panel shows one line with a count for a repeated notice and stays fast at 200 messages.
- why: F24: the same sentence six times on a fresh install, and every message drawn at 200.
- done when: Six equal notices in a row show as one with "x6"; 200 messages draw at most 40 nodes and scroll to the newest; a test on an empty config fails on repeats.
- locks: none
- after: none
- files: ui/web/chat.tsx, ui/web/chat-view.tsx, ui/web/chat-samples.ts, ui/test/chat-panel.pw.ts

### W16 The task page header
Result: A task page opens on one header with title, state, step and model, with the tabs on the content edge.
- why: F28: only tabs and chat show, and the tabs sit 12 px off the column.
- done when: The header shows the four facts at 1440 and 390 px; the tabs share the chat column's left edge; screenshots at both widths and with a 200-character title.
- locks: none
- after: none
- files: ui/web/task.tsx, ui/web/task-live.tsx, ui/test/task.pw.ts

### W17 The task tabs draw every state
Result: Terminal and Changes each have a drawn loading, empty, error and long state.
- why: F35: only Chat and Changes are sampled, and only filled.
- done when: A sample per tab and state exists (`?state=` on the task page); each is shot at 1440 and 390 px; none shows raw error text.
- locks: none
- after: none
- files: ui/web/task-changes.tsx, ui/web/samples.ts, ui/web/lazy-samples.ts, ui/test/demo-states.pw.ts

### W18 The Inbox lists the asks
Result: The Inbox view lists every ask, windowed at 200, with the real count.
- why: F30: one card and a link for 199 asks, and a "99+" count.
- done when: `/inbox?state=many` shows a list with the newest first and at most 40 nodes drawn; the count in the rail and bar shows the number up to 999; screenshots at both widths.
- locks: none
- after: W11
- files: ui/web/inbox-strip.tsx, ui/web/frame.tsx, ui/test/home-inbox.pw.ts

### W19 Settings draws every state
Result: Each Settings tab shows named loading, empty and error states, and the notify link is a row inside a tab.
- why: F31: a ghost bar that never resolves, and a bare link under the card.
- done when: Each tab has a shot of each state at 1440 and 390 px; the notify link is in the Secrets tab; no ghost bar stays after the data loaded.
- locks: none
- after: none
- files: ui/web/settings.tsx, ui/web/settings-models.tsx, ui/web/settings-account.ts, ui/test/settings.pw.ts

### W20 Usage sits in the frame
Result: Usage shows inside the frame, without a focus ring on load, and says so when there is no use.
- why: F32: no rail or bar, an orange ring on Close, and "$0.00" over an empty chart.
- done when: `/usage` shows the rail at 1440 and the bar at 390 px; no element has focus on load; zero use shows one sentence; screenshots at both widths.
- locks: none
- after: none
- files: ui/web/usage-sheet.tsx, ui/web/usage-mark.tsx, ui/test/usage-inbox.pw.ts

### W21 The roadmap opens short
Result: The roadmap opens on a short status and at most a few steps, not a run-on sentence and repeated card text.
- why: F33: a 200-character status and "A customer can X and it just works." on every card.
- done when: The status is under 80 characters with the reason in Details; a card shows its result only when it differs from its title; screenshots at 1440 and 390 px.
- locks: none
- after: none
- files: ui/web/roadmap, ui/test/roadmap.pw.ts

### W22 State changes have named motion
Result: Route changes, tab switches, list additions and the Dispatcher panel each play a named motion from the kit, and none under reduced motion.
- why: F34: only the kit handles reduced motion, and the web pages have almost no motion.
- done when: Each of the four has a motion id in `ui/kit/motion.ts`; a test with `prefers-reduced-motion: reduce` sees none play; a performance trace of each stays at 60 fps and a recording of each is stored.
- locks: none
- after: W11, W16, W18
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
