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
- locks: server-screen, file-server-server-live-readers
- after: none
- files: server/server/live/activity.ts, server/server/live/commands.ts, server/server/live/folders.ts, server/server/live/readers/steps.ts, server/server/live/unread.ts, server/server/live/worktree.ts, server/shared/activity.ts, server/shared/attention.ts, server/shared/order.ts

### L443 The catalog lists pi only
Result: The server's agent catalog names pi alone, so no setting, menu or command offers another agent CLI.
- why: area D2 of scope.md: pi runs every agent, but `settings-catalog.ts` still describes every CLI herdr can start.
- done when: `settings-catalog.ts` has one agent kind, pi, and is under 120 lines; `lineclear task add --agent claude` is refused with a line that names pi; a test checks both.
- locks: settings, file-server-server-live-settings-store-ts
- after: none
- files: server/server/live/settings-catalog.ts, server/server/live/settings-store.ts, server/server/live/args.ts

### L430 Needs you means a question
Result: A task shows Needs you only when it asks you something; one that stopped without a question is resumed by itself.
- why: a task whose turn ends without a question still shows Needs you, so the Inbox hides the real questions among them.
- done when: A task is in Needs you only with an open card or `lineclear wait owner`; a turn that ends with neither gets one nudge and, if still quiet, a restart. A test ends a turn with no question and sees no Inbox item.
- locks: stall-check, file-src-stalls-ts, file-src-inbox-ts
- after: none
- files: server/server/live/engine/status.ts, src/stalls.ts, src/inbox.ts

### L436 Flaky tests quarantined
Result: A test that flakes on GitHub stops blocking merges within one run and gets its own fix task; it leaves quarantine only once fixed.
- why: merge happens only on green, and a flaky server test is never rerun alone, so one flake holds every merge.
- done when: The server suite's failures are rerun alone like the root's. A test that fails and then passes alone on one commit goes to `test/quarantine.json` with its fix task's id; its failure alone no longer fails the check, a failure alone too still does. At most 5 tests are in quarantine. A test plants a flake, a break and a 6th flake.
- locks: quarantine, file-scripts-check-ts
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
- locks: web-samples, file-ui-web-chat-tsx, file-ui-web-home-table-tsx, file-ui-web-chat-samples-ts, file-ui-web-setup-tsx, file-ui-web-settings-samples-ts, file-ui-web-samples-ts, file-ui-web-lazy-samples-ts
- after: none
- files: ui/web/samples.ts, ui/web/real-samples.ts, ui/web/roadmap-samples.ts, ui/web/chat-samples.ts, ui/web/settings-samples.ts, ui/web/browser-samples.ts, ui/web/lazy-samples.ts, ui/web/data.ts, ui/web/chat.tsx, ui/web/home-table.tsx, ui/web/browsers.tsx, ui/web/setup.tsx

### L471 Reactions gone
Result: A task's chat has no emoji reactions; replies still quote the message they answer.
- why: area D3 of scope.md: no page of `ui/web/` offers a reaction, yet 18 lines of `chatlines.ts` and a kit part still parse and draw one.
- done when: `ui/kit/task-chat.tsx` is deleted; `chatlines.ts` is 90 lines or less (255 today) and `chats-replies.ts` 170 or less (264); `Reaction` is gone from the types; `git grep -il reaction` lists no non-test file.
- locks: chat-reactions, file-ui-kit
- after: none
- files: server/server/live/chatlines.ts, server/server/live/chats-replies.ts, server/shared/types-chat.ts, ui/kit/task-chat.tsx

### L472 Only pi's log is read
Result: The server reads the logs and start prompts of pi alone; the code and samples of other agent CLIs are gone.
- why: area D2 of scope.md: pi runs every agent, but `readers/find.ts` and `trust.ts` still know how Claude and Codex write logs and ask for trust.
- done when: `wc -l` of `server/server/live/readers/`, `trust.ts`, `streaming.ts` and `runtime.ts` prints 300 or less in all (541 today); `server/test/samples/` and `server/test/fixtures/startup/` hold no claude or codex file; `git grep -il codex` lists no non-test file.
- locks: pi-only, file-server-server-live-readers
- after: none
- files: server/server/live/readers/, server/server/live/trust.ts, server/server/live/streaming.ts, server/server/live/runtime.ts

### L473 One chat log reader
Result: The Dispatcher's chat and a task's chat read their log through one path, so a chat bug is fixed once.
- why: `chats-helpers.ts` and `chats-logs.ts` (662 lines) are the biggest files of the two chat paths; the step merges what they share.
- done when: `wc -l` of `chats-helpers.ts`, `chats-logs.ts` and `chats.ts` prints 420 or less in all (672 today); the server's chat tests pass on GitHub with no test deleted that still tests a live feature.
- locks: chat-log, file-server-server-live-chats-logs-ts, file-server-server-live-chats-ts
- after: none
- files: server/server/live/chats-helpers.ts, server/server/live/chats-logs.ts, server/server/live/chats.ts

### L474 The board command is one table
Result: Each `lineclear` word of the board is one row of a table, not a case in three files.
- why: `source-cli.ts`, `source-subcommands.ts` and `source-helpers.ts` (779 lines) hold the board command's words; the step puts each word in one table row.
- done when: `wc -l` of those three files prints 520 or less in all; `lineclear --help` prints the same words as before; the server's CLI tests pass on GitHub.
- locks: board-words, file-server-server-live-source-helpers-ts, file-server-server-live-source-cli-ts, file-server-server-live-source-subcommands-ts
- after: none
- files: server/server/live/source-cli.ts, server/server/live/source-subcommands.ts, server/server/live/source-helpers.ts

### L475 One git helper
Result: Every git call of the rule loop and the server goes through one helper; the copies are gone.
- why: `src/git.ts` is called the one git helper, yet `engine/git.ts` (407 lines) and `engine/worktrees.ts` (328) hold more git code; the step moves what repeats into the helper.
- done when: `wc -l` of `engine/git.ts`, `engine/worktrees.ts`, `src/git.ts`, `src/main-branch.ts` and `src/worktree.ts` prints 560 or less in all (851 today); `git grep -n "spawnSync('git'"` lists one non-test file.
- locks: git-helper, file-server-server-live-engine-worktrees-ts, file-src-main-branch-ts
- after: none
- files: server/server/live/engine/git.ts, server/server/live/engine/worktrees.ts, src/git.ts, src/main-branch.ts, src/worktree.ts

### L476 One project settings reader
Result: A project's settings are read by one function, so the Roadmap, Home and Settings never disagree.
- why: `projectSettings` is written twice (`web-settings.ts`, `roadmap-view.ts`) and `project.ts` is the biggest file of the CLI (579 lines).
- done when: `git grep -c "function projectSettings"` over non-test files prints 1; `wc -l` of `project.ts`, `web-settings.ts`, `roadmap-view.ts` and `add-project.ts` prints 760 or less in all (1057 today).
- locks: project-settings, file-src-project-ts
- after: none
- files: src/project.ts, src/web-settings.ts, src/roadmap-view.ts, src/add-project.ts

### L477 One line picture
Result: Home and the Roadmap draw the line of steps with the same parts, and the picture keeps its motion.
- why: the kit's line (`line.tsx`, `line-parts.tsx`, `line-glide.tsx`, `line-motion.tsx`) and the Roadmap's `line.tsx` are 1387 lines for one picture; the step merges the parts that draw a station twice.
- done when: `wc -l` of those five files prints 900 or less in all; `bun run ui:test` still passes its motion and screenshot cases at 1440 and 390 px on GitHub.
- locks: line-picture, file-ui-kit, file-ui-web-roadmap
- after: none
- files: ui/kit/line.tsx, ui/kit/line-parts.tsx, ui/kit/line-glide.tsx, ui/kit/line-motion.tsx, ui/web/roadmap/line.tsx

### L478 One list of browsers
Result: The agents' browsers are listed and drawn from one shape of data, in less code.
- why: area D4 of scope.md left `src/browsers.ts` (354 lines) and the kit's `browsers.tsx` (388) are 742 lines for one list.
- done when: `wc -l` of those two files prints 500 or less in all (742 today); the browser view and `lineclear` browser tests pass on GitHub.
- locks: browser-list, file-ui-kit
- after: none
- files: src/browsers.ts, ui/kit/browsers.tsx

### L479 Machine links in less code
Result: Machines and their links work as before from a third less code, with one retry path.
- why: `machines-links.ts` (502 lines), `machines-helpers.ts`, `mfs.ts`, `herdr-forward.ts` and `recovery.ts` are 1050 lines; `recovery.ts` retries a link and `machines-links.ts` keeps its state.
- done when: `wc -l` of `machines*.ts`, `mfs.ts`, `herdr-forward.ts` and `recovery.ts` in `server/server/live/` prints 720 or less in all (1050 today); the server's machine tests pass on GitHub.
- locks: machine-links, file-server-server-live-machines-links-ts, file-server-server-live-machines-helpers-ts, file-server-server-live-recovery-ts, file-server-server-live-herdr-forward-ts, file-server-server-live-machines-ts, file-server-server-live-machines-actions-ts
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
- locks: engine-state, file-server-server-live-engine-engine-state-ts, file-server-server-live-engine-engine-tidy-ts
- after: none
- files: server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-state.ts, server/server/live/engine/engine-tidy.ts

### L484 Home reads once
Result: Home's data comes from one read per tick, not one per widget.
- why: `home-data.ts`, `home-waits.ts`, `kept-read.ts` and `progress.ts` (935 lines) are Home's data.
- done when: `wc -l` of those four files prints 650 or less in all; `lineclear top` and the Home tests pass on GitHub.
- locks: home-read, file-src-kept-read-ts, file-src-home-waits-ts
- after: none
- files: src/home-data.ts, src/home-waits.ts, src/kept-read.ts, src/progress.ts

### L485 The Inbox's answers in one path
Result: A card, a push and an answer share one path, so a new kind of ask needs one change.
- why: `asks.ts` (436 lines), `inbox-answer.ts`, `cards.ts` and `notify.ts` turn an ask into a card, a push and an answer.
- done when: `wc -l` of those four files prints 500 or less in all (726 today); the Inbox and asks tests pass on GitHub.
- locks: inbox-path, file-src-inbox-answer-ts
- after: none
- files: src/asks.ts, src/inbox-answer.ts, src/cards.ts, src/notify.ts

### L486 Recount and the next cuts
Result: scope.md shows the line count after the cuts, and ROADMAP.md holds the steps for the rest of the way to 40,000.
- why: the cuts above reach about 41,000 with L95; the last 1,000 lines cannot be named until the others are gone.
- done when: `wc -l` by the rule of scope.md prints 41,500 or less on main and scope.md shows it; if it prints more than 40,000, at least 3 new steps with disjoint locks name the next cuts.
- locks: recount, file-docs-scope-md
- after: L470, L471, L472, L473, L474, L475, L476, L477, L478, L479, L480, L481, L482, L483, L484, L485, L496, L497
- files: docs/scope.md, docs/ROADMAP.md

### L498 Agent records in less code
Result: An agent's record, events, start and delivery work as before from a third less code.
- why: `agents-delivery.ts` (497 lines), `agents-state.ts` (372), `agents-sending.ts` (226), `agents-helpers.ts` and `agents.ts` are 1255 lines; delivery and sending both build the same message envelope.
- done when: `wc -l` of `server/server/live/agents*.ts` prints 850 or less in all (1255 today); the server's agent tests pass on GitHub.
- locks: agent-records, file-server-server-live-agents-delivery-ts, file-server-server-live-agents-state-ts, file-server-server-live-agents-sending-ts, file-server-server-live-agents-ts, file-server-server-live-agents-helpers-ts
- after: none
- files: server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/agents-sending.ts, server/server/live/agents-helpers.ts, server/server/live/agents.ts, server/server/live/agent-start.ts, server/server/live/agent-routes.ts, server/server/live/agent-input.ts, server/server/live/agent-terminals.ts

### L499 The live source in less code
Result: The live source keeps its state, spaces and restarts in less code, with one reader for each.
- why: `source-state.ts` (344 lines), `source-task-words.ts` (314), `source-spaces.ts` (239), `source-restarts.ts` (211), `source-upkeep.ts` (205) and `source-helpers.ts` are 1384 lines that repeat the same task and space lookups.
- done when: `wc -l` of those six files prints 1000 or less in all (1384 today); the server's source tests pass on GitHub.
- locks: live-source, file-server-server-live-source-helpers-ts, file-server-server-live-source-state-ts, file-server-server-live-source-upkeep-ts
- after: none
- files: server/server/live/source-state.ts, server/server/live/source-task-words.ts, server/server/live/source-spaces.ts, server/server/live/source-restarts.ts, server/server/live/source-upkeep.ts, server/server/live/source-helpers.ts

### L500 The chat view in less code
Result: The Dispatcher chat looks and moves as before, drawn by fewer parts.
- why: `ui/kit/chat.tsx` (582 lines), `ui/web/chat-view.tsx` (315), `ui/web/chat.tsx` (194), `chat-files.tsx`, `chat-reply.tsx`, `markdown.tsx` (332) and `rich-text.tsx` are 1572 lines; the kit and the page both lay out a message.
- done when: `wc -l` of those seven files prints 1100 or less in all (1572 today); `bun run ui:test` still passes its chat screenshot and motion cases at 1440 and 390 px on GitHub.
- locks: chat-view, file-ui-web-chat-tsx, file-ui-kit, file-ui-web-chat-view-tsx
- after: none
- files: ui/kit/chat.tsx, ui/web/chat-view.tsx, ui/web/chat.tsx, ui/kit/chat-files.tsx, ui/kit/chat-reply.tsx, ui/kit/markdown.tsx, ui/kit/rich-text.tsx

### L501 The web server in less code
Result: The page server answers the same routes from a third less code.
- why: `web.ts` (226 lines), `web-routes.ts` (289), `web-chat-api.ts`, `web-views.ts` and `web-files.ts` are 774 lines; each route repeats its guard, parse and error reply.
- done when: `wc -l` of those five files prints 560 or less in all (774 today); the web tests pass on GitHub.
- locks: web-server, file-src-web-ts
- after: none
- files: src/web.ts, src/web-routes.ts, src/web-chat-api.ts, src/web-views.ts, src/web-files.ts

### L487 One server, one task store
Result: One board server runs per machine and writes one task store, so a task is never in two lists.
- why: the owner measured two `server/main.ts` processes and two task stores still running on one machine after L439.
- done when: after a restart, `pgrep -fc server/main.ts` prints 1 (2 today) and the data folder holds one task store (2 today); a test starts a second server on the same store and sees it exit with a line that names the first one's pid.
- locks: one-server, file-server-server-main-ts, file-server-server-store-ts, file-src-serve-ts
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
- locks: agent-cache, file-pi-extension-ts, file-pi-nudge-ts
- after: none
- files: pi/extension.ts, pi/heavy-tool.ts, pi/nudge.ts

### L490 Agents run no tsc
Result: A task agent's checks start no tsc process in its worktree; types are checked on GitHub.
- why: the owner measured agents running `tsc` in their worktrees: 307 MB each and 2 cores for each of 45 agents.
- done when: `lineclear check --changed` in a worktree starts 0 tsc processes (a test lists the spawned commands) and adds 20 MB or less under `node_modules/.cache` (307 MB today); the GitHub `check` still runs `tsc`.
- locks: no-local-tsc, file-scripts-check-ts
- after: none
- files: scripts/check.ts, package.json, tsconfig.json

### L491 Worktrees and store stay small
Result: Retired tasks lose their worktrees, and the data folder holds nothing of deleted features.
- why: the owner measured 79 worktrees at 8.4 GB and 4.3 GB in `~/.lineclear`, of which `autopilot-runtime` is 2.9 GB for a deleted feature.
- done when: after one tick on that machine, worktrees of retired tasks are gone and `du -sm` of the worktrees prints 3000 or less (8.4 GB today) and of `~/.lineclear` 1000 or less (4.3 GB); `autopilot-runtime` is deleted by the update; a test plants a retired task and an old folder and sees both removed, and a live task's worktree kept.
- locks: disk-use, file-server-server-live-engine-retire-ts, file-src-store-copies-ts
- after: none
- files: server/server/live/engine/retire.ts, src/tmpdirs.ts, src/store-copies.ts

### L492 A reaper for test servers
Result: A UI test server or browser left from an earlier run ends by itself within 10 minutes.
- why: the owner found UI test servers from the day before still running, each holding a port and memory.
- done when: `pgrep -fc fake-lineclear-server` prints 0 ten minutes after a run is killed (a leftover of yesterday today); a test starts a server, kills its parent and sees the reaper end it, and a server of a live run kept.
- locks: reaper, file-ui-test
- after: none
- files: src/process-group.ts, src/reaper.ts, ui/test/fake-lineclear-server.ts

### L493 A step is claimed once
Result: Two machines never start the same step: the board claims it once before any machine starts it.
- why: two tasks did the same step twice (L455, L443); L461 stops it on one machine, not across machines.
- done when: a test starts one step from 2 machines at the same instant and sees 1 task and 1 refusal that names the first; over 20 simulated races 0 steps start twice (L455 and L443 each started twice).
- locks: step-claim, file-server-server-live-task-ids-ts
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
- locks: doctor-models, file-server-server-live-settings-store-ts, file-src-doctor-ts
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
- locks: world, file-src-real-world-ts
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
- locks: agent-start, file-src-starts-ts, file-server-server-live-engine-briefs-ts, file-server-server-live-engine-engine-launch-ts
- after: none
- files: server/server/live/engine/engine-launch.ts, server/server/live/engine/briefs.ts, src/starts.ts

### L452 The CLI answers in 100 ms
Result: `lineclear task list`, `lineclear show` and `lineclear room` each finish in 0.1 s or less, p90.
- why: `task list` takes 0.23 s, `show` 0.09 s and `room` 0.47 s (p90 0.68 s) today, and every agent calls them many times a task.
- done when: `bun scripts/core-baseline.ts time 7 lineclear room` and the same for `task list` and `show` print a p90 of 0.1 s or less; `bun test test/cli.test.ts` has a case that fails above it.
- locks: cli-speed, file-src-task-read-ts, file-src-cli-ts
- after: none
- files: src/cli.ts, src/task-read.ts, src/herdr.ts

### L453 Main is never red
Result: A commit that turns main red is reverted within 10 minutes and gets a fix task, and no run on main is cancelled.
- why: of the last 50 runs on main 16 failed and 13 were cancelled (before `check.yml` stopped cancelling runs on main), and no rule yet reverts a red main.
- done when: `gh run list --workflow check.yml --branch main --limit 20 --json conclusion` lists 0 `cancelled` over 20 runs after the step's merge; a test plants a red main and sees a revert commit and a fix task within 10 simulated minutes. Baseline today: 16 failed and 13 cancelled of the last 50 runs.
- locks: main-green, file-server-server-live-engine-lane-watch-ts
- after: none
- files: .github/workflows/check.yml, server/server/live/engine/lane.ts, server/server/live/engine/lane-watch.ts

### L454 Stable follows green main only
Result: `bun scripts/promote.ts <commit>` installs a commit as stable only when its GitHub `check` is green on main, and prints the commit.
- why: the machines run the stable install, and a promotion of a red or unchecked commit puts every machine on a bug.
- done when: a test runs `scripts/promote.ts` on a red, a pending and a green commit and sees refuse, refuse, install; `bun scripts/canary.ts` still passes on the installed commit. Baseline today: no command checks the commit's `check` run before an install.
- locks: promotion, file-install-sh
- after: none
- files: scripts/promote.ts, scripts/canary.ts, install.sh

### L455 GitHub check in 45 seconds
Result: The whole `check.yml` run on main finishes in 45 s or less, median, and 60 s at p90.
- why: merge waits for the check, which takes 73 s (median) and 92 s (p90) today, in 8 shards; the slowest shard of the last runs took 203 s.
- done when: `bun scripts/core-baseline.ts gh 20` prints a run median of 45 s or less and a p90 of 60 s or less over 20 runs on main. Baseline today: median 73 s, p90 92 s.
- locks: check-ci, file-scripts-check-speed-ts, file-scripts-load-map-ts, file-test-check-speed-test-ts
- after: none
- files: scripts/check-speed.ts, scripts/load-map.ts, test/check-speed.test.ts

### L456 Every stall is real and named
Result: A lock wait raises no stall line, and every other stall line names a class other than `unknown`, with a remedy that clears it.
- why: of 1559 `stall <class>` lines in `decisions.jsonl`, `lock-held` is 552 (a wait the rule loop handles by design) and `unknown` is 545, so the loop restarts what it cannot name.
- done when: `bun scripts/core-baseline.ts stalls` prints, for a day of `decisions.jsonl` after the merge, 0 lines of `lock-held` and of `unknown` and at most 2 stall lines per hour; a test feeds each class of `STALL_CLASSES` and sees its one remedy and, for a lock wait, `lineclear roadmap locks` still listing the wait. Baseline today: 15.5 stall-kind lines per hour.
- locks: stall-classes, file-src-stall-class-ts, file-src-waits-ts
- after: none
- files: src/stall-class.ts, src/waits.ts, src/heal.ts, src/health.ts

### L457 Agents read less
Result: A task agent spends at most 40 k new input tokens at the median and 150 k at p90, with its prompt and skills trimmed to match.
- why: a task agent spends 79 k new input tokens (median) and 280 k (p90), and 1303 k cache reads (p90 11.1 M).
- done when: `bun scripts/core-baseline.ts tokens 20` over 20 new tasks prints agent new input of 40 k or less (median) and 150 k or less (p90); `wc -c server/server/live/prompts.ts` prints at most 9400 bytes (70 % of 13418 today).
- locks: agent-prompt, file-server-server-live-prompts-ts, file-src-brief-ts
- after: none
- files: server/server/live/prompts.ts, server/skill/lineclear-agent/SKILL.md, src/brief.ts

### L458 Chats compact before they grow
Result: The coordinator and the Dispatcher compact at a set size, so a session never passes 1 M new input tokens.
- why: a coordinator session reaches 12.7 M new input tokens (p90) and a Dispatcher session 2.8 M, against 227 k and 38 k at the median.
- done when: `bun scripts/core-baseline.ts chat-tokens 20` over 20 new sessions prints a p90 of new input of 1000 k or less for the coordinator and 500 k or less for the Dispatcher; `bun test test/dispatcher-chat.test.ts` has a case that ends a long session and sees a compaction.
- locks: chat-context, file-src-harness-pi-ts, file-src-dispatcher-ts
- after: none
- files: src/harness-pi.ts, src/dispatcher.ts, src/chat.ts

### L459 Failed starts per machine
Result: `lineclear doctor` lists each machine's failed starts of the last 24 hours with their cause.
- why: the board keeps no failed-start record per machine, so a machine that fails starts looks the same as one that does not.
- done when: `lineclear doctor` prints one line per machine with its failed-start count and causes (brief unsent 32 and machine unreachable 4 lines per week today are the baseline); a test fails a start on one of two machines and sees only that machine's line change.
- locks: start-record, file-src-doctor-ts, file-src-measure-ts
- after: none
- files: src/doctor.ts, src/home-doctor.ts, src/measure.ts

### L460 45 agents work at once
Result: With 45 ready steps on disjoint locks, 45 agents are working within 5 minutes across machines of 10, 12 and 25 slots.
- why: one machine ran 2 tasks at the baseline and the rule loop wrote 6 `no-room` stall lines in a week, so the slots are not yet shown to fill.
- done when: a test with 3 fake machines of 10, 12 and 25 slots and 45 ready steps starts 45 within 5 simulated minutes and never more than a machine's slots; `lineclear roadmap locks . --space <name>` on this file lists every step of this section as startable together.
- locks: slots, file-src-tick-project-ts, file-src-rules-ts
- after: none
- files: src/rules.ts, src/tick-project.ts

### L461 One agent per step
Result: A step never has two agents working at once, and a step already landed starts no agent.
- why: six tasks started for one step with five working at once, and six others ended in 0.4 minutes with nothing to merge; each duplicate holds a slot and starts an agent that reads the brief and the repo.
- done when: `lineclear task list` after the merge shows at most 1 working task per step id over 20 new tasks, and 0 tasks that end with "Nothing to merge" in under 1 minute; a test adds the same step twice and sees one start and one refusal, and adds a landed step and sees no start. Baseline today: 5 working agents on L436 and 6 empty tasks of 22.
- locks: one-start, file-src-starts-ts, file-src-task-steps-ts
- after: none
- files: src/task-steps.ts, src/starts.ts, src/resolve.ts

### L462 The start has no fixed wait
Result: A task's agent makes its first tool call at most 10 s after `lineclear task add`, median, with the wait named.
- why: L451 met p90 (24.6 s) but not the median: every start takes 23 to 25 s with almost no spread, so a fixed wait or a fixed-cost step sits in the start path.
- done when: `bun scripts/core-baseline.ts start 20` over 20 new tasks prints a median of 10 s or less and a p90 of 15 s or less; `bun scripts/core-baseline.ts start` also prints the time of each start phase (worktree, install, session, first call). Baseline today: median 23.5 s, p90 24.6 s.
- locks: core-baseline, file-server-server-live-engine-worktrees-ts, file-server-server-live-agent-process-ts
- after: none
- files: scripts/core-baseline.ts, server/server/live/engine/worktrees.ts, server/server/live/agent-process.ts

### L463 A start never lacks a model
Result: A task whose agent is pi starts with a model, or says in one line which setting to change, and never ends in "No model is set for pi".
- why: when no default model is set for pi, a start ends in "No model is set for pi" and waits for the owner.
- done when: a test starts a task with the default model unset and sees the machine's first available model chosen and the choice noted in the facts; `lineclear doctor` prints the model a new task would use. Baseline today: a start with no model sets the task to "Needs you".
- locks: start-model, file-src-doctor-ts
- after: none
- files: src/models.ts, src/doctor.ts, server/server/live/project-models.ts

### L464 One red stops the merges
Result: When main goes red, merges pause until it is green, so a burst of failures is one failure.
- why: 10 of the last 20 runs on main failed in one 11-minute burst (ten merges landed on a red main) and three fix commits followed; the last 10 runs are green.
- done when: a test merges 3 tasks while the planted main is red and sees the 2nd and 3rd held until a green run; `gh run list --workflow check.yml --branch main --limit 20 --json conclusion` lists at most 2 `failure` over 20 runs after the merge. Baseline today: 10 failed of the last 20.
- locks: red-burst, file-src-main-branch-ts
- after: none
- files: server/server/live/engine/engine-merge.ts, server/server/live/engine/merge.ts, src/main-branch.ts

### L465 No shard is the tail
Result: No shard of `check.yml` runs over 60 s, so the run finishes in 45 s at the median and 60 s at p90.
- why: L455 is not met (47 s median, 68 s p90) because `full check (5/8)` takes 61 s at p90 and 189 s at worst while the other shards take 17 to 35 s at the median and 43 s at worst.
- done when: `bun scripts/core-baseline.ts gh 20` over 20 runs prints a run median of 45 s or less and a p90 of 60 s or less, and no job with a worst above 60 s. Baseline today: run 47 s and 68 s, shard 5/8 worst 189 s.
- locks: shard-balance, file-scripts-check-speed-ts, file-scripts-load-map-ts, file-test-check-speed-test-ts
- after: none
- files: scripts/load-map.ts, scripts/check-speed.ts, test/check-speed.test.ts

### L466 The agent prompt is smaller
Result: A task agent's prompt and skills hold 40 k new input tokens or less at the median and 150 k at p90.
- why: L457 is not met: agent new input is 76 k (median) and 195 k (p90), cache reads are 2429 k (p90 16.7 M), and `prompts.ts` is 10067 bytes against 9400.
- done when: `wc -c server/server/live/prompts.ts` prints 9400 or less; `bun scripts/core-baseline.ts tokens 20` over 20 new tasks prints agent new input of 40 k or less (median) and 150 k or less (p90). Baseline today: 76 k, 195 k, 10067 bytes.
- locks: prompt-size, file-server-server-live-prompts-ts
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
- locks: decision-log, file-src-stalls-ts, file-src-tick-project-ts
- after: none
- files: src/decision-dedupe.ts, src/tick-project.ts, src/stalls.ts

## Open steps from the audits

Sixty-three steps from the audits of `docs/audit/` and `docs/roles.md`, in the order stores, engine, agents, loop, machines, roles. Where two steps list the same file or folder and no `after` orders them, both hold a `file-` lock, so they never run at once. The findings stay in the audit files.

### L540 One store file with transactions
Result: Lineclear keeps its state in one `store.sqlite` with transactions, and a store that cannot open stops the board with a named cause.
- why: S1-S8, S13: 18 stores are written whole or appended by several processes, and a broken one is read as empty.
- done when: `server/server/store.ts` opens `store.sqlite` (WAL, `busy_timeout=5000`) and exposes `db` and `tx()`; `readJson` and `writeJson` are deleted from it; an import step turns each old JSON file into rows once and renames it `*.imported`; a test corrupts the file and sees the board refuse to start with the file's path in the line, not an empty store.
- locks: store-core, file-server-server-main-ts, file-server-server-store-ts, file-server-server-live-task-ids-ts
- after: none
- files: server/server/store.ts, server/server/main.ts, server/server/live/task-ids.ts, src/paths.ts

### L541 Tasks are rows, not a whole file
Result: A task's change is one row written, so a status line writes under 2 KB instead of the 678 KB of `tasks.json`.
- why: S1, S13, S14, S15: `save()` rewrites every hot task 10 times in 30 s with 9 agents, about 1.1 MB/s at 45.
- done when: `tasks` rows hold tasks, briefs and retired marks; `cold.ts` (the task part) and `briefs.ts` are deleted; a test with 45 tasks reporting 100 status lines counts 100 row updates and under 200 KB of writes (`wc -c` of the WAL), against 67 MB today; `retire.ts` marks rows in one transaction.
- locks: store-tasks, file-server-server-live-engine-engine-state-ts, file-server-server-live-engine-engine-tidy-ts, file-src-kept-read-ts, file-server-server-live-engine-retire-ts, file-server-server-live-task-ids-ts, file-server-server-live-engine-briefs-ts, file-server-server-live-engine-cold-ts
- after: L540
- files: server/server/live/engine/engine-state.ts, server/server/live/engine/cold.ts, server/server/live/engine/briefs.ts, server/server/live/engine/retire.ts, server/server/live/engine/engine-tidy.ts, server/server/live/task-ids.ts, src/kept-read.ts, src/doctor-task-ids.ts

### L542 Agents and outbox are rows
Result: A message to an agent and a change of its record write one row each, not the 424 KB of `agents.json` and the 170 KB of `typed.json`.
- why: S2, S3, S20: 15 save sites rewrite 131 agent records, and each delivered message rewrites 200 sent items.
- done when: `agents`, `outbox` and `typed` are tables; `ColdAgents` is deleted; `requested-news.ts` reads the table, not `agents.json`; a test delivers 100 messages and sees under 300 KB written (about 17 MB today).
- locks: store-agents, file-server-server-live-agents-delivery-ts, file-server-server-live-agents-state-ts, file-server-server-live-agents-sending-ts
- after: L541
- files: server/server/live/agents-state.ts, server/server/live/agents-delivery.ts, server/server/live/agents-sending.ts, server/server/live/requested-news.ts

### L543 Chat logs are rows
Result: A card or an answer in a chat is one row inserted, not the whole log of that chat written again.
- why: S4: 421 chat files, each rewritten whole on every post or answer.
- done when: `chatlog` is a table; `saveLog` and the `chatlog/` folder are gone; a test posts 100 cards to one chat and sees under 100 KB written (about 2.5 MB when each rewrite grows to 50 KB).
- locks: store-chats, file-server-server-live-chats-logs-ts, file-server-server-live-chats-ts, file-src-measure-ts
- after: L541
- files: server/server/live/chats-logs.ts, server/server/live/chats.ts, src/task-detail.ts, src/measure.ts

### L544 Settings and places in the store
Result: Settings, spaces, names and health live in the store, and the migrations of old settings shapes are gone.
- why: S5, S6, S9: three whole files for places, two `settings.json` of the same name, and a migration that runs at every start.
- done when: `settings`, `spaces`, `names` and `health` are tables; `settings-store.ts` is under 120 lines (about 250 today, `wc -l`); `worktrees.ts` no longer reads and writes `spaces.json`; a test sets a value from two processes at once and sees both.
- locks: settings, file-server-server-live-engine-worktrees-ts, file-server-server-live-source-state-ts, file-server-server-live-settings-store-ts
- after: L443, L540
- files: server/server/live/settings-store.ts, server/server/live/places.ts, server/server/live/engine/worktrees.ts, server/server/live/source-state.ts, server/server/live/health.ts

### L545 One settings reader
Result: The CLI reads the project settings and models from the store, not from a second `settings.json` and a spawned `lineclear space list`.
- why: S6, S7, S21: `readSetup` parses a file and checks a legacy path on each of 42 calls, and `detectSpace` blocks about 100 ms on a child process.
- done when: `project.ts` has no `spawnSync` and no `setup.json` path (`grep` prints 0); `src/serve.ts` reads the same table; a test counts 0 child processes started by `project add`.
- locks: cli-settings, file-src-project-ts, file-src-serve-ts, file-src-requests-ts
- after: L544
- files: src/project.ts, src/serve.ts, src/wait-service.ts, src/requests.ts

### L546 A copy is one file
Result: A store copy is one consistent `VACUUM INTO` file of 3 MB, so a restore returns the store as it was at one moment.
- why: S16, S17: 56 copies take 1,068 MB, and copying files one by one is not a point in time.
- done when: `copyStore` writes one file with `VACUUM INTO` and holds under 5 MB per copy (34 MB today); `restoreCopy` puts one file back; secrets and push keys are not in the copy; the copy error is not swallowed (a test breaks the folder and sees the line in `doctor`).
- locks: disk-use, file-src-rules-ts, file-src-store-copies-ts
- after: L491, L540
- files: src/store-copies.ts, src/rules.ts

### L547 Decisions in the store
Result: The decisions log is a table with an index on time, written by one statement from the server, the rule loop and every agent's CLI.
- why: S11: four writers append to one 939 KB file, readers parse all of it, and a daily cut moves lines between files.
- done when: `decisions` is a table; `cutDecisionsDaily`, `rotateDecisions`, `readDecisionsSince` file reads and the `lastWritten` dedupe are deleted; `lineclear status` reads one `WHERE time >` query in under 10 ms with 100,000 rows (a test measures it).
- locks: decisions, file-src-home-waits-ts, file-server-server-live-engine-lane-watch-ts, file-src-stall-class-ts, file-src-plan-ts, file-src-task-work-ts
- after: L540
- files: src/stall-class.ts, src/task-work.ts, src/plan.ts, server/server/live/engine/lane-watch.ts, src/status.ts, src/start-failures.ts, src/home-waits.ts

### L548 Inbox and waits in the store
Result: Inbox items, waits and requests are rows, so the rule loop reads them with one query and a new item needs no retry on a taken number.
- why: S12: `readItems` lists and parses every item file on each of 23 calls, and `addItem` loops on `EEXIST`.
- done when: `inbox`, `waits` and `requests` are tables; `createAtomic` is used by 0 callers and deleted from `pi/atomic.ts` if nothing else uses it; `addItem` has no loop (a test adds 50 items from 5 processes and sees 50 distinct numbers).
- locks: cli-items, file-src-inbox-ts, file-src-inbox-answer-ts, file-src-waits-ts, file-src-requests-ts
- after: L540
- files: src/inbox.ts, src/waits.ts, src/requests.ts, src/inbox-answer.ts, pi/atomic.ts

### L549 Small stores read loud
Result: Machine caches, secrets and push keys are written on change only, read once, and a failed write is an error, not a swallowed catch.
- why: S10, S19: `last.json` hides a full disk, `secrets.read()` parses on every call, and `push.json` is rewritten whole.
- done when: `machines-links.ts` and `machines-helpers.ts` hold 0 empty catches (`grep` prints 0, 2 today); `secrets.read()` parses the file once per change of its mtime (a test counts 1 read for 100 calls); a full disk makes the next write fail with the path named.
- locks: small-stores, file-server-server-live-machines-links-ts, file-server-server-live-machines-helpers-ts, file-server-server-push-ts
- after: L540
- files: server/server/live/machines-links.ts, server/server/live/machines-helpers.ts, server/server/live/secrets.ts, server/server/push.ts

### L520 The task store loses nothing
Result: A crash, a full disk or a half-written file never empties your task list, and a save writes only what changed.
- why: findings 25 to 30 and 46: `readJson` turns a corrupt `tasks.json` into an empty list that the next save writes over the real file, and every status change rewrites 680 KB.
- done when: a test truncates `tasks.json` and the server refuses to start, names `tasks.json.bad-<time>` and keeps it; a test kills the writer 1000 times mid-save and every reload parses; with 45 agents reporting for 10 minutes, bytes written to the task store are 5 MB or less (about 136 MB/min today); `lineclear doctor` lists a skipped cold line.
- locks: task-store, file-server-server-live-engine-retire-ts, file-server-server-live-engine-briefs-ts, file-server-server-live-engine-cold-ts
- after: L487
- files: server/server/live/engine/cold.ts, server/server/live/engine/briefs.ts, server/server/live/engine/retire.ts, server/server/live/engine/task-store.ts

### L521 A task has one phase
Result: A task is in exactly one named phase, moves only by listed transitions, and keeps its phase across a restart.
- why: findings 1 to 4, 7, 33, 49, 50: 58 fields and 19 in-memory sets decide the status through 15 ordered ifs, and repair code rebuilds what a restart loses.
- done when: `TaskRec` has a `phase` and 20 or fewer remaining fields that are state (58 today, 16 flags); one `transitions` table lists every move and a test feeds each pair of (phase, event) and sees either the next phase or a refusal; `starting`, `briefing`, `handing` and `cleaning` sets are gone; a test restarts the engine in each phase and sees the same status; one `settle()` with 45 held tasks and 561 stored makes 0 status scans of other tasks (25,000 today).
- locks: task-phase, file-server-server-live-engine-engine-state-ts
- after: L483, L430, L520
- files: server/server/live/engine/engine-state.ts, server/server/live/engine/status.ts, server/server/live/engine/engine-helpers.ts, server/server/live/engine/phase.ts, server/server/live/restart.ts

### L522 Turns end by pi's word
Result: A task shows Ready or Needs you the moment pi says its turn is settled, with no wait of 4 to 6 seconds and no resent brief.
- why: findings 5, 8, 9, 10, 31, 33, 42, 44: `settleSoon` (4 s), `ANSWER_GRACE` (6 s) and the 120 s brief timer guess what `agent_settled` and `agent_start` say.
- done when: `grep -n "settleSoon\|ANSWER_GRACE\|BRIEF_WAIT\|briefResent"` in `server/server/live/` lists none; a test sends `agent_settled` and sees the phase change within one tick (4000 ms today); a test sends `agent_settled` with `aborted` and sees no Ready card; a failed `agents.send` for a go leaves the task in a phase with `trouble` set and a card, 0 silent catches in the three files.
- locks: pi-events, file-pi-extension-ts, file-server-server-live-engine-engine-launch-ts, file-server-server-live-engine-engine-tidy-ts
- after: L521, L483
- files: pi/extension.ts, server/server/live/engine/engine-launch.ts, server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-tidy.ts, server/server/live/quiet.ts

### L523 Stall checks run on deadlines
Result: A stalled task is named at the minute its wait ran out, and the engine's six timers are one.
- why: findings 11 to 13: three loops over every task each minute, an hourly sweep, and three fixed first-run delays stand in for deadlines and for herdr's first snapshot.
- done when: `engine.ts` has no `setInterval`; the engine holds one timer, for the earliest deadline; a test advances a fake clock to each deadline (stall 20 min, silent 5 min, ready 20 min) and sees one card, none before and none twice; with 561 tasks and 45 working, `checkStalls` makes 0 status calls per minute while nothing is due (about 1,700 today).
- locks: stall-deadlines
- after: L521, L430
- files: server/server/live/engine/stalls.ts, server/server/live/engine/engine.ts, server/server/live/engine/deadlines.ts

### L524 GitHub is read once per repo
Result: Checks, reviews and main's runs are read by one call per repo, and waiting for them costs no extra calls.
- why: findings 16 to 20, 32, 35, 36, 38 (GitHub half), 40: 45 tasks cost about 150 `gh` spawns per 2 minutes, each held merge up to 190, and a bad answer reads as "no PR".
- done when: a test with 45 open PRs in one repo counts 1 `gh` spawn per watch tick (about 150 today) and 0 when GitHub answers 304; 45 waiting `lineclear checks` add 0 spawns; a malformed `gh` answer makes the repo state `down` and opens no second PR; `grep -c "\.catch(() => " server/server/live/engine/engine-merge.ts` prints 0 (9 today).
- locks: github-read
- after: L464, L494
- files: server/server/live/engine/github.ts, server/server/live/engine/engine-merge.ts, server/server/live/engine/repo-watch.ts

### L525 A merge waits on events
Result: A merge waits for a turn, a red main or a queue by awaiting an event, can be cancelled, and is never held by its title.
- why: findings 14, 15, 17, 21, 22, 38 (git half), 39, 45: five sleep loops (one with no limit), a `/proc` scan to guess a hung step, and `/^fix\b/` on a title that opens the red-main gate.
- done when: `grep -n "Bun.sleep" server/server/live/engine/merge.ts server/server/live/engine/lane-watch.ts` lists none (4 today); `machine.ts` and `HeadWatch` are gone; a test plants a step that never ends and sees it aborted at its own timeout with its process group dead; a task titled "Fix typo" is held by a red main; a test holds 10 merges on a red main for 30 simulated minutes and counts 0 `gh` spawns of its own (1 per 10 s each today).
- locks: merge-waits, file-server-server-live-engine-lane-watch-ts
- after: L524, L494, L453, L464
- files: server/server/live/engine/merge.ts, server/server/live/engine/lane.ts, server/server/live/engine/lane-watch.ts, server/server/live/engine/machine.ts

### L526 Agents revive on herdr's events
Result: A stopped or outdated agent is started again within 20 seconds of herdr saying so, and the server polls nothing for it.
- why: finding 23: every 15 s, 45 `processInfo` calls (180 per minute) plus a hash of each prompt file look for what `pane.exited` and `onOpen` already say.
- done when: a test with 45 agents counts 0 `processInfo` calls in a quiet minute (180 today); a test emits `pane.exited` and sees the agent started within the 20 s grace and no sooner; a test restarts herdr and sees one stale-flag compare per agent, not one per 15 s; `Revivals` keeps its counters and gaps (tests unchanged).
- locks: revive-events, file-server-server-live-recovery-ts, file-server-server-live-agents-sending-ts, file-server-server-live-source-upkeep-ts, file-server-server-live-revive-ts
- after: none
- files: server/server/live/revive.ts, server/server/live/source-upkeep.ts, server/server/live/agents-sending.ts, server/server/live/recovery.ts

### L527 Herdr spaces are looked up once
Result: Putting a finished task away costs one herdr call, and a herdr timeout is told apart from a space that is gone.
- why: findings 34, 41, 47: `spaceOf` lists every space 3 to 5 times per `putAway`, and 14 silent catches make a timeout look like "nothing there".
- done when: a test with 45 spaces counts 1 herdr call per `putAway` (3 to 5 whole lists today); a timeout leaves the task `cleaning` with a recorded error and a not-found counts as done; `grep -c "\.catch(() => " server/server/live/engine/worktrees.ts` prints 0 (14 today).
- locks: herdr-spaces, file-server-server-live-engine-worktrees-ts
- after: L462
- files: server/server/live/engine/worktrees.ts

### L528 Git output is read by exit code
Result: Conflicts, remotes and ignored files are known from git's exit codes and null-separated output, not from English text.
- why: finding 43: a remote URL regex, a glob turned into a `RegExp` and a conflict-marker regex read git's text.
- done when: the three parsers are replaced and a test runs them with `LANG=fi_FI.UTF-8` and sees the same answers; `git.ts` has no `new RegExp`; `wc -l` of `git.ts` is 340 or less (407 today).
- locks: git-parse
- after: L475
- files: server/server/live/engine/git.ts

### L529 The engine is composed
Result: The engine is a few modules with one job each, and no class inherits from another eight.
- why: finding 48: nine classes in one inheritance line, split by line count, with every member visible to every layer.
- done when: `grep -c "extends Engine" server/server/live/engine/*.ts` prints 0 (8 today); no file of `engine/` is over 400 lines (520 today); the engine's tests pass unchanged on GitHub.
- locks: engine-compose, file-server-server-live-engine-engine-launch-ts, file-server-server-live-engine-engine-state-ts, file-server-server-live-engine-engine-tidy-ts
- after: L521, L522, L523, L524, L525, L527
- files: server/server/live/engine/engine.ts, server/server/live/engine/engine-launch.ts, server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-tidy.ts, server/server/live/engine/engine-merge.ts, server/server/live/engine/engine-state.ts

### L509 Task agent is a pi RPC process
Result: A task's agent runs as a `pi --mode rpc` child of its machine's server, with its events read from the pipe, not a herdr pane.
- why: A1-A11, B1-B7, C5-C7 all come from driving a TUI by keys; pi's RPC gives start, prompt, abort, state and `agent_settled` as records (rpc.md, json.md).
- done when: One new task starts, takes its brief, works and ends with 0 herdr calls for that agent (counted in a test with a stand-in herdr), its first event is read within 3 s of the spawn, and `lineclear task add` in the existing contract tests passes on GitHub. Coordinators and the Dispatcher still start in panes.
- locks: agent-rpc, file-server-server-live-agents-ts, file-server-server-live-agent-process-ts
- after: none
- files: server/server/live/agent-rpc.ts, server/server/live/agent-process.ts, server/server/live/agents.ts

### L510 Prompts go in by RPC
Result: A message to a task agent is one RPC prompt that says if it started, was queued or was handled; nothing is typed into a screen.
- why: A1-A11 and C4: eight tuning knobs, a paste watcher and a 1.5 s sleep per delivered item exist because the input is a screen.
- done when: `paste-watch.ts` is deleted; `untilReady`, `submitted`, `typeIntoPane`, `giveUpOnBriefs`, `holdFrom` and `deliveryFailed` are gone from `agents-state.ts` and `agents-delivery.ts`; a brief of 3 items is in the agent in under 1 s (was 4.5 s plus 3 snapshots); a test sends while the agent works and sees `queued`; the 2 s `settle` interval is gone (0 `setInterval` in the three agent files).
- locks: agent-delivery, file-server-server-live-agents-delivery-ts, file-server-server-live-agents-state-ts, file-server-server-live-agents-sending-ts, file-server-server-live-agents-helpers-ts
- after: L509
- files: server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/agents-sending.ts, server/server/live/agents-helpers.ts, server/server/live/paste-watch.ts

### L502 Start has no retry or timer
Result: A task agent's start is one spawn that succeeds or exits; its log file and route come with it.
- why: B1-B8: an 8-try loop, a 750 ms sleep, three start timers, a perl route binder and five log-scan timers guess at a pane being ready.
- done when: `launch` has no loop and no `setTimeout` (0 timers in the function, 3 today); `follow`, `discoverLog` and `repairRoutes` are gone, and the session file comes from `get_state`; `route.pl --bind` is not spawned for RPC agents; a start of 45 tasks in a test makes 0 herdr snapshots and 0 perl processes.
- locks: agent-delivery, file-server-server-live-readers, file-server-server-live-agents-delivery-ts, file-server-server-live-agents-state-ts
- after: L510
- files: server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/readers/find.ts

### L503 One module per agent job
Result: Agent records and the outbox are written as rows, not as two files rewritten whole, and the three-file class is split by job.
- why: D1, D2, F1: `agents.json` (424 KB) is rewritten for every launch step and `typed.json` (170 KB) for every delivered item, about 118 MB per 45-start burst (est.).
- done when: A save writes bytes in proportion to the record changed (a test changes one record of 131 and sees under 8 KB written, 424 KB today); `typed.json` and `requested-news-receipts.json` are gone; no file of `agents*.ts` is over 300 lines and no `protected` field is shared across files; `bun run gates` is green.
- locks: agent-delivery, file-server-server-live-agents-delivery-ts, file-server-server-live-agents-state-ts, file-server-server-live-agents-sending-ts, file-server-server-live-engine-cold-ts
- after: L502
- files: server/server/live/agents-state.ts, server/server/live/agents-delivery.ts, server/server/live/agents-sending.ts, server/server/live/engine/cold.ts

### L504 One held herdr link
Result: The coordinator panes' state comes over one held herdr connection that is never rebuilt, and no call retries a send.
- why: C1-C3, C5, F2-F5: 51 subscriptions are rebuilt and the whole session is re-read on every pane change; every call opens a socket or spawns a process.
- done when: Starting and stopping 45 panes causes 0 subscription reopens and at most 1 `session.snapshot` (est. 90 and 270 today), counted in a test with a stand-in socket; `herdrCliSync` is gone (0 `spawnSync` in `herdr.ts`); `send` never repeats a `pane.send_*` or `agent.prompt`; `terminal-clock.ts` reads at most 2 panes a second.
- locks: herdr-link
- after: none
- files: server/server/live/herdr.ts, server/server/live/agent-events.ts, server/server/live/terminal-clock.ts

### L505 Machine room by one ssh read
Result: Another machine's load and memory come from one ssh call, with no tab opened on it.
- why: F6: `room` opens a tab, types a `printf`, polls the terminal 25 times and matches the text with a regex.
- done when: `room(machine)` makes 1 process call (was 5-7 forwarded calls plus up to 25 reads) and returns in under 1 s on a warm ControlMaster; `ROOM_LINE`, the 25-read loop and the regex are gone; a test reads `/proc` text from a stand-in ssh.
- locks: herdr-forward, file-server-server-live-herdr-forward-ts
- after: none
- files: server/server/live/herdr-forward.ts

### L506 Worktrees without herdr spaces
Result: A task's worktree is made and removed by git alone, and a done task's folder is put away even when herdr is down.
- why: D3, E1-E6: 18 swallowed errors, two ways to remove a folder, a shared JSON file and two guessing timers.
- done when: `worktrees.ts` has 0 empty catches (18 today) and is under 150 lines (332); `repo-spaces.json` is gone; `agentPane`, `idleShells`, `busy` and `closeRepoSpace` are gone; `settleSoon` and the `BRIEF_WAIT` timer are replaced by `agent_settled` and the prompt response; a test ends a task with herdr stopped and the worktree is removed.
- locks: worktrees, file-server-server-live-engine-worktrees-ts, file-server-server-live-engine-engine-launch-ts
- after: L509
- files: server/server/live/engine/worktrees.ts, server/server/live/engine/engine-launch.ts

### L507 Pi extension: no timer or regex
Result: An agent shows it is alive from its own events, and a quiet turn is answered by the server, not by a regex in the agent.
- why: C8-C11: a process is spawned every 4 minutes per busy agent, a regex reads the model's prose, and whole session files are read for a limit message.
- done when: `pi/extension.ts` has 0 `setInterval`/`execFile` (2 today), `pi/nudge.ts` is deleted or under 15 lines (41) with the nudge sent by the server from `agent_settled`, `src/harness-pi.ts` reads no session file (0 `readFileSync`), `account-fallback.ts` has 0 `execFileSync`; the nudge test ends a turn with no question and sees one `follow_up`.
- locks: pi-ext, file-pi-extension-ts, file-pi-nudge-ts, file-src-harness-pi-ts
- after: L509
- files: pi/extension.ts, pi/nudge.ts, pi/account-fallback.ts, src/harness-pi.ts

### L508 Revival from the exit event
Result: An agent whose process ended is started again from the exit event, with a limit, and a stale one is known by its launch hash.
- why: C6, C7: `pane.process_info` and two sha256 file reads per agent per pass find what an exit event says.
- done when: `paneWrong`, `staleFlag`, `hashOf`, `sameValue` and `logLoop` are gone from `revive.ts` (under 60 lines, 136 today); `wrong()` makes 0 herdr calls for an RPC agent; a test kills an agent's process and sees one restart after the grace and none after 3 in an hour.
- locks: revive, file-server-server-live-recovery-ts, file-server-server-live-revive-ts
- after: L509
- files: server/server/live/revive.ts, server/server/live/recovery.ts

### L560 One loop process, no survivors
Result: The rule loop runs in one process that crashes loudly, and a corrupt state file stops its project with a line that names it.
- why: `tickAway` starts a process every 30 s and throws every memo away, `readState` reads a corrupt file as an empty one (`closedSteps` lost, every closed step starts again), and the loop survives every error it should not.
- done when: Ticks 2 to 20 of a 20 tick run start 0 new `bun` processes (20 today, a test counts `lineclear run --once` spawns); `grep -c "uncaughtException\|unhandledRejection\|SIGHUP" src/rules.ts` prints 0 (3 today); a test writes `{` into `state.json` and sees the tick of that project stop with an Inbox item that names the file, and `closedSteps` unchanged; a test with `state.json` unchanged between two ticks sees 0 writes of it (1 per tick today).
- locks: slots, file-src-serve-ts, file-src-rules-ts
- after: L460
- files: src/rules.ts, src/serve.ts

### L561 One tick reads facts once
Result: A tick reads main and the tasks once, never runs the project's tests, and a step never starts twice for want of a second look.
- why: `whyStale` re-reads fetch, main, the task list and two ssh calls per machine before every start and tests one fact twice, `checkHealth` and `proveClosed` run tests on the owner's machine next to the board's own red mark, and `startsWith("lock '")` steers the loop by its own sentence.
- done when: A test with 5 ready steps and 1 other machine counts the spawned commands of one tick and sees 15 or fewer (about 45 today); `grep -n "health\|proveClosed\|whyStale\|startsWith(\"lock" src/tick-project.ts` lists nothing; a test with main marked red by the board sees new starts stop and 0 health commands run; `wc -l src/tick-project.ts` prints 340 or less (468 today).
- locks: slots, file-src-tick-project-ts
- after: L460, L493, L560
- files: src/tick-project.ts

### L562 The world's reads are exact
Result: Every read of the world is bounded, typed and cached by what changed, and no tool's text output is parsed with a regex.
- why: `run` waits 600 s for every command, `git log` reads all of main every tick, `maxTasks`, `reviewerSetting` and the model list are cut from text, and an unreadable list means "every model is offered".
- done when: `grep -c "HEALTH_TIMEOUT_MS" src/real-world.ts` prints 2 (the constant and the detached merge only; 3 today); a test with a `git` that never answers sees the tick end its read in 10 s or less and note a timeout; a test with refs unchanged between ticks counts 0 `git log` spawns on the second tick (1 per tick today); `grep -n 'machine\.maxTasks\|reviewer\.model' src/real-world.ts` lists nothing; `pi --list-models` runs 0 times in a 20 tick test with a pi RPC double that answers `get_available_models`.
- locks: world, file-src-task-read-ts, file-src-real-world-ts
- after: L497, L561
- files: src/world.ts, src/real-world.ts, src/task-read.ts

### L563 Decisions carry a code
Result: A skip is one line when it starts and one when it ends, written from a code, with no text parsing on the way.
- why: every tick rewrites the same skip text and `freshDecisions` removes repeats by replacing numbers; the loop also reads its own sentence to decide what to do.
- done when: `Decision` has a `code` (a union of at most 12) and `freshDecisions` compares codes: `grep -c "replace(/" src/decision-dedupe.ts` prints 0 (1 today); a 100 tick test of one blocked step writes 2 lines (start and end of the skip), the same as today's output; `grep -c 'startsWith("skip:")' src/decision-dedupe.ts` prints 0 (1 today).
- locks: decision-log, slots, file-src-rules-ts
- after: L469, L560, L561
- files: src/decision-dedupe.ts, src/rules.ts

### L564 Plans settle on events
Result: A plan applies once, at the moment its project allows it, and `lineclear plan` never reads the whole task list to learn the board is up.
- why: `settlePlans` runs a model and a merge inside the tick before any project's lock, a second path to what `autoApply` already does; `plan.ts` spawns a 123 KB task list as a ping.
- done when: `settlePlans` is deleted and a test with a waiting plan sees the tick make 0 model calls (1 today); `grep -c "serverIsDown\|startsWith(\"Cannot" src/plan.ts` prints 0 (4 today); `mergeTask` spawns 3 git processes or fewer for a 40 commit merge (42 today); `grep -n "Bun.spawnSync" src/plan.ts src/autoplan.ts` lists only calls with a `timeout`.
- locks: autoplan, slots, file-src-rules-ts, file-src-plan-ts, file-src-autoplan-ts
- after: L496, L560, L563
- files: src/autoplan.ts, src/plan.ts, src/rules.ts

### L565 The Inbox is read by change
Result: Pushes, asks and the tick read only the Inbox items and chats that changed, and an answered card is recorded on the card.
- why: the push watcher parses every Inbox file every 2 s next to a server that stats the folder each second, `routeAsks` parses all chat history of a space every tick, and `asks-routed.json` is rewritten whole to hold what each card could say.
- done when: with 1,000 closed Inbox items a test counts 0 file reads by `notifyNew` when nothing changed (1,000 per 2 s today); `readItems` reads 0 files under `inbox/closed/`; a test with 200 archived chat files sees `routeAsks` read 0 of them (200 per tick today) and parse an unchanged live chat 0 times; `src/asks.ts` has no `asks-routed.json` and `wc -l src/asks.ts src/notify.ts` prints 420 or less in all (531 today).
- locks: inbox-path, file-src-inbox-ts, file-src-web-ts, file-src-asks-ts, file-src-notify-ts
- after: L485
- files: src/asks.ts, src/notify.ts, src/inbox.ts, src/web.ts

### L566 Home reads fields, not words
Result: Home shows a task's stage, step, merge release and start time from the task record, and these survive a restart.
- why: Home guesses the stage from a status line, the step from a title, the lane from a sentence and "since" from the first read of this process, so a restart or a changed wording changes what the owner sees.
- done when: `grep -c '/\breview/i\|Your merge hung\|const seen = new Map' src/home-data.ts` prints 0 (3 today); a test restarts the reader and sees every working task keep its `since`; `grep -c ": Raw\|<Raw>\|Raw\[\]" src/home-data.ts` prints 0 (15 today); `import.meta.main` is gone from the file.
- locks: home-read
- after: L484
- files: src/home-data.ts

### L567 The dead proof checker is gone
Result: No code reads or writes a proof file nobody makes, and the done-when proof is the reviewer's, named in scope.md.
- why: `proveStep` has no caller outside tests, while `unprovenOf` parses a proof file on every tick and every Home read.
- done when: `git ls-files src/doneproof-run.ts` prints nothing and `git grep -n "unprovenOf\|readProofs\|saveProof\|commandsFor\|testOf" src` lists nothing; `doneItems` lives in `roadmap.ts`; `wc -l` of the deleted files (295 in scope.md) is gone from `bun run gates` knip's list; the GitHub check is green.
- locks: doneproof, one-start, file-docs-scope-md, file-src-brief-ts, file-src-task-work-ts, file-src-task-steps-ts
- after: L461, L561, L562
- files: src/doneproof.ts, src/doneproof-run.ts, src/task-steps.ts, src/owner-steps.ts, src/task-work.ts, src/roadmap.ts, src/brief.ts, docs/scope.md

### L568 The chat link backs off
Result: When the board is down, an open chat page waits longer between tries and shows why, instead of reading the whole board three times a second.
- why: `chat.ts` retries every 3 s and each try reads the whole board snapshot (about 120 KB) to find a chat key it already knew.
- done when: a test with the board down for 60 s sees 8 or fewer connect attempts (20 today) and at most 1 snapshot read after the first; a test with a refused connection and a 500 shows two different reasons (one today); `grep -c "retryMs" src/chat.ts` prints 0 (6 today).
- locks: chat-context
- after: L458
- files: src/chat.ts

### L569 Night watch speaks on change
Result: At night the Dispatcher hears only about what the rules found, and a quiet night sends nothing.
- why: the watch asks a model every 2 hours what the loop wrote 30 seconds ago.
- done when: a test with a quiet night of 9 hours (no `stall`, no owner-blocking `skip`) sends 0 messages (5 today); a test with one `stall` at 02:10 sends 1 message that holds its line; `WATCH_EVERY_MS` is gone.
- locks: night-watch, file-src-night-watch-ts
- after: none
- files: src/night-watch.ts

### L580 Machine room from the worker
Result: A machine's load, free memory and cores come from its worker's snapshot, with no herdr tab, no regex and no spawned CLI.
- why: `room()` costs up to 29 herdr calls and 5 s per machine per tick and flashes a tab; `readRoom` blocks the loop with 2 process starts of up to 40 s per machine per project (findings 1-4).
- done when: a test with 3 fake workers asserts a tick makes 0 `tab.create` calls and 0 `Bun.spawnSync` calls for the room, and `grep -c "ROOM" server/server/live/herdr-forward.ts` prints 0; the room of a macOS fake machine is read.
- locks: machine-room, file-server-server-live-herdr-forward-ts, file-src-real-world-ts, file-src-tick-project-ts, file-src-spread-ts
- after: none
- files: server/server/live/herdr-forward.ts, src/spread.ts, src/real-world.ts, src/tick-project.ts

### L581 Place by CPU and memory
Result: A task goes to the machine with the most free slots, CPU and memory, and ten starts in one tick never overbook a machine.
- why: placement checks memory only as a 1 GiB floor and reads the room once per tick, so 10 starts see the same room (findings 7).
- done when: a test with machines of 10, 12 and 25 slots, 8 GiB free on the first, and 45 ready steps starts at most `floor((free - reserve) / per-agent)` on each; no machine passes its slots or memory in the test; `mostRoom` has 0 callers that do not subtract placed tasks.
- locks: placement, file-src-rules-ts, file-src-tick-project-ts, file-src-spread-ts
- after: L580
- files: src/spread.ts, src/tick-project.ts, src/rules.ts

### L582 One task store
Result: Tasks, settings and push subscriptions live in one SQLite store of the main server, with no per-machine `tasks.json` or `remoteSeen` copy.
- why: 18 stores are written whole and 3 boards cause double steps; `remoteSeen` rewrites about 45 KB per project per tick and `writeJson` shares a fixed tmp name between processes (findings 5, 10, 11, 13).
- done when: `grep -rn "remoteSeen\|machineReads" src server | wc -l` prints 0; a test writes 1000 tasks from 4 concurrent callers and reads 1000 intact; `workers/*/tasks.json` is no longer created.
- locks: task-store, file-server-server-live-machines-helpers-ts, file-server-server-store-ts, file-server-server-push-ts, file-src-spread-ts
- after: none
- files: server/server/store.ts, server/server/push.ts, src/spread.ts, server/server/live/machines-helpers.ts

### L583 Atomic step claims
Result: A step is claimed by one insert, so two loops get one task and one refusal, and a silent machine's claim ends by lease.
- why: `startOn` sends secrets, clones and adds a task with no claim taken first; L455 and L443 ran twice; `SILENT_DROP_MS` holds a dead machine's locks 24 h (findings 8, 9).
- done when: a test starts one step from 2 racing loops 100 times and sees 100 times exactly 1 task; a claim whose worker closed its socket is released within 30 s in a test.
- locks: step-claim, file-src-real-world-ts, file-src-starts-ts, file-src-task-steps-ts, file-src-spread-ts
- after: L582
- files: src/spread.ts, src/starts.ts, src/task-steps.ts, src/real-world.ts

### L584 Settings never lose a model
Result: A bad or old `settings.json` stops with a message naming the file, and a migration is versioned, written atomically and keeps a backup.
- why: `readStored` returns `{}` on any error and the next `saveSetup` writes that over the file, so a migration dropped the model lists on two machines unseen (finding 12).
- done when: a test with a truncated `settings.json` sees an error naming the file and the file unchanged; a test migrating a v1 file to v2 keeps every role's model list and leaves `settings.json.v1.bak`; `lineclear doctor` prints the settings version of each machine.
- locks: settings-store, file-src-project-ts, file-src-doctor-ts
- after: none
- files: src/project.ts, src/doctor.ts

### L585 The link is one socket
Result: Each worker has one WebSocket and no 5 s snapshot poll, no file poll for its port, and no restart timer.
- why: `pollAll` fetches the full snapshot 12 times a minute per machine beside an open WebSocket, `look` reads a file every 300 ms for up to 60 s, and `WorkerHealth` restarts after 3 minutes instead of reconnecting (findings 16, 18, 19, 23).
- done when: a test with a fake worker counts 1 snapshot fetch in 60 s of idle (12 today per machine); `grep -c "setInterval" server/server/live/machines*.ts server/server/live/link-poll.ts` prints 0 apart from the sync timer; a killed link is back within 5 s in a test.
- locks: machine-link, file-server-server-live-machines-links-ts, file-server-server-live-machines-ts, file-server-server-live-recovery-ts, file-server-server-live-link-poll-ts
- after: none
- files: server/server/live/machines.ts, server/server/live/machines-links.ts, server/server/live/link-poll.ts, server/server/live/recovery.ts

### L586 Workers hold no state
Result: A worker is an executor with no store, no rule loop and no `last.json`; the main server reads its state from the worker when it connects.
- why: `keep` rewrites each machine's whole chat set every 5 s, `kept.ts` migrates it on every start, and each worker is a full second server (findings 14, 15, 34).
- done when: `server/server/live/kept.ts` no longer exists; a restart of the main server shows each machine's chats after the first worker snapshot with 0 files under `machines/`; the worker's resident memory is at most 150 MB in a measured run of `bun scripts/core-baseline.ts` (record the value in `docs/numbers.md`).
- locks: worker-state, file-server-server-live-machines-links-ts, file-server-server-main-ts, file-server-server-live-worker-process-ts
- after: L582, L585
- files: server/server/live/kept.ts, server/server/live/machines-links.ts, server/server/main.ts, server/server/live/worker-process.ts

### L587 One way to run on a machine
Result: One `ssh.ts` builds every SSH command and quotes it, and `runSync`, `tellRunBy` and the 2 s git read cache are gone.
- why: five places build an SSH command line and three copy `quote`; `runSync` freezes the server for the round trip (an estimated 100 ms each, 4.5 s for 45; not measured); `tellRunBy` fires an unchecked ssh on every probe (findings 26-30).
- done when: `grep -rn "Bun.spawnSync" server/server/live/box.ts` prints 0; `grep -rln "sshArgs" src server | wc -l` shows one definition; a test of 45 reads of a file on a fake box blocks the loop for under 50 ms in total.
- locks: ssh-one, file-src-spread-ts, file-server-server-live-install-ts
- after: none
- files: server/server/live/box.ts, src/ssh.ts, server/server/live/install.ts, src/spread.ts

### L588 Workers start without scraping
Result: A worker prints its address when it serves, a stopped one is awaited as a child process, and one is adopted only when its token matches.
- why: `setInterval(300)` waits for a port file, `running()` polls `kill(pid, 0)` every 2 s forever, and `commandOf` matches `ps` output (findings 18, 20-22).
- done when: `grep -c "setInterval" server/server/live/worker-process.ts` prints 0; a test starts a worker and sees its address with no file read; a reused pid is not adopted.
- locks: worker-process, file-server-server-live-machines-links-ts, file-server-server-main-ts, file-server-server-live-worker-process-ts
- after: L585
- files: server/server/live/worker-process.ts, server/server/live/machines-links.ts, server/server/main.ts

### L589 The tunnel has no heartbeat
Result: The tunnel has no `sleep 10` on the machine, no `rm -f` first and no `chown`; the worker connects out and agents use a local socket.
- why: each machine runs a shell poll every 10 s only to keep a forward alive (finding 33).
- done when: `grep -c "sleep" server/server/live/tunnel.ts` prints 0; a test kills the link and the agents' `lineclear` on the fake machine reaches the main server again within 5 s.
- locks: tunnel, file-helper-lineclear
- after: L586
- files: server/server/live/tunnel.ts, helper/lineclear

### L590 The helper goes in atomically
Result: The helper is extracted into a folder named by its version and switched by one symlink; the probe returns JSON from a script on the machine.
- why: `rm -rf bin skill; tar xf` leaves a window with no `lineclear` for an agent starting; `PROBE` scrapes `key=value` lines and a login shell's PATH with sed and a regex (findings 31, 32).
- done when: a test starts 50 `lineclear` calls while the helper updates and sees 0 failures; `grep -c "match(" server/server/live/install.ts` prints 0.
- locks: helper-install, file-helper-lineclear, file-server-server-live-install-ts
- after: L587
- files: server/server/live/install.ts, helper/lineclear

### L591 Updates drain a machine
Result: The plane has one version; a worker is updated only when it has no working task, one machine at a time.
- why: every machine updates in the same minute on the 15 s sync, with no check for work in flight beyond `MERGE_DEADLINE` (finding 38); `sync()` also runs 8 herdr process starts a minute and treats a failed read as an empty list (finding 17).
- done when: a test with 3 machines, one with a working task, sees the busy one updated last and never two updating at once; `herdr machine list` is started at most once per start and once per change in a 10-minute run; a failed read keeps every worker.
- locks: machine-update, file-server-server-live-machines-links-ts, file-server-server-live-machines-ts, file-server-server-live-install-ts
- after: L585
- files: server/server/live/machines.ts, server/server/live/install.ts, server/server/live/machines-links.ts

### L592 The update has one path
Result: `install.sh` updates by a version folder and an atomic symlink only, with no sleep, one health wait the service signals, and one rollback.
- why: `sleep 1`, a 2-minute check loop, two rollback paths and a store copy per update exist because the update can lose work (findings 35-37).
- done when: `grep -c "sleep" install.sh` prints 0; `grep -c "rollback" install.sh` shows one rollback function; the install test in CI updates from the previous release fixture and rolls back a failed one.
- locks: install-script, file-install-sh
- after: L584
- files: install.sh, test/install.test.ts

### L593 Actions to a machine are kept
Result: An action for a machine that is out of reach is stored with an id and delivered once; a failure shows in the machine's state.
- why: `forward().catch(() => waiting.push(a))` retries forever in memory and loses the list on a restart; four empty catches wait for the doctor (findings 24, 25).
- done when: a test queues 3 actions while a worker is down, restarts the main server, and sees each delivered exactly once when the worker is back; `grep -c "catch {" server/server/live/link-poll.ts` prints 0.
- locks: machine-actions, file-server-server-live-machines-links-ts, file-server-server-live-machines-actions-ts, file-server-server-live-link-poll-ts
- after: L582
- files: server/server/live/link-poll.ts, server/server/live/machines-links.ts, server/server/live/machines-actions.ts

### L600 Questions go to the project chat
Result: A question from a task lands in its project's chat first, and the Dispatcher chat gets it only when the project chat does not answer.
- why: 195 of 201 Inbox items in the measured burst were answerable by the Dispatcher, and 137 closed because the owner wrote to the task.
- done when: `lineclear ask` and `lineclear wait owner` from a task put a card in its project's chat, not the Inbox view; a test asks a question the roadmap answers and sees no owner push.
- locks: ask-route, file-src-asks-ts
- after: L485, L430
- files: src/asks.ts, src/cards.ts

### L601 The Dispatcher answers tasks
Result: The Dispatcher answers a task's question from the roadmap and docs and asks the owner only for a login, money, an outward act or a choice.
- why: the owner's model says the Dispatcher answers what the roadmap and docs answer; today the 168 stuck items and 11 step items reach a person.
- done when: the Dispatcher prompt names the four owner needs; an eval case in `test/dispatcher-eval/` asks a stuck task, a reviewer that did not answer and a licence choice, and sees an answer, an answer and an owner card.
- locks: dispatcher-answers, file-server-server-live-prompts-ts, file-src-dispatcher-ts
- after: L600
- files: src/dispatcher.ts, server/server/live/prompts.ts, test/dispatcher-eval

### L602 The Inbox keeps three kinds
Result: The Inbox has login, outward and choice items only, so a stuck task or a plan never becomes an item.
- why: of 201 items in the measured burst 168 were stuck, 14 plan and 12 step, and 97% of all were answered without the owner.
- done when: `src/inbox.ts` has the kinds `login`, `outward` and `choice`; `KIND_LABEL` and the code of `stuck`, `plan`, `step` and `release` are deleted with their tests; `wc -l` of `src/inbox.ts`, `src/inbox-answer.ts` and `src/notify.ts` is 400 or less in all (561 today).
- locks: inbox-kinds, file-src-inbox-ts, file-src-inbox-answer-ts, file-src-notify-ts
- after: L601, L430, L485
- files: src/inbox.ts, src/inbox-answer.ts, src/notify.ts

### L603 The Dispatcher plans itself
Result: A plan is written by the Dispatcher in its own chat, so no separate planning task starts and Settings has no planner model.
- why: `lineclear plan` starts a task agent only to write steps, which costs a worktree, a start and tokens that the Dispatcher already has in context.
- done when: `lineclear plan <project> "<goal>"` hands the goal to the Dispatcher chat and starts no task; `lineclear plan submit` and the rule checks run unchanged; `templates/plan.md` is read by the Dispatcher, and `models.planner` is gone from settings. A test plans a goal and sees no new task in `lineclear task list`.
- locks: dispatcher-plans, file-src-requests-ts, file-src-plan-ts, file-ui-web-roadmap
- after: L601, L496
- files: src/plan.ts, src/plan-brief.ts, src/requests.ts, templates/plan.md, ui/web/roadmap/since.tsx

### L604 A plan applies without the owner
Result: A plan that passes the rule checks applies by itself and can be undone from the chat, with no approval card.
- why: 9 of 14 plan items were approved without a note and 5 applied by themselves; none was rejected.
- done when: `plansAreAuto` is gone and a plan that passes `planProblems` merges; a rejected check sends it back to the Dispatcher; `lineclear undo` of an applied plan is reachable from the chat card; a test sees no Inbox item for a plan.
- locks: plan-apply, file-src-dispatcher-ts, file-src-autoplan-ts
- after: L603, L602
- files: src/autoplan.ts, src/dispatcher.ts

### L605 The Inbox view is gone
Result: The web UI has no Inbox page: `/inbox` and `/inbox/<ask>` land on the Dispatcher chat with the card.
- why: 3% of the items need the owner, and the chat shows those cards.
- done when: `ui/web/inbox-strip.tsx` and `ui/kit/inbox-card.tsx` no longer hold a view; `View` in `ui/web/routes.ts` has no `inbox`; an old `/inbox/7` link opens `/chat` on that card; `bun run ui:test` has no Inbox page screenshot.
- locks: view-inbox, file-ui-kit, file-ui-web-routes-ts, file-ui-web-inbox-strip-tsx, file-ui-web-app-tsx
- after: L602
- files: ui/web/routes.ts, ui/web/app.tsx, ui/web/inbox-strip.tsx, ui/kit/inbox-card.tsx

### L606 Home shows one Needs you line
Result: Home shows a single "Needs you" line when a login, money, an outward action or a product choice waits, and nothing when none does.
- why: the ask strip of 345 lines was built for 201 items in 7 hours; the owner's need is 1 or 2 a day.
- done when: `ui/web/home.tsx` shows the line with a link to the chat card; `wc -l ui/web/inbox-strip.tsx` is 120 or less or the file is deleted; the screenshot at 1440 and 390 px has the line, the empty state and 3 items.
- locks: home-needs, file-ui-web-home-table-tsx, file-ui-web-home-tsx, file-ui-web-home-rows-ts
- after: L605
- files: ui/web/home.tsx, ui/web/home-table.tsx, ui/web/home-rows.ts

### L607 Run commands of a chat gone
Result: `lineclear progress`, `checkpoint` and `complete` and stopping-goal runs no longer exist; a step's done-when is the one stopping goal.
- why: two ways to run a long goal (a stopping goal and a roadmap step) cost a second state and tokens.
- done when: the three commands are deleted from `src/cli.ts` and `server/server/live/source-cli.ts`; `autopilot-runs.json` is not read; `lineclear --help` lists none; the project chat still answers.
- locks: coordinator-cli, file-server-server-live-source-cli-ts, file-server-server-live-source-subcommands-ts, file-src-cli-ts
- after: L442
- files: src/cli.ts, server/server/live/source-cli.ts, server/server/live/source-subcommands.ts

### L608 Watch and backup are loop jobs
Result: The night watch is one message the rule loop sends only on a stall, and the hourly store copy is a plain rule-loop job.
- why: the rule loop already finds a stalled task and an unstarted step, so a model checklist every 2 hours at night costs tokens for what a program knows.
- done when: `src/night-watch.ts` is deleted or under 30 lines; a night tick with nothing stalled sends nothing; a test stalls a task at night and sees one Dispatcher message. `src/store-copies.ts` stays and is called from `rules.ts` only.
- locks: watch-backup, file-src-store-copies-ts, file-src-rules-ts, file-src-night-watch-ts
- after: L601
- files: src/night-watch.ts, src/rules.ts, src/store-copies.ts

### L609 Swarm against one agent
Result: A table shows merged steps per hour and tokens per merged step on the devbox, swarm against one agent, and names roles that cost too much.
- why: parallel work is worth keeping only if it merges more steps an hour for no more tokens each; no number says so today.
- done when: a doc in `docs/numbers.md` has two runs on the devbox on the same 5 steps with disjoint locks: the swarm as it runs and one pi agent in a row with the same model and review setting; each run lists merged steps per hour and tokens per merged step summed over every role; then the swarm run repeated with the planner, the coordinator, the night watch and the Inbox off one at a time. Each role whose run costs more tokens or time per merged step than it saves gets a step that deletes it.
- locks: swarm-measure, file-src-measure-ts
- after: L603, L608
- files: docs/numbers.md, src/measure.ts

## Open steps for the web

Steps W1 to W22 from [web-audit.md](web-audit.md), listed after the core steps. They hold the same `file-` locks.

### W1 The line fits its column
Result: The line on Home shows every project to its `main` end at 1440 and 390 px, with no clipped label or track.
- why: F1, F6: the `main` column and the right end of each track are cut off at both widths.
- done when: A screenshot test at 1440 and 390 px of Home with two projects shows the whole line; no element of `The line` has a right edge past its region; the "+3" chip names what it opens.
- locks: line, file-ui-kit, file-ui-web-home-tsx, file-ui-test-home-pw-ts, file-ui-test
- after: none
- files: ui/web/home.tsx, ui/kit, ui/test/home.pw.ts

### W2 The table shows facts
Result: Each working row shows its state, model and time, and long text ends in an ellipsis inside its cell.
- why: F2, F3, F5, F7: cells clip, empty values show as `-` and `0`, and the line repeats the table.
- done when: No cell is clipped by the table edge at 1440 or 390; a value that is not known is left out; the 390 row leads with its state; a test with a 200-character `Last` and 200 rows passes.
- locks: task-row, file-ui-web-home-table-tsx, file-ui-web-home-rows-ts, file-ui-test-home-pw-ts, file-ui-test
- after: none
- files: ui/web/home-table.tsx, ui/web/home-rows.ts, ui/test/home.pw.ts

### W3 The Dispatcher chat is real
Result: The Dispatcher panel shows only real lines, has an empty state, and opens from Home at 390 px.
- why: F4, F8, F19: fake repeated lines, no chat entry on mobile Home, a red Chat pill.
- done when: A fresh install's chat is empty with its composer; Home at 390 px has a chat entry; the Chat pill is not the broken colour; a test reads the panel on an empty config and fails on repeated or sample lines.
- locks: chat, file-ui-web-chat-samples-ts, file-ui-web-chat-tsx, file-ui-web-chat-view-tsx, file-ui-web-frame-tsx
- after: none
- files: ui/web/chat.tsx, ui/web/chat-view.tsx, ui/web/chat-samples.ts, ui/web/frame.tsx

### W4 Health shows one line
Result: The doctor's findings are one line with a count on Home and its commands appear only in Details.
- why: F9: raw doctor text, paths and `curl | sh` push the page's first content below the fold.
- done when: Home with 7 findings shows one line and a Details row at 390 and 1440 px, the first content stays above 400 px, and no command text shows outside Details.
- locks: home, file-ui-test
- after: none
- files: ui/web/alerts.tsx, ui/web/health.ts, ui/test/once.pw.ts

### W5 An empty Home has one next step
Result: A fresh install's Home shows one empty state with one next step instead of a repo picker and a second empty card.
- why: F10: two empty cards and nine equal repo chips.
- done when: Home with no tasks shows one empty state; the repo picker is a single field with at most 3 suggestions; screenshots at 1440 and 390 px.
- locks: home, file-ui-web-setup-tsx, file-ui-web-home-tsx, file-ui-web-settings-empty-ts
- after: W4
- files: ui/web/home.tsx, ui/web/setup.tsx, ui/web/settings-empty.ts

### W6 The frame leads to every view
Result: The rail and the bottom bar list Home, Inbox, Browsers and Settings with icons, and the Inbox carries the count.
- why: F11, F12, F21: no Inbox tab or count, a one-item bottom bar, Browsers unreachable.
- done when: Both bars list the views of design.md with `aria-current`, 44 px targets and the Inbox count; `/inbox` with no ask shows an Inbox view; `ui/test/frame.pw.ts` passes at 390, 768 and 1440 px.
- locks: shell, file-ui-web-routes-ts, file-ui-web-inbox-strip-tsx, file-ui-web-frame-tsx, file-ui-test
- after: none
- files: ui/web/frame.tsx, ui/web/inbox-strip.tsx, ui/web/routes.ts, ui/test/frame.pw.ts

### W7 The task page has one header
Result: A task page shows its title, state, step and model in one header with the tabs beneath it, and says once when there is no chat.
- why: F13, F14, F15: floating tabs, no state, an unknown id drawn as a real task, "no chat" three times.
- done when: The tabs align to the content edge at 1440 and 390 px; `/task/NOPE-9` shows a not-found state with a link Home; a task with no chat says it once with the composer off; screenshots at both widths.
- locks: task-row, file-ui-test, file-ui-web-task-tsx, file-ui-web-task-live-tsx, file-ui-test-task-pw-ts, file-ui-web-task-changes-tsx
- after: none
- files: ui/web/task.tsx, ui/web/task-live.tsx, ui/web/task-changes.tsx, ui/test/task.pw.ts

### W8 Settings has one source per tab
Result: Each Settings tab shows its own empty state or its data, never both, and its form fields align.
- why: F16, F17, F18: an empty harness card above a model list, the Projects empty card under Models, a broken price row.
- done when: Models shows either the no-harness card or the list; "No projects yet." appears only in Projects; the price row aligns on one baseline at 1440 and 390 px; screenshots of each tab in both states.
- locks: settings, file-ui-web-settings-samples-ts, file-ui-web-settings-empty-ts
- after: none
- files: ui/web/settings.tsx, ui/web/settings-models.tsx, ui/web/settings-empty.ts, ui/web/settings-samples.ts

### W9 Roadmap bars use the track style
Result: A project's roadmap shows its phase bar in the track style with a count that matches the line and spacing from the scale.
- why: F20: a focus-ring-looking bar, "0/4" against "2 done", loose gaps.
- done when: The bar has no outline at rest; the phase count equals the summary; gaps are values from the 8 px scale; screenshot at 1440 and 390 px.
- locks: roadmap, file-ui-web-roadmap, file-ui-test
- after: none
- files: ui/web/roadmap, ui/test/roadmap.pw.ts

### W10 The demo covers every state
Result: The demo states (`?state=`) hold a chat, changes, a long task title and 200 tasks in one project, so each state of the UI bar can be shot.
- why: F22: demo tasks have no chat, so the task tabs and the long-text and 200-item states cannot be reached.
- done when: The demo has one task with a chat and a change, one with a 200-character title (`?state=title`) and a project with 200 tasks (`?state=tasks200`); `ui/test` shoots each at 1440 and 390 px.
- locks: file-ui-web-samples-ts, file-ui-test
- after: none
- files: ui/web/samples.ts, ui/test

### W11 A missing page says so
Result: A roadmap, task or view that cannot load shows its state inside the frame with a way back, never a black screen or another page.
- why: F27, F29: a 404 roadmap is blank, `/browsers` draws Home, and the not-found task marks Inbox.
- done when: `/<project>/roadmap` for an unknown project, a failed API call and `/browsers` with no session each show a named state in the frame at 1440 and 390 px; the not-found page marks no view as current; a test covers each.
- locks: routes, file-ui-web-routes-ts, file-ui-web-app-tsx, file-ui-web-frame-tsx, file-ui-test
- after: none
- files: ui/web/app.tsx, ui/web/routes.ts, ui/web/frame.tsx, ui/test/errors.pw.ts

### W12 The line never cuts a project
Result: Home's line shows every project whole, however many there are.
- why: F23: the fifth project's track is cut in half at the region's edge.
- done when: With `?state=many` and `?state=tasks200` no track is cut by its region at 1440 and 390 px; a region that scrolls has a visible edge; screenshots at both widths.
- locks: line, file-ui-kit, file-ui-web-home-tsx, file-ui-test
- after: none
- files: ui/web/home.tsx, ui/kit, ui/test/home-line.pw.ts

### W13 The table says what it cuts
Result: A cut value in the table can be read in full, and Time is how long the task has run.
- why: F25: ellipsised state, model and last line with no way to read them; "7 days" for a running task.
- done when: Each cut cell has the full text in its title and in the row's detail; Time is the run time of the task; a test with a 200-character `Last` reads it in full.
- locks: task-row, file-ui-web-home-table-tsx, file-ui-web-home-rows-ts, file-ui-test-home-pw-ts, file-ui-test
- after: none
- files: ui/web/home-table.tsx, ui/web/home-rows.ts, ui/test/home.pw.ts

### W14 The table head sorts
Result: At 390 px the table head is a labelled sort control and the first row of what needs me is above the fold.
- why: F26: three unlabelled grey boxes and a table 900 px down.
- done when: The head says "Sort by" with the current key; with `?state=many` at 390 px the first table row starts above 700 px; screenshot at 390 px.
- locks: table-head, file-ui-web-home-table-tsx, file-ui-web-home-tsx, file-ui-test-home-pw-ts, file-ui-test
- after: W12, W13
- files: ui/web/home-table.tsx, ui/web/home.tsx, ui/test/home.pw.ts

### W15 The chat folds repeats
Result: The Dispatcher panel shows one line with a count for a repeated notice and stays fast at 200 messages.
- why: F24: the same sentence six times on a fresh install, and every message drawn at 200.
- done when: Six equal notices in a row show as one with "x6"; 200 messages draw at most 40 nodes and scroll to the newest; a test on an empty config fails on repeats.
- locks: chat, file-ui-web-chat-samples-ts, file-ui-web-chat-tsx, file-ui-web-chat-view-tsx, file-ui-test
- after: none
- files: ui/web/chat.tsx, ui/web/chat-view.tsx, ui/web/chat-samples.ts, ui/test/chat-panel.pw.ts

### W16 The task page header
Result: A task page opens on one header with title, state, step and model, with the tabs on the content edge.
- why: F28: only tabs and chat show, and the tabs sit 12 px off the column.
- done when: The header shows the four facts at 1440 and 390 px; the tabs share the chat column's left edge; screenshots at both widths and with a 200-character title.
- locks: task-page, file-ui-web-task-tsx, file-ui-web-task-live-tsx, file-ui-test-task-pw-ts, file-ui-test
- after: none
- files: ui/web/task.tsx, ui/web/task-live.tsx, ui/test/task.pw.ts

### W17 The task tabs draw every state
Result: Terminal and Changes each have a drawn loading, empty, error and long state.
- why: F35: only Chat and Changes are sampled, and only filled.
- done when: A sample per tab and state exists (`?state=` on the task page); each is shot at 1440 and 390 px; none shows raw error text.
- locks: task-tabs, file-ui-web-samples-ts, file-ui-web-lazy-samples-ts, file-ui-web-task-changes-tsx, file-ui-test
- after: none
- files: ui/web/task-changes.tsx, ui/web/samples.ts, ui/web/lazy-samples.ts, ui/test/demo-states.pw.ts

### W18 The Inbox lists the asks
Result: The Inbox view lists every ask, windowed at 200, with the real count.
- why: F30: one card and a link for 199 asks, and a "99+" count.
- done when: `/inbox?state=many` shows a list with the newest first and at most 40 nodes drawn; the count in the rail and bar shows the number up to 999; screenshots at both widths.
- locks: inbox, file-ui-web-inbox-strip-tsx, file-ui-web-frame-tsx, file-ui-test
- after: W11
- files: ui/web/inbox-strip.tsx, ui/web/frame.tsx, ui/test/home-inbox.pw.ts

### W19 Settings draws every state
Result: Each Settings tab shows named loading, empty and error states, and the notify link is a row inside a tab.
- why: F31: a ghost bar that never resolves, and a bare link under the card.
- done when: Each tab has a shot of each state at 1440 and 390 px; the notify link is in the Secrets tab; no ghost bar stays after the data loaded.
- locks: settings, file-ui-test
- after: none
- files: ui/web/settings.tsx, ui/web/settings-models.tsx, ui/web/settings-account.ts, ui/test/settings.pw.ts

### W20 Usage sits in the frame
Result: Usage shows inside the frame, without a focus ring on load, and says so when there is no use.
- why: F32: no rail or bar, an orange ring on Close, and "$0.00" over an empty chart.
- done when: `/usage` shows the rail at 1440 and the bar at 390 px; no element has focus on load; zero use shows one sentence; screenshots at both widths.
- locks: usage, file-ui-test
- after: none
- files: ui/web/usage-sheet.tsx, ui/web/usage-mark.tsx, ui/test/usage-inbox.pw.ts

### W21 The roadmap opens short
Result: The roadmap opens on a short status and at most a few steps, not a run-on sentence and repeated card text.
- why: F33: a 200-character status and "A customer can X and it just works." on every card.
- done when: The status is under 80 characters with the reason in Details; a card shows its result only when it differs from its title; screenshots at 1440 and 390 px.
- locks: roadmap, file-ui-web-roadmap, file-ui-test
- after: none
- files: ui/web/roadmap, ui/test/roadmap.pw.ts

### W22 State changes have named motion
Result: Route changes, tab switches, list additions and the Dispatcher panel each play a named motion from the kit, and none under reduced motion.
- why: F34: only the kit handles reduced motion, and the web pages have almost no motion.
- done when: Each of the four has a motion id in `ui/kit/motion.ts`; a test with `prefers-reduced-motion: reduce` sees none play; a performance trace of each stays at 60 fps and a recording of each is stored.
- locks: motion, file-ui-web-app-tsx, file-ui-kit, file-ui-test
- after: W11, W16, W18
- files: ui/kit/motion.ts, ui/kit/kit.css, ui/web/app.tsx, ui/test/kit.pw.ts

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
