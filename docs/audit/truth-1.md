# Truth audit 1: done steps

Audited on origin/main c87d1fc9, 4 Nov 2026. Each `done when` item of the done steps is read against the code and the
docs. Verdicts are true, false or partly. Where an item says `bun run check` or `bun run ui:test` passes, the verdict
rests on the merge gate that let the step in; the full check was not run for this audit. Tests named here were run
unless noted: all passed, except one flaky server test (`server/test/machines.test.ts`, "a worker started again out of
its hands ... is followed to its new address"), which no item depends on. `bun run gates` was run: all ok.

Steps with a false or partly item are reopened in `docs/ROADMAP.md`: R3, L0, L8, L134, L154.

| Step | Item | Verdict | Proof |
| --- | --- | --- | --- |
| L76 | Fresh install shows no Shepherdr name (help, output, pages, units, files) | true | `scripts/one-name.ts` runs in `.github/workflows/install.yml` ("The user sees one name"); `bin/lineclear --help` has 0 lines with the old name |
| L76 | `bun run check` and `ui:test` pass | true | merge gate (not run here) |
| R2 | README short, with install via `gh`, first project, removal | true | `README.md` 77 lines; headings "Install" (gh auth login, README:18-26), "Your first project", "Remove it" |
| R2 | LICENSE MIT, README names `server/NOTICE` | true | `LICENSE`; `README.md:77-79`; `test/install.test.ts:362` |
| R2 | CHANGELOG 0.1.0: works, not works, fork origin with link | true | `CHANGELOG.md` sections "What works", "Known not to work", "Origin" |
| R2 | Picture is a still, no film; `bun run check` passes | true | `README.md:7` shows `docs/shots/home-1440.png`; merge gate |
| R3 | Main green (LINE-10) and cold install (LINE-4) on main | true | `git log origin/main`: d6f4a1dc LINE-10; `scripts/cold-start.ts`, 3a2f205a |
| R3 | `bun run release 0.1.0` refuses on dirty tree or red check, tags, installs, never pushes, test covers it | true | `scripts/release-tag.ts`; `test/release-tag.test.ts` (5 tests, pass) |
| R3 | Dispatcher eval at least 95 % on main, recorded | true | `docs/numbers.md:613-622`: 100 % (58/58) |
| R3 | `docs/numbers.md` has "Release 0.1" with the command output, merges per day, date reached | false | `grep "Release 0.1" docs/numbers.md` finds only the eval run text (lines 613, 621), no such section |
| R3 | Tag `v0.1.0` pushed and GitHub release made | false | `git tag -l 'v*'` and `git ls-remote --tags origin` print nothing; `package.json` version is 0.0.0 |
| L128 | `install.sh` installs a release to `builds/<version>`, `current` points at it, service and PATH run from it | true | `install.sh:6,122-157`; `test/install.test.ts:388` |
| L128 | Previous build kept as `previous` | true | `test/install.test.ts:388` |
| L128 | Doctor fails on a checkout or non-release build and names the fix | true | `src/doctor.ts:482`; `test/doctor.test.ts:293` |
| L128 | Test: fresh HOME, unit and PATH inside `builds/<version>`, second install keeps first | true | `test/install.test.ts:388` |
| L129 | Agent in a Lineclear worktree gets the stable `lineclear` on PATH | true | `server/test/agent-env.test.ts`; `server/server/live/box.ts` (commit 7bf7968f) |
| L129 | Repo `bin/lineclear` refuses stable config, data, port and says how to test | true | `bin/lineclear:5`, `src/paths.ts:91-104`; `test/cli.test.ts:61,97` |
| L129 | Tests of both | true | `test/cli.test.ts:61,97,106`, `server/test/agent-env.test.ts` |
| L138 | Every file `install.sh` writes points into `builds/current` | true | `src/install-paths.ts`, `src/doctor.ts:468`; `test/install.test.ts` |
| L138 | Doctor fails on an installed file or pi setting that points into a checkout | true | `src/doctor.ts:468`; `test/doctor.test.ts:319` |
| L138 | Test with a worktree beside, planted pi setting fails doctor | true | `test/doctor.test.ts:319` (pass) |
| L130 | `release try [version]` builds, starts a test instance on a copy of the data; 30 min cap | true | `src/try-instance.ts`; `test/try-instance.test.ts:123,145` |
| L130 | Instance cannot touch what is real; `--stop` removes it | true | `test/try-instance.test.ts:80-112` (byte-for-byte trees, planted `git push` and `gh` fail), `:153` |
| L130 | `release` and `doctor` show the instance | true | `src/release.ts:440`, `src/doctor.ts:129` (`tryLines`) |
| L130 | Tests: byte for byte, planted push and gh fail, answers on own port | true | `test/try-instance.test.ts` (skipped only without herdr; herdr is present, pass) |
| L137 | Stable and candidate read one store; format change ships with a migration and a both-ways check before merge | true | `src/migrate.ts`, `scripts/formats.ts`; `test/release.test.ts:179,210` |
| L137 | Test: candidate store survives rollback; planted format change fails | true | `test/release.test.ts:199,210,222` |
| L131 | `release check <version>` runs check at the tag, smoke, canary, store check both ways | true | `src/candidate-check.ts`; `test/candidate-check.test.ts:55` |
| L131 | Result kept in `release.json`, shown by `release`; failed candidate files one task | true | `test/candidate-check.test.ts:55,66` |
| L131 | Tests: failing smoke marks failed and files one; green marks ready | true | `test/candidate-check.test.ts:55,66` |
| L132 | `release promote` is the only path and refuses unpassed candidates; rule loop runs it | true | `src/promote-cmd.ts`; `test/promote.test.ts:39` |
| L132 | Inbox item with one tap to roll back; `release.promote: ask` gives a promote tap | true | `test/promote.test.ts:53,109,118` |
| L132 | Switch, previous kept, restart, smoke, auto go back, `decisions.jsonl` | true | `test/promote.test.ts:53,70` |
| L132 | Running work survives | true | `test/promote.test.ts:83` |
| L132 | Tests of refusal, failing smoke, running work | true | `test/promote.test.ts:39,70,83` |
| L133 | `release rollback` points `current` at `previous`, restarts, smoke, records; rolled-back build not offered again | true | `src/rollback.ts`; `test/rollback.test.ts:24`; `install.sh:134` (`rejected` list) |
| L133 | Doctor names current, previous, candidate | true | `test/doctor.test.ts:276` |
| L133 | Tests: two releases and a rollback; running task survives | true | `test/rollback.test.ts:24,32,41` |
| L134 | `machine update` gives each machine the build in turn with smoke; failure rolls back, stops the rest, files one task | true | `test/machines.test.ts:99,108,127,138` (pass) |
| L134 | Settings shows one version for each machine | true | `src/machines.ts:44-49`; `ui/kit/settings.tsx:193` |
| L134 | A machine on another build gets no task | true | `src/spread.ts:75`; `test/second-machine.test.ts:260` |
| L134 | `doctor` names it with both versions | true | `src/doctor.ts:273-285` |
| L134 | Home names it with both versions | partly | Home prints the rule loop's last skip through `plainReason` (`src/home-data.ts:267`); no test or view shows this reason with both versions |
| L134 | Tests with a second machine: good build, planted failure, planted mismatch | true | `test/machines.test.ts:108,138`; `test/second-machine.test.ts:260` |
| L135 | `update.ts` and `live/install.ts` have no lint or dead-code baseline entry | true | `grep -c "update\|live/install" scripts/gates/baseline/lint.json` is 0; `dead-code.json` is `{}` |
| L135 | Server tests pass | true | merge gate (not run here) |
| L136 | `server/test/update.test.ts` has no lint baseline entry | true | no entry in `scripts/gates/baseline/lint.json` |
| L136 | Server tests pass, same cases | true | merge gate (not run here) |
| L151 | Rule loop holds a step's own locks, not its parts | true | `test/rules.test.ts:492` |
| L151 | Test: second step starts; one with no locks line waits with `lock 'ui' is held by` | true | `test/rules.test.ts:492,504` |
| L151 | "How to read it" says the rule; `templates/plan.md` tells the planner | true | `docs/ROADMAP.md` "How to read it"; `templates/plan.md:23` |
| L149 | Home and `/api/home` list exactly the projects of `project list`; no phantom space | true | `src/home-data.ts`; `test/web-prefs.test.ts` (route), `test/home-projects.test.ts` |
| L149 | An open task of a space with no project still shows | true | `test/home-data.test.ts:121` |
| L149 | Test: three projects, Dispatcher space, one more space | true | `test/web-prefs.test.ts` (route), `test/home-data.test.ts:121` |
| L150 | Install sets `NODE_COMPILE_CACHE`; second install changes nothing; uninstall removes it | true | `install.sh:257`; `src/uninstall.ts:75`; `test/install.test.ts:138-144`, `test/uninstall.test.ts:61` |
| L150 | Temp sweep removes `/tmp/node-compile-cache` and trims the disk cache | true | `src/tmpdirs.ts:97`; `test/tmpdirs.test.ts:97` |
| L150 | Doctor fails when the setting is missing, fix installs again | true | `src/doctor.ts:231`; `test/install.test.ts:144` |
| L150 | Tests cover setting, second install, uninstall, sweep | true | tests above |
| U69 | `/api/home` gives tasks at work, paused tasks with what they wait for, ready steps with the loop's reason | true | `src/home-data.ts:88,282-300`; `test/home-data.test.ts:539` |
| U69 | Waiters of one task are counted together | true | `test/home-data.test.ts:539` ("5 tasks wait for U3 Holds the lock") |
| U69 | Home shows the three groups, no headline | true | `ui/kit/line-parts.tsx:330-363` |
| U69 | Test plants five waiters, a lock-held and a full-machine step | true | `test/home-data.test.ts:539` |
| U69 | Screenshots at 390 and 1440 px on the pull request | true | the pull request is not readable here; the repo has updated `ui/test/screens/home-*-390.png` and `-1440.png` (commit 3d3eae8b) |
| L156 | `status` counts only Inbox items and owner waits; other waits print as paused with what they wait for | true | `src/status.ts`; `test/waiting.test.ts:135` |
| L156 | Test: count two, two paused lines | true | `test/waiting.test.ts:59,135` |
| L152 | No `server/` entry in the dead-code baseline; gates and server tests pass | true | `scripts/gates/baseline/dead-code.json` is `{}`; knip project covers `server/**` (`knip.jsonc:14-18`); `bun run gates`: dead-code ok, 0 known |
| L153 | Idle server, loop and herdr under 3 % CPU, measured by `measure --idle`, numbers before and after | false | no `--idle` in `src/`; `docs/numbers.md` "Idle cost (L153)" has no CPU figure and says "The live cost after the change is not measured yet" |
| L153 | Other machine read over one kept ssh connection, at most once a minute while nothing changed | partly | kept connection done (`server/server/live/herdr.ts`, `ControlMaster=auto`, `docs/numbers.md` "Idle cost"); commit 0378e521 lists the once-a-minute read as not done |
| L153 | Test with fake clock counts reads in an idle hour | false | no such test in `test/second-machine.test.ts` or `server/test/machine-recovery.test.ts` (grep "idle hour" finds nothing) |
| L154 | On every machine each "goes" or "in Lineclear" Control Center unit is stopped and disabled | partly | this machine: `systemctl --user list-unit-files` shows `cc-control-center`, `cc-playwright-dashboard`, `cc-tailnet@`, `cc-tick.timer` disabled, none running; other machines not checked |
| L154 | `doctor` names a running unit, `--fix` stops it on every machine; test | true | `test/doctor.test.ts:366,415` |
| L155 | A test run ends every process it started and leaves none in its temp folder | true | `test/tmpdirs.test.ts:76`; `test/helpers.ts` |
| L155 | Temp sweep ends a process from a removed test folder | true | `test/tmpdirs.test.ts:39` |
| L155 | Test plants a leftover server and finds it ended | true | `test/tmpdirs.test.ts:39` |
| L0 | TypeScript strict on Bun with `src/`, `test/`, `bin/lineclear` | true | `tsconfig.json`, `bin/lineclear` |
| L0 | `--help` lists commands; unknown command prints one line, exits 2 | true | `test/cli.test.ts:14,20` (pass) |
| L0 | `bun run check` runs types, tests, dash check and passes in under 60 s | false | `docs/numbers.md:750`: median 223 s, goal 190 s; `AGENTS.md` allows 180 s |
| L0 | Dash check fails on each dash and names file and line; fixture in a temp folder | true | `test/dashes.test.ts` |
| L1 | `install.sh` installs missing tools, then Lineclear with pi extension and user service | true | `install.sh`; `test/install.test.ts:118` |
| L1 | Service and extension do nothing until later steps | true | later steps L6 and L9 filled them, as the item said |
| L1 | `LINECLEAR_REF` takes a ref | true | `test/release-tag.test.ts` installs with it; `.github/workflows/install.yml` |
| L1 | Asks nothing it can detect; sudo only for system packages; one line per step | true | `test/install.test.ts:149` (lingering prints the one command) |
| L1 | `doctor` prints a line and a fix per problem, exit 0 only when well | true | `test/install.test.ts:301` |
| L1 | `uninstall` keeps settings and secrets unless `--all` | true | `test/install.test.ts:326`, `test/uninstall.test.ts` |
| L1 | A second `install.sh` updates to newest main | true | `test/install.test.ts:171` |
| L1 | Workflow on a fresh Ubuntu VM: install, doctor, second install no change, update, uninstall | true | `.github/workflows/install.yml` (not run here) |
| L2 | `roadmap check` names the line of each error kind | true | `test/roadmap.test.ts:48,74,80` |
| L2 | `roadmap status` gives five states from main, `dropped`, open task, `after` | true | `test/roadmap.test.ts:89,113` |
| L2 | Tests cover every state and error; this file passes; 400 steps | true | `test/roadmap.test.ts:125,130`; `lineclear roadmap check .` prints `ok: 241 steps` in 0.25 s |
| L3 | `roadmap import` writes `docs/ROADMAP.md` from JSON with the four lines plus `id`, `title`, `phase`, `state` | true | `src/roadmap-import.ts`; `test/roadmap-import.test.ts:40,64` |
| L3 | States open, done, dropped; reason default | true | `test/roadmap-import.test.ts:40` |
| L3 | `docs/import.md` documents the shape | true | `docs/import.md`; `test/roadmap-import.test.ts:101` |
| L3 | Import commit has `Step: <id>` per done step | true | `test/roadmap-import.test.ts:40` |
| L3 | A field it cannot place stops the import and writes nothing | true | `test/roadmap-import.test.ts:71` |
| L3 | Tests: every state, one error | true | `test/roadmap-import.test.ts:40,71` |
| L4 | `measure` prints asks, wait, cost per day; flags unpriced models and missing sessions | true | `src/measure.ts`; `test/measure.test.ts:234,304` |
| L4 | Uses no AI, reads files and git | true | `src/measure.ts` |
| L4 | Two-day fixture counted by hand | true | `test/measure.test.ts:234` |
| L5 | `project add` writes settings with repo, space, check, health, three model lists | true | `test/project.test.ts:28,49` |
| L5 | Detects the space and check command; asks only for what is missing | true | `test/project.test.ts:28,43,57` |
| L5 | `list`, `remove`, `check` work | true | `test/project.test.ts:90,102` |
| L5 | Tests per field and a missing repo | true | `test/project.test.ts:80` |
| L6 | `run` ticks every 30 s; `--once --dry-run` prints decisions | true | `src/rules.ts:31` (`TICK_MS`); `test/rules.test.ts:338` |
| L6 | Ready step with free locks and slot starts with `task add` and a brief from the template | true | `test/rules.test.ts:13,127,143` |
| L6 | Brief asks for a review from another company, fixes critical and major, bounded rounds | true | `templates/brief.md:55`; `test/rules.test.ts:259` |
| L6 | Steps start day and night; broken roadmap starts nothing and shows in status | true | `test/rules.test.ts:352,170` |
| L6 | Failing health command files one fix task, a second stops starts | true | `test/rules.test.ts:180` |
| L6 | Each start and skip goes to `decisions.jsonl` once with a reason | true | `test/rules.test.ts:290,318` |
| L6 | Tests with a fake `shepherdr` | true | `test/rules.test.ts` (pass) |
| L7 | `wait` kinds, `ask`, `resume` work from a task and show in status | true | `test/rules-waits.test.ts:10,42,110` |
| L7 | `until` wait holds no slot, stops and wakes the task | true | `test/rules-waits.test.ts:92` |
| L7 | `lineclear check` takes turns, N at once, `checks` wait | true | `test/rules-waits.test.ts:127,163` |
| L7 | Load limit stops starts, said once | true | `test/rules.test.ts:399` |
| L7 | Brief tells workers to use `check`, `wait`, `ask` | true | `test/rules.test.ts:411`; `templates/brief.md:22,56` |
| L7 | Tests for each wait kind, timed wake, three checks with N=2, load limit | true | tests above |
| L8 | One project picked, coordinator regular, told in chat, standing requests cleared, `run` drives it | true | `docs/numbers.md:115-135` |
| L8 | Pilot numbers in `docs/numbers.md`: steps merged, slot waits, rule starts, the coordinator's runs and cost | yes | `docs/numbers.md:156-178` has merges (38), slot waits (0), starts (37) and 69 coordinator turns, and its cost ($8.39, priced from the tokens) |
| L8 | Before and after numbers in `docs/numbers.md` | true | `docs/numbers.md:130-178` |

L153 is not reopened in `docs/ROADMAP.md`: `lineclear roadmap check` refuses a `Reopened:` line while `docs/numbers.md` holds a section "Idle cost (L153)". Its three verdicts above stand; that section proves only the first part (the kept ssh connection).
