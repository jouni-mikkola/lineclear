# Plan v0.2: code layout

Part of the v0.2 plan: the layout of the code, so parallel steps by humans and agents do not collide. The lead plan
ranks and merges these steps; ids L760 to L789. Numbers are from `origin/main` at `b9c534126` (7 Nov 2026).

## What is wrong today

Collisions, measured over the merged pull requests of the last 3 days (295, all within 22 hours):

- 494 of 1,528 touched files were changed by more than one PR (`git log --first-parent --name-only`); 25 by more than 10.
- 49 PRs were rebased (79 force pushes, read from GitHub's `HeadRefForcePushedEvent`). Replaying each rebase with
  `git merge-tree --write-tree <new base> <old head>`: 29 PRs (9.8 per 100) hit a conflict, on 120 files.
- 46 of the 120 conflicted files are gone from main: a delete step raced steps that edited the same files
  (`server/server/demo/*` 16, `server/docs/plugins.md` 4, `server/plugins.json` 3).
- 10 "Fix main red" commits and 25 steps merged more than once (39 extra merges) in the same window.

The hubs: files that most changes edit, whatever their job.

| File | PRs | Conflicts | Why every change edits it |
| --- | ---: | ---: | --- |
| `src/cli.ts` | 32 | 3 | the `commands` table and an import of every command |
| `src/rules.ts`, `src/tick-project.ts` | 21, 19 | 0 | every loop job is a call in one tick function |
| `scripts/check.ts` | 20 | 2 | test discovery, shards and timing in one file |
| `docs/ROADMAP.md` | 19 | 0 | one file for every step of every plan (3 plan tasks write it now) |
| `src/doctor.ts` | 18 | 3 | every check is a call in one function |
| `docs/architecture.md` | 17 | 2 | the borders table: a new module is a new row |
| `server/server/live/source-cli.ts` | 16 | 2 | the board's words: one object of inline handlers |
| `server/server/live/prompts.ts` | 11 | 2 | every role's prompt text in one file |
| `server/shared/types-core.ts`, `types-snapshot.ts` | 11, 8 | 2 | wire types of every domain in two files |
| `docs/numbers.md` | 11 | 1 | every measure in one file |
| `knip.jsonc` | 7 | 3 | a new entry file is a new line |
| `pi/extension.ts`, `server/server/app.ts` | 9, 9 | 3, 3 | every hook, every route |
| `server/test/source-b.test.ts` to `-g`, `source-fixture.ts` | 12, 7 | 2 | 16 test files split by letter, not by module |

The tree: `src/` holds 125 files in one flat folder, `server/server/live/` 79, `test/` 127 and `server/test/` 105.
Tests sit in a second tree, so a step edits two folders. The architecture's `check-line` module is a grab bag
(machine names, GitHub checks, the work log, git, time): there is no lower layer. `server/` is a second package with
its own `package.json`, `bun.lock`, `tsconfig.json`, test runner (`server/scripts/test.ts`, 215 lines) and 9 docs of
the fork (`server/docs/`, 593 lines). Lines today (scope.md's rule): 45,829 non-test; 30,644 in the test folders.

## Target design

Group by domain, not by kind: code that changes together sits together (Nx groups libraries by domain and enforces
dependency rules with a lint rule, [nx.dev](https://nx.dev/docs/kb/folder-structure),
[boundaries](https://nx.dev/docs/kb/enforce-module-boundaries)). Layers go one way: VS Code's `base` imports nothing
and `platform`, `editor`, `workbench` build on it, with tests beside each area
([source code organization](https://github.com/microsoft/vscode/wiki/source-code-organization)). Agent tools do the
same: opencode keeps a folder per domain in `packages/core/src` (`session/`, `tool/`, `permission/`, `worktree/`)
and an `AGENTS.md` per package ([anomalyco/opencode](https://github.com/anomalyco/opencode)); pi splits `ai`,
`agent`, `coding-agent` and `tui` into packages ([earendil-works/pi](https://github.com/earendil-works/pi)).
A list that every change appends to becomes one file per item: Changesets keeps each change in its own file
([FAQ](https://github.com/changesets/changesets/blob/main/docs/common-questions.md)), Kubernetes one folder per KEP
([keps/](https://github.com/kubernetes/enhancements/tree/master/keps)).

One package. Under `src/`: `base/` (layer 0: git, gh, herdr client, store, paths, time, process, ssh; imports none of
ours), then one folder per domain (layer 1: `plan`, `loop`, `engine`, `agents`, `chats`, `machines`, `settings`,
`secrets`, `install`, `doctor`), then the wiring (layer 2: `board` the server process, `cli`, `web`; nothing imports
them). `ui/`, `pi/` and `scripts/` keep their place. Each folder has a `README.md` whose first lines are its row:
`Owns`, `May import`, `Lines` (a budget); the borders gate reads them, so no central table. Each folder has one owner
module named like the folder (`plan/plan.ts`): other folders import only that file. Tests sit beside the file they
test (`plan/roadmap.test.ts`); a folder's fixture is `testing.ts` in it.

No hubs: a CLI word is a file in `cli/words/`, a board word a file in `board/words/`, a doctor check a file in
`doctor/`, a tick job a file in `loop/jobs/`, a prompt a file per role, a step a file in `docs/roadmap/`, a measure
a file in `docs/numbers/`. Knip finds them by glob. Adding one is a new file, never an edit of a shared one.

Line target for v0.2, by scope.md's rule: **non-test at most 40,000** (45,829 today: the open roadmap deletions
L541 to L548, L567, L602 to L605 plan about 3,700, this plan about 300 with the second test runner and the two
word tables; L789 cuts the last 1,800 by folder budget), and **tests at most 26,000** (30,644 today: lettered and step-named test
files merge by module).

## What scope.md and roles.md mark gone

| Gone | Step |
| --- | --- |
| The fork's own docs and guidance (`server/docs/`, `server/README.md`, `server/AGENTS.md`, `server/CLAUDE.md`) | L775 |
| The second package's tooling (`server/package.json`, `bun.lock`, `tsconfig.json`, `bunfig.toml`, `scripts/test.ts`) | L776 |
| The `check-line` grab bag of architecture.md | L777 |
| The planner, Inbox view and kinds, night watch as a role | L602 to L605, L608 (open); the `planner` and `inbox` icons of `ui/brand/roles.ts` go with L603 and L605 |

## Ranks and waves

Priorities (owner): 1 core loop, 2 simple (cleanup and layout), 3 tokens, 4 any project, 5 web. Every step here is
rank 2; L762 to L764 serve 4 too (any repo gets step files), L769 serves 3 (a prompt's size per role). Moves come after
the core steps that touch the same files (`after`), so rank 1 is never held up by a move.

- Wave 1, at once (disjoint files): L760, L761, L762, L769, L775.
- Wave 2: L763, L766, L767, L768, L776 (after L760 or a wave 1 step); L773 and L774 once L609 lands.
- Wave 3, one folder each: L777, then L765, L770 to L772, L778 to L788 as their `after` steps land.
- Last: L764 (after the lead plan's ROADMAP.md edits), L789.

A move step moves each moved file's tests (`test/<name>*.test.ts`, `server/test/<name>*.test.ts`) beside it, and
rewrites imports in other files; git follows the renamed files on a rebase, so a concurrent step conflicts only on
its import lines. L95 and U43 are frozen by the owner: they are not in any `after`; their `files` lines take the new
paths when they open.

## Steps

### L760 Tests may sit beside code
Result: A test file next to its module runs in the check, so a step changes one folder, not two.
- why: `src/` and `test/` are two trees (125 and 127 files); `scripts/changed.ts` picks only `test/*.test.ts`.
- done when: `src/x/y.test.ts` beside `y.ts` runs in `lineclear check --changed` and in the full check's shards; knip's entry globs cover `src/**/*.test.ts`, `src/cli/words/*.ts`, `server/server/live/words/*.ts` and `src/doctor/*.ts`; `test/changed.test.ts` plants a test beside a module and sees it picked.
- locks: check-ci, file-scripts-check-ts, file-knip-jsonc
- after: none
- files: scripts/changed.ts, scripts/check.ts, scripts/load-map.ts, knip.jsonc, test/changed.test.ts

### L761 Borders live in each folder
Result: A new module states its own border in its folder; nobody edits a central table to add one.
- why: `docs/architecture.md` was changed by 17 PRs in 3 days, 2 of them with a conflict, because its table lists every module.
- done when: `scripts/gates/borders.ts` reads `Owns`, `May import` and `Lines` from the first lines of a folder's `README.md`; architecture.md keeps only the layer rules (0 table rows); a new `test/borders.test.ts` adds a folder with a README and sees a forbidden import fail with no edit to architecture.md.
- locks: borders, file-docs-architecture-md
- after: none
- files: scripts/gates/borders.ts, docs/architecture.md, test/borders.test.ts

### L762 The roadmap reads step files
Result: A project's steps are read from one file per step, so two plans never edit the same file.
- why: `docs/ROADMAP.md` is one file for every step; 3 plan tasks write it at once today.
- done when: `roadmapSource` reads `docs/roadmap/<id>.md` when the folder exists (joined in id order, so the parser is unchanged) and `docs/ROADMAP.md` otherwise; `lineclear roadmap check .` checks the folder; a test reads 3 step files and checks one with a bad title.
- locks: roadmap-read, file-src-roadmap-source-ts
- after: none
- files: src/roadmap-source.ts, src/roadmap-cli.ts, test/roadmap.test.ts

### L763 Plans write step files
Result: A plan that applies adds or edits one file per step, in any repo, even one with no docs folder.
- why: a plan apply rewrites the whole roadmap file, which collides with every other plan.
- done when: plan apply writes `docs/roadmap/<id>.md` per changed step and deletes the file of a dropped step; on a second small repo with no `docs/`, a plan creates the folder; a test applies two plans with disjoint steps and sees no conflict.
- locks: plan-apply-files, file-src-plan-apply-ts
- after: L762
- files: src/plan-apply.ts, src/add-project.ts, test/autoplan-apply.test.ts, test/plan.test.ts

### L764 Every roadmap is split
Result: This repo and every registered project keep their steps as files, and the single-file reader is gone.
- why: two formats are two ways to do one job; L762 reads both only until every project is split.
- done when: `lineclear roadmap split <project>` writes one file per open step and a short `docs/roadmap/README.md`; it ran on every project of `lineclear project list`; `git grep -n "ROADMAP.md" src` lists none; `lineclear roadmap check .` passes.
- locks: roadmap-read, file-src-roadmap-source-ts, file-docs-roadmap-md
- after: L762, L763
- files: src/roadmap-source.ts, src/roadmap-cli.ts, docs/ROADMAP.md, docs/roadmap/

### L765 The install folder
Result: Install, update, uninstall and the store copies live in one folder with their tests.
- why: 9 install files sit among 125 flat files in `src/`.
- done when: `src/install/` holds `install-paths`, `builds`, `uninstall`, `store-copies`, `health`, `board`, `serve`, `reaper` and their tests, with a README row; `ls src/*.ts` lists none of them; gates green.
- locks: layout-install, file-src-store-copies-ts, file-src-serve-ts
- after: L545, L546, L608, L777
- files: src/install/, src/install-paths.ts, src/builds.ts, src/uninstall.ts, src/store-copies.ts, src/health.ts, src/board.ts, src/serve.ts, src/reaper.ts

### L766 One file per CLI word
Result: A new `lineclear` word is one new file; `src/cli.ts` no longer changes with every command.
- why: `src/cli.ts` was changed by 32 PRs in 3 days, 3 with a conflict: one `commands` table and an import of each command.
- done when: `src/cli/words/<word>.ts` exports `about` and `run`; `src/cli/cli.ts` loads the word's file by name and is at most 80 lines; `lineclear --help` lists the folder; a test adds a word file in a temp copy and sees it in help.
- locks: cli-words, file-src-cli-ts
- after: L760
- files: src/cli.ts, src/cli/, bin/lineclear, test/cli.test.ts

### L767 One file per board word
Result: A new board word is one new file; the board's word object is gone.
- why: `source-cli.ts` (278 lines) was changed by 16 PRs, 2 with a conflict.
- done when: `server/server/live/words/<word>.ts` holds each word; `source-cli.ts` and `source-subcommands.ts` are deleted; the board loads a word by name; `server/test/cli.test.ts` passes unchanged.
- locks: board-words, file-server-server-live-source-cli-ts
- after: L760
- files: server/server/live/source-cli.ts, server/server/live/source-subcommands.ts, server/server/live/words/, server/test/cli.test.ts

### L768 Doctor checks one file each
Result: A new doctor check is one new file; `src/doctor.ts` only runs them.
- why: `src/doctor.ts` (422 lines) was changed by 18 PRs, 3 with a conflict.
- done when: each check is `src/doctor/<check>.ts`; `src/doctor/doctor.ts` runs every file of the folder and is at most 100 lines; `test/doctor.test.ts` passes and adds a check file in a temp copy.
- locks: doctor, file-src-doctor-ts
- after: L760, L541
- files: src/doctor.ts, src/doctor-task-ids.ts, src/doctor/, test/doctor.test.ts

### L769 One prompt file per role
Result: Each role's prompt is its own file, so its size per role can be read and budgeted.
- why: `prompts.ts` holds every role's text; 11 PRs changed it, 2 with a conflict.
- done when: `server/skill/prompts/<role>.md` holds each role's text; `prompts.ts` only fills them in and is at most 60 lines; `wc -c server/skill/prompts/*.md` prints one size per role; the prompt tests pass.
- locks: agent-prompt, file-server-server-live-prompts-ts
- after: none
- files: server/server/live/prompts.ts, server/skill/prompts/

### L770 Wire types per domain
Result: A type change touches its domain's types file, not one shared catalog.
- why: `types-core.ts` (319 lines) and `types-snapshot.ts` were changed by 19 PRs, 2 with a conflict.
- done when: `server/shared/types/<domain>.ts` holds each domain's types; `types-core.ts`, `types.ts` and `types-snapshot.ts` are gone; no file in `server/shared/types/` is over 150 lines; `bun run types` is green on GitHub.
- locks: wire-types
- after: L521, L541
- files: server/shared/types-core.ts, server/shared/types.ts, server/shared/types-snapshot.ts, server/shared/types-chat.ts, server/shared/types/

### L771 Source tests by module
Result: The live source's tests are named by the module they test, so two steps rarely edit one test file.
- why: 6 lettered files `source-b` to `source-g` plus `source-fixture.ts` collect tests by when they were written.
- done when: `ls server/test | grep -cE 'source-[b-g]\.test\.ts'` prints 0; each test file names one module; the test count is the same or lower with no case lost (a list of `test(` names before and after).
- locks: source-tests
- after: L544
- files: server/test/source.test.ts, server/test/source-b.test.ts, server/test/source-c.test.ts, server/test/source-d.test.ts, server/test/source-e.test.ts, server/test/source-f.test.ts, server/test/source-g.test.ts, server/test/source-fixture.ts

### L772 Engine tests by module
Result: The engine's tests are named by module, so engine steps edit their own test file.
- why: 8 lettered files (`engine-b`, `engine-merge-b` to `-d`, `engine-queue-b`, `-c`, `live-b`, `-c`) split tests by size.
- done when: `ls server/test | grep -cE '^(engine|live).*-[b-h]\.test\.ts'` prints 0; no case lost (a list of `test(` names before and after).
- locks: engine-tests
- after: L521, L522, L523, L525
- files: server/test/engine-b.test.ts, server/test/engine-c.test.ts, server/test/engine-merge-b.test.ts, server/test/engine-merge-c.test.ts, server/test/engine-merge-d.test.ts, server/test/engine-queue-b.test.ts, server/test/engine-queue-c.test.ts, server/test/live-b.test.ts, server/test/live-c.test.ts

### L773 One file per measure
Result: Each measure has its own page in `docs/numbers/`, so two measuring steps never edit one file.
- why: `docs/numbers.md` was changed by 11 PRs, 1 with a conflict.
- done when: `docs/numbers/<measure>.md` holds each section; `docs/numbers.md` is gone; `git grep -n "numbers.md"` lists none outside git history.
- locks: numbers-doc, file-docs-numbers-md
- after: L760, L609
- files: docs/numbers.md, docs/numbers/, scripts/check-speed.ts, scripts/core-baseline.ts, scripts/check.ts

### L774 Collisions can be measured
Result: One command prints how many merged PRs hit a rebase conflict and which files many PRs touch.
- why: the numbers above were taken by hand; the layout's goal needs a number anyone can rerun.
- done when: `bun scripts/core-baseline.ts collisions <n>` replays the force pushes of the last n merged PRs with `git merge-tree` and prints conflicting PRs per 100 and files touched by more than 10 PRs; run on today's window it prints 29 of 295; a test replays a planted conflict.
- locks: core-baseline
- after: L773
- files: scripts/core-baseline.ts, test/core-baseline.test.ts

### L775 The fork's leftovers are gone
Result: The repo has one set of docs and guidance; the fork's own docs are gone.
- why: `server/docs/` (9 files, 593 lines), `server/README.md`, `server/AGENTS.md` and `server/CLAUDE.md` describe the fork, not Lineclear.
- done when: `git ls-files server/docs server/README.md server/AGENTS.md server/CLAUDE.md` lists none; `server/LICENSE` and `server/NOTICE` stay; `git grep -n "server/docs"` lists none.
- locks: fork-docs
- after: none
- files: server/docs/, server/README.md, server/AGENTS.md, server/CLAUDE.md

### L776 One package, one lock file
Result: The repo has one package, one lock file and one test runner.
- why: `server/` repeats `package.json`, `bun.lock`, `tsconfig.json` and a 215-line test runner; each conflicted in the last 3 days.
- done when: `git ls-files server/package.json server/bun.lock server/tsconfig.json server/bunfig.toml server/scripts/test.ts` lists none; the root `bun test` runs the server's tests; the full check on GitHub is green with the same test count.
- locks: one-package, file-package-json, file-tsconfig-json
- after: L760
- files: server/package.json, server/bun.lock, server/tsconfig.json, server/bunfig.toml, server/scripts/test.ts, package.json, tsconfig.json, bun.lock, .github/workflows/check.yml

### L777 The base layer
Result: Code every domain needs lives in `src/base/`, which imports nothing else of Lineclear.
- why: the `check-line` module is a grab bag, and git, paths, time and the store sit in three places.
- done when: `src/base/` holds `git`, `time`, `zone`, `paths`, `herdr`, `ssh`, `process-group`, `tmpdirs`, `main-branch`, `server/server/store.ts` and `server/shared/` helpers, with tests beside them; its README says `May import: none`; `check-line` is gone; gates green.
- locks: layout-base
- after: L582, L587, L761, L770, L776
- files: src/base/, src/git.ts, src/time.ts, src/zone.ts, src/paths.ts, src/herdr.ts, src/ssh.ts, src/process-group.ts, src/tmpdirs.ts, src/main-branch.ts, server/server/store.ts, server/shared/

### L778 The plan folder
Result: The roadmap, plan apply and the step check live in `src/plan/` with their tests.
- why: 16 plan files are spread among 125 in `src/`, their tests in `test/`.
- done when: `src/plan/` holds `roadmap*`, `plan*`, `autoplan`, `stepcheck`, `parts`, `direction`, `reader-ask`, `step-check-cost`, `ask-model` and their tests; owner module `src/plan/plan.ts`; gates green.
- locks: layout-plan, autoplan, file-src-plan-ts, file-src-autoplan-ts
- after: L547, L564, L567, L603, L604, L764, L777
- files: src/plan/, src/roadmap.ts, src/roadmap-cli.ts, src/roadmap-line.ts, src/roadmap-source.ts, src/roadmap-view.ts, src/plan.ts, src/plan-apply.ts, src/plan-brief.ts, src/autoplan.ts, src/stepcheck.ts, src/parts.ts, src/direction.ts, src/reader-ask.ts, src/step-check-cost.ts, src/ask-model.ts

### L779 The loop folder
Result: The rule loop's files live in `src/loop/` with their tests.
- why: 16 loop files sit flat in `src/`; `rules.ts` and `tick-project.ts` were changed by 40 PRs together.
- done when: `src/loop/` holds `rules`, `tick-project`, `starts`, `stalls`, `stall-class`, `waits*`, `waiting`, `world`, `task-steps`, `owner-steps`, `routine`, `hold`, `heal`, `night-watch`, `decision-dedupe`, `start-failures` and tests; owner `src/loop/loop.ts`; gates green.
- locks: layout-loop, slots, file-src-rules-ts, file-src-tick-project-ts
- after: L545, L546, L547, L548, L561, L562, L563, L564, L567, L580, L581, L583, L608, L777
- files: src/loop/, src/rules.ts, src/tick-project.ts, src/starts.ts, src/stalls.ts, src/stall-class.ts, src/waits.ts, src/wait-service.ts, src/waiting.ts, src/world.ts, src/task-steps.ts, src/owner-steps.ts, src/routine.ts, src/hold.ts, src/heal.ts, src/night-watch.ts, src/decision-dedupe.ts, src/start-failures.ts

### L780 Tick jobs one file each
Result: A new loop job is one file in `src/loop/jobs/`; the tick only runs them in order.
- why: every loop job is a call inside one tick function, so loop steps all edit it.
- done when: each job of a tick is `src/loop/jobs/<nn>-<job>.ts` (`nn` is its order); the tick is at most 80 lines and runs the folder; the loop tests pass unchanged.
- locks: layout-loop, slots
- after: L779
- files: src/loop/jobs/, src/loop/tick-project.ts, src/loop/rules.ts

### L781 The engine folder
Result: The task engine lives in `src/engine/` with its tests beside it.
- why: the engine is split between `server/server/live/engine/` (28 files) and 22 test files in `server/test/`.
- done when: `src/engine/` holds the engine files, `restart.ts` and `task-ids.ts`, tests beside them; owner `src/engine/engine.ts`; gates green.
- locks: layout-engine, engine-compose, task-phase
- after: L503, L506, L521, L522, L523, L525, L529, L541, L544, L547, L772, L777
- files: src/engine/, server/server/live/engine/, server/server/live/restart.ts, server/server/live/task-ids.ts

### L782 The agents folder
Result: Starting, feeding and reviving pi agents lives in `src/agents/`.
- why: 20 agent files sit among 79 flat files of `server/server/live/`.
- done when: `src/agents/` holds `agent*`, `agents*`, `readers/`, `prompts`, `paste-watch`, `requested-news`, `revive`, `quiet`, `terminal-clock`, `log-list`, `log-tail` and tests; owner `src/agents/agents.ts`; gates green.
- locks: layout-agents, agent-delivery
- after: L502, L503, L508, L510, L542, L769, L777
- files: src/agents/, server/server/live/agents.ts, server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/agents-sending.ts, server/server/live/agents-helpers.ts, server/server/live/agent-start.ts, server/server/live/agent-process.ts, server/server/live/readers/, server/server/live/prompts.ts, server/server/live/revive.ts

### L783 The chats folder
Result: The Dispatcher, project chats, asks and pushes live in `src/chats/`.
- why: chat code is in two packages: `server/server/live/chats*` and `src/chat*`, `asks`, `inbox*`.
- done when: `src/chats/` holds the server's `chats*`, `chatlines`, `chatquotes` and `src/chat*`, `dispatcher`, `asks`, `inbox*`, `cards`, `notify`, `requests`, `resolve` with tests; owner `src/chats/chats.ts`; gates green.
- locks: layout-chats, inbox-path, file-src-asks-ts, file-src-inbox-ts
- after: L543, L545, L548, L600, L602, L603, L604, L605, L777
- files: src/chats/, server/server/live/chats.ts, server/server/live/chats-logs.ts, server/server/live/chatlines.ts, src/chat.ts, src/dispatcher.ts, src/asks.ts, src/inbox.ts, src/inbox-answer.ts, src/cards.ts, src/notify.ts, src/requests.ts, src/resolve.ts

### L784 The machines folder
Result: Workers, links, the room and placement live in `src/machines/`.
- why: machine code is in `server/server/live/machines*`, `box`, `tunnel`, `install` and `src/spread.ts`.
- done when: `src/machines/` holds them with tests; owner `src/machines/machines.ts`; gates green.
- locks: layout-machines, machine-link, machine-room
- after: L549, L580, L581, L582, L583, L585, L586, L587, L588, L589, L590, L591, L593, L777
- files: src/machines/, server/server/live/machines.ts, server/server/live/machines-links.ts, server/server/live/machines-helpers.ts, server/server/live/machines-actions.ts, server/server/live/box.ts, server/server/live/tunnel.ts, server/server/live/install.ts, server/server/live/herdr-forward.ts, server/server/live/link-poll.ts, server/server/live/worker-process.ts, src/spread.ts

### L785 The settings folder
Result: Settings, models, accounts and projects live in `src/settings/`.
- why: settings are read in two packages (`settings-store.ts`, `src/project*.ts`, `src/models.ts`).
- done when: `src/settings/` holds `settings-*`, `project-models`, `places`, `models`, `project*`, `setup`, `fill-setup`, `company`, `full`, `harness-pi`, `session-text`, `measure`, `task-work` and tests; owner `src/settings/settings.ts`; gates green.
- locks: layout-settings, cli-settings
- after: L543, L544, L545, L547, L549, L567, L609, L777
- files: src/settings/, server/server/live/settings-store.ts, server/server/live/settings-catalog.ts, server/server/live/project-models.ts, server/server/live/places.ts, src/models.ts, src/project.ts, src/setup.ts, src/measure.ts, src/task-work.ts

### L786 The secrets folder
Result: The vault, login codes and the page guard live in `src/secrets/`.
- why: secrets code is in `server/server/live/secret*` and `src/totp.ts`, `web-guard.ts`, `published.ts`.
- done when: `src/secrets/` holds them with tests; owner `src/secrets/secrets.ts`; gates green.
- locks: layout-secrets
- after: L549, L777
- files: src/secrets/, server/server/live/secrets.ts, server/server/live/secret-access.ts, server/server/live/secret-paths.ts, src/totp.ts, src/web-guard.ts, src/published.ts

### L787 The board folder
Result: The board server process and its words live in `src/board/` and only wire the domains.
- why: `server/server/` mixes the process (`app`, `main`, `lock`) with 22 `source-*` files of the live source.
- done when: `src/board/` holds `app`, `main`, `lock`, `source*`, `args` and `words/` with tests; `git ls-files server/server` lists none; gates green.
- locks: layout-board, live-source
- after: L767, L781, L782, L783, L784, L785, L786
- files: src/board/, server/server/

### L788 The web data folder
Result: The web server and the data of each page live in `src/web/`.
- why: 19 web and Home files sit flat in `src/`.
- done when: `src/web/` holds `web*`, `home*`, `kept-read`, `live*`, `progress`, `step-page`, `task-detail`, `task-live`, `status`, `agent-status`, `lineclear-client`, `prefs`, `read-aside`, `top-cmd` and tests; owner `src/web/web.ts`; gates green.
- locks: layout-web, web-server
- after: L541, L547, L606, L777
- files: src/web/, src/web.ts, src/web-routes.ts, src/home-data.ts, src/kept-read.ts, src/progress.ts, src/status.ts, src/task-live.ts

### L789 Recount and collisions
Result: The code fits its line target and budgets, and parallel steps rarely collide.
- why: v0.2 needs a number that shows the layout stopped collisions.
- done when: scope.md's count prints at most 40,000 non-test lines and the test folders plus `*.test.ts` at most 26,000; each folder's `Lines` budget holds (the gate fails over it); `bun scripts/core-baseline.ts collisions 100` prints at most 3 conflicting PRs per 100 and no file touched by more than 10; `ls src/*.ts` lists none; scope.md and AGENTS.md's Layout name the folders.
- locks: recount, file-docs-scope-md
- after: L567, L765, L770, L771, L774, L778, L779, L780, L787, L788
- files: docs/scope.md, AGENTS.md, docs/architecture.md
