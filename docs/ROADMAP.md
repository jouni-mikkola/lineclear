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

## The line target

The goal: at most 40,000 lines of non-test code, from 47,311 (the count and the reasoning are in [scope.md](scope.md)
under "The line target"). Each step cuts named files, deletes the tests of what it deletes, and loses no feature. Every
step has `after: none`, its own lock and its own files, so all of them run at once. A step's line count is `wc -l` of
its files on the commit that merges it.

### L470 Sample data leaves the bundle
Result: The pages ship no sample data; the `?state=` pictures read their samples from the UI test folder.
- why: 1222 lines of sample data (`samples.ts` and six more) ship in every page bundle but only `?state=` and the tests draw them.
- done when: The seven `*samples.ts` files of `ui/web/` are under `ui/test/`; `?state=` still draws every state in `bun run ui:test`; `wc -l` of the non-test files of `ui/web/` prints 2800 or less (4033 today).
- locks: web-samples
- after: none
- files: ui/web/samples.ts, ui/web/real-samples.ts, ui/web/roadmap-samples.ts, ui/web/chat-samples.ts, ui/web/settings-samples.ts, ui/web/browser-samples.ts, ui/web/lazy-samples.ts, ui/web/data.ts, ui/web/chat.tsx, ui/web/home-table.tsx, ui/web/browsers.tsx, ui/web/setup.tsx

### L471 Reactions gone
Result: A task's chat has no emoji reactions; replies still quote the message they answer.
- why: area D3 of scope.md: no page of `ui/web/` offers a reaction, yet 18 lines of `chatlines.ts` and a kit part still parse and draw one.
- done when: `ui/kit/task-chat.tsx` is deleted; `chatlines.ts` is 90 lines or less (255 today) and `chats-replies.ts` 170 or less (264); `Reaction` is gone from the types; `git grep -il reaction` lists no non-test file.
- locks: chat-reactions
- after: none
- files: server/server/live/chatlines.ts, server/server/live/chats-replies.ts, server/shared/types-chat.ts, ui/kit/task-chat.tsx

### L472 Only pi's log is read
Result: The server reads the logs and start prompts of pi alone; the code and samples of other agent CLIs are gone.
- why: area D2 of scope.md: pi runs every agent, but `readers/find.ts` and `trust.ts` still know how Claude and Codex write logs and ask for trust.
- done when: `wc -l` of `server/server/live/readers/`, `trust.ts`, `streaming.ts` and `runtime.ts` prints 300 or less in all (541 today); `server/test/samples/` and `server/test/fixtures/startup/` hold no claude or codex file; `git grep -il codex` lists no non-test file.
- locks: pi-only
- after: none
- files: server/server/live/readers/, server/server/live/trust.ts, server/server/live/streaming.ts, server/server/live/runtime.ts

### L473 One chat log reader
Result: The Dispatcher's chat and a task's chat read their log through one path, so a chat bug is fixed once.
- why: `chats-helpers.ts` and `chats-logs.ts` (662 lines) are the biggest files of the two chat paths; the step merges what they share.
- done when: `wc -l` of `chats-helpers.ts`, `chats-logs.ts` and `chats.ts` prints 420 or less in all (672 today); the server's chat tests pass on GitHub with no test deleted that still tests a live feature.
- locks: chat-log
- after: none
- files: server/server/live/chats-helpers.ts, server/server/live/chats-logs.ts, server/server/live/chats.ts

### L474 The board command is one table
Result: Each `lineclear` word of the board is one row of a table, not a case in three files.
- why: `source-cli.ts`, `source-subcommands.ts` and `source-helpers.ts` (779 lines) hold the board command's words; the step puts each word in one table row.
- done when: `wc -l` of those three files prints 520 or less in all; `lineclear --help` prints the same words as before; the server's CLI tests pass on GitHub.
- locks: board-words
- after: none
- files: server/server/live/source-cli.ts, server/server/live/source-subcommands.ts, server/server/live/source-helpers.ts

### L475 One git helper
Result: Every git call of the rule loop and the server goes through one helper; the copies are gone.
- why: `src/git.ts` is called the one git helper, yet `engine/git.ts` (407 lines) and `engine/worktrees.ts` (328) hold more git code; the step moves what repeats into the helper.
- done when: `wc -l` of `engine/git.ts`, `engine/worktrees.ts`, `src/git.ts`, `src/main-branch.ts` and `src/worktree.ts` prints 560 or less in all (851 today); `git grep -n "spawnSync('git'"` lists one non-test file.
- locks: git-helper
- after: none
- files: server/server/live/engine/git.ts, server/server/live/engine/worktrees.ts, src/git.ts, src/main-branch.ts, src/worktree.ts

### L476 One project settings reader
Result: A project's settings are read by one function, so the Roadmap, Home and Settings never disagree.
- why: `projectSettings` is written twice (`web-settings.ts`, `roadmap-view.ts`) and `project.ts` is the biggest file of the CLI (579 lines).
- done when: `git grep -c "function projectSettings"` over non-test files prints 1; `wc -l` of `project.ts`, `web-settings.ts`, `roadmap-view.ts` and `add-project.ts` prints 760 or less in all (1057 today).
- locks: project-settings
- after: none
- files: src/project.ts, src/web-settings.ts, src/roadmap-view.ts, src/add-project.ts

### L477 One line picture
Result: Home and the Roadmap draw the line of steps with the same parts, and the picture keeps its motion.
- why: the kit's line (`line.tsx`, `line-parts.tsx`, `line-glide.tsx`, `line-motion.tsx`) and the Roadmap's `line.tsx` are 1387 lines for one picture; the step merges the parts that draw a station twice.
- done when: `wc -l` of those five files prints 900 or less in all; `bun run ui:test` still passes its motion and screenshot cases at 1440 and 390 px on GitHub.
- locks: line-picture
- after: none
- files: ui/kit/line.tsx, ui/kit/line-parts.tsx, ui/kit/line-glide.tsx, ui/kit/line-motion.tsx, ui/web/roadmap/line.tsx

### L478 One list of browsers
Result: The agents' browsers are listed and drawn from one shape of data, in less code.
- why: area D4 of scope.md left `src/browsers.ts` (354 lines) and the kit's `browsers.tsx` (388) are 742 lines for one list.
- done when: `wc -l` of those two files prints 500 or less in all (742 today); the browser view and `lineclear` browser tests pass on GitHub.
- locks: browser-list
- after: none
- files: src/browsers.ts, ui/kit/browsers.tsx

### L479 Machine links in less code
Result: Machines and their links work as before from a third less code, with one retry path.
- why: `machines-links.ts` (502 lines), `machines-helpers.ts`, `mfs.ts`, `herdr-forward.ts` and `recovery.ts` are 1050 lines; `recovery.ts` retries a link and `machines-links.ts` keeps its state.
- done when: `wc -l` of `machines*.ts`, `mfs.ts`, `herdr-forward.ts` and `recovery.ts` in `server/server/live/` prints 720 or less in all (1050 today); the server's machine tests pass on GitHub.
- locks: machine-links
- after: none
- files: server/server/live/machines-links.ts, server/server/live/machines-helpers.ts, server/server/live/machines-actions.ts, server/server/live/machines.ts, server/server/live/mfs.ts, server/server/live/herdr-forward.ts, server/server/live/recovery.ts

### L480 Release tools in one place
Result: The update reads old store files through one script, and the release scripts share their helpers.
- why: `scripts/formats.ts` and `server/scripts/store-formats.ts` both list old store formats; the other scripts are small files a step can merge.
- done when: `scripts/formats.ts` is deleted; `wc -l` of `store-formats.ts`, `changed.ts`, `fast-gates.ts`, `ui-changed.ts`, `fake-sessions.ts`, `release-tag.ts` and `release-notes.ts` prints 330 or less in all (504 today with `formats.ts`); `bun scripts/smoke.ts` still passes.
- locks: release-tools
- after: none
- files: scripts/formats.ts, server/scripts/store-formats.ts, scripts/changed.ts, scripts/fast-gates.ts, scripts/ui-changed.ts, scripts/fake-sessions.ts, scripts/release-tag.ts, scripts/release-notes.ts

### L481 Docs nobody reads are gone
Result: The docs folder holds only pages that code, a check or another page uses.
- why: `fit-audit.md`, `web-audit.md` and `rivals.md` (241 lines) are linked from no file, and `fit-audit.md` lists deletes that are already done.
- done when: those three files are deleted; `git grep` finds no link to them; `wc -l docs/*.md` prints 1780 or less in all (2025 today).
- locks: docs-cut
- after: none
- files: docs/fit-audit.md, docs/web-audit.md, docs/rivals.md

### L482 The knip config fits the repo
Result: `bun run gates` prints no configuration hint, so a real dead-code finding is not buried.
- why: knip prints 9 configuration hints today (a stale ignore, entry patterns that match nothing), so people stop reading its output.
- done when: `bunx knip` prints no "Configuration hints" block and no finding; `wc -l knip.jsonc` prints 20 or less (24 today).
- locks: knip-config
- after: none
- files: knip.jsonc

### L483 The engine's state in one place
Result: A task's state and handoff are kept by one module, not three that copy each other's fields.
- why: `engine-handoff.ts` (520 lines), `engine-state.ts` (491) and `engine-tidy.ts` (281) are the biggest files of the engine's state.
- done when: `wc -l` of those three files prints 900 or less in all (1292 today); the server's engine tests pass on GitHub.
- locks: engine-state
- after: none
- files: server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-state.ts, server/server/live/engine/engine-tidy.ts

### L484 Home reads once
Result: Home's data comes from one read per tick, not one per widget.
- why: `home-data.ts`, `home-waits.ts`, `kept-read.ts` and `progress.ts` (935 lines) are Home's data.
- done when: `wc -l` of those four files prints 650 or less in all; `lineclear top` and the Home tests pass on GitHub.
- locks: home-read
- after: none
- files: src/home-data.ts, src/home-waits.ts, src/kept-read.ts, src/progress.ts

### L485 The Inbox's answers in one path
Result: A card, a push and an answer share one path, so a new kind of ask needs one change.
- why: `asks.ts` (436 lines), `inbox-answer.ts`, `cards.ts` and `notify.ts` turn an ask into a card, a push and an answer.
- done when: `wc -l` of those four files prints 500 or less in all (726 today); the Inbox and asks tests pass on GitHub.
- locks: inbox-path
- after: none
- files: src/asks.ts, src/inbox-answer.ts, src/cards.ts, src/notify.ts

### L486 Recount and the next cuts
Result: scope.md shows the line count after the cuts, and ROADMAP.md holds the steps for the rest of the way to 40,000.
- why: the cuts above reach about 41,000 with L95; the last 1,000 lines cannot be named until the others are gone.
- done when: `wc -l` by the rule of scope.md prints 41,500 or less on main and scope.md shows it; if it prints more than 40,000, at least 3 new steps with disjoint locks name the next cuts.
- locks: recount
- after: L470, L471, L472, L473, L474, L475, L476, L477, L478, L479, L480, L481, L482, L483, L484, L485, L496, L497
- files: docs/scope.md, docs/ROADMAP.md

### L487 One server, one task store
Result: One board server runs per machine and writes one task store, so a task is never in two lists.
- why: the owner measured two `server/main.ts` processes and two task stores still running on one machine after L439.
- done when: after a restart, `pgrep -fc server/main.ts` prints 1 (2 today) and the data folder holds one task store (2 today); a test starts a second server on the same store and sees it exit with a line that names the first one's pid.
- locks: one-server
- after: none
- files: server/server/main.ts, server/server/lock.ts, server/server/store.ts, src/board.ts, src/serve.ts

### L488 The coordinator reads less
Result: A coordinator session spends at most 1 M new input tokens at p90 because the pi extension compacts it at a set size.
- why: the owner measured 12.7 M new input tokens (p90) per coordinator session; L458 sets the harness side, this step the extension's compaction.
- done when: `bun scripts/core-baseline.ts chat-tokens 20` over 20 new coordinator sessions prints a p90 of 1000 k or less (12.7 M today); a test ends a session past the set size and sees `compact-chats.ts` compact it once.
- locks: coordinator-tokens
- after: none
- files: pi/compact-chats.ts, pi/fresh-dispatcher.ts, pi/config.ts

### L489 Agent cache reads shrink
Result: A task agent's cache reads stay at 3 M tokens or less at p90, so a task costs a quarter of today's reads.
- why: the owner measured 11 M cache reads (p90) per task agent; long tool output and repeated reads are re-sent on every turn.
- done when: `bun scripts/core-baseline.ts tokens 20` over 20 new tasks prints cache reads of 3 M or less at p90 (11 M today); a test feeds a 200-line tool result and sees it cut before the next turn.
- locks: agent-cache
- after: none
- files: pi/extension.ts, pi/heavy-tool.ts, pi/nudge.ts

### L490 Agents run no tsc
Result: A task agent's checks start no tsc process in its worktree; types are checked on GitHub.
- why: the owner measured agents running `tsc` in their worktrees: 307 MB each and 2 cores for each of 45 agents.
- done when: `lineclear check --changed` in a worktree starts 0 tsc processes (a test lists the spawned commands) and adds 20 MB or less under `node_modules/.cache` (307 MB today); the GitHub `check` still runs `tsc`.
- locks: no-local-tsc
- after: none
- files: scripts/check.ts, package.json, tsconfig.json

### L491 Worktrees and store stay small
Result: Retired tasks lose their worktrees, and the data folder holds nothing of deleted features.
- why: the owner measured 79 worktrees at 8.4 GB and 4.3 GB in `~/.lineclear`, of which `autopilot-runtime` is 2.9 GB for a deleted feature.
- done when: after one tick on that machine, worktrees of retired tasks are gone and `du -sm` of the worktrees prints 3000 or less (8.4 GB today) and of `~/.lineclear` 1000 or less (4.3 GB); `autopilot-runtime` is deleted by the update; a test plants a retired task and an old folder and sees both removed, and a live task's worktree kept.
- locks: disk-use
- after: none
- files: server/server/live/engine/retire.ts, src/tmpdirs.ts, src/store-copies.ts

### L492 A reaper for test servers
Result: A UI test server or browser left from an earlier run ends by itself within 10 minutes.
- why: the owner found UI test servers from the day before still running, each holding a port and memory.
- done when: `pgrep -fc fake-lineclear-server` prints 0 ten minutes after a run is killed (a leftover of yesterday today); a test starts a server, kills its parent and sees the reaper end it, and a server of a live run kept.
- locks: reaper
- after: none
- files: src/process-group.ts, src/reaper.ts, ui/test/fake-lineclear-server.ts

### L493 A step is claimed once
Result: Two machines never start the same step: the board claims it once before any machine starts it.
- why: two tasks did the same step twice (L455, L443); L461 stops it on one machine, not across machines.
- done when: a test starts one step from 2 machines at the same instant and sees 1 task and 1 refusal that names the first; over 20 simulated races 0 steps start twice (L455 and L443 each started twice).
- locks: step-claim
- after: L461, L487
- files: server/server/live/task-ids.ts, server/server/live/source-actions.ts

### L494 The engine lands a ready task
Result: A task at Ready to merge is merged by the engine, which rebases on a conflict itself, with no one pressing merge.
- why: the owner's merges stop at Ready to merge and wait for a person or an agent.
- done when: a test with a green task sees it merged within 2 simulated minutes, and with a conflicting one sees a rebase and then a merge; a conflict the rebase cannot settle opens one card; 0 tasks wait at Ready to merge over a day with green checks.
- locks: auto-land
- after: L453, L464, L483
- files: server/server/live/engine/lane.ts, server/server/live/engine/merge.ts, server/server/live/engine/github.ts

### L495 Doctor catches lost models
Result: `lineclear doctor` names a machine whose role has no model, so a bad settings migration is seen in one run.
- why: a settings migration dropped the models on two machines and nothing said so until starts failed.
- done when: `lineclear doctor` prints one line per role with no model and exits non-zero (0 lines today for a machine with none); a test migrates a settings file that loses its models and sees the line, and a full file sees none.
- locks: doctor-models
- after: L463
- files: src/doctor-settings.ts, src/doctor.ts, server/server/live/settings-store.ts

### L496 The plan check fits any project
Result: The planner's chain check counts to the last step of any roadmap, and the module is smaller.
- why: `src/autoplan.ts` (304 lines) counts every chain to a step named `U43`, which only this repo has; it still serves the Plan job of idea.md (applying and undoing plans).
- done when: `git grep -n '"U43"' src` lists nothing; `wc -l src/autoplan.ts` prints 230 or less; a test plans a roadmap with another last step and sees its chain counted.
- locks: autoplan
- after: none
- files: src/autoplan.ts

### L497 One world module
Result: The rule loop reads its world through one module, not an interface file and a second file that fills it.
- why: `world.ts` (75 lines) names what a tick needs and `real-world.ts` (239) is its only filler, used by `rules.ts` alone.
- done when: `real-world.ts` is deleted; `wc -l src/world.ts` prints 250 or less; the rule loop's tests pass on GitHub with the same fake world.
- locks: world
- after: none
- files: src/world.ts, src/real-world.ts

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
- why: from add to first tool call takes 22 s (median) and 131 s (p90) today, and 22 of 194 tasks needed their brief sent again.
- done when: `bun scripts/core-baseline.ts start 20` prints a median of 10 s or less and a p90 of 30 s or less over 20 new tasks; no task of those 20 needed its brief sent again. Baseline today: median 22 s, p90 131 s.
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
Result: A commit that turns main red is reverted within 10 minutes and gets a fix task, and no run on main is cancelled.
- why: of the last 50 runs on main 16 failed and 13 were cancelled (before `check.yml` stopped cancelling runs on main), and no rule yet reverts a red main.
- done when: `gh run list --workflow check.yml --branch main --limit 20 --json conclusion` lists 0 `cancelled` over 20 runs after the step's merge; a test plants a red main and sees a revert commit and a fix task within 10 simulated minutes. Baseline today: 16 failed and 13 cancelled of the last 50 runs.
- locks: main-green
- after: none
- files: .github/workflows/check.yml, server/server/live/engine/lane.ts, server/server/live/engine/lane-watch.ts

### L454 Stable follows green main only
Result: `bun scripts/promote.ts <commit>` installs a commit as stable only when its GitHub `check` is green on main, and prints the commit.
- why: the machines run the stable install, and a promotion of a red or unchecked commit puts every machine on a bug.
- done when: a test runs `scripts/promote.ts` on a red, a pending and a green commit and sees refuse, refuse, install; `bun scripts/canary.ts` still passes on the installed commit. Baseline today: no command checks the commit's `check` run before an install.
- locks: promotion
- after: none
- files: scripts/promote.ts, scripts/canary.ts, install.sh

### L455 GitHub check in 45 seconds
Result: The whole `check.yml` run on main finishes in 45 s or less, median, and 60 s at p90.
- why: merge waits for the check, which takes 73 s (median) and 92 s (p90) today, in 8 shards; the slowest shard of the last runs took 203 s.
- done when: `bun scripts/core-baseline.ts gh 20` prints a run median of 45 s or less and a p90 of 60 s or less over 20 runs on main. Baseline today: median 73 s, p90 92 s.
- locks: check-ci
- after: none
- files: scripts/check-speed.ts, scripts/load-map.ts, test/check-speed.test.ts

### L456 Every stall is real and named
Result: A lock wait raises no stall line, and every other stall line names a class other than `unknown`, with a remedy that clears it.
- why: of 1559 `stall <class>` lines in `decisions.jsonl`, `lock-held` is 552 (a wait the rule loop handles by design) and `unknown` is 545, so the loop restarts what it cannot name.
- done when: `bun scripts/core-baseline.ts stalls` prints, for a day of `decisions.jsonl` after the merge, 0 lines of `lock-held` and of `unknown` and at most 2 stall lines per hour; a test feeds each class of `STALL_CLASSES` and sees its one remedy and, for a lock wait, `lineclear roadmap locks` still listing the wait. Baseline today: 15.5 stall-kind lines per hour.
- locks: stall-classes
- after: none
- files: src/stall-class.ts, src/waits.ts, src/heal.ts, src/health.ts

### L457 Agents read less
Result: A task agent spends at most 40 k new input tokens at the median and 150 k at p90, with its prompt and skills trimmed to match.
- why: a task agent spends 79 k new input tokens (median) and 280 k (p90), and 1303 k cache reads (p90 11.1 M).
- done when: `bun scripts/core-baseline.ts tokens 20` over 20 new tasks prints agent new input of 40 k or less (median) and 150 k or less (p90); `wc -c server/server/live/prompts.ts` prints at most 9400 bytes (70 % of 13418 today).
- locks: agent-prompt
- after: none
- files: server/server/live/prompts.ts, server/skill/lineclear-agent/SKILL.md, src/brief.ts

### L458 Chats compact before they grow
Result: The coordinator and the Dispatcher compact at a set size, so a session never passes 1 M new input tokens.
- why: a coordinator session reaches 12.7 M new input tokens (p90) and a Dispatcher session 2.8 M, against 227 k and 38 k at the median.
- done when: `bun scripts/core-baseline.ts chat-tokens 20` over 20 new sessions prints a p90 of new input of 1000 k or less for the coordinator and 500 k or less for the Dispatcher; `bun test test/dispatcher-chat.test.ts` has a case that ends a long session and sees a compaction.
- locks: chat-context
- after: none
- files: src/harness-pi.ts, src/dispatcher.ts, src/chat.ts

### L459 Failed starts per machine
Result: `lineclear doctor` lists each machine's failed starts of the last 24 hours with their cause.
- why: the board keeps no failed-start record per machine, so a machine that fails starts looks the same as one that does not.
- done when: `lineclear doctor` prints one line per machine with its failed-start count and causes (brief unsent 32 and machine unreachable 4 lines per week today are the baseline); a test fails a start on one of two machines and sees only that machine's line change.
- locks: start-record
- after: none
- files: src/doctor.ts, src/home-doctor.ts, src/measure.ts

### L460 45 agents work at once
Result: With 45 ready steps on disjoint locks, 45 agents are working within 5 minutes across machines of 10, 12 and 25 slots.
- why: one machine ran 2 tasks at the baseline and the rule loop wrote 6 `no-room` stall lines in a week, so the slots are not yet shown to fill.
- done when: a test with 3 fake machines of 10, 12 and 25 slots and 45 ready steps starts 45 within 5 simulated minutes and never more than a machine's slots; `lineclear roadmap locks . --space <name>` on this file lists every step of this section as startable together.
- locks: slots
- after: none
- files: src/rules.ts, src/tick-project.ts

### L461 One agent per step
Result: A step never has two agents working at once, and a step already landed starts no agent.
- why: six tasks started for one step with five working at once, and six others ended in 0.4 minutes with nothing to merge; each duplicate holds a slot and starts an agent that reads the brief and the repo.
- done when: `lineclear task list` after the merge shows at most 1 working task per step id over 20 new tasks, and 0 tasks that end with "Nothing to merge" in under 1 minute; a test adds the same step twice and sees one start and one refusal, and adds a landed step and sees no start. Baseline today: 5 working agents on L436 and 6 empty tasks of 22.
- locks: one-start
- after: none
- files: src/task-steps.ts, src/starts.ts, src/resolve.ts

### L462 The start has no fixed wait
Result: A task's agent makes its first tool call at most 10 s after `lineclear task add`, median, with the wait named.
- why: L451 met p90 (24.6 s) but not the median: every start takes 23 to 25 s with almost no spread, so a fixed wait or a fixed-cost step sits in the start path.
- done when: `bun scripts/core-baseline.ts start 20` over 20 new tasks prints a median of 10 s or less and a p90 of 15 s or less; `bun scripts/core-baseline.ts start` also prints the time of each start phase (worktree, install, session, first call). Baseline today: median 23.5 s, p90 24.6 s.
- locks: core-baseline
- after: none
- files: scripts/core-baseline.ts, server/server/live/engine/worktrees.ts, server/server/live/agent-process.ts

### L463 A start never lacks a model
Result: A task whose agent is pi starts with a model, or says in one line which setting to change, and never ends in "No model is set for pi".
- why: when no default model is set for pi, a start ends in "No model is set for pi" and waits for the owner.
- done when: a test starts a task with the default model unset and sees the machine's first available model chosen and the choice noted in the facts; `lineclear doctor` prints the model a new task would use. Baseline today: a start with no model sets the task to "Needs you".
- locks: start-model
- after: none
- files: src/models.ts, src/doctor.ts, server/server/live/project-models.ts

### L464 One red stops the merges
Result: When main goes red, merges pause until it is green, so a burst of failures is one failure.
- why: 10 of the last 20 runs on main failed in one 11-minute burst (ten merges landed on a red main) and three fix commits followed; the last 10 runs are green.
- done when: a test merges 3 tasks while the planted main is red and sees the 2nd and 3rd held until a green run; `gh run list --workflow check.yml --branch main --limit 20 --json conclusion` lists at most 2 `failure` over 20 runs after the merge. Baseline today: 10 failed of the last 20.
- locks: red-burst
- after: none
- files: server/server/live/engine/engine-merge.ts, server/server/live/engine/merge.ts, src/main-branch.ts

### L465 No shard is the tail
Result: No shard of `check.yml` runs over 60 s, so the run finishes in 45 s at the median and 60 s at p90.
- why: L455 is not met (47 s median, 68 s p90) because `full check (5/8)` takes 61 s at p90 and 189 s at worst while the other shards take 17 to 35 s at the median and 43 s at worst.
- done when: `bun scripts/core-baseline.ts gh 20` over 20 runs prints a run median of 45 s or less and a p90 of 60 s or less, and no job with a worst above 60 s. Baseline today: run 47 s and 68 s, shard 5/8 worst 189 s.
- locks: shard-balance
- after: none
- files: scripts/load-map.ts, scripts/check-speed.ts, test/check-speed.test.ts

### L466 The agent prompt is smaller
Result: A task agent's prompt and skills hold 40 k new input tokens or less at the median and 150 k at p90.
- why: L457 is not met: agent new input is 76 k (median) and 195 k (p90), cache reads are 2429 k (p90 16.7 M), and `prompts.ts` is 10067 bytes against 9400.
- done when: `wc -c server/server/live/prompts.ts` prints 9400 or less; `bun scripts/core-baseline.ts tokens 20` over 20 new tasks prints agent new input of 40 k or less (median) and 150 k or less (p90). Baseline today: 76 k, 195 k, 10067 bytes.
- locks: prompt-size
- after: none
- files: server/server/live/prompts.ts, server/skill/lineclear/SKILL.md, server/skill/lineclear-agent/START.md

### L467 A review costs less
Result: A reviewer reads the diff and the changed files only, and spends 40 k new input tokens or less at the median.
- why: a reviewer spends 73 k new input (p90 133 k) and 1003 k cache reads (p90 2.0 M) per task, as much as the agent that wrote the change, for a diff that is usually small.
- done when: `bun scripts/core-baseline.ts tokens 20` over 20 new tasks with a review prints reviewer new input of 40 k or less (median) and 80 k or less (p90). Baseline today: 73 k and 133 k.
- locks: review-cost
- after: none
- files: src/review-call.ts, server/server/live/engine/result.ts

### L468 Chat tokens can be measured
Result: `bun scripts/core-baseline.ts chat-tokens` prints the coordinator's and the Dispatcher's tokens on every machine.
- why: it reads session folders that a machine may not have, so it prints 0 runs and L458's 1 M and 500 k p90 limits are unproven.
- done when: `bun scripts/core-baseline.ts chat-tokens 20` prints 1 or more runs for the coordinator and the Dispatcher on a machine that has had a chat, and a test reads a fake session folder and sees both roles. Baseline today: 0 runs.
- locks: core-baseline
- after: none
- files: scripts/core-baseline.ts, src/session-text.ts, test/core-baseline.test.ts

### L469 The decision log is small
Result: `decisions.jsonl` holds one line per decision, not one per tick, so it grows under 20 KB an hour and the stall counts stay readable.
- why: it holds 4528 `run` lines in 10.5 hours (about 430 an hour), 99.6 % of the file, and `freshDecisions` in `src/decision-dedupe.ts` does not drop them.
- done when: `wc -c ~/.config/lineclear/decisions.jsonl` grows by at most 20 KB over one hour with 5 tasks working; a test runs 100 ticks of an unchanged world and sees 1 line, not 100. Baseline today: 648 KB in 10 hours.
- locks: decision-log
- after: none
- files: src/decision-dedupe.ts, src/tick-project.ts, src/stalls.ts

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
