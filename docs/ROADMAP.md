# Roadmap

What Lineclear has to do is in [idea.md](idea.md). This file says when each step can start and when it counts as
done. The rules will read it, so it follows its own format.

**Done means.** Lineclear is done when every line below holds. Each line names the steps that show it, so
`lineclear roadmap status` tells how far it is.

- Every step in this file is done or dropped.
- Release 0.1 goes out with the web UI as it is, once its phase is done (R3). No later release goes out before
  the web UI is finished and proved, the release gate (U43).
- Every machine you add runs its spaces, tasks and slots on Lineclear, with one Home and one Inbox for all (L42).
- One server and one task store run every machine through herdr, and other machines need no Lineclear install (L91
  to L96).
- Nothing runs on herdr-projects 2.0 or on an AI coordinator with a timer, and going back is one command (L43).
- One product: one name, one CLI, one web UI and one data folder on every machine, and a clean install shows no
  other name (L68 to L76, U57 to U60).
- A step held for room waits only when no machine of its project has room, and heavy test suites never overload a
  machine (L44, L45).
- A full subscription hands its work on before the task stalls, and Usage shows it (L46).
- A new Inbox item reaches your phone, and only you can answer it (L47, L48).
- Someone new installs it from the README alone (L49).
- A reboot, a killed service, a full disk or a lost network comes back with no loss and no manual step (L50).
- Every user gets the measured token savings, on by default (L51 to L56).
- Every new step gets a go from a fresh model of another company before you see its plan, and the check stays only
  while it saves more than it costs (L61, L62, L65).
- The work measured so far meets the goals in idea.md: under 3 asks a day, a median wait from ready to start under 5 min,
  and a cost per merged step at least 15 % below the pilot's before Lineclear (L57).
- The code stays clean by rule: every gate, in the check and in the heavy run, finds no fault, with no baseline left, and the check stays fast (L77 to L90).
- No task sits in Needs you with no question: it asks one Inbox question or keeps going, and the stall ladder
  catches the rest within minutes (L140 to L146).
- The one Lineclear that runs the work is a released build in its own folder, never the repo or main; a new build
  becomes stable only by an explicit promotion after its test instance passes, and one command rolls back (L128 to
  L138).
- No single task stops the merge line: a stuck head is released by itself and shows on Home with its reason, each
  machine's checks wait in a line of their own, and a task's question never waits unseen: a rule answers it or it is
  in the Inbox (L119 to L127).
- Every way a task stops moving has a named class, a remedy, and a fix step Lineclear files for itself when the
  remedy is not enough; a test track runs the whole chain every night and after every update; it holds 10 projects
  and 1000 tasks, and no data file grows without bound (L112 to L117).
- The release loop promotes a green main within hours on a busy machine, or names each failing test and its error,
  and two runs on one main give the same verdict (L278, L280, L281, L283, L284).

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
- From phase 2 on, each phase is measured before and after with `lineclear measure` (L4). The numbers go to
  `docs/numbers.md` without project names.
- New ideas go to [backlog.md](backlog.md), never into this file.
- Phases 7 to 12 are roadmap 2, from a review of Lineclear as built. They go in order of value: what is broken,
  then what can be simpler, then UI detail, then new things. A step waits for the fork (phase 5) only where its
  `after` says so.
- Phase 13 builds the web UI to the design board in [design/board.html](design/board.html), after U24.
- Phase 14 is roadmap 3: what is still missing before all your work runs on Lineclear. Its steps wait for the
  phases before it only where their `after` says so.
- Phase 15 finishes the look: the README film and the UI motion refined, and real screenshots. Its steps wait only
  for the code they use; U43 waits for all of them and U39.
- Phase 16 adds a fresh-eyes check of each step before work starts. It shares no step with the release gate, so it
  runs beside phases 13 to 15 and U43 does not wait for it.
- Phase 17 leaves one product named Lineclear: the fork's old name, UI, plugin and folders go. Its steps keep
  every running task and go in the order of their `after` lines.
- Phase 18 makes clean code a rule the machine checks: lint, dead code, copies, module borders, sizes, comments and
  coverage, each a ratchet that only tightens.
- Phase 19 leaves one server and one task store for every machine, each reached through herdr's own forwarding.
- Phase 24 runs the work on a released build and proves each new one on a test instance before it becomes stable.
  It comes right after Release 0.1 in this file, so its steps take the first free slots.
- Phase 25 makes Needs you mean a question: a quiet turn is answered every time and a quiet Needs you is a stall.
- Phase 26 keeps Lineclear on the rails with no human: every way work stops gets a name, a remedy and, when the
  remedy is not enough, a fix step that Lineclear files for itself. It waits for no other phase.
- Phase 27 makes Home tell the truth: only real projects, why each piece of work waits, and an idle board that costs
  almost nothing. It comes right after Phase 24 in this file, so its steps take early slots.
- Phase 28 makes Lineclear independent of any AI company and harness: models come from a registry, quota and harnesses
  are adapters, and a first-run setup lets the owner choose. It sits before the U39 minor findings and waits for no other phase.
- Release 0.1 comes first in this file, and the rule loop starts ready steps in the order of this file, so its
  steps take the first free slot. The rest runs beside it wherever a slot and its locks are free.
- The section "Frozen by the owner 5 Nov 2026" holds open steps the rule loop never starts. Moving a step out of it is the owner's call.
- An `after` names only a step whose code the later step needs, so as many steps as possible are ready at once.

**Time.** Estimates come from `lineclear measure` once L4 is done.

## Release 0.1

Why: a release must ship as soon as possible, and the rest of this file is weeks of work. Release 0.1 is what is
on main now, with the web UI as it is, in the repository as it is: private, for those who have access. It holds
only what someone new with that access needs to install it and what keeps it honest: main green, no Lineclear name a user can see, a cold install by the README alone, a README, license and
changelog that say what is true, and a tag.

Target date: Monday 2 November 2026, in the morning. Measured speed: 145 merges to main in the 42 hours from the
first merge on 31 October to 1 November 20:00, 73 of them in the last 24 hours, about 3 an hour. The cut is 5
merges: two tasks already at work and the three steps below. L76 and R2 run side by side and R3 after both. Of the last 50 tasks on this board, 9 in
10 took under 2 hours 20 minutes from start to done, so the two in a row take under 5 hours, and the target holds
if the work starts tonight. L76 moves here from Phase 17 with no `after`: what a user sees needs no rename inside
`server/` or the docs, which stay in L75.
R3 records the date reached in `docs/numbers.md` under "Release 0.1".

In the cut, already at work as tasks:

- Main green on an idle machine: `bun run check` on main passes twice in a row on an idle machine, hermetic tests
  only (LINE-10).
- The cold install by the README: the install part of LINE-4. A fresh HOME with a clean PATH installs from the repo
  by the README alone and its doctor passes; the run and every place the README was not enough are recorded in
  `docs/numbers.md` under "L49", and each is fixed. The rest of LINE-4 (first day without commands, the agent kit,
  the proof gate that reopens L49 and L44) moves after 0.1.

Already on main and part of 0.1: agents decide (LIN-163), worktrees ready to check (LIN-164), the rollback of an
update that breaks (LIN-136), `lineclear machine add` in one command (LIN-167), lint and dead code in the check
(L77, L78).

The owner set this cut and its order. Moved after 0.1, in this order of priority, each with why a stranger does not need it on day one:

1. Home is the Dispatcher (LIN-139) and every UI redesign (Phase 13, LIN-145, LIN-146, LIN-148, LIN-151, LIN-159):
   the UI as it is installs and runs a project; a better Home is the first thing of 0.2.
2. The flagship line (LIN-149, LIN-150, LIN-152): it makes the work worth watching; using Lineclear does not need
   it.
3. The Blender film and the finished look (LIN-153, Phase 15): a still serves the README for 0.1.
4. Code gates beyond lint and dead code (LIN-154, L83 to L90): coverage floors, splits and the heavy check keep
   the code clean over months; the check already runs lint and dead code.
5. Parts with keepers (LIN-168): quality over long work, not what a stranger meets.
6. Stall classes (LIN-158): a loop that finds new kinds of stall matters once Lineclear runs long without a human.
7. The builder's own setup folds in (LIN-169): a stranger never has it.
8. Pacing the week (LIN-166): a first day does not reach a weekly allowance.
9. The rest keeps its phase and order: merges on a busy machine (LIN-155), a step with nothing to merge (LIN-156),
   temp files off the RAM disk (LIN-165), no path to the old folder (LINE-1), the fast loop and check tiers (LINE-2,
   LINE-3), machines through herdr (LIN-173), fresh eyes before work (Phase 16), the rest of Lineclear only
   (Phase 17, with L75) and of clean code (Phase 18). Each is a fix for long or heavy use, or for the builder's own
   machines, not for a first install.

Ready steps, not counting the 6 at work, are those whose `after` is done: 14 before this change and 20 after it.
A plan that applies by itself may not drop a lock, so the coarse locks stay until the owner approves a split.

A task in the cut finishes only the part named here. A task outside it goes on beside the cut and merges in the
smallest part that stands on its own; none is lost.

### L76 A clean install shows one name
Result: A new install shows only the Lineclear name, with no trace of the old one.
- why: someone new must get Lineclear with no trace of the old name.
- done when:
  - The fresh machine test of L31 installs with `install.sh` and finds no Lineclear name in what a user sees: the
    CLI's help and output, the web pages, the service names and the files it installed. `scripts/fresh-one-name.ts`
    installs into an empty HOME and runs `scripts/one-name.ts` there, and `.github/workflows/install.yml` runs it.
  - `bun run check` and `bun run ui:test` pass.
- parts: install, core
- locks: words
- after: none

### R2 README, license, changelog
Result: A stranger reads a true README, a license and a changelog before installing 0.1.
- why: a stranger decides from the README whether to install, and a claim that is not true breaks trust in the rest.
- done when:
  - `README.md` is short: what Lineclear is, what it needs, the one-line install, the first project, and how to
    remove it. The install works for someone with access to the private repository: it signs in with
    `gh auth login` and fetches the repository over https with `gh`, since a plain download of a private file
    fails. Every claim in it is checked against main and the cold install of LINE-4; a picture is a still from
    the UI as it is, no film.
  - `LICENSE` is MIT, and the README names `server/NOTICE`, which keeps the MIT notice of herdr-projects 2.0.
  - `CHANGELOG.md` has a 0.1.0 entry: what works, what is known not to, and that Lineclear began as a fork of
    herdr-projects 2.0, with its link.
  - `bun run check` passes.
- parts: ui
- locks: docs
- after: none

### R3 Release 0.1 tagged
Result: Release 0.1 is a tag you can install again the same way, after its checks pass.
- why: a release that is not tagged and checked from its tag can not be installed again the same way.
- done when:
  - Main green on an idle machine (LINE-10) and the cold install of LINE-4 are on main. These are tasks, not steps,
    on another machine's board, so its task reads `git log origin/main` for them and, until both have merged,
    waits with `lineclear wait until <time>` and reads again.
  - `bun run release 0.1.0` refuses on a dirty tree or a red `bun run check`. Otherwise it sets the version to
    0.1.0, makes the tag `v0.1.0` here, installs from that tag into a fresh HOME with `LINECLEAR_REF=v0.1.0` and
    runs its doctor. It never pushes. A test covers the refusal and the tag.
  - `bun run dispatcher:eval` calls at least 95 % right on main, recorded under "Dispatcher eval".
  - `docs/numbers.md` has "Release 0.1": the release command's output, the merges per day, and the date reached
    against the target above.
  - Once the rest is true, its task pushes the tag `v0.1.0` and makes the GitHub release in the same private
    repository with `gh release create v0.1.0`, its notes the 0.1.0 entry of `CHANGELOG.md`. The owner has
    approved this release, so it needs no ask. The repository stays private.
  - Reopened: no tag `v0.1.0` and no GitHub release exist, and `docs/numbers.md` has no "Release 0.1" section.
- parts: install
- locks: release
- after: L76, R2

## Next in order

Why: the owner set this order for the steps still open, and the rule loop starts ready steps in file order. Tier 1, platform stability: the release that promotes a green main (L278, L280, L281, L283, L284) and herdr watched by its events and counted (L267, L268). Tier 2, efficiency so tasks reach merge fast, first one product and one setup (Lineclear gone, one server, one store, one id space, a task on its machine, no gate that finds nothing: L311 to L319), then work placed where there is room (L94), one status for every reader (L214) and no fix loop (L271). Tier 3, the rest (bug fixes, Dispatcher, UI and features), is frozen by the owner on 5 Nov 2026 (last section of this file). Done steps follow at the end of this section.

### L401 Install tests skip slow copying
Result: The first four install tests pass on a loaded machine, as the test repo's fetch and the file checks take a fifth of the time.
- why: a test that fails only under load blocks the merges of branches that do not reach it, and a green release, and a longer limit only hides the cost.
- done when:
  - The tests are the first four of `test/install.test.ts`, red in the release run of 59884fd: the first install timed out at 57.8 s, and "where lingering needs root", "a second install changes no file" and "install again updates Lineclear" failed on its half-made copy.
  - Cause one: the test repo holds the checkout (about 1,900 files, 97 MB) as loose objects, so the first install's `git fetch --depth 1` compresses and delta-searches all of it: 25 s at a load of 4 per core. `beforeAll` sets `core.compression 0` and `pack.window 0` in the test repo before its commit; the fetch then takes about 5 s at the same load.
  - Cause two: `snapshot` hashed every file under the test home (about 22,000 with `node_modules`) twice per test, 5.5 s each. It records each file's size, mode and mtime from `lstatSync` and a link's target from `readlinkSync` instead: 0.6 s.
  - `install.sh` runs `git remote set-url origin` only when the URL differs, since the mtime check finds it rewrote `.git/config` on every run.
  - Cause three: `install.sh` asked port 7421 for a running board, so the test home got `lineclear-serve-7421.service` whenever this machine's own board did not answer in 2 s. It asks the port the data folder's `server.json` records, the test's fake server.
  - No retry, no skip, no quarantine and no longer timeout. `bun test test/install.test.ts` passes at a load of 7 per core, the first install in 23 s.
- parts: install
- locks: install-test, install-git
- after: none
- files: test/install.test.ts, install.sh

### L415 Browser specs out of coverage
Result: `lineclear measure` counts ui's coverage from the files the bun tests can load, so the Playwright specs no longer score against it.
- why: a part's health score that counts files its tests can never load points health steps at a fault that is not there.
- done when:
  - The cause: `withUnloaded` in `scripts/gates/coverage.ts` adds every tracked file the root tests did not load with 0 hits, including the `ui-test` module (`ui/test/`, `ui/shots/`, `ui/budget/`), which only `bun run ui:test` and `bun run shots` run. In `.coverage/files.json` those files hold 0 of their lines against the 94 % floor.
  - `scripts/coverage.ts` leaves the `ui-test` module's files out of the report and out of `.coverage/files.json`, and its floor leaves `scripts/gates/baseline/coverage.json`.
  - A test in `test/coverage-floor.test.ts` gives `fileCoverage` a report with a `ui/test/` spec and finds it absent.
  - After `bun run coverage`, the uncovered column of ui in `lineclear measure` part health counts no file under `ui/test/`.
- parts: gates, ui (health)
- locks: coverage
- after: none
- files: scripts/coverage.ts, scripts/gates/coverage.ts, scripts/gates/baseline/coverage.json, test/coverage-floor.test.ts

### L278 A red release names its tests
Result: When a release run holds main, `lineclear release` and the fix task name each failing test or step with its first error line.
- why: a held line that says `failing tests:` and nothing after it gives the fix task nothing to fix, so the same red repeats.
- done when:
  - The held line in `lineclear release`, the release state and the brief of the fix task list each failing test as `<file> > <test>: <first error line>`, up to 20, the rest counted.
  - A failed step with no test names (a timeout, a killed suite, a gate, the browser suite) is named with its step name and its last error line, never an empty list.
  - `scripts/check.ts` prints each failing test with its file and first error line, and a test file the runner stopped for its time limit is named as timed out.
  - Tests in `test/release.test.ts` plant a failing test, a timed-out test file and a failed gate in a full check's output and find each named in the held line.
- parts: install, gates
- locks: release, check-output
- after: none
- files: src/release.ts, scripts/check.ts, scripts/flaky.ts, test/release.test.ts

### L280 The release check has the slots
Result: While the release's full check runs, no new check, slot or heavy agent command starts on its machine, so it runs on a quiet machine.
- why: the full check runs every suite and the browser suite at once, and beside task checks and browser suites it ran at load 30 to 96 and timed out.
- done when:
  - The release run takes its full check through the check slots like `lineclear check --full`: it first holds new starts on its machine, waits for the running checks to end, then holds every check slot until the full check ends.
  - While it holds them, `lineclear check`, `lineclear slot` and the pi extension's heavy commands wait with the reason `waiting for the release check on <machine>`, and start once it ends, killed or done.
  - The release run records its slot wait and the load at its start in `check-runs.jsonl`, as every check run does.
  - Tests in `test/heavy.test.ts`: with a release check holding the slots, a task's check and a browser suite wait and start after it; a release check killed mid-run frees every slot.
- parts: install, rules, checks, server
- locks: release, check-slots
- after: none
- files: docs/parts/checks.md, docs/parts/rules.md, src/candidate-check.ts, src/release.ts, src/waits.ts, src/process-group.ts, server/server/live/engine/check-queue.ts, test/heavy.test.ts, test/release.test.ts

### L281 A release run checks again
Result: `lineclear release run --again` tests main's head once more and shows its verdict, without promoting.
- why: whether a verdict holds can only be seen by testing the same commit twice, and the release run skips a commit it tested already.
- done when:
  - `lineclear release run --again` tests main's head even when it was tested or promoted already: it builds next, runs the full check (no earlier pass reused), the canary and the format checks, and records `green` or `held` for the commit. It never promotes: a later plain `release run` promotes as before.
  - A run's verdict is green, or held with every failing test or step named as L278 says (a timed-out test file counts as a named failing test; a failed build, canary or main that cannot be read is held with that step named).
  - `lineclear release` shows each run's commit, time, minutes from start to verdict and verdict.
  - Tests in `test/release.test.ts`: `--again` on a held commit that now passes records green and does not promote; on a held commit it gives the same held line for the same planted failure.
- parts: install
- locks: release
- after: L278
- files: src/release.ts, test/release.test.ts

### L283 A red stable rolls back
Result: When a check again finds the stable build red, the previous build takes over by itself and a fix task is filed.
- why: the running system must always be a proven build (principle 2), so a stable build whose own commit no longer passes cannot keep running the work.
- done when:
  - A `release run --again` that holds the commit stable points at says `stable <commit> fails again: ...` in the held line, files the fix task as any red main does, and rolls back to the previous build as `lineclear release rollback` does (L133), without ending running work.
  - A green `--again` on stable's commit leaves stable as it was.
  - Tests in `test/release.test.ts`: a planted failure on stable's commit rolls back to the previous build and files one fix task; a green recheck changes nothing.
- parts: install
- locks: release
- after: L281
- files: src/release.ts, test/release.test.ts

### L284 A release verdict holds twice
Result: On the owner's busy machine a release run promotes main or names the failing test, and a second run on the same main agrees.
- why: a verdict that changes between two runs of one commit says what the machine was doing, not whether main is good, so no one can act on it.
- done when:
  - On the owner's machine, while at least four tasks work on it and its load at the start (`loadAtStart` in `check-runs.jsonl`, the 1-minute load average per core) is over 1, `lineclear release run` and then `lineclear release run --again` on the unchanged main give the same verdict, each within 2 hours from its start to its verdict, its slot wait included.
  - Both runs (commit, verdict, minutes, slot wait, start load) are written in `docs/numbers.md` under L284. Two verdicts that differ leave the step open, with the difference written there as the cause to fix.
- parts: install, measure
- locks: release
- after: L278, L280, L281, L283
- files: docs/numbers.md

### L267 The rule loop spawns no herdr
Result: The rule loop learns whether a task's agent started or stalled from the server, without starting a herdr command for it.
- why: `agentStart` in `src/starts.ts` and `agentLastError` in `src/stalls.ts` spawn `herdr agent get` and `herdr agent read` for each task on each tick, about 65 a minute on a busy board.
- done when:
  - The server's `/api/snapshot` carries, for each task's agent, a `herdr` field kept from L266's events: `status` (herdr's `agent_status`), `session` (the path of its pi session file, as `agent.get` gives it today) and `pasted` (true while its pane still shows the pasted brief), with `at`, the time of the last event or snapshot it came from.
  - `agentStart` and `agentLastError` read that field from the server snapshot the tick already fetches, and read the session file at that path as they do today. A task with no `herdr` field in a snapshot the server answered is `gone`, as a failed `agent get` is today; no snapshot, or one older than 60 s, gives no verdict that tick and logs why, never `gone`.
  - In `src/`, no code runs `herdr agent get` or `herdr agent read`, and a test fails on a planted one.
  - The start and stall tests keep their cases (acted, busy, silent, gone, last error) on a fake snapshot, and a test of ten ticks with five tasks counts no herdr spawn from these checks.
- parts: rules, server
- locks: starts, herdr-events
- after: L266
- files: src/starts.ts, src/stalls.ts, server/server/live/agents-state.ts, test/starts.test.ts, test/stalls.test.ts

### L311 Agents are told only lineclear
Result: Every `lineclear` command that agents, briefs, skills and scripts use has a `lineclear` one, and agents are told only that.
- why: two CLIs with overlapping commands make every agent choose between them, and each choice is a chance to reach the wrong store.
- done when:
  - A test lists every `lineclear` subcommand that `src/`, `pi/`, `scripts/`, `templates/`, `server/skill/` and the briefs call, and finds a `lineclear` command for each, with the same arguments and output.
  - Every brief, skill, template and agent prompt names only `lineclear`; a test over those files fails on a line that tells an agent to run `lineclear`.
  - `src/lineclear-client.ts` calls the `lineclear` commands, and a test with a fake server finds the same results as before.
- parts: server, pi, core, inbox, install, rules, ui
- locks: agent-commands
- after: none
- files: src/lineclear-client.ts, src/cli.ts, pi/extension.ts, server/skill, test/contracts/server.test.ts, test/lineclear-client.test.ts, test/asks.test.ts, src/asks.ts, src/cards.ts, src/doctor.ts, src/roadmap-source.ts, src/spread.ts, src/stall-ladder.ts, src/stalls.ts, src/waits.ts, docs/parts/core.md

### L312 One server, one data folder
Result: A machine runs one server on one port with its data in `~/.lineclear`; the old data folders and second port are gone.
- why: a second server and a second data folder per machine hold a second copy of the same tasks, and the copies disagree.
- done when:
  - `lineclear update` moves what is in the old data folders into `~/.lineclear`, keeps a copy for one command back (`lineclear update --back`), and a test with a planted old folder finds every task, chat and secret in the new place, and the old folder gone.
  - After the update a machine listens on one Lineclear port; a test starts it and finds no process on the former second port (7421).
  - A running task survives the move: a test updates while a task works and finds the task unchanged.
  - A planted failure in the move rolls back to the old folders and the old port, as every update does (LIN-136).
- parts: server, install, core, rules
- locks: data-folder
- after: L311
- files: src/install-paths.ts, src/rollback.ts, src/paths.ts, server/server/live/paths.ts, test/install.test.ts, test/recovery.test.ts, src/update.ts, test/update.test.ts, src/migrate.ts, src/cli.ts, docs/parts/install.md

### L313 The old name is gone
Result: No code, doc, brief or skill of Lineclear names the old product, and a gate fails the check on a new one; Lineclear is the only product.
- why: a name that stays in code and briefs is a way back to the old tool, and an agent that reads it will use it.
- done when:
  - The old product's binary, its client file, its env names and the fork's old code paths are renamed or removed; `bun run test` passes on the result.
  - A gate `old-name` in `bun run gates` fails on the old name (any case) in a tracked file or in a brief or skill a task is given, with only `server/NOTICE` and the MIT license text allowed, and a test plants the name in a code file, a doc and a skill and finds each refused.
  - The gate's baseline is empty and `bun run check` names it in the gates step.
- parts: gates, server, pi
- locks: old-name
- after: L311, L312
- files: scripts/gates/run.ts, scripts/gates/baseline, server/NOTICE, pi/extension.ts, test/contracts/gates.test.ts

### L314 Every moving part has a cost
Result: `docs/simplify.md` lists each process, timer, store, loop and gate with what it costs a merged step and what breaks without it.
- why: only a list with measured costs shows what can go, and a part with no stated cost cannot be weighed.
- done when:
  - `docs/simplify.md` has one row per process the install starts, per timer, per task or check store, per rule loop and per gate in `scripts/gates/`, with the time, tokens and restarts per merged step over the last 7 days, and a line on what breaks without it.
  - The numbers come from `check-runs.jsonl`, `check-steps.jsonl`, `decisions.jsonl` and the task store, and the page names the command that recounts each.
  - A test lists the processes, timers, stores and gates found in the repo and fails on one with no row, and on a row with no number.
- parts: measure (health), checks
- locks: simplify-doc
- after: none
- files: scripts/simplify-count.ts, test/simplify.test.ts, docs/simplify.md, docs/parts/measure.md

### L315 Task ids are unique everywhere
Result: `lineclear task show <id>` and `close <id>` find the one task with that id, on any machine, and no two tasks share an id.
- why: the same id on two machines lets a command act on the wrong task, which closed a finished task and left a stale one open.
- done when:
  - A test with two stores that both hold a task `OMA-91` finds the later one renamed to a new id of the space's series, its old id kept as an alias that names the machine (`machine-b:OMA-91`), and `show` and `close` by either form reaching the right task.
  - A test with a task on another machine finds it by its id alone, with no machine prefix.
  - New ids come from one series per space, and a test that starts tasks on two machines at once finds no repeat.
  - A check over the live store (`lineclear doctor`) fails on a duplicate id, and a test plants one.
- parts: server, core, install
- locks: task-ids
- after: L312
- files: server/server/live/task-ids.ts, server/server/live/machines.ts, src/doctor.ts, test/contracts/server.test.ts

### L316 One store, read over the link
Result: Each machine keeps one task store; other machines read it over the link and keep no copy, so a task's state cannot differ between machines.
- why: a mirrored copy of another machine's tasks can go stale and disagree, and the board then shows two truths.
- done when:
  - `~/.lineclear/machines/<machine>/tasks.json` is no longer written; an update removes the old mirrors, and a test finds none after it.
  - The board reads a remote machine's tasks through the link at each request, and a test with a fake link finds a change on the remote machine in the next read.
  - A test with the link down finds the remote tasks marked unreachable with their last known state and no write to a local copy.
  - A status change is sent once to the machine that owns the task and never forwarded back; a test with two machines and 100 changes finds each applied once and no ping-pong (LIN-1013).
- parts: server, core, install
- locks: task-store
- after: L315
- files: server/server/live/machines.ts, server/server/live/source.ts, src/machines.ts, test/contracts/server.test.ts

### L317 A task stays on its machine
Result: A task's agent, its worker check, merge check, reviews, step check and done proof all run on the machine it was started on.
- why: work sent back to the main machine loads it and makes the offload pointless; one task on two machines is also hard to follow.
- done when:
  - A test starts a task on machine B and finds its agent, `lineclear check`, merge check, review runs, step check and done proof all running on B (`whereRun` names B in `check-runs.jsonl` and `decisions.jsonl`), and none on the main machine.
  - A machine with no room holds the work in its own line (L119 to L127), not on another machine.
  - `lineclear measure` counts runs per machine, and a test on a fixed log finds none of a task's runs on a machine other than its own.
- parts: checks, server, rules, install, planner
- locks: check-where
- after: L304, L316
- files: src/check-runs.ts, src/candidate-check.ts, src/stepcheck.ts, src/doneproof-run.ts, server/server/live/engine/lane.ts, test/contracts/checks.test.ts

### L318 Gates that catch nothing are cut
Result: A gate or check that caught no fault in 7 days of runs is cut or merged into another, and no fault class goes unchecked.
- why: every check costs time on every merge, and one that never finds a fault only slows the line.
- done when:
  - `lineclear measure` lists per gate and per merge-check step the faults it caught in the last 7 days, counted from `check-runs.jsonl` and `decisions.jsonl`, and a test on a fixed log finds each count.
  - Each gate with 0 catches is merged into a gate that runs the same files, or cut; `docs/simplify.md` names each and the time per merge saved, measured before and after.
  - A cut gate's fault class is still planted by a test in the heavy tier; no check the merge needs for a fault class that was caught is removed, and a test plants one fault per remaining class and finds the merge check refuse it.
- parts: gates, checks (health), measure
- locks: gate-list
- after: L314
- files: scripts/gates/run.ts, scripts/gates/borders.ts, scripts/gates/code-rules.ts, scripts/gates/baseline/, scripts/check.ts, src/check-runs.ts, src/catches.ts, src/measure-main.ts, test/measure.test.ts, test/catches.test.ts, test/gates.test.ts, docs/simplify.md, docs/parts/measure.md, docs/parts/checks.md, scripts/gates/herdr-calls.ts, scripts/gates/model-names.ts

### L319 No new measuring before tier 2
Result: The roadmap check refuses a new step that adds a measurement or report feature until tiers 1 and 2 are done.
- why: each measurement feature adds code, runs and tokens, and the owner asked for fewer moving parts first.
- done when:
  - `lineclear roadmap check` fails on a step that is not in `docs/simplify.md`'s list of existing ones, whose parts include `measure` or whose files include `src/measure*`, `docs/numbers.md` or a report view, unless L271 is in its `after` chain.
  - A test plants such a step with no `after`, with `after: L271` and an existing one, and finds the first refused and the others kept.
  - The refusal names the rule and the step ids to wait for.
- parts: planner, measure
- locks: roadmap-check
- after: L314
- files: src/roadmap.ts, src/roadmap-cli.ts, test/roadmap.test.ts, docs/simplify.md

### L94 Work goes where there is room
Result: A step starts on the machine with room, found through herdr.
- why: room is read today by an SSH script that asks the other machine's own Lineclear. With one server, room is
  what herdr and the small read of L92 say.
- done when:
  - Each machine's room is its working tasks in the one store, its heavy slot, and the load, cores and free memory
    read through the adapter.
  - The rule loop places any task, a roadmap step or one made by hand, on a machine with room, and logs why in
    `decisions.jsonl`. A project may name its machines in its settings, and then runs only there.
  - Tests cover a start on the other machine, a project that names one machine, a machine that is full and one that
    cannot be reached.
- files: src/rules.ts, src/project.ts, src/machines.ts, src/spread.ts, src/real-world.ts, src/paths.ts, src/waits.ts, docs/parts/core.md, docs/parts/server.md, test/second-machine.test.ts, server/server/live/engine/engine-state.ts, server/server/live/engine/check-queue.ts, server/server/live/source-cli.ts, server/server/live/source-subcommands.ts, server/server/live/args.ts
- parts: rules, core, install, server
- after: L93

### L214 One status for every reader
Result: `lineclear roadmap status`, Home, the roadmap view and the rule loop give the same state for every step.
- why: the loop reads main, the hand entries, other machines' tasks and proof records, while the CLI and views call `stepStatuses` with less, so the owner can read `ready` while the loop says `work` (red-team F6).
- done when:
  - One function returns the inputs of `stepStatuses` and every caller uses it.
  - A closed-with-nothing task makes a step done only with a checker record, and a hand entry in `state.closedSteps` ends with a revert.
  - A test with a remote task and a hand entry finds the same status from all four readers.
- parts: rules, core
- locks: none
- after: L212
- files: src/status.ts, src/tick-project.ts, test/rules.test.ts

### L271 A fix loop files its own fix
Result: A step whose fix tasks end twice with no merge gets no third; one planning fix on Lineclear itself looks for the cause.
- why: a fix that ends empty twice will end empty again, and the cause is in Lineclear, not in the step.
- done when:
  - A fix task ends with no merge when its status is `closed`, or `done` with `closed` set (`endedUnmerged` in `src/self-fix.ts`). After the step's last two fix tasks in a row end so, with no fix of it merged between them, `fileFix` files no third for that step; a merged fix starts the count again. The two ends are one stall of a new class `fix-loop` (`src/stall-class.ts`), which `fileFixes` files once as a planning fix on Lineclear's own project, under its day cap, with both tasks as evidence.
  - A test ends two fix tasks of a step with no merge and finds over ten ticks no third fix and one `fix-loop` planning fix.
- parts: rules
- locks: fixes
- after: L275
- files: src/self-fix.ts, src/stall-class.ts, test/stall-class.test.ts

### L302 Red main waits for a commit
Result: `lineclear release run` retries a red main only after a new commit lands on it, never on a timer.
- why: the same red commit tested again every 2 minutes gives the same verdict and costs a full check each time.
- done when:
  - A test with a red main and 10 ticks with no new commit finds one full check in `check-runs.jsonl`, and a new commit on main makes the next tick run one more.
  - `lineclear release run --again` still tests an unchanged head (L281).
- parts: install
- locks: release
- after: none
- files: src/release.ts, test/release.test.ts

### L304 Checks run where the task is
Result: A task started on another machine runs its checks on that machine, not back on the main one.
- why: 122 starts sent to a second machine ran their checks on the first, which loaded it and made the offload pointless.
- done when:
  - A test with a task started on machine B finds its `lineclear check` and its merge check run on B (`whereRun` names B in `check-runs.jsonl`), and none on the main machine.
  - A machine with no room for the check holds it in its own check line (L119 to L127), not on the main machine.
- parts: checks, server
- locks: check-where
- after: L301
- files: src/check-runs.ts, src/check-tier.ts, server/server/live, server/server/live/engine/engine-tidy.ts, server/test/engine-lane.test.ts, test/contracts/checks.test.ts, docs/parts/checks.md

### L282 Kit formats and motion tested
Result: The kit's number, time and motion helpers have their own tests, so a change to one fails a test before it reaches a view.
- why: the ui part has the worst health in `lineclear measure`, and its kit code is covered at 23 %, so a broken helper shows only in a picture.
- done when:
  - A new `test/kit-format.test.ts` tests each export of `ui/kit/format.ts` (`count`, `dollars`, `ago`, `plural`, `when`) and the plain logic of `ui/kit/motion.ts` (`MOTIONS` names and times, `reducedMotion`, `countTo` and `stop` on a stand-in element), with fixed dates and no timing.
  - `bun run coverage --raise` lifts the `kit` floor in `scripts/gates/baseline/coverage.json` to 40 or more, the new test file is listed under the ui part's tests in `docs/parts/ui.md`, and `bun run check` passes.
- parts: ui (health), gates
- locks: kit-tests, coverage-floors
- after: none
- files: test/kit-format.test.ts, scripts/gates/baseline/coverage.json, docs/parts/ui.md

### L212 No step starts without end
Result: A step that keeps starting and ending without a merge is stopped after three tries a day and shows in the Inbox.
- why: the done-never-restarts and reopened-restarts guards counted different things and made about 125 empty tasks; a reopened step whose tasks all close empty still loops.
- done when:
  - `startStep` counts the tasks made for a step in a rolling 24 hours from the task list, any end, and starts none over three, whatever state the step is in (ready, reopened, unproven).
  - A guard that cannot read its input (for example `commitsSince` undefined) stops the start and says so on Home, never allows it.
  - A step over the limit is an owner step in the Inbox with its done-when.
  - Tests make every task of a ready, a reopened and an unproven step close empty and find at most three starts after ten ticks, over three simulated days too.
- parts: rules, planner
- locks: none
- after: none

### L254 Steps start twice a day at most
Result: The waste watch finds no step of Lineclear started more than twice in 24 h, on this machine and the others.
- why: a step starts once, and once more after a real stop: a third start is a loop that burns tokens.
- done when:
  - The start cap in `src/tick-project.ts` reads `LIMITS.starts.limit` from `src/waste.ts`, so the rules and the waste watch hold one number.
  - Starts on another machine count against the cap like local ones: L101 made 84 starts in 24 h, many of them on a remote host, each task ending with nothing to merge.
  - A test plants the waste: every task of a ready step ends with nothing to merge, local and remote, over ten ticks; the decision log then holds at most two starts of it in 24 h and `alarms()` gives no starts alarm.
- parts: rules
- locks: starts
- after: L212
- files: src/tick-project.ts, src/starts.ts, src/waste.ts, test/starts.test.ts

### L213 One way to file a fix
Result: Every fix task the rule loop files goes through one function with one cap, one dedupe and an end that reaches the owner.
- why: `refileReopened`, `restartUnproven` and `proveClosed` bypass the daily cap, and an entry in `reopenFixes` or `proofFixes` outlives a fix task that ended unmerged, so the step is skipped in silence (red-team F4).
- done when:
  - One `fileFix` in `src/self-fix.ts` serves the stall, waste, reopened, unproven and closed-step fixes, with the daily cap, a dedupe against the task list, and a title that starts with the step id.
  - A fix task that ends without a merge makes an Inbox item, not silence, and `reopenFixes`, `proofFixes` and `proofRestarts` are gone.
  - A test ends a fix task unmerged and finds the Inbox item on the next tick.
- parts: rules
- locks: none
- after: L212
- files: src/self-fix.ts, src/tick-project.ts

### L274 Each refiled fix names its cause
Result: `lineclear measure` lists, per step, how often its fix task was filed in a day and why each one after the first was filed again.
- why: one step got its fix task 77 times in a day and another 146 times, and a fix that guesses the cause may leave the loop running.
- done when:
  - `lineclear measure <project> --refiles [--since <date>]` (default: the last 7 days) reads the fix tasks of every machine from the server's task store (its `tasks.json` and `tasks-cold.jsonl`, each task with `created` and, once ended, `doneAt` and `merged`). A fix task is a step's when its title is `Fix <id> <title>` or `<id> Fix: <title>`.
  - For each step with two or more fix tasks created in one rolling 24 hours of the period, it prints the most created in any 24 hours, and over the whole period how many of its fix tasks ended with no merge and one cause for each fix task created in the period. A cause is read against the step's fix task created just before it, on any machine, even one created before `--since`; a fix task with none before it has the cause `first`:
    1. `missed open`: that one had no `doneAt` before this one's `created`, on the same machine under the same title form: the dedupe missed a task it should have seen.
    2. `open elsewhere`: the same, but on another machine or under the other title form.
    3. `ended merged` or `ended unmerged`: that one ended before this one was created, with its `merged` value.
  - A test plants one fix task of each cause and prints them with those causes.
  - `docs/numbers.md` under "L274" lists the 5 steps with the most fix tasks in a day over the last 7 days (L8, L101, L107, L108 and L109 were the worst when this step was planned), each with its count and causes, largest first.
- parts: measure
- locks: measure-refiles
- after: none
- files: src/measure.ts, src/measure-main.ts, src/measure-refiles.ts, test/measure.test.ts, test/measure-refiles.test.ts, docs/parts/measure.md, docs/numbers.md

### L275 A step gets one fix a day
Result: A step whose fix task is open, or ended in the last 24 hours, gets no other fix task, on any machine.
- why: `fileFix` looks for an open fix only by its title on one machine's task list, so a fix on another machine or under an older title is not seen.
- done when:
  - `fileFix` in `src/self-fix.ts` files no fix for a step while a fix task of that step is open, or ended in the last 24 hours, on any machine. A local task is the step's by the rules' record (`taskSteps` in the project's `state.json`), another machine's by its title in either form, `Fix <id> <title>` or `<id> Fix: <title>`.
  - A test plants, for three steps that each need a fix, a fix task open on another machine, one open under the old title, and one that ended an hour ago. Over ten ticks it finds no new fix task for any of them. Then the open two end, and 25 hours after the last end each step gets one new fix task.
- parts: rules, planner
- locks: fixes
- after: none
- files: src/self-fix.ts, src/task-steps.ts, test/reopened.test.ts

### L270 A fix's cause is its step's text
Result: A new commit on main no longer files an ended fix again: a fix's cause is the step's own Reopened line or unproven item.
- why: the basis of a reopened fix is main's newest commit and of an unproven fix the proof head, so every merge looks like a new cause.
- done when:
  - `refileReopened` and `restartUnproven` in `src/tick-project.ts` pass `fileFix` the step's Reopened line or its unproven item as the basis.
  - A test ends a reopened and an unproven fix task done with no merge, moves main ten commits, and finds no new fix for either over ten ticks; a changed Reopened line files one.
- parts: rules, planner
- locks: fixes
- after: none
- files: src/tick-project.ts, test/reopened.test.ts

### L272 A fix filing logs a start
Result: Every fix task the rule loop files writes a start line with its step's id, so a step's starts count its fixes.
- why: an unproven fix is logged with no step id, so a reader of `decisions.jsonl` counts no start for it.
- done when:
  - Each fix filing for a step (reopened, unproven, closed) writes one decision of kind `start` with the step's id and a reason that names the kind.
  - A test files each kind once and finds three such lines.
- parts: rules, planner
- locks: decisions
- after: none
- files: src/tick-project.ts, test/reopened.test.ts

### L277 Home data tests split by topic
Result: The Home data tests sit in files by topic, each well under the size limit, so a Home step has room for its own cases.
- why: `test/home-data.test.ts` is 595 lines of the 600 a file may have, so the next Home step that adds a case breaks the size gate.
- done when:
  - The `describe` blocks of `test/home-data.test.ts` after "taskState" (the line, the spend and the "why work waits" cases) move to `test/home-projects.test.ts`, with every case kept and passing and the shared fixtures in one helper both import. Each file is under 400 lines.
  - `bun run gates` passes.
- parts: ui (health)
- locks: home
- after: none
- files: test/home-data.test.ts, test/home-projects.test.ts, test/home-fixtures.ts, docs/parts/ui.md

### L273 Home waits out of home-data
Result: Home's wait reasons live in their own file, and `src/home-data.ts` has room under the size limit for new Home data.
- why: `src/home-data.ts` is 552 lines of the 600 a file may have, and why work waits is a job apart from building the rows.
- done when:
  - `waitBlocker`, `spaceStops`, `stopsOfSpace`, `plainReason`, `notStarted` and `waitingOf` move from `src/home-data.ts` to a new `src/home-waits.ts`, listed under the ui part's code in `docs/parts/ui.md`; the importers use the new file.
  - `src/home-data.ts` is under 470 lines, and `bun run gates` and the tests pass.
- parts: ui (health), inbox
- locks: home
- after: none
- files: src/home-data.ts, src/roadmap-view.ts, test/contracts/inbox.test.ts, test/home-projects.test.ts, docs/parts/ui.md

### L218 A red check names its cause
Result: Every red merge-tier run records what failed, so the largest cause is fixed by the record.
- why: 47 % of merge checks are red and 288 of 420 red runs have no failure text, so no one can say what to fix next.
- done when:
  - A red run in `check-runs.jsonl` lists the failed gate, test or timeout; none has an empty list.
  - `lineclear measure` prints the red share by cause, and `docs/numbers.md` has it; the goal is under 15 % red.
  - A test fails a gate, a test and a timeout in turn and finds each named in the run.
- parts: checks, measure, gates
- locks: none
- after: none
- files: scripts/check.ts, src/check-runs.ts, src/measure.ts

### L250 Quarantine that heals
Result: `lineclear check` quarantines a flaky test by file and name, files a fix task, and releases the test after 10 clean runs.
- why: a flaky test blocks merges until someone releases it by hand, and names that clash across files or a chained tier skip it.
- done when:
  - `lineclear check` keys a quarantined test by file and name as `scripts/flaky.ts` does, files the same fix task on a second flake of one test within 24 hours, and releases a test after 10 clean runs in the check log.
  - A test that fails on every run is never quarantined, and each command of a chained tier runs, so quarantine applies there.
  - `lineclear check` prints each quarantined test with its run counts, and a test plants a fail, a flake, a heal and a broken case.
- parts: checks, gates
- locks: none
- after: L218
- files: src/check-runs.ts, src/check-tier.ts, scripts/flaky.ts, test/contracts/checks.test.ts, docs/parts/checks.md

### L251 A red main pauses the line
Result: A red main or a failed check for an infra reason pauses the merge line and shows on Home, and the fix for it merges first.
- why: 47 % of merge checks are red, and one red main bounces each waiting head with a failure it did not cause.
- done when:
  - When the last merge-tier run on main is red, or a check fails for out of disk, killed or an over-long slot wait, the lane pauses and Home names the reason.
  - A task whose step is the fix for the red main goes first, and the lane resumes when main is green.
  - A test shows three heads waiting through one red main and none told to fix it.
- parts: server, rules
- locks: none
- after: L218
- files: server/server/live/engine/, src/rules.ts

### L252 A pass cache per step
Result: A rebase onto an unrelated main change reads a step's earlier pass instead of running its tests again.
- why: the merge check reruns tests only because main moved, and 30.6 h of 47.9 h merge time went to checks.
- done when:
  - A step's pass is stored in the check log under a hash of the test file, the files the load map lists for it, the lock file and the runtime version.
  - A lock file or config change misses for all steps, and an unknown input is a miss, never a hit.
  - A test rebases a branch onto an unrelated main commit and no reached test reruns, and a changed loaded file reruns exactly its tests.
  - How often the merge check reruns tests only because of a rebase is measured first and written in `docs/numbers.md`.
- parts: checks, gates, measure
- locks: none
- after: L218, L250
- files: scripts/check.ts, src/check-runs.ts, test/contracts/checks.test.ts, docs/numbers.md

### L257 A busy agent is never silent
Result: A task whose agent runs a long command is no longer called silent and reminded or restarted mid-work.
- why: pi writes its session log only when a tool call ends, so an agent in a 10-minute check looks silent to the
  server, which posts "may be stuck" and starts the ladder on a task that was busy all along.
- done when:
  - While a task agent's tool call runs, the pi extension tells the server at least every 5 minutes that it is
    alive, and `lifeOf` in `server/server/live/engine/stalls.ts` counts it; it stops when the call ends.
  - A test plants the stall: a working task whose one tool call runs 25 minutes. It fails on main (a "may be
    stuck: quiet for" card) and passes after (no card).
  - A task whose agent process stopped mid-call still gets a "may be stuck: quiet for" card after 20 minutes; a
    test shows it.
  - `decisions.jsonl` in Lineclear's config folder (`$LINECLEAR_CONFIG`, else `~/.config/lineclear/`) has, in the
    day after this step merges, no `stall` line of the class `no-sign-of-life` for a task whose session log or
    heartbeat moved in the 20 minutes before it.
- parts: pi, server
- locks: stall-check
- after: none
- files: pi/extension.ts, server/server/live/engine/stalls.ts, server/test/stalls.test.ts, test/pack.test.ts

### L258 An unproven step is no stall
Result: A merged step whose unproven done-when item names a stall is no longer recorded as a no-sign-of-life stall.
- why: `classify` matches its patterns on the whole reason, quoted done-when text too, so a step whose item says
  "may be stuck" is counted as a silent task and a fix is filed for a stall that never was.
- done when:
  - `classify` in `src/stall-class.ts` matches only Lineclear's own words: a reason "<step> is merged, unproven:
    <item>" never gets a class from what the item says.
  - A test plants the stall: a skip decision with the reason `L13 is merged, unproven: Lineclear's checkStalls
    posts a "may be stuck" card after 20 min with no sign of life.` It fails on main (the class
    `no-sign-of-life`) and passes after.
  - `decisions.jsonl` in Lineclear's config folder (`$LINECLEAR_CONFIG`, else `~/.config/lineclear/`) has, in the
    day after this step merges, no line of the class `no-sign-of-life` whose reason starts "<step> is merged,
    unproven".
- parts: rules
- locks: stall-class
- after: none
- files: src/stall-class.ts, test/stall-class.test.ts

### L261 A narrow lock holds its area
Result: A step with files no longer waits behind a step that locks only another area of the same part.
- why: a step with its own locks still holds its part's plain name, which every step with files needs, so U72
  (`locks: kit`) kept other ui steps waiting for hours, and a reminder to U72's task cannot end that.
- done when:
  - In `src/parts.ts`, a running step that names its own locks holds those locks and `~<part>`, not `<part>`;
    a step with no locks or a `none` with no files still holds and needs its parts whole, and a lock named after a
    part now holds and needs that part whole too: the way to say a step's work really needs the whole part.
  - A test plants the stall: a running step `parts: ui` with `locks: kit` and a ready step `parts: ui` with
    `files: ui/web/settings.tsx`. It fails on main (the ready step is skipped with "lock 'ui' is held by") and
    passes after (it starts in the same tick); a ready whole-part step of `ui` still waits, and the test shows it.
- parts: gates
- locks: step-locks
- after: none
- files: src/parts.ts, test/parts.test.ts

### L262 New steps name their lock areas
Result: `lineclear plan submit` refuses a new or changed step that holds a whole part without saying so.
- why: a step that holds a part whole makes every other step of that part wait, so the narrow locks of L261 only
  help while new steps name their real areas, or the part itself when the work needs all of it.
- done when:
  - `lineclear plan submit` refuses a new or changed step with parts whose locks line is missing or is `none` with
    no files, and the message says to name the real areas, or the part when the work needs all of it. A step that
    names a part on its locks line, or that did not change, is not refused.
  - A test in `test/autoplan.test.ts` shows both refusals and the two steps that pass.
- parts: planner
- locks: plan-rules
- after: none
- files: src/autoplan.ts, test/autoplan.test.ts

### L263 Open steps name their areas
Result: An open step holds a whole part only when its work needs it, so lineclear's steps stop waiting on locks they do not share.
- why: U14, U15, L39, U22 and other open steps lock a part's name or no area at all while they change one area of
  it, so they wait behind any step of that part, and L262 checks only new or changed steps. Install has the worst
  part health in `lineclear measure`, and most of its stall lines are `lock-held`.
- done when:
  - Each step of `docs/ROADMAP.md` that is not done names its real areas on its locks or files line, or names the
    part on its locks line when its work changes all of it; only locks and files lines change. Not done means any
    state but done in `stepStatuses` of `src/roadmap.ts` (ready, waiting, reopened, unproven or at work).
  - A test in `test/roadmap.test.ts` reads `docs/ROADMAP.md` and the step ids done on main (`doneIds` over main's
    commits, a reopened step counted as not done), and fails on a step that is not done, names parts and has
    neither files nor a locks line other than `none`. It fails on main and passes after.
- parts: planner, install (health)
- locks: roadmap-locks
- after: L261
- files: docs/ROADMAP.md, test/roadmap.test.ts

### L264 No lock wait on another area
Result: For a day of normal runs, no step of this repo is recorded waiting on a lock it does not share with the holder.
- why: the tests of L261 and L263 plant the stall, but only a day of real starts shows the class does not come back.
  The task only reads the log and writes one entry, so it holds `numbers` for minutes; started before the day is
  over, it writes nothing, the step stays unproven and the rule loop starts it again later.
- done when:
  - `decisions.jsonl` in Lineclear's config folder (`$LINECLEAR_CONFIG`, else `~/.config/lineclear/`) has, in the
    24 hours after L263 merges while the rule loop starts this repo's open steps as usual, no `stall` line of the
    class `lock-held` for this repo whose holder and waiter share no lock and no file and neither holds a part of
    the other whole: a wait on the same area, or on a part one of them needs whole, is real contention.
  - `docs/numbers.md` has the count of `lock-held` stall lines of those 24 hours under "L264", split into shared
    and not shared, with the window's start and end.
- parts: measure
- locks: numbers
- after: L261, L263
- files: docs/numbers.md

### L259 Install has a contract test
Result: The install part's interface that other parts call is pinned by one contract test, and its debt line goes.
- why: install has the worst part health in `lineclear measure`, and its one debt is a missing contract test, so a
  change there can break the parts that read machines, secrets or releases with no test that says so.
- done when:
  - `test/contracts/install.test.ts` runs each case in a temporary `LINECLEAR_CONFIG` folder and checks:
    - `readMachines` returns `[]` with no machines file and with a file that is not JSON; it drops an entry whose
      host is not a valid host; an entry in `installing` whose `pid` is not alive comes back as `failed`.
    - `secretNames` returns a project's secret names sorted, and no value of them appears in what it returns.
    - `storedLoginAdvice` names `<NAME>_USER` style logins by name only for a text that mentions a stored login,
      and returns undefined for a text that names none.
    - `readRelease` returns `{}` with no release state file, and the saved state after `saveRelease`.
  - The line "No contract test yet" is gone from the Debts of `docs/parts/install.md`, and
    `lineclear parts check .` passes.
- parts: install (health)
- locks: install-contract
- after: none
- files: test/contracts/install.test.ts, docs/parts/install.md

### L216 Compaction by measured cost
Result: A session compacts where its measured cost says, and old tool output is replaced by a stub only if that saves money.
- why: 96 % of tokens are cache reads and two thirds of the worker cost is spent above 50k of context, so what a call carries costs more than what it adds. A stub rewrites the cache, so the saving has to be measured, not assumed.
- done when:
  - `lineclear measure` prints cost per call by context band, from the ledger (`src/measure-main.ts` prints it, `src/measure-bands.ts` builds it, `test/measure.test.ts` runs it).
  - The pack compacts at a value that band table supports (60 to 80k as the first try) and tries stubbing a used tool result after a set number of turns, keeping the notes of L54; each is kept only when tokens and dollars per merged step fall, with before and after in `docs/numbers.md` under "Token pack". It also covers the Dispatcher's session (L219 is its rotation).
  - Tests cover the band table, the stub and a value of the owner's own that stays.
- parts: pi, measure
- locks: none
- after: L52, L54
- files: pi/compaction.ts, pi/parts/compaction.ts, pi/parts/cut-output.ts, src/measure.ts, src/measure-main.ts, docs/numbers.md, src/measure-bands.ts, test/measure-bands.test.ts, test/measure.test.ts

### L217 Review cost is read, not guessed
Result: The ledger names a reviewer's calls, and a change that touches only docs or a roadmap file gets no review.
- why: review cannot be priced while the ledger does not tell it from the agent's work, and a docs-only change gains little from an Opus read of the repo rules. The brief already sizes rounds by diff (`templates/brief.md`).
- done when:
  - Each ledger row of a reviewer carries its role and round, and `lineclear measure` prints the review's tokens and dollars per task.
  - The brief says a change that touches only docs or a roadmap file and passed the check needs no review.
  - A test plants a docs-only diff and a code diff and finds the review named for one only.
- parts: planner, measure, rules
- locks: none
- after: none
- files: src/brief.ts, templates/brief.md, src/measure.ts, test/briefs.test.ts, test/measure.test.ts

### L178 Owner-only steps stay off agents
Result: A step only the owner can do by hand, like L172, is never started as an agent task and shows in the Inbox as an owner step.
- why: an agent started on a power cut or a hand test can only wait, which holds a slot and a lock for nothing.
- done when:
  - A step can be marked owner-only in the roadmap, and `lineclear roadmap check` accepts the mark; L172 carries it.
  - The line never starts an owner-only step as a task, and the step does not count as stuck or as a stall.
  - Home and the Inbox show each ready owner-only step as the owner's, with its done-when, and the owner marks it done there with the result.
  - A test makes an owner-only step ready and finds no task started and one Inbox item; marking it done releases the steps after it.
- parts: planner, inbox, rules
- after: none
- files: src/roadmap.ts, src/tick-project.ts, src/inbox.ts, test/roadmap.test.ts

### L179 No step started twice
Result: The line never starts a step whose task is working, ready or merged on any machine, so no duplicate task appears.
- why: steps like R3 and L28 were started again while a task worked on them or after it merged, because the line read only one machine's tasks.
- done when:
  - Before it starts a step, the line reads the tasks of every machine and `origin/main`, and starts nothing for a step with a task that is working, ready to merge or waiting, or with a merged commit. The one exception is a merged step the independent checker records unproven (L212, L254): it starts again with its missing item, at most three times in 24 hours.
  - A failed or closed task with no merge does not block a new start.
  - A test with two machines plants a working task on one and a merged step on main, and finds no start for either on the other.
- parts: planner, rules
- after: none
- files: src/starts.ts, src/remotes.ts, src/tick-project.ts, test/starts.test.ts, test/second-machine.test.ts

### L177 Plan uses the running server
Result: `lineclear plan` finds the running server by itself and no longer fails on the dead default address.
- why: it calls `http://127.0.0.1:7787` even when the server runs elsewhere, so a plan fails with a connection error.
- done when:
  - `lineclear plan` takes the server from the same place as `lineclear status`: the flag, then the environment, then the data folder's record of the running server, and only then the default.
  - With no server running, it says so in one line and names the command that starts it.
  - A test runs a server on a free port and finds `lineclear plan submit` using it with no flag; a test with none running finds the one-line message.
- parts: core, planner
- after: none

### L190 Reads are instant
Result: `lineclear status` and `lineclear inbox` answer in under 2 s.
- why: the Dispatcher answers from them, and today a call takes 10 to 80 s.
- done when:
  - Both read a cache the board keeps fresh instead of walking every project on each call.
  - A test with 20 projects gets each in under 2 s.
- parts: dispatcher, core
- locks: none
- after: none
- files: src/dispatcher.ts, src/cli.ts, test/dispatcher.test.ts, docs/parts/dispatcher.md

### L306 The server measures its loop lag
Result: `lineclear measure --server` prints the server's event-loop lag and a CPU profile, and a lag over 200 ms is logged with its work.
- why: a server whose loop is blocked answers late and fails herdr calls, and no one can fix what no number shows.
- done when:
  - `lineclear measure --server` prints p50, p95 and max event-loop lag and the main thread's CPU share over a window, and `--profile` saves a CPU profile of the running server.
  - A lag over 200 ms is logged with its length and the name of the work that held the loop (a route, a rule, a store write).
  - A test blocks the loop of a test server for 300 ms inside a named job and finds one log line with that name; another test finds the lag figures in the output.
- parts: server, measure (health)
- locks: loop-measure
- after: none
- files: server/server/live/loop-lag.ts, server/server/app.ts, server/server/live/source.ts, server/server/store.ts, src/measure-main.ts, src/measure-server.ts, test/measure-server.test.ts, docs/parts/measure.md, server/test/loop-lag.test.ts

### L307 The loop is free of hot paths
Result: On a busy board the server's loop lag stays under 50 ms at p95 and its main thread uses under 15 % of one core.
- why: whole-state JSON work, per-client pushes and synchronous spawns or file reads on the loop delay every request, including calls to herdr.
- done when:
  - The profile from L306 on a test board of 400 tasks and 10 agents names the top paths on the loop; each is removed or moved off the loop (a cached string for an unchanged state, one push shared by all UI clients, async spawns and reads).
  - `lineclear measure --server` on that board shows p95 lag under 50 ms and main-thread CPU under 15 %, and the before and after figures are in `docs/numbers.md` under "Server loop".
  - A test fails when a request path or a change handler runs a synchronous spawn or a file read of more than 100 KB on the loop.
- parts: server, measure
- locks: loop-hot-paths
- after: L306
- files: server/server/, server/shared/time.ts, server/test/, docs/numbers.md

### L308 A closed herdr call is retried
Result: When herdr closes a connection before its reply, the call is retried once and any failure reads "herdr closed the connection".
- why: a closed connection means the request arrived late, not that herdr is down, and calling it "isn't answering" restarts agents that are running.
- done when:
  - `send()` in `server/server/live/herdr.ts` retries a call once when herdr closed the socket before the reply (ECONNRESET, EPIPE, an early end); a second close fails with "herdr closed the connection".
  - "herdr isn't answering" is reported only when herdr's socket cannot be reached or a call times out.
  - A failed herdr call of the closed kind is not counted as an agent stop by the state checks or the stall rules.
  - Tests with a fake herdr socket plant a close before the reply and find one retry that succeeds, a second close reported with the new wording, and no agent stop counted.
- parts: server
- locks: herdr-send
- after: L266
- files: server/server/live/herdr.ts, server/server/live/agents-state.ts, server/test/herdr-contract.test.ts, server/test/herdr-send.test.ts

### L309 Nothing routes to a done task
Result: A message, restart or routing for a done or closed task is refused with its reason and never sent to a pane.
- why: a merged task has no pane, so each routing ends in "pane not found" and adds load and noise.
- done when:
  - The server and the CLI refuse a routing, tell or restart for a done or closed task before any herdr call, and name the task's state in the answer.
  - Anything queued for a task is dropped when the task turns done or closed.
  - A test with a fake herdr finds zero herdr calls for a merged task across the routing, tell and restart paths, and the refusal text.
- parts: server, rules
- locks: routing-closed
- after: none
- files: server/server/live/agents-sending.ts, server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/engine/engine-handoff.ts, server/server/live/engine/engine-tidy.ts, server/server/live/engine/engine.ts, server/server/live/engine/merge.ts, server/server/live/source-restarts.ts, src/real-world.ts, src/rules.ts, test/routing-closed-cli.test.ts, server/test/routing-closed.test.ts, docs/parts/rules.md

### L310 Done tasks leave the hot store
Result: Done tasks move out of `tasks.json` into the cold file, so the hot file holds only open work.
- why: every change rewrites `tasks.json`, so a file holding 410 tasks costs more than one holding the few that are open.
- done when:
  - A task done or closed for more than a day moves from `tasks.json` to `tasks-cold.jsonl`, and a read of it by id still finds it.
  - A test with 400 done tasks and 10 open ones finds `tasks.json` holding only the open ones, the cold file holding the rest and every task still read by id.
  - The size of `tasks.json` before and after on the test store is in `docs/numbers.md` under "Server loop".
- parts: server, measure
- locks: task-store
- after: L220
- files: server/server/store.ts, server/server/live/engine/, server/test/store-cold.test.ts, docs/numbers.md

### L253 Herdr stays healthy
Result: A herdr server at high CPU, one outside its service, or a workspace of a closed task is found and fixed by Lineclear itself.
- why: on 4 Nov a herdr spun at 100 % CPU for hours, started outside `herdr.service` that had failed 15 times, with 23 workspaces of closed tasks, and every start there failed.
- done when:
  - A rule finds a herdr server above a CPU limit for several ticks, or running outside its service, and restarts it under the service, with one line in the decision log.
  - A rule closes the workspace of a closed task.
  - A failing service is named on Home with its failure count, never left to fail in silence.
  - Tests plant a spinning herdr, a herdr outside its service and a workspace of a closed task, and find each fixed.
- parts: server, rules
- locks: none
- after: none
- files: src/herdr-health.ts, src/herdr-world.ts, src/rules.ts, test/herdr-health.test.ts, test/herdr-health-tick.test.ts

### L266 The server hears herdr's events
Result: The server learns each agent's state from one herdr event stream, with no timed pane reads while nothing changes.
- why: reading every pane on a timer costs herdr and the server CPU on each tick and grows with the number of agents; herdr pushes each change as an event (https://herdr.dev/llms.txt).
- done when:
  - The server holds one `events.subscribe` stream (the `Subscription` in `server/server/live/herdr.ts`) for the agent and pane events, and reads `session.snapshot` once when it opens and again on each `events_lost` or reopen.
  - Agent status, the agent's session file and its pane are kept from those events; the 2 s refresh in `agents-delivery.ts` and the timed `pane.read` and `pane.process_info` calls in `agents-state.ts` are gone. A pane is read only when an event or a send needs it.
  - A test with a fake herdr socket and a fake clock counts the calls in an idle hour with five agents: one `events.subscribe`, one `session.snapshot`, no `pane.read` or `pane.process_info`. A planted `events_lost` brings exactly one more `session.snapshot`, and a planted status event shows in the snapshot the server serves.
- parts: server
- locks: herdr-events
- after: none
- files: server/server/live/herdr.ts, server/server/live/agents-state.ts, server/server/live/agents-delivery.ts, server/server/live/agents-sending.ts, server/test/herdr-events.test.ts, server/server/live/agent-events.ts, server/server/live/agents.ts, server/test/background.test.ts, server/test/herdr-contract.test.ts, server/test/known-faults.test.ts, server/test/machine-recovery.test.ts

### L220 A task's brief is stored once
Result: `tasks.json` holds a task's state, and its brief sits in a file of its own that is read when needed.
- why: the brief is 91 % of `tasks.json` and is rewritten, with the rest, on every change.
- done when:
  - The brief of a task is a file under the task's folder; the task record holds its path and size (`server/server/live/engine/briefs.ts`).
  - `tasks.json` is under 10 % of its size today at the same task count, and the figure is in `docs/numbers.md`.
  - A test migrates a store with 100 tasks and finds every brief unchanged.
- parts: server
- locks: none
- after: none
- files: server/server/store.ts, server/server/live/engine/briefs.ts, server/test/engine-briefs.test.ts

## Phase 24: One stable Lineclear runs the work

Why: Lineclear builds itself while it runs the work, so a service that runs from the repo or from main changes
under every running task with each merge, and one bad merge stops every project on every machine. Here one stable
Lineclear runs all the orchestration for every machine (the server, the merge lane, the rule loop and the
Dispatcher), installed from a released build in a folder of its own. Lineclear is then a project like any other:
its tasks build and test the next version. A new version runs first as a test instance of its own, with a copy of
the real data, and becomes stable only by an explicit promotion step, once its checks and a smoke run pass. The previous build stays, and one command goes back to it. Other machines stay hands driven through herdr
(principle 7); until L95 removes their own installs, each follows the same stable build, one machine after the
other (L134).

Machines split by load, not by project: the rule loop places each task where there is room (L94), and one
project's merge line never blocks another's (LIN-199). No step here ties a project to a machine.

The steps build on the stable and next builds of LIN-186 (`src/release.ts`, `scripts/canary.ts`,
`scripts/formats.ts`) and on the release command of R3. LIN-197, LIN-199, LIN-186, LIN-204 and LIN-205 are at work
now and go first in the merge line. This phase comes right after Release 0.1 in this file, so the rule loop gives
its steps the first free slots, and each waits only for the steps whose code it needs.

Order and estimate. A task here takes 1 h 31 min from start to done at the median, half of them 47 min to 3 h 53
min (the last 50 tasks of this project). A step of one file and its test is taken as 45 min, one that changes a flow
across parts as 2 h, the rest as the median.

1. At once, in parallel: L135 (45 min), L136 (45 min), L139 after L71 (1 h 30 min), and R3 before L128.
2. After R3: L128 (2 h).
3. After L128, in parallel where their parts allow: L129 (1 h 30 min), L130 (2 h), L133 (45 min), L137 (2 h),
   L138 (1 h 30 min).
4. After L130 and L137: L131 (1 h 30 min). After L131: L132 (2 h). After L132: L134 (1 h 30 min).

The longest chain, R3 then L128, L130 (or L137), L131, L132 and L134, is about 9 h of work after R3. The steps
share the `release` lock where they change the same release code, so that chain runs one at a time.

### L128 Stable runs from a release
Result: The running service uses a fixed release folder, so a merge no longer changes it.
- why: a service that runs from a git checkout or from main changes under running work with every merge or
  checkout, so no one can say which code runs the work.
- done when:
  - `install.sh` installs a release (a version tag made by `bun run release`, with its built files) into
    `~/.lineclear/builds/<version>` and points `~/.lineclear/builds/current` at it. The service, the merge lane, the
    rule loop and the Dispatcher run from `current`, and the `lineclear` on PATH is the one in `current`.
  - The build before it stays in its folder as `~/.lineclear/builds/previous`.
  - `lineclear doctor` fails when the service or the `lineclear` on PATH runs from a git checkout or from a build
    that is not a release, and names the command that fixes it.
  - A test installs a release into a fresh HOME: the service unit and the `lineclear` on PATH point inside
    `builds/<version>`, and none inside a repo. A second install of a newer release keeps the first as `previous`.
- parts: install, core
- locks: release
- after: R3
- files: install.sh, src/machines.ts, src/doctor.ts, test/install.test.ts, test/machines.test.ts

### L129 Own tasks leave stable alone
Result: A task in this repo can no longer touch the config, port or store of the running system.
- why: a task in the Lineclear repo that runs its own `bin/lineclear` against the real config, port or store
  changes the system that runs every other task.
- done when:
  - An agent in a worktree of the Lineclear repo gets the stable `lineclear` on PATH, as an agent of any other
    project does. Its own `bin/lineclear` runs only with a `LINECLEAR_CONFIG` and a data folder of its own.
  - The repo's `bin/lineclear` started without its own `LINECLEAR_CONFIG` refuses to use the stable config folder,
    data folder or port, and says how to start a test instance (L130).
  - Tests: an agent's environment in a Lineclear worktree resolves `lineclear` to `builds/current`, and the repo's
    `bin/lineclear` with the stable config refuses and changes no file.
- parts: core
- locks: none
- after: L128
- files: bin/lineclear, src/paths.ts, src/cli.ts, test/cli.test.ts

### L138 Installs point at stable
Result: Nothing installed points into a worktree, so an agent never runs a branch by accident.
- why: a secrets loader, a pi extension or a service file that points into a worktree runs that branch's code for
  every agent, and breaks when the worktree goes.
- done when:
  - The secrets loader, the pi extension pi loads, the agent kit, the service units, the helper and every other
    file `install.sh` writes point into `~/.lineclear/builds/current`, never into a repo or a worktree.
  - `lineclear doctor` fails on any installed file or pi setting that points into a git checkout, and names it.
  - A test installs a release with a Lineclear worktree beside it and finds no installed path inside that worktree;
    a planted pi setting that points into it fails the doctor.
- parts: install, pi
- locks: release
- after: L128
- files: install.sh, pi/, src/secrets.ts, src/doctor.ts, test/install.test.ts, test/doctor.test.ts

### L130 Test instance of next build
Result: The next build runs on a test instance before it takes over real data.
- why: a new build proved only on a scratch store can still break on the real data it takes over.
- done when:
  - `lineclear release try <version>` builds that release into `~/.lineclear/builds/<version>` and starts it as a
    test instance: its own port, its own `LINECLEAR_CONFIG` and data folder, its own herdr session, with a copy of
    the real data (the task store, the chats, the Inbox, the settings, the spaces and each project's roadmap). With
    no version it makes a candidate release from main's newest green commit, at most one each 30 minutes.
  - The test instance cannot touch what is real: it works on clones of the projects in its own folder whose remote
    is a local bare copy, it gets no GitHub token and no SSH to another machine, it starts no agent on a real task,
    and it never writes stable's files or takes stable's port or service. `lineclear release try --stop` ends it and
    removes its folders.
  - `lineclear release` and `lineclear doctor` show the test instance's version, port and state.
  - Tests: stable's config and data folders and each real repo's refs are the same byte for byte after a try run and
    its stop; a planted `git push` and a planted `gh` call from the test instance fail; the test instance answers on
    its own port with the copied tasks.
- parts: install, server
- locks: release
- after: L128
- files: install.sh, src/doctor.ts, server/scripts/update.ts, test/doctor.test.ts

### L137 One store for both builds
Result: A rollback loses no tasks, chats or Inbox items.
- why: a rollback puts the previous build back on the store the new one wrote, so a format only one of them reads
  loses tasks, chats or Inbox items.
- done when:
  - Stable and the candidate read the same store. A change of a stored format (the task store, chats, the Inbox,
    settings, spaces, the roadmap) ships with a migration and with a check both ways: the candidate reads what
    stable wrote, and stable reads what the candidate wrote, with no task, chat or Inbox item lost. The check runs
    before a merge, as LIN-186's format test does, and fails on a format change with no migration.
  - A test writes a store with the candidate, rolls back to the previous build, and finds every task, chat and Inbox
    item; a planted format change with no migration fails the check.
- parts: install, server
- locks: release
- after: L128
- files: server/scripts/update.ts, src/migrate.ts, test/migrate.test.ts

### L131 Candidate checked on its own
Result: Checks and a smoke test run on the exact build that would be promoted.
- why: a promotion can only trust what was checked on the exact build it promotes.
- done when:
  - For a candidate, `lineclear release check <version>` runs its `bun run check` at its tag, then the smoke check
    and the canary (start a task, brief it, make a change, check it, close it) against its test instance, and the
    store check of L137 both ways.
  - The result, with the version, the commit and each check's outcome, is kept in `<config>/release.json` and shown
    by `lineclear release`. A failed candidate files one fix task with what failed, as LIN-186 does.
  - Tests: a planted failing smoke run marks the candidate failed and files one task; a green run marks it ready.
- parts: install, checks
- locks: release
- after: L130, L137
- files: scripts/smoke.ts, src/check-runs.ts, test/install.test.ts

### L132 Promotion is explicit
Result: A build becomes stable only by a promotion that records the proof and the way back.
- why: a build that becomes stable as a side effect of a merge or an install skips the proof it needs, and whoever
  looks later must see which build took over, on what proof, and how to go back.
- done when:
  - `lineclear release promote <version>` is the only path to stable, and refuses a candidate whose checks, smoke
    run and canary (L131) did not all pass. No merge, install or update promotes a build. The rule loop runs it by
    itself for a candidate that passed, as its own recorded step.
  - Each promotion leaves one Inbox item to read: the version, what changed since stable and the smoke run's
    result, with one tap to roll back (L133). A project that sets `release.promote: ask` gets the same item with
    one tap to promote instead, and the rule loop then waits for that tap.
  - A promotion points `current` at the build, keeps the one before as `previous`, restarts the service, runs the
    smoke check, and goes back by itself when that fails (LIN-136). It is recorded in `decisions.jsonl` with the
    version and the checks it relied on.
  - Running work survives it (LIN-135): every agent, herdr space, wait and the merge line's queue is the same after
    the restart, and no task restarts or loses its place.
  - Tests: a promotion of a candidate with no passed checks is refused; a planted failing smoke after the switch
    puts the previous build back; with tasks working, waiting and queued to merge, a promotion leaves each agent's
    process, herdr space, wait and place in the line as it was.
- parts: install, inbox, rules
- locks: release
- after: L131
- files: install.sh, src/inbox.ts, src/rules.ts, scripts/smoke.ts, test/install.test.ts

### L133 One command rolls back
Result: One command puts the previous stable build back.
- why: when a stable build turns out bad after its checks, the way back must be one command that anyone can run.
- done when:
  - `lineclear release rollback` points `current` at `previous`, restarts the service without ending running
    work, runs the smoke check and records the rollback in `decisions.jsonl`. The rolled-back build stays in its
    folder and is not offered again until a newer version passes.
  - `lineclear doctor` names the current, previous and candidate builds.
  - Tests: an install of two releases and a rollback leave the service unit, the `lineclear` on PATH and the
    version of the first; a running task survives the rollback.
- parts: install
- locks: release
- after: L128
- files: install.sh, src/doctor.ts, test/doctor.test.ts

### L135 Server install code clean
Result: The install and update code of the server is tidy enough to rely on.
- why: the server has the worst part health, and the stable and next builds lean on its install and update code.
- done when:
  - `server/scripts/update.ts` and `server/server/live/install.ts` have no entry left in the lint and dead-code
    baselines, and `bun run gates --lower` lowered them.
  - The server's tests pass.
- parts: server (health)
- locks: release
- after: none
- files: server/scripts/update.ts, server/server/live/install.ts

### L136 Server update tests clean
Result: The update's tests are short and plain, so what they prove can be read.
- why: the update's tests guard every promotion and rollback, and a test with long functions and forced values
  hides what it proves.
- done when:
  - `server/test/update.test.ts` has no entry left in the lint baseline: no function over the length limit and no
    non-null assertion, and `bun run gates --lower` lowered it.
  - The server's tests pass and test the same cases as before.
- parts: server (health)
- locks: none
- after: none
- files: server/test/update.test.ts

## Phase 27: Home tells the truth

Why: Home must show what is, or the owner stops trusting it. It listed every space of the server as a project, so
the Dispatcher's own space showed as a project with no tasks and a space left from a retired setup showed beside the
three real projects. Tools that cache compiled code wrote it into a RAM-backed /tmp, so the doctor warned on Home that
the machine may swap. Home also said nothing of why work waits: which task holds a paused merge, or why a ready step
has not started.

The ready steps that did not start were held by locks, not by slots: a step's parts are its locks, so one step at
work on a part held every ready step of that part, even where they name different areas (one UI step held ten). L151
lets a step's own locks narrow its part's lock, so that independent steps run in parallel as far as the machines
allow. No step here waits for another. L151, L150 and L156 can start at once. L149 and U69 both change Home's data, so
they share the `home` lock and run one after the other, once L151 is merged or the UI step at work ends. L152 is the
health step for the part with the worst health, the server, and starts when its lock is free.

An idle board must also cost close to nothing. With no change to show, the server process stayed near a quarter of
a core, herdr near a fifth, and other machines were polled over ssh every few seconds. The old setup's own server
and timer kept running after it folded in, and server processes that tests started lived on after their run. L153
finds and cuts the idle cost, L154 stops what the old setup left running once L107 has decided each part, and L155
ends what tests leave behind.

### L151 Step locks narrow part locks
Result: Ready steps on different areas of one part start side by side instead of waiting for the whole part.
- why: a part lock that covers areas no step shares holds back work that could run beside it.
- done when:
  - The rule loop holds, for a step that names locks of its own on its locks line, those locks and not its parts as
    wholes. A step with no locks line, or `locks: none`, still holds each of its parts whole.
  - A test plants a step with `parts: ui` and `locks: data, shell` at work and a ready step with `parts: ui` and
    `locks: roadmap, status`: the second starts. A ready step with `parts: ui` and no locks line waits, with the
    reason `lock 'ui' is held by` the first.
  - The "How to read it" list of this file says the rule, and `templates/plan.md` tells the planner to name a
    step's real areas on its locks line.
- parts: rules, planner
- locks: none
- after: none
- files: src/rules.ts, test/rules.test.ts, docs/ROADMAP.md, templates/plan.md

### L149 Home lists projects, not spaces
Result: Home shows only your real projects; the Dispatcher's space and leftover spaces no longer appear as projects.
- why: a space with no project, such as the Dispatcher's own space or one left from a retired tool, is not work, and
  showing it as a project makes the owner doubt every other line.
- done when:
  - Home and `/api/home` list on each machine exactly the projects of `lineclear project list` there, except the
    paused ones and the test space, which Settings hides until the owner asks (`showPaused`). A server space
    that no project points at shows no project, line or "0 tasks open".
  - An open task of a space with no project still shows among the tasks at work, under its space's name, so no
    running work hides.
  - A test with three projects, the Dispatcher's space and one more space with an open task gets three projects and
    that task from `/api/home`.
- parts: ui
- locks: home
- after: none
- files: src/home-data.ts, test/home-data.test.ts, test/home-projects.test.ts, test/web-prefs.test.ts

### L150 No compile cache in RAM
Result: The compile cache lives on disk, so /tmp stays small and the doctor no longer warns of swap on Home.
- why: Node, npm and pnpm write their compile cache to `/tmp/node-compile-cache` by default, and where /tmp is RAM
  it grows past a gigabyte and pushes the machine toward swap.
- done when:
  - The install sets `NODE_COMPILE_CACHE` to Lineclear's cache on disk (`compileCacheDir` in `src/tmpdirs.ts`) for
    the user's services and sessions, so the service, its checks and every agent started after it write there. A
    second install changes no file, and `lineclear uninstall` removes the setting.
  - The rule loop's temp sweep removes `/tmp/node-compile-cache` and keeps the disk cache trimmed to its cap.
  - `lineclear doctor` fails when `NODE_COMPILE_CACHE` is not set where the install sets it, and its fix installs
    again.
  - Tests cover the setting, the second install, the uninstall and the sweep.
- parts: core, install
- locks: none
- after: none
- files: src/tmpdirs.ts, install.sh, src/doctor.ts, src/uninstall.ts, test/tmpdirs.test.ts, test/install.test.ts

### U69 Home says why work waits
Result: Home shows what runs now, what each paused task waits for and why each ready step has not started.
- why: a paused task or a ready step that does not start looks like a stall unless Home says what it waits for.
- done when:
  - For each project, `/api/home` gives the tasks at work now with their stage and how long they have run; each
    paused task with what it waits for in words (a task wait names that task and its title, a timed wait its
    reason and when it wakes); and each ready step not started with the rule loop's last reason for it from
    `decisions.jsonl`, such as "lock 'ui' is held by U34 An error keeps your data".
  - Paused tasks that wait for the same task are counted together, such as "5 merges wait for LIN-197", whether
    they wait for it by a task wait or a timed wait whose reason names it.
  - Home shows these three groups under each project, with no headline or explainer.
  - A test plants five tasks that wait for one task, a ready step held by a lock and one held by a full machine,
    and gets the count and the reasons from `/api/home`.
  - Screenshots at 390 and 1440 px of a project with all three groups and with none are on the pull request.
- parts: ui, rules
- locks: home, task-row
- after: none
- files: src/home-data.ts, src/waits.ts, ui/web/home.tsx, test/home-data.test.ts

### L156 Status counts only your waits
Result: `lineclear status` counts as waiting for you only what needs you; an agent's other waits show as paused.
- why: an agent that waits for another task or a timer does not need the owner, and counting it as such hides the
  real asks among false ones.
- done when:
  - `lineclear status` (`src/status.ts`) counts as waiting for you only the Inbox items and the owner waits, and
    prints an agent's other waits as paused, each with what it waits for.
  - A test (`test/waiting.test.ts`) plants an Inbox item, an owner wait, a task wait and a timed wait, and gets a
    count of two and two paused lines.
- parts: rules
- locks: status
- after: none
- files: src/status.ts, test/waiting.test.ts

### L152 No dead exports in the server
Result: The server has no export that nothing imports, so its dead code baseline is empty.
- why: an export no one imports is code to read, keep and test for nothing, and the server has the most of them.
- done when:
  - The dead code baseline in `scripts/gates/baseline/dead-code.json` lists no entry under `server/`: each export
    is used, made private or removed, and `bun run gates` and the server's tests pass.
- parts: server (health)
- locks: none
- after: none
- files: server/

### L153 Idle board uses almost no CPU
Result: With nothing at work, the server, the rule loop and herdr together use only a few percent of one core.
- why: a server that polls and redraws when nothing changed takes CPU from the work on the same machine, and every
  other machine it polls pays too.
- done when:
  - With no task at work and nothing changed for 10 minutes, the server's process and the rule loop together use
    under 3 % of one core on average, and herdr under 3 %, measured by `lineclear measure --idle` over those 10
    minutes. The numbers before and after are in `docs/numbers.md` under "Idle cost", each with what used it.
  - Another machine is read over one kept ssh connection, and only as often as its last answer changed: at most
    once a minute while nothing there changed, at once after a change Lineclear made there.
  - A test with a fake clock and a fake machine counts the server's reads of herdr and of the other machine in an
    idle hour, and fails above the counts this step sets.
- parts: server (health), rules, measure
- locks: none
- after: none
- files: server/, src/remotes.ts, src/measure.ts, docs/numbers.md, test/second-machine.test.ts

### L154 No old setup left running
Result: No service of the old setup, timer or server still runs on any machine once its part has moved.
- why: a service kept running after its job moved costs CPU and memory and keeps a second web UI open.
- done when:
  - On every machine, each unit, timer and server of the old setup whose verdict is "in
    Lineclear" or "goes" is stopped and disabled, and no process of it runs.
  - `lineclear doctor` names any such unit or process still running, and `lineclear doctor --fix` stops and
    disables it on every machine. A test covers a running unit and its fix.
- parts: install
- locks: none
- after: L107
- files: src/doctor.ts, test/doctor.test.ts

### L155 Tests leave no process behind
Result: A test run ends every process it started, even when a test fails or times out.
- why: a server a test started and did not stop keeps its memory and ports for days.
- done when:
  - Every process a test starts ends with its test, even when the test fails or times out: a test run leaves no
    process whose command lies in its temp folder.
  - The rule loop's temp sweep ends a process that runs from a test folder it removes.
  - A test plants a server left by a run and finds it ended by the sweep.
- parts: core
- locks: none
- after: none
- files: test/helpers.ts, test/tmp-scope.ts, src/tmpdirs.ts, test/tmpdirs.test.ts

## Phase 0: Base

Why: every later step needs a repo, a check, and an install that anyone can run.

### L0 Repo that checks itself
Result: One command checks types, tests and dashes, and fails by itself when it takes over 180 s.
- why: every later step needs a place to land and one check that keeps the repo clean.
- done when:
  - The stack in idea.md is set up: TypeScript strict on Bun (`tsconfig.json`, `test/stack.test.ts`), with `src/`, `test/` and
    `bin/lineclear`.
  - `bin/lineclear --help` lists its commands. An unknown command prints one line and exits 2. `bun test test/cli.test.ts`
    shows both on the real `bin/lineclear`, and `test/bin-lineclear.test.ts` shows the exit code 2 from a plain shell.
  - `bun run check` runs the types, the tests and the dash check, and passes. It fails by itself over 180 s
    (load-adjusted), the budget in `docs/numbers.md` under "The merge check's budget" and in AGENTS.md.
  - The dash check fails on an en dash or an em dash in any tracked file, and names the file and the line. A test
    shows it on a fixture with each dash, made in a temporary folder so that no tracked file holds a dash.
- locks: repo
- after: none

### L1 One-line install and doctor
Result: You install Lineclear with one command, and a broken setup tells you how to fix itself.
- why: every pilot installs with one command, and a broken setup says how to fix itself.
- done when:
  - `curl -fsSL <repo>/raw/main/install.sh | sh` first installs the missing tools among git, Bun, herdr and pi. Then it adds Lineclear with its pi
    extension and its systemd user service. It uses curl because `bunx` needs Bun first.
  - Until later steps fill them, the service runs a `lineclear run` that stays up and does nothing, and the pi
    extension is empty. L6 and L9 fill them.
  - `install.sh` takes an optional ref in `LINECLEAR_REF`, so a test can install a branch.
  - It asks nothing it can detect. It asks for sudo only to add system packages. It prints one plain line per step.
  - `lineclear doctor` checks each part. For each problem it prints one line and one command that fixes it. It exits
    0 only when all is well.
  - `lineclear uninstall` removes what install added. It keeps project settings and secrets unless given `--all`.
  - Running `install.sh` again updates Lineclear to the newest version on main.
  - A test in `.github/workflows/install.yml` on a fresh Ubuntu virtual machine with systemd. It installs, and then
    doctor passes. A second install changes no file. An install of the branch's parent commit followed by an install
    of the branch updates it. Uninstall leaves
    none of Lineclear's files.
- locks: install
- after: L0

## Phase 1: Read the plan

Why: the rules and the numbers can only work from a plan they read without guessing.

### L2 Roadmap check and status
Result: `lineclear roadmap status` shows how far a project is, from the roadmap file alone.
- why: the rules must read the plan without guessing, and progress must survive any restart without a file edit.
- done when:
  - `lineclear roadmap check <repo>` reads `docs/ROADMAP.md` in the format at the top of this file and names the line of a missing or unknown field, a duplicate id, and an `after` that is unknown or circular (test/roadmap.test.ts).
  - `lineclear roadmap status <repo> --space <name> [--json]` gives each step one of five states. Done comes from
    the commits on origin/main as the format says. Dropped comes from the `dropped` line. In work means an open task
    in that Lineclear space whose title starts with the id and a space, so `L1` never matches `L10`. Ready means
    every step in its `after` is done. Waiting is all the rest. L6 passes the space from L5's settings.
  - Tests: a test repo covers every state and every error kind, and this file passes. A generated roadmap of 400
    steps over 12 phases is checked in under 1 s.
- locks: roadmap
- after: L0

### L3 Bring your own plan in
Result: A project with its plan in another file imports it without redoing its done steps.
- why: a project with its plan in another file must not start over, or redo its done steps.
- done when:
  - `lineclear roadmap import <file.json> <repo>` (src/roadmap-import.ts, test/roadmap-import.test.ts) writes `docs/ROADMAP.md` from a JSON list of steps with the fields `result`, `why`, `done_when`, `locks`, `after`, `id`, `title`, `phase` and `state`.
  - The `state` is `open`, `done` or `dropped`; a dropped step may have a `reason`, and without one it gets "imported as dropped" (test/roadmap-import.test.ts).
  - `docs/import.md` documents the shape with an example.
  - The import commit has a line `Step: <id>` for each done step, so `roadmap status` shows the same done set as the file (test/roadmap-import.test.ts).
  - A field it cannot place stops the import with the step id and the field, and nothing is written (test/roadmap-import.test.ts).
  - Tests: a fixture with every state, and one with an error (test/roadmap-import.test.ts).
- locks: roadmap
- after: L2

### L4 Three numbers for the work
Result: `lineclear measure` shows your asks a day, the wait before a start and the cost of a merged step.
- why: the before and after of every phase.
- done when:
  - `lineclear measure <project> --since <date> [--json]` prints, for each day:
    - asks: needs-you cards in Lineclear's chat files, and Inbox items once the Inbox exists
    - wait: the median minutes from the merge that made a step ready (its last `after`) to the start of its task
    - cost: the equivalent $ per merged step. It is the tokens in its tasks' pi session files at the price of the
      same model in pi's model data. A model with no price there is named, not guessed. A task with no session
      file found is named too, and is not counted as $0.
  - It uses no AI, and reads only files and git.
  - A fixture of two days, counted by hand, gives the same numbers.
- locks: measure
- after: L2, L5

### L5 Project settings
Result: Each project has its own settings, such as its check, its space and its models.
- why: the rules need to know each project's settings, and none of them may be guessed.
- done when:
  - `lineclear project add <repo>` writes `~/.config/lineclear/projects/<name>/settings.json` with these fields:
    - the repo path and its Lineclear space
    - the check command, and an optional health command for main
    - an ordered model list for each of the three roles in idea.md
  - It fills in what it can detect: the space from `lineclear space list`, the check command from a `check` script
    in `package.json` or a `check` target in a `Makefile`. It asks only for what is still missing.
  - `lineclear project list`, `lineclear project remove <name>` and `lineclear project check <name>` work. The check
    says whether the repo exists and its check command runs.
  - Tests cover each field and a missing repo.
- locks: settings
- after: L0

## Phase 2: Rules instead of the AI coordinator

Why: an AI coordinator that wakes on a timer spends tokens when nothing changed. A rule does the same for free.

### L6 Rules start the work
Result: Ready steps start by themselves, with no AI coordinator watching the clock.
- why: this step replaces the AI coordinator.
- done when:
  - `lineclear run` ticks every 30 s as the user service from L1. `lineclear run --once --dry-run` prints the
    decisions of one tick and changes nothing.
  - Each tick, for each project: a ready step whose locks are free starts with
    `lineclear task add "<id> <title>" --brief <brief> --space <space>` when the space has a free slot. The brief is
    made from `templates/brief.md` with the step's why, its done-when and the project's check command.
  - The brief asks for a review before the merge by the first model in L5's reviewer list that comes from another
    company than the worker's model, and tells the agent to merge once that review passes. The reviewer reads the
    change against the step's why and done-when. Critical and major findings are fixed, for at most the project's
    review rounds (2 if unset). A finding still open after them makes the step ask you. A reviewer model that pi
    no longer offers is skipped for the next one in the list.
  - Steps start day and night, as many at once as their locks and the space's slots allow.
  - A broken roadmap starts nothing, and shows in `lineclear status`.
  - When the project's health command fails after a merge, it starts one fix task with the command's output in its
    brief. A second failure in a row stops new starts in that project, and shows in `lineclear status`.
  - Each start, and each reason a ready step did not start, goes to `decisions.jsonl` once, with its reason.
  - Tests with a fake `lineclear` cover locks, after, a full space, a broken roadmap, a failing health command and
    a reviewer from the worker's company being skipped.
- locks: rules
- after: L1, L2, L5

### L7 Waiting agents are left alone
Result: An agent that waits is not nudged, and checks take turns so one machine is not overloaded.
- why: an agent that waits must not be nudged, and checks must not overload the machine.
- done when:
  - `lineclear wait <owner|login|checks|browser> "<reason>"`, `lineclear wait until <time> "<reason>"`,
    `lineclear wait task <id> "<reason>"` (refused for an unknown task; the rule loop wakes the task once that one is done),
    `lineclear ask "<question>" --choice <a> --choice <b>` and `lineclear resume` work from inside a task. They find
    the task from its worktree. Each wait and its reason show in `lineclear status`.
  - An `until` wait holds no slot. The rule loop stops the task with `lineclear task stop`. At the time it wakes the
    task with `lineclear task tell`, which resumes its agent. Until the Inbox (L12) `lineclear ask` posts the
    question as a `lineclear ask` card.
  - `lineclear check` runs the project's check command. At most N checks run at once on a machine (a machine
    setting, 2 if unset). A check that waits for its turn is a `checks` wait.
  - A load limit (a machine setting, the number of CPU cores if unset): while the machine's load average is above
    it, the rule loop starts no new task, and says so once in `decisions.jsonl`.
  - The brief template tells workers to use `lineclear check`, `lineclear wait` and `lineclear ask`.
  - Tests cover each wait kind, a timed wake, three checks with N set to 2, and no start above the load limit.
- locks: rules
- after: L6

### L8 Rules run a real project
Result: A real project runs on the rules for a week and its numbers are written down.
- why: the proof that rules can replace the AI coordinator.
- done when:
  - One project is picked. Its coordinator is set to regular (`lineclear mode <space> regular`). It is told in its
    chat that rules now run the project, and its standing requests are cleared. Then `lineclear run` drives the
    project, and the project stays on the rules.
  - The pilot has run. Its numbers so far are in `docs/numbers.md`: steps merged, waits for a free slot, task
    starts by a rule, and the coordinator's runs and cost.
  - The project's numbers before and after are in `docs/numbers.md`.
- locks: pilot
- after: L3, L4, L7

## Phase 3: Safety

Why: an agent should hold only what its task needs, and nothing should leave without you. This does not depend on
the rules, so it runs beside phase 2.

## Phase 4: Inbox and stalls

Why: you are asked only for real decisions, and stalls are cleared without you.

### L12 Inbox
Result: One place asks you, and you answer with a button.
- why: one place asks you, with its answers as buttons.
- done when:
  - `lineclear inbox` lists the open items. There are five kinds:
    - a plan to approve
    - a step that needs you
    - a login or a code, with the name of the agent's live playwright-cli browser session to take over
    - an outward action
    - a task stuck after every automatic try
  - `lineclear inbox answer <n> <choice>` answers one. The answer reaches the task with `lineclear task tell`.
  - `lineclear ask` adds an item to the Inbox instead of a `lineclear ask` card.
  - Each new item reaches the phone once, as one Web Push. Nothing else from Lineclear alerts you.
  - The brief template tells workers to raise an outward action with `lineclear ask`.
  - Tests cover each of the five kinds and an answer that reaches its task.
- locks: inbox
- after: L7

### L13 Stalls clear themselves
Result: A stalled agent is nudged and restarted by a rule before it ever asks you.
- why: a stall is cleared by a rule, not by you.
- done when:
  - Lineclear's `checkStalls` posts a "may be stuck" card after 20 min with no sign of life. Each such card moves its
    task to the next rung, unless the task has a declared wait. The rungs in order:
    1. a reminder with `lineclear task tell`
    2. a restart that resumes its session: `lineclear task stop`, then `lineclear task tell`
    3. its role's next model from L5's list: the task is closed with `lineclear task close`, which keeps a branch
       with unmerged work, and the step starts again with `lineclear task add ... --model <next>`. Its brief names
       the old branch to go on from. Rung 3 runs inside the rule loop's tick, so the loop never starts the step a
       second time. A test shows one start.
    4. an Inbox item
  - Lineclear itself handles a task that is out of allowance, signed out or without its provider: its backup agent
    takes over once when it is another CLI (Lineclear `server/live/engine/engine.ts:1158-1164`). When Lineclear
    leaves such a task waiting for you, it goes straight to rung 3.
  - Accounts: a task whose subscription is full, or whose free or extra account ran out, goes straight to rung 3
    with no wait. A model on a paid API key is used only after you allowed it in the Inbox, once per key.
  - Each rung goes to `decisions.jsonl`. Tests use a fake clock and a fake `lineclear`, and cover a full
    subscription, an ended free account and a paid key that is not yet allowed.
- locks: rules
- after: L12

### L19 Common asks answered for you
Result: Routine questions from agents are answered by a rule and never reach you.
- why: an ask that a rule can answer should never reach you.
- done when:
  - The needs-you cards of the last week in Lineclear's chat files are sorted into kinds in `docs/asks.md`, each
    with its count.
  - The three most frequent kinds that a rule can answer each get that rule and a test, and no longer reach you.
  - The other kinds are listed in `docs/asks.md` with the Inbox kind they become.
- locks: inbox
- after: L12

## Phase 5: Own fork

Why: a merge lane with its own rules, and fixes for Lineclear's known faults, need changes inside Lineclear.

### L20 Old server faults fixed
Result: The known faults of herdr-projects 2.0 are gone, so no workaround is left to run.
- why: a fork that keeps its base's faults keeps their workarounds too, and each workaround is one more part to run.
- done when:
  - `docs/known-faults.md` lists every fault seen in herdr-projects 2.0 before the fork, each with how it shows and the
    workaround people use for it. It includes at least: an agent loses its herdr name right after start, so its
    brief never arrives and its merge is blocked by messages it never read; `lineclear ready` without an id crashes;
    a task keeps waiting for a task that is already merged; a merge can land conflict markers on main; a brief typed while pi is still starting is never sent, and the task shows as waiting for you.
  - Each fault has a test that fails on `ebb17d5` and passes on the fork.
  - Each workaround in the list is no longer needed, and the list says so per line.
  - A fault that cannot be fixed without a large rewrite is named with its reason and moved to backlog.md.
- locks: server
- after: L14

### L15 Move from herdr-projects 2.0
Result: Your work moves to Lineclear with nothing lost, and one command takes you back.
- why: your work moves over without loss, and you can go back.
- done when:
  - `lineclear migrate --dry-run` lists what it copies from the old data folder. That is every space with its settings,
    and the open tasks with their chats and artifacts. `lineclear migrate` copies them to `~/.lineclear` and never
    changes the old data folder, so herdr-projects 2.0 can start again.
  - The rule loop, the waits and the Inbox talk to the fork instead of herdr-projects 2.0.
  - A check runs right after the move: a task starts, waits and merges on the fork, and the run adds no main-red,
    needs-you or stall card beyond what herdr-projects 2.0 added in a run of the same task.
  - herdr-projects 2.0 is stopped, and `lineclear doctor` says so. `install.sh` no longer adds it, and `lineclear
    doctor` no longer checks for it.
- locks: server
- after: L20

### L16 Merges land the same way
Result: Each merge lands by a rule and main stays green.
- why: with the coordinator gone, a rule decides how each merge lands, and main stays green.
- done when:
  - A task's agent merges its own task once its review passed, and every merge goes through the lane.
  - A branch is merged as it is when no commit on main since its base touches its files (herdr-projects 2.0 already
    merges a branch behind main as it is). Otherwise the project's check runs on the merged result first.
  - A conflict goes back to its worker with the conflicting files.
  - After two failed health commands in a row on main, the last merge is reverted, and an Inbox item says so.
  - `lineclear measure` gains a fourth number, the median minutes from review passed to merged. It is in
    `docs/numbers.md` before and after.
- locks: server
- after: L15

## Phase 6: Planner and Dispatcher

Why: a new project or a change of plan takes one conversation and one approval.

### L17 Plans come from a planner
Result: A planner writes the roadmap change the same way every time, and you approve it once.
- why: a roadmap is written the same way every time, and you approve it once.
- done when:
  - `lineclear plan <project> "<goal>"` starts a planning task with a brief from `templates/plan.md`.
  - Its result is a change to `docs/ROADMAP.md` that passes `roadmap check`. It comes to the Inbox as one approval
    with the diff. Approving merges it. Rejecting it with a note sends it back once.
  - A test with a fake planner covers both answers.
- locks: planner
- after: L12

### L18 One chat for all projects
Result: You ask and steer every project in one chat with the Dispatcher.
- why: one chat to ask and steer across projects, with no coordinator per project.
- done when:
  - The Dispatcher is the coordinator chat of its own space in regular mode, with pi as its agent. That space has
    no tasks and is not the home space, so no news reaches it (Lineclear `README.md:371-376`). Its prompt is
    `templates/dispatcher.md`.
  - Its tools are the commands `lineclear status`, `lineclear plan`, `lineclear move` and `lineclear inbox`.
    `lineclear move <project> <step> --after <ids>` sends a plan change to the Inbox for approval. Its status comes
    from `lineclear status`, not from memory.
  - Its status answer for all projects stays under 2000 tokens.
  - Lineclear's pi extension refuses `lineclear inbox answer` and any merge from the Dispatcher. Tests show both
    refusals, and that a task event in a project does not wake it.
- locks: dispatcher
- after: L17

### L41 One contact for the team
Result: One sentence in the chat reaches the right project's worker, and you get an answer back.
- why: the parts exist, but a sentence in the chat has never reached workers in the right project, and the Dispatcher
  does not pick the project itself.
- done when:
  - In the web chat, a request that names no project goes to the right one. Plain code gives the Dispatcher the
    project list (`lineclear dispatcher projects`: name, repo, the first lines of the idea or README), and the model
    picks. If two fit, it asks one short question with the projects as buttons. If none fits, it says so.
  - It hands the request on with `lineclear plan <project> "<goal>"`. The steps come back as one approval, the same
    item in the chat and the Inbox. Approving puts them in the roadmap. The Dispatcher never starts or merges a step.
  - It answers with a link to the live view of those steps, and `lineclear status --plan <task>` says where exactly
    those steps stand.
  - Tests with a fake planner and two fake projects cover a clear pick, a pick that asks, an unknown project, and
    approve and reject. One real run is in `docs/numbers.md` under L41.
- locks: dispatcher
- after: L37

## UI track

Why: Lineclear is used every day, so it must be clear at a glance and pleasant to use. It is built once, on one
brand.

### U0 Logo and colours
Result: Lineclear has a mark and a theme where green means clear, amber means it waits for you and red means broken.
- why: every view is built on one mark and one meaning of colour, taken from the railway signal behind the name.
- done when:
  - Three options are made. Each has one SVG mark that reads at 16 px (as a favicon) and at 512 px, a one-colour
    version and the wordmark, shown in one picture on the dark base.
  - There is one theme only, the dark graphite one. There is no light variant.
  - The colour tokens have one meaning each:
    - green means line clear (on main and all good)
    - amber means caution (it waits for you in the Inbox)
    - red means stop (broken and needs action)
  - Green starts from `#5fa883` and amber from `#e7b25a` as in the Home mockup. Red is new. The accent `#d97757`
    and the graphite base `#0b0b0c` stay. The accent marks the brand and actions but never a state.
  - The builder judges the three options against `idea.md` and picks one, with one line of why in
    `docs/brand.md`. Its files are in `ui/brand/`: `mark.svg`, `mark-mono.svg`, `wordmark.svg` and
    `tokens.css`.
- locks: ui
- after: none

### U1 Home pictured three ways
Result: You see three finished Home designs and pick the look.
- why: choose the look from finished pictures, not from sketches.
- done when:
  - Three finished Home pictures are made at 1440 px with real data from Lineclear's files, in the stack and the
    one dark graphite theme of idea.md, on U0's tokens. Nothing is asked.
  - Each is graphic first: project progress as tracks, usage and spend as charts, task states as shapes. Text says
    only what a graphic cannot. Each shows answers instead of headings, and the state colours only with their
    meaning.
  - The builder judges them against `idea.md` and picks the one of top quality, with one line of why in
    `docs/brand.md`. Only that one gets pictures at 1440 and 390 px of each state: empty, loading, error, long text
    and 200 items.
  - The chosen one gets a clickable prototype of a task starting and finishing, with a short recording of each
    motion. In a browser performance trace both run at 60 fps, a click during a motion acts at once, and with
    prefers-reduced-motion both are instant.
- locks: ui
- after: U0

### U8 Agents' browsers
Result: You open an agent's own browser live to sign in or enter a code.
- why: a login or a code needs you in the agent's own browser, live, without hunting for it.
- done when:
  - The page `/browsers` shows each agent's open playwright-cli session as a card with its task's plain title and
    a live picture. One click opens it to watch, and one more takes it over.
  - An Inbox item for a login or a code (L12) links straight to its session.
  - It passes the UI bar of U2, with motion for a session opening and closing.
- locks: ui
- after: U2, L12

### U18 Clear in one minute
Result: A first-time reader sees the problem Lineclear solves and how it works within a minute.
- why: a first-time reader must see what problem Lineclear solves and how it works, without knowing herdr, pi or
  Lineclear.
- done when:
  - The README animation tells three beats and loops in under about 15 s:
    - the problem: you run several AI agents and you are the bottleneck; they wait, stall and ask what is next
    - how it works: the roadmap is a line of stations, rules start each step when the one before has merged, a
      worker builds, a reviewer from another company checks, it merges, and only a real decision reaches you as a
      button on your phone
    - the result: the line keeps moving while you sleep, and you answer a few questions a day
  - It uses the railway signal colours, the dark graphite theme and the orange accent. It renders and animates on
    GitHub, and reads at 680 px and on a phone. Its alt text tells the same story.
  - A "How it works" section of at most about 12 lines names each role in one line: You, Roadmap, Rules,
    Dispatcher, Planner, Worker, Reviewer and Inbox. `idea.md` uses the same words. The README stays about 30
    lines plus images.
  - Screenshots of each beat at 390 and 1440 px of GitHub's render are on the pull request.
- locks: none
- after: U6
- files: README.md, docs/idea.md, ui/brand/

### U20 Home draws the line live
Result: Home shows you, the Dispatcher, the roadmap and the workers as a moving picture.
- why: Home must show how Lineclear works with a picture and motion, not text: you and the Dispatcher, the roadmap,
  the rules, the workers, the reviewers and main. A wall of cut task titles shows none of it.
- done when:
  - Home opens with the line in four zones: in line, at work, in review and main, with the Dispatcher's box above. Each open task is a
    token at its stage (in line, at work, in review, ready, merged), labelled with its step id. Hover, focus or tap
    shows its title, model and time at the stage.
  - A token glides to its new station when its task changes stage, on the poll Home already has. A merge lands with
    a green pulse at Main. A token that waits for you turns amber, blinks softly and links to the Inbox. Red only
    when main is broken. Nothing moves with reduced motion. 60 fps with 30 tasks, written in `docs/numbers.md`.
  - Each project has the same line in small, one row each, in place of its task chips.
  - Each role has one small icon, used on Home, in Settings, in the Inbox and on the roadmap view (not in the README).
  - At 390 px the line keeps its shape, closer together. Nothing at work, all clear, many tasks and offline are designed, with
    screenshots at 1440 and 390 px.
- locks: home-flow
- after: none

## Phase 7: True status

Why: Home's first job is to answer "is all clear?". Today amber also lights for tasks at work, questions of finished
tasks stay open, and two views count one project differently, so the answer cannot be trusted.

### L21 Amber means it waits for you
Result: A task shows amber only when something waits for you.
- why: amber must mean that something waits for you. A task's last chat card says what it last said, not what it
  does now, so a task that works again after a reply still shows amber.
- done when:
  - Home, the roadmap view and `lineclear status` take each task's state from `lineclear task list`, where a task
    that waits for you is `need` and one at work is `work`, not from its last chat card. The last card gives only
    the text.
  - A test with a fake task list and chat files shows a task at work after a "Waits for your reply" card as at
    work, and a task that waits as amber with its card's text.
- locks: status
- after: none

### L22 Closed tasks leave no asks
Result: The questions of a finished task disappear, so the live ones are easy to find.
- why: a question of a finished task needs no answer, and it hides the questions that do.
- done when:
  - Each tick, an open Inbox item whose task is done or closed in Lineclear closes, with that reason in the item and
    in `decisions.jsonl`. So does an item whose task got a message from you in its chat after the item was made.
  - A declared wait of a done or closed task is removed, and no longer shows in `lineclear status`.
  - `lineclear inbox` and the Inbox view show open items only. `lineclear inbox --all` also lists the closed ones
    with their reason.
  - Tests cover a done task, a closed task and a reply in the task's chat.
- locks: inbox
- after: none

### L23 One count of what waits
Result: Home and the Inbox badge show the same number of things waiting for you.
- why: Home's headline and the Inbox badge count different things, so neither number can be acted on.
- done when:
  - What waits for you is one list: the open Inbox items, and each task that waits for you with no open item, each
    task once. Home's headline, the Inbox badge and `lineclear status` give its count.
  - The Inbox view shows every entry. A waiting task with no item shows its last card's text and a link to the
    task's chat, where it is answered.
  - The Browsers badge counts the open browsers that wait for you, from the same list.
  - A test with an Inbox item, a card of the same task and a waiting task with no item counts 2.
- locks: status, inbox
- after: L21, L22

### L24 Home and roadmap agree
Result: Home and the roadmap page give the same numbers for a project.
- why: two views that give one project different numbers make both look wrong.
- done when:
  - Home and `/<project>/roadmap` take steps done and steps in all from one function. A test on one roadmap file
    gets the same numbers from `/api/home` and from the roadmap view's data.
  - The roadmap view's headline and the line under its phase track name the same phase.
- locks: status, ui
- after: none

### L25 Every roadmap opens
Result: Any project with a roadmap file opens its roadmap page, not only Lineclear projects.
- why: Home counts the steps of every project that has a roadmap file, but only a Lineclear project can open
  its roadmap view, so the others show progress with no way to see what is behind it.
- done when:
  - Every project on Home that has a roadmap file links to its `/<project>/roadmap`, also one whose roadmap is Now,
    Next and Later lists. Such a roadmap shows each list as a phase and each item as a step card.
  - Screenshot tests at 1440 and 390 px include a Now, Next and Later roadmap.
- locks: ui
- after: L24

### U9 Project line fits a phone
Result: The line under each project reads whole on a 390 px phone.
- why: the one line under each project says where it is going, but at 390 px it is cut after a few words, and its
  text repeats words and copies roadmap text as it is.
- done when:
  - The line names the phase, the next step, what blocks it and the finish date, each once. A step shows its plain
    title with no id and no closing full stop. A blocker is named by its kind, such as "a question waits for you",
    and links to it, instead of quoting the question.
  - At 390 px it wraps to at most three lines and nothing is cut.
  - The finish date is never earlier than the end of a dated wait on an open step. A test shows it.
  - Screenshot tests at 1440 and 390 px cover a phased roadmap, a Now, Next and Later one, a blocker and long text.
- locks: home
- after: none
- files: ui/web/, src/home-data.ts

## Phase 8: Light and fast

Why: idea.md promises one light process that adds no load. As measured, the service takes a steady share of a core
and over a GB of memory on a busy machine, and Home can wait seconds for an answer, because the tick, the spend
count and the web server share one process that blocks.

### L26 Ticks no longer list models
Result: The service no longer spends CPU every half minute listing models.
- why: each tick runs `pi --list-models`, which takes about 2 s of CPU, every 30 s, even when nothing starts.
- done when:
  - The offered models are read only when a step is about to start and the last list is over 10 minutes old.
  - A test with a fake pi counts no `--list-models` call over 20 ticks that start nothing, then one call for a
    start.
- locks: rules
- after: none

### L27 Usage read once per file
Result: Home opens fast, because each session file is read once and not every minute.
- why: Home reads every pi session file of the last 14 days again each minute, which takes seconds and hundreds of
  MB on a busy machine.
- done when:
  - The counts of each session file are kept in a cache under `~/.cache/lineclear/`, by its path, size and time of
    change. A refresh reads only new and grown files.
  - A test on 500 generated session files gives the same totals as a full read, and a warm refresh takes under
    200 ms.
- locks: spend
- after: none

### L28 Pages answer during a tick
Result: Web pages answer at once even while the service runs its checks.
- why: the tick runs its commands one by one and blocks, so while it runs, the web pages get no answer.
- done when:
  - The tick runs its commands (lineclear, git, health and check commands) without blocking the web server.
  - A test with a fake lineclear that takes 5 s shows `/api/home` answering from its last data in under 200 ms
    while the tick runs.
  - The slowest `/api/home` answer over 10 minutes of the live service is in `docs/numbers.md`.
- locks: rules
- after: none

### L29 Fast first load
Result: The web pages are built at install and sent compressed, so they load fast on any machine.
- why: the service builds its web pages with Vite at every start, which needs the build tools on every machine,
  and it sends its large script uncompressed.
- done when:
  - `install.sh` builds the web pages once, and again on each update. `lineclear run` serves the built files and
    never builds. If they are missing, it says so in one line with the command that fixes it.
  - `bun run ui:test` and `bun run ui:record` build the pages first.
  - Scripts and styles go out compressed when the browser accepts it. A test checks the header and the size.
- locks: install
- after: none

## Phase 9: Promises kept

Why: a promise that a new user can check and see fail costs more than a missing part. The README, the install test
and the numbers each promise something the product does not do yet.

### L30 README tells the truth
Result: The README shows the install command and status that are true today.
- why: the README is the first thing anyone reads, and its install command and its status line are out of date.
- done when:
  - The install command works for anyone who can read the repo, or it is marked "coming" as U6 says.
  - The status line names what works now (rules, waits, the stall ladder, the Inbox, the web views) and what does
    not yet (the own fork and the merge lane).
  - After the install, the README gives the next two things to do: `lineclear project add <repo>`, and open
    `http://127.0.0.1:7420/`.
- locks: none
- files: README.md
- after: none

### L31 Install is tested again
Result: A change that breaks the install on a fresh machine is caught.
- why: L1's test on a fresh machine is turned off, so a change that breaks the install is not seen.
- done when: the fresh machine test of L1 runs on every merge to main, on CI or on one of your machines with one
  command, and its last run on main passed. The README's status links to it.
- locks: install
- after: L29, L30

### L32 Cost counts every step
Result: The cost of a merged step counts every step, including ones merged with no task.
- why: steps merged with no task count as $0, so the cost per step looks about half of what it is, and the Inbox
  is not in the asks yet.
- done when:
  - `lineclear measure` leaves a merged step with no task out of the cost, and names how many there were.
  - Asks count the Inbox items as well as the needs-you cards, each question once.
  - A fixture with one step that has no task and one question that is both a card and an Inbox item gives the
    numbers counted by hand.
  - The pilot's numbers in `docs/numbers.md` are counted again with the fix, and the change is named there.
- locks: measure
- after: none

### L35 A failed check says why
Result: When a project check fails you see its output and know what to fix.
- why: `lineclear project check` says that a check failed but hides its output, so the fix needs another run by
  hand.
- done when: `lineclear project check <name>` and `lineclear doctor` print the last 20 lines of a failing command
  with its exit code, with stored secrets masked as in L9. A test with a failing check shows them.
- locks: settings
- after: none

## Phase 10: Simpler

Why: a part that nobody runs still has to be read, tested and kept working, and it breaks without anyone seeing.

### L36 Old Home prototype gone
Result: The Home prototype is removed, and only the chosen design remains.
- why: `ui/home/` and `bun run home` are U1's three directions. The chosen one lives on in `ui/web/`.
- done when: `ui/home/` and the `home` script are gone. `docs/brand.md` keeps the pictures and the line of why, and
  no doc or script but the roadmap names the prototype. `bun run check` and `bun run ui:test` pass.
- locks: ui
- after: none

### L37 Dispatcher in the web chat
Result: You talk to the Dispatcher in the web chat and get answers.
- why: L18 is built and tested, but the Dispatcher has no place to talk, so it has never answered a question.
- done when:
  - `lineclear dispatcher setup` makes the Dispatcher on the main machine, and the web chat talks to it.
  - The Dispatcher answers status, plan and move from the web chat. A test covers each.
- locks: dispatcher
- after: L34

### L38 A real plan through the planner
Result: A roadmap change comes through the planner and no longer by hand.
- why: L17 is built and tested, but no plan has ever come through it. Roadmap changes are still written by hand.
- done when:
  - One roadmap change in a project is made with `lineclear plan`, and approved or rejected in the Inbox view.
  - The brief template names `lineclear plan` for roadmap changes. If the plan did not work, the reason is in
    `docs/numbers.md`.
- locks: planner
- after: none

## Phase 11: UI fine detail

Why: the views pass the UI bar on sample data, but live data shows a long skeleton, a page load between views, a
tab bar that does not fit a phone, two focus rings, no press state, and labels that say something else than the
number.

### U10 Home answers in a second
Result: Home shows its first answer in under a second, with no jumping logo or cards.
- why: the first load of Home shows a skeleton for about 5 s, and the logo and the cards jump in after it.
- done when:
  - `/api/home` answers with the projects first and never waits for spend and usage. The charts fill in when they
    come.
  - On the live service, Home's headline shows within 1 s of a first load. The logo is in the first paint, and the
    layout shift when data comes is under 0.01, measured in a UI test.
- locks: ui
- after: L27, L28

### U11 Pages swap without reload
Result: Links and the back button change the view in place, with its motion.
- why: the roadmap link and the back button load the whole page again, so the view-change motion never plays
  between Home and a roadmap, and all data loads again.
- done when:
  - Every link between Lineclear's views changes the view without a page load. A test sets a value on the page,
    follows a link and goes back, and the value is still there.
  - Each change plays U2's view-change motion, instant with reduced motion. Back and forward keep the scroll place.
- locks: ui
- after: none

### U12 Tab bar fits a phone
Result: All five tabs, Settings included, fit the bar at 390 px.
- why: on a roadmap view a fifth tab pushes Settings out of the bar on a phone.
- done when:
  - A roadmap is a page under Home with a back link, as one browser is under Browsers, not a tab of its own.
  - At 390 px every tab is fully in view on every view, shown in the screenshot tests.
- locks: ui
- after: U11

### U13 One focus ring and press
Result: Buttons, tabs and links show the same focus ring and a press state.
- why: buttons have a 2 px accent ring but tabs and links get the browser's own one, and a tap on a phone shows
  nothing.
- done when:
  - Every focusable part has the same ring from one token. A test tabs through the design page and checks each.
  - Every button, tab and card link shows a press state within 100 ms.
- locks: ui
- after: none

### U16 Calm answer buttons
Result: The main answer button no longer looks like the red of broken, and headings are in order.
- why: the primary answer button is filled with the coral accent, which reads close to the red of "broken", and a
  screen reader hears a project's state as part of its name.
- done when:
  - The primary answer button is filled with neither the accent nor a red. design.md names its token, and a test
    checks its fill on the Inbox view.
  - Each view has one h1; sections are h2 and cards h3. A project's heading reads its name, and its state is said
    apart.
- locks: ui
- after: U13

### U14 Settings and Browsers add up
Result: Labels in Settings and Browsers say what they really show.
- why: on live data some labels say something else than what they show.
- done when:
  - A machine over its load limit shows amber on Settings, not green "ready".
  - The Browsers headline and its badge count the same thing, and say what they count.
  - A browser card shows its task's title and the page's host, not the page title. A session with no task is
    folded under "Other sessions". A card has a placeholder until its first picture comes.
  - Each of these has a test on sample data.
- locks: none
- after: none
- files: ui/web/, src/browsers.ts, src/web-settings.ts, test/browsers.test.ts

### U17 Usage and Inbox labelled right
Result: Usage cards and Inbox items carry titles that match their content.
- why: the usage card shows each account's share of tokens under a title that promises usage, and an Inbox item
  does not say which task asks or how long it has waited.
- done when:
  - The usage card shows what its title says, and its title and its line name the same time span. It is on Home
    only, not again on Settings.
  - Each spend bar shows its day and its dollars on hover, focus and tap.
  - An Inbox item names its project, its task and its age, and has the same card style as Home's.
  - Each of these has a test on sample data.
- locks: ui
- after: U14

### U15 Same type on every machine
Result: Text looks the same on Linux, Mac and phone.
- why: the type is the system font, so it falls back to a wide font on Linux and looks different on each machine,
  and the screenshot tests depend on the fonts of the machine that runs them.
- done when: one open licensed variable font is served from `ui/brand/` with its licence, and the tokens use it
  first. Its files are under 150 KB in all. The screenshot tests pass on two machines with different system
  fonts. design.md says which font and why.
- locks: none
- after: none
- files: ui/brand/, docs/design.md, ui/test/

### U21 Unclear labels fixed
Result: Numbers and labels that were hard to read at a glance are plain.
- why: a review of the live views found parts that are hard to read at a glance: sentences where a number or a
  label would do, raw ids and shell lines, a form bigger than what it adds, long lists that open all at once, grey
  labels under 4.5:1 and numbers that change without a motion.
- done when:
  - Each finding of the review is fixed here, or sent to the task of the U step whose work it is (U10 to U17,
    U20), which fixes it there.
  - Home's line under a project shows its phase as a label, its next step as the title, a question as an amber
    badge and the date as "done about".
  - Settings is four cards: Machines, Models, Projects and Usage, each with one plain title and its value big.
    Models show a name people say, the account as a tag and a numbered order. A project shows what its check
    runs, with the full commands behind Details, and its secrets as a count.
  - The Roadmap view opens only the current phase, shows each other phase as one row with its progress, and finds
    a step by its id or title.
  - Every grey label is at least 4.5:1 on each surface it sits on, with a test. Numbers count to a new value and
    bars grow, in a `value-change` motion under 300 ms, and not under reduced motion.
  - A question's links are links and its paths are code. Closing a step closes a question that names no project.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- locks: views
- after: none

## Phase 12: New things

Why: once the status is true, the service light and the parts few, the next value is for a user who is not the
builder.

### L39 Add a project from Home
Result: A new user adds a project from Home and does not need to find a command.
- why: after the install a new user sees "Nothing to carry yet" and has to find `lineclear project add` in the
  docs.
- done when:
  - Home's empty state has a field for a repo folder. It shows what `lineclear project add` detects (space, check
    command, roadmap) and saves it with one click, where the CLI saves it.
  - When `lineclear doctor` finds a problem, Home shows it with its fix command.
  - A UI test on an empty config adds a project from the page, and `lineclear project list` shows it.
- locks: none
- after: none
- files: ui/web/, src/web-settings.ts, src/add-project.ts, src/doctor.ts

### L58 CLI shows its version
Result: `lineclear --version` names the exact code that ran, for bug reports.
- why: a bug report or a support question needs the exact code that ran, and today the CLI cannot say which
  version or commit it is.
- done when:
  - `lineclear --version` prints one line with the version from `package.json` and the short commit of the code
    that runs, then exits 0. Outside a git checkout it says `unknown` for the commit.
  - `lineclear --help` lists `--version`.
  - A test checks the line in this repo and in a copy with no `.git`.
- locks: core
- after: none

### U22 A README film that explains
Result: The README film shows how Lineclear works, with a source for each claim.
- why: the README animation is too short to show how Lineclear works, and a claim with no source cannot be trusted.
- done when:
  - `docs/readme/line.svg` is a film of about 45 to 60 s in nine scenes: the problem, the roadmap, rules, a
    worker, a reviewer, main, your call, at night and the result. Each scene has one large caption that reads at
    680 px and on a phone, and a progress bar of the scenes runs along the bottom. It loops with a pause at the end.
  - Every number in it is measured, with its source in `docs/numbers.md` under "README film".
  - Moves ease and enter in turn on an 8 px grid, in the dark graphite theme, the signal colours and the orange
    accent, with the role icons from `ui/brand/roles/`.
  - It animates on GitHub with CSS only, is under 150 kB, shows a still poster under reduced motion, and its alt
    text tells the whole story. Frames of every scene at 390 and 1440 px of GitHub's render are on the pull request.
- locks: none
- after: none
- files: README.md, docs/readme/, scripts/readme-film.ts, docs/numbers.md

### U23 Who does what
Result: The film shows who you talk to and how work travels from there to main.
- why: the film shows what Lineclear is, but not who you talk to and how the work moves from there to main.
- done when:
  - `docs/readme/roles.svg`, right under "How it works" in the README, plays one request as a chain in about 30 to
    45 s: you and the Dispatcher, the planner, the roadmap, rules, three workers side by side, a reviewer from
    another company, checks and main, the Inbox, and the Dispatcher answering from the live status. It uses the role
    icons from `ui/brand/roles/`, one short caption per scene.
  - A closed table under it, "Role, Who it is, Does, Never does", one row per role.
    Each line is true of the code, and what is not built yet says "coming", such as the Dispatcher picking the
    project for each request (L41).
  - The film tells the story in railway pictures: one track into a dark tunnel, then the Dispatcher's signal box,
    a track per project, steps as stations, workers as trains, the review as a signal, the merge as a junction into
    the main line, and "Line clear." at the end. Every number sits in the README's details, sourced in
    `docs/numbers.md` under "README story".
  - One beat on what saves tokens, true today: plain code decides what starts next, and each worker gets only its
    step. The details give the measured cost per merged step.
  - Captions state plain facts. The README, the film, `docs/idea.md` and the app use only the words in
    `docs/brand.md` under "Words".
  - Dropped (owner order): the web "How it works" panel. The mark goes Home and opens nothing; the models per role and
    the chat address are cards in Settings.
- locks: ui
- after: none

### U24 One railway picture language
Result: The app draws with the same railway pictures as the README film.
- why: the README film tells Lineclear as a railway, but the app draws other pictures, so a user learns two
  languages for one product.
- done when:
  - `docs/brand.md` has a short "Picture language", the one source every view uses: a project is a track, a step a
    station, a task at work a train on its track, a review the signal before the junction, a merge joins the main
    line, what waits for you an amber signal, broken red, an empty slot an empty siding and the Dispatcher the
    signal box. Captions stay plain words.
  - Home draws each project as its track with its stations, a train per open task, the signal per review and the
    main line, with a short pulse on news. The Roadmap view draws each phase as a track with parallel steps on
    parallel tracks. Each Inbox ask is an amber signal that turns green when answered. The chat shows the
    Dispatcher as the signal box. Settings shows each machine's slots as sidings and each account as an engine
    with its use in % and its spend in $. Agent browsers use the same parts. (The "How it works" panel was dropped, owner order.)
  - One set of SVG parts and motion tokens in `ui/brand/rail.ts` is used by every view and the README images. A
    motion explains a change; loading lays the track. Reduced motion shows the final state.
  - Screenshots of every view and state at 390 and 1440 px and a recording of each motion are judged against
    `docs/brand.md`. A fresh model looks at Home cold and its answer is in `docs/numbers.md` under "U24".
- locks: ui
- after: U20, U21, U23

## Phase 13: A web UI that feels finished

Why: the views work, but they do not yet feel like a finished product. A review of the live views at 390, 768, 1440
and 2560 px found a phone column on every screen, an answer with no next tap, three pictures of one project, states
that change with no motion, an error that throws away what you saw, and usage in a corner. The target is the design
board, [design/board.html](design/board.html): one mock per view in the railway picture language of U24, with its
parts, its motion and every state. U25 builds every part the board draws and U26 the frame, so each view step after
them changes only its own view and they run in parallel. U44 to U49 let you follow the roadmap in depth and give
anyone who leads the work one page of goals, all inside the Roadmap view. A view step draws its loading, empty, stale
and broken states with the kit's parts. Each step puts screenshots before and after at 390 and 1440 px on its pull
request, next to the board's frame. Home is the state of all work and the Inbox the one place for decisions: U50 and
U51 set this on the board first. An overview (Home, Usage, Roadmap) states facts plainly, with no call-out headline.

A step waits only for the merged code it uses. A test that later steps must pass (the words of U36 and U49, the
taps of U37, the layout shift of U54) runs in `bun run check` or `bun run ui:test` from its own merge, so each view
merged after it passes it, and the step does not wait for every view. The Roadmap view is one file per part (U26),
with a lock per file, so U29 and U44 to U48 run side by side. U41 holds the motion source that the film reads, so it
runs beside U40 and holds what U53 asked. The longest chain of open steps to U43 was 14:
U16 > U25 > U26 > U29 > U44 > U45 > U28 > U36 > U49 > U39 > U40 > U41 > U53 > U43. It is now 7:
U16 > U25 > U26 > U44 > U28 > U39 > U43.

### U50 Home leads with decisions
Result: Home opens with what waits for you and its answer buttons.
- why: the board's Home frames lead with "2 things wait for you" and an ask with its buttons, so a decision sits in
  two places and Home does not say how the work goes.
- done when:
  - Every Home frame in `docs/design/board.html` (Home, Chat beside Home, and the loading, stale and long names
    states) opens with one plain line on the state of all work, such as "Line clear. 7 at work, 3 merged today, next
    merge in about 20 min". No frame shows "N things wait for you", an ask or an answer button on Home.
  - What waits for you shows only as a count on the Inbox tab in the rail and the bar, and an amber lamp on the step
    in its track.
  - Each task at work on Home is a row with its title, its state in words, how long it has run and its expected
    finish from the measured pace, and the caption says a tap opens its step page (U45).
  - The views line of `docs/idea.md` says that Home shows the state of all work and only the Inbox asks.
  - A test reads the board's Home frames and fails on "wait for you" in a Home headline or an answer button on Home.
- locks: board
- after: none

### U51 Usage states the facts
Result: Usage shows accounts, limits and resets as facts, not as a verdict.
- why: the board's Usage frames open with "Work can start now: 4 slots free", a verdict where the facts (accounts,
  limits, resets, slots) would let you judge for yourself, and they do not show which agents run.
- done when:
  - The Usage frames in `docs/design/board.html` have no call-out headline: they open with each account's use, limit
    and reset time, then the machines' slots as sidings, then the agents at work (U52), then tokens and cost.
  - A frame at 1440 px and one at 390 px draw the agents at work: each with its task title, model, account, role,
    context in %, tokens and dollars so far and time running. A third frame shows no agent at work.
  - `docs/design.md` says the rule: an overview (Home, Usage, Roadmap) states facts plainly with no call-out, and
    lists the verdict phrases a test rejects, such as "Work can start now".
  - A test reads the board's Usage frames and fails on a phrase from that list.
- locks: board
- after: none

### U25 One kit for every view
Result: Hover, press and tap targets work the same in every view and fit a phone.
- why: hover and press change in 0 ms with no pointer, every target on a phone is under 44 px, under the 48 px
  headline everything is 14 or 12 px, money reads as raw numbers, and each view draws its own rows and cards.
- done when:
  - The kit holds every part the board draws, on U24's railway parts: row, card, tile, bar chart, toast with Undo,
    side panel, bottom bar, rail, parallel tracks, the stale bar and the laid track for loading. `/design` shows each
    part in each state, and the views draw nothing of their own.
  - `ui/brand/tokens.css` holds the board's measures (the 4 px unit, the rail and content widths, rows of 44 and
    48 px, the 12 px radius) and the surface and line steps the board uses. No view uses a colour or a size outside
    the tokens: a test fails on a type size off the scale (18 px a card or section title, 22 a detail, 32 a view
    title on a phone) or a colour that is not a token.
  - Motion takes its times only from U24's motion tokens, plus press (100 ms) and hover (120 ms). Lists insert and
    remove with their height. The lamp has four states: grey while a review checks, amber waits for you, green
    clear, red broken.
  - Everything that acts has a pointer, a 120 ms hover and a press to 0.97 within 100 ms, read by a test on
    `/design`. At 390 px every target is at least 48 by 48 px, measured on every view.
  - One table part, in the dark graphite theme: tabular figures aligned right, units in the header and not in each
    cell, sorting where a table has more than 10 rows, a sticky header, and rows that open their details behind a
    click. At 390 px each row becomes a card with the two figures that matter. `docs/design.md` says when not to use
    it: where a picture (a track, a bar, a lamp) says it better. `/design` shows it with 3 and 200 rows.
  - Money and counts use one format with thousands separators. No view uses the mark as an empty-state icon, and
    the laid track replaces the animated mark as the loading state, in the views and in brand.md's Files.
  - U2's motion test allows two loops, each only while it lasts: loading lays the track at U24's time, and a lamp
    that waits on someone blinks. Every other motion stays under 300 ms.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- locks: kit
- after: U24, U15, U16, U50, U51

### U26 Frame uses the screen
Result: The page fills a wide screen, and tabs are links you can open in a new tab.
- why: content stops at 1100 px on every screen, so at 2560 px more than half is empty. Tabs are buttons with no
  address, so a reload or a shared link loses the view. On a phone the tabs sit at the top, out of thumb reach.
- done when:
  - From 1024 px a rail on the left holds the mark, the views and a row per project; the mark goes Home
    (the How it works panel was dropped, owner order). Content runs up to 1128 px on 12 columns, centred in the room right of the rail. Under 1024 px a bottom
    bar holds Home, Inbox, Chat, Usage and Browsers; Settings is a gear at the top right. Until U27, Usage opens
    the usage cards there are today.
  - The Inbox tab in the rail and the bar carries the count of what waits for you (L23). No other count of it shows
    outside the Inbox.
  - The rail and the bar are links, with `aria-current` on the view you are on. Each view, project, step and ask
    has its own address. A test opens each address cold and after a reload, and lands on the same thing.
  - Each view lives in its own file under `ui/web/`, so the view steps after this one share no file. The Roadmap
    view is a folder, `ui/web/roadmap/`, with one file per part: the line, the head line, the step page, the chain,
    since you last looked and the goals page. A step's address shows its why and done when in the step page's file,
    the page U45 builds on.
  - Screenshots of every view at 390, 768, 1440 and 2560 px match the board's frame and grid. Screenshots before
    and after at 390 and 1440 px are on the pull request.
- parts: ui
- locks: shell
- after: U25, U10, U12

### U27 Usage page
Result: One Usage page shows each account's limit, reset time and share.
- why: usage is one share-of-tokens bar on Home and again in Settings, with no limit, no reset time, nothing per
  project and nothing per merged step. Whether more work can start, and what it costs, is a question you ask often,
  and the plain facts answer it better than a verdict.
- done when:
  - `/usage` has no call-out headline such as "Work can start now". It opens with each account's use, limit and reset
    time, then each machine as a siding with its free and busy slots, as the board's Usage frames (U51) draw it.
    Machines leave Settings. L46 adds when a full account frees up.
  - Per project and per day for 14 days: tokens as one bar split into cache reads, fresh input and output; tiles
    for dollars per merged step, cache hits in %, compactions, and what the rules saved against an AI coordinator
    woken on a timer. The saving is marked "estimate", with its method in `docs/numbers.md` under "U27".
  - A spend, a limit or a reset time that its source does not report says "not reported", never $0 or 0%.
  - The view and `lineclear measure` read the same code, and a test on fixed data finds the same numbers in both.
  - Home keeps one line that links to Usage. No usage yet, loading, stale, one account and 12 accounts are
    designed.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- parts: ui, measure
- locks: usage, home
- after: U14, U17, U51, U26
- dropped: Usage is no page. Its account facts and spend are in Home's usage sheet and the per-agent cost is in the opened row (U62); the per-project and per-day figures stay in `lineclear measure`.

### U52 Usage per agent
Result: You see each running agent, where it runs and what it costs now.
- why: to know what the work costs and where it stands right now, you need to see each agent that runs, on which
  model and account, and how much it has used, not only totals per day.
- done when:
  - `/usage` lists each running agent with its task title, model, account, role (worker, reviewer or planner),
    context in %, tokens and dollars so far and time running, as the board's frames (U51) draw it. Each account's
    use shows with its limit and reset time from the same data.
  - The view and `lineclear measure` read the same code. A test on fixed data (3 agents on 2 accounts, one with no
    reported spend) finds the same numbers in both, and "not reported" where the source says nothing.
  - No agent at work, 1 and 30 agents are designed. Screenshots before and after at 390 and 1440 px are on the pull
    request.
- parts: ui, measure
- locks: usage
- after: U27
- dropped: Each running agent is a row of Home's table with its model, account and context in the opened row (U62), not a Usage page.

### U28 Home shows all work first
Result: Home shows the state of all work first, then the line, and each decision once.
- why: Home says "3 things wait for you" and then shows spend and usage, so a decision sits in two places and Home
  does not say how the work goes. A project shows a progress bar, a station strip and a text list, three pictures of
  one thing. A fresh install is three empty cards with the mark as their icon.
- done when:
  - The headline gives the state of all work in one plain line, such as "Line clear. 7 at work, 3 merged today, next
    merge in about 20 min", from the shared status code. It never says "N things wait for you", and Home has no ask
    and no answer button. What waits for you shows only as the count on the Inbox tab (U26) and a lamp on the step
    in its track. A test reads Home in every state and fails on either.
  - Each task at work shows its title, its state in words, how long it has run and its expected finish from the
    measured pace, from U44's code in the shared status code. A tap opens its step's address (U26), the page U45
    fills in, checked by a test.
  - Each project is one track (U24) with its stations, trains, lamps and the curve into main. The progress bar and
    the text list go. 40 projects fold to one row each, the ones with a lamp first.
  - Spend and usage leave Home for one line of facts that links to Usage.
  - With no projects, Home is an empty track and one folder field (L39).
  - The Home section of `docs/design.md` says the same, as the board's Home frames (U50) draw it.
  - Screenshots before and after at 390 and 1440 px, and of nothing at work, 40 projects and no projects, are on the
    pull request.
- parts: ui
- locks: home
- after: U26, L39, U44, U50
- dropped: Home is rebuilt as the command center (U62), which replaces this headline-and-tracks design.

### U62 Home: the command center
Result: Home is one page where you see everything that runs and answer what waits.
- why: the owner's main view is one page where everything is seen and answered, not five pages to visit. What happens
  is a table of working tasks with their facts, the line shows where the work is, the Dispatcher is always at hand,
  and nothing explains itself.
- done when:
  - Home is built as the Home section of `docs/design.md` says: the line on top, the Inbox strip only when something
    needs the owner, the table of working tasks in the centre, the Dispatcher chat at the right and the usage mark in
    its footer. At 1440 x 900 all of it shows with no page scroll, checked by a test; each part scrolls inside itself.
  - A row holds the project, the step, the machine, the stage, what the agent did last and how long ago, the files
    changed and the check result; the cost so far is in the opened row only. A stuck task shows its reason in its
    row. A click opens the row in place with the log tail, the diff stat, the check output, the review findings and the task's browser.
  - Home shows no spend figures, no charts and no per-account bar rows. The one mark is a thin week bar per account in
    the chat column's footer, with no numbers or labels: neutral, amber only when the pace says that week runs out
    before its reset, never red. Hover or focus shows the exact figures. A click opens a sheet over Home with the full
    usage (accounts, session and week, reset times, pace) and the spend (month, 14 days, per merged step); "not
    reported" where a source says nothing. `/usage` opens Home with the sheet open. The figures come from the code
    `lineclear measure` reads.
  - A test fails on any subtitle, hint or label that describes the UI on Home, and on a headline or counts line.
  - `/inbox`, `/usage`, `/browsers` and `/chat` open Home; Settings and a project's roadmap stay pages.
  - Loading, empty, error, long text and 200 rows are designed; screenshots at 390 and 1440 px are on the pull request.
- parts: ui, measure
- locks: home, line, task-row, chat, usage-mark, usage, measure
- after: U26, U44, U50

### U29 Roadmap fits the screen
Result: The roadmap fits a 390 px phone with no sideways scrolling.
- why: Lineclear's own roadmap is 468 px wide at 390, so the page scrolls sideways, and a strip of 319 stations
  cannot be read at any width.
- done when:
  - Phases are segments of one bar, sized by their steps; they replace U21's row per other phase. On a desktop a
    tap on a segment opens that phase. At 390 px the bar is a picture only, and one 48 px row opens the list of
    phases. The open phase is drawn station by station, and steps that can run side by side run on
    parallel tracks that rejoin. Its list gives the titles of its steps.
  - At 390 px the track runs down the left edge, a station per row. With 319 steps nothing scrolls sideways, checked
    by a test.
  - The train sits on the step at work and a lamp on a step that waits for you. A tap on a station opens its why and
    done when at the step's own address (U26).
  - Screenshots before and after at 390 and 1440 px, with 8 steps and with 319, are on the pull request.
- parts: ui
- locks: roadmap-line
- after: U26

### U44 Roadmap in one line
Result: The roadmap tells in one line how far it is, when it ends and what holds it up.
- why: the whole line shows where each step is, but not how far the roadmap is in all, when it ends, or what keeps
  the end from coming sooner.
- done when:
  - At the top of every roadmap one plain line gives how many steps are done, at work, waiting for you and left, and
    the estimated finish from the measured pace, with the reason it is not sooner: the longest chain of steps that
    wait on each other, a lock, a check slot or a model quota, named in words.
  - `lineclear roadmap status` prints the same line first, from the same function in the shared status code that
    Home's finish date uses. A test on one roadmap file gets the same counts, date and reason from the CLI, the
    view's data and `/api/home`.
  - With no measured pace yet, the line says so instead of a date. Screenshots before and after at 390 and 1440 px,
    with 8 steps and with 319, are on the pull request.
- parts: ui
- locks: roadmap, status, roadmap-head
- after: U26

### U45 A step has its own page
Result: Each step opens at its own address with whether it is met and what holds it up.
- why: a station opened today shows its why and done when, but not whether it is met, what exactly holds it up, or
  what it took, so following one step means reading the task list, the pull request and the logs.
- done when:
  - A step opened at its own address shows, in this order: what it gives and why, in one sentence; its done when as
    a checklist; its state and what exactly it waits for (a named step with its title, a lock, a check slot, a model
    quota, or you), each a link to that step, slot, quota or Inbox ask; then its history.
  - The checklist is ticked from the step's evidence with no model: every item of a merged step from its merge
    commit, and an item of a step at work only where its task's ready facts or proof name it. An item with no
    evidence stays open and says so.
  - The history gives the task, the branch and the pull request, each review round with its findings, each check
    run with its result, the time from ready to start and from start to merge, and the cost in dollars from the
    same code as Usage. What a source does not report says "not reported".
  - A test opens a done step, a step at work, a step that waits on a lock and one that waits for you, and finds each
    part in that order. Screenshots of each at 390 and 1440 px are on the pull request.
- parts: ui, measure
- locks: roadmap-step
- after: U26

### U46 See what a step waits for
Result: You see which steps wait on which, and which one sets the finish.
- why: the finish date only makes sense when you can see which steps wait on which, and which of them sets the
  date.
- done when:
  - A step's page draws its chain as rail (U24, U25): the steps it waits for before it and the steps that wait for
    it after it, each a station with its title and state. The critical path, the chain that sets the finish in
    U44's line, is marked on the rail and in words.
  - From U44's line one tap opens the critical path, so the reason for the finish date is one tap away.
  - A test on a fixed roadmap finds the same critical path in the drawing and in `lineclear roadmap status`.
    Screenshots at 390 and 1440 px, with a chain of 2 steps and of 40, are on the pull request.
- parts: ui
- locks: roadmap-chain, roadmap-step
- after: U44, U45

### U47 What changed since you looked
Result: The roadmap shows what changed since your last visit.
- why: someone who comes back after a day wants to know what changed, not to compare the whole line with their
  memory.
- done when:
  - The Roadmap view shows what merged, what started and what newly waits for you since your last look, each a step
    title that opens its page. Nothing new says so in one line.
  - The time of your last look is kept in the browser, with no new data store; the changes come from git and the
    task files. A test moves the clock, merges and starts a step on fixed data, and finds each in the view.
  - Screenshots at 390 and 1440 px, with nothing new and with 30 changes, are on the pull request.
- parts: ui
- locks: roadmap-since
- after: U26
- dropped: What changed since your last look is marked on Home's line (U62), not a part of the roadmap page.

### U48 Roadmap for leaders
Result: One page shows what each goal delivers, when, and how sure that is.
- why: someone who leads the work asks what each goal delivers, when, and how sure that is, not which step is at
  work; the deep view answers the second, and nothing answers the first on one page.
- done when:
  - The Roadmap view opens on one page with no step ids and no rail detail: each line of "Done means" in the
    roadmap is a goal, an outcome, as a row in a Now, Next or Later column. A roadmap without "Done means" uses its
    phases as goals.
  - Each goal shows its progress, its expected date and a confidence: on track, at risk or late, with the reason
    in one sentence. The rule is plain code, written in `docs/design.md`: at risk when a step on its critical path
    waits for you, a quota or a stall; late when its expected date is later than it was 7 days ago, read from git.
  - The page lists what was delivered lately and the decisions that wait for the owner, each a link to its Inbox
    ask. It reads the same data as U44, U45 and U47, and a tap on a goal opens its phases and steps.
  - It prints or saves as one page: a test prints it to PDF at A4 and finds one page. The railway look stays light:
    a progress bar per goal, lamps for confidence.
  - The Roadmap line of the views in `docs/idea.md` names its parts: this one page of goals, then the phase track,
    and a page per step with its chain, waits and history.
  - Screenshots at 390 and 1440 px and the printed page, with 3 goals and with 12, are on the pull request.
- parts: ui
- locks: roadmap-goals
- after: U29, U44, U45, U47

### U49 Roadmap in plain words
Result: The roadmap page uses no code you cannot place, such as a bare id or lock name.
- why: an internal code a reader cannot place, such as a bare step id or a lock name, makes the page readable only
  to the one who built it.
- done when:
  - Every step id in the Roadmap view comes with its title, and every lock, slot, quota and state is named in plain
    words, with the words of `docs/brand.md`.
  - A test in `bun run check` reads the text of every Roadmap view page (the one page, the line, a step, the chain,
    since you last looked) and fails on a step id without its title next to it, or a code that is not in brand.md's
    "Words". A page merged before this step is fixed here; one merged after it passes the test before its merge.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- parts: ui
- locks: roadmap-line, roadmap-step
- after: U36, U29, U45

### U30 An ask opens where you are
Result: Tapping an ask opens it in place, in its project and step.
- why: a card does not say which project and step it is about, 180 waiting asks are one long list with no way
  through, and an answered ask just disappears with no way back. A page of its own takes you away from the work.
- done when:
  - There is no Inbox page: `/inbox` opens Home. An ask is a strip at the top of Home (U62), shown only when
    something needs the owner, and the same ask is in its task's open row.
  - The strip names the project, the step, who asks and how long ago, and holds the answers as buttons. With more asks
    it shows the first and a count; the count opens the rest in place, grouped by project, so 200 asks are a few rows.
  - An answer turns the lamp green, the strip leaves with its height, and Undo stays 5 s. A test answers, undoes and
    finds the ask back.
  - Screenshots before and after at 390 and 1440 px, with no ask, 1 ask and 200, are on the pull request.
- parts: ui
- locks: inbox-view, home
- after: U16, U17, U26, U62

### U31 Chat beside the view
Result: On a desktop you chat beside the view you are looking at.
- why: on a desktop Chat is a page with a small card in an empty room, and asking about a view means leaving it.
- done when:
  - On Home the chat is always there (U62). On the other pages (Settings, a roadmap) a desktop opens it as a 400 px panel, and from 1920 px it stays open. On a phone it is full
    screen with the composer above the keyboard.
  - Work the Dispatcher hands on shows as a new station on its project's track, with one pulse.
  - With no Dispatcher set up, one screen says what it does, with the command and a copy button.
  - Screenshots before and after at 390 and 1440 px, and at 1920 and 2560 px with the panel open, are on the pull
    request.
- parts: ui
- locks: chat
- after: U26

### U32 Settings holds only settings
Result: Settings shows only what you set, and status lives elsewhere.
- why: Settings mixes what you set with status you only read: a machine's state, its load and the usage bar again.
- done when:
  - Settings has four sections: Models, Projects, Machines to add and Secrets. They replace U21's four cards;
    status and counts live on Usage and Home.
  - Models are an ordered list per role, and the next one takes over when one runs out. A project shows its check
    command and its secrets as a count, the rest on a tap.
  - On a desktop the sections sit on the left with the open one on the right; on a phone they are a grouped list
    with 52 px rows.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- parts: ui
- locks: settings
- after: U26, U62, U14

### U33 Browsers: in the task's row
Result: A task's browser opens in the task's own row, so you watch it with the task.
- why: the list keeps the browser of a task that is done, and a phone shows one large picture per row. A browser is
  only worth watching as part of the task it works for.
- done when:
  - There is no Browsers page: `/browsers` opens Home. A working task's row (U62) opens in place with its browser
    to watch and take over, and a task that is done has none within 3 s, checked by a test.
  - At 390 px the picture is one per open row, full width.
  - Screenshots before and after at 390 and 1440 px, with no session, 3 and 20, are on the pull request.
- parts: ui
- locks: browsers, task-row
- after: U14, U26, U62

### U34 An error keeps your data
Result: When a request fails you keep the data you were reading.
- why: when a request fails, the view swaps the data you were reading for an error, and one bad input can throw a
  whole view away.
- done when:
  - The shared data code keeps each view's last data when a request fails, and the frame shows a quiet bar: "Not
    updated since 14:02. Retrying." A test stops the server under each open view and the data stays.
  - A lost connection, a stopped service, a slow API (an answer after 5 s) and a malformed roadmap file each have a
    designed state in the frame, drawn on the board's States, and a test for each. The last data stays in all four;
    the laid track shows only where no data came yet.
  - Red shows only what is broken, in the frame, with the one command that fixes it. A malformed roadmap file is
    broken: the frame names the file, the line and the message of `lineclear roadmap check`.
  - Each view sits in an error boundary in the frame, so no view throws: a bad answer shows the broken state and the
    rest of the page stays. A test feeds each view a malformed answer and finds no uncaught error.
  - The views need no change of their own for this.
  - Screenshots before and after at 390 and 1440 px of stale, slow and broken are on the pull request.
- parts: ui
- locks: data, shell
- after: U26

### U35 Motion says where you went
Result: Going into a project and back each move differently, so you know where you are.
- why: every view change is the same 200 ms fade, so going into a project and coming back look alike, and a card
  does not grow into its page.
- done when:
  - In the frame, a view change slides 24 px the way you went in 280 ms, a card grows into its page, and the Chat
    panel opens with the move token. Back plays it in reverse. The views need no change of their own for this.
  - Every motion runs at 60 fps in a performance trace with no long task over 50 ms, a click during a motion acts at
    once, and nothing moves under reduced motion. A recording of each motion is on the pull request.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- parts: ui
- locks: shell
- after: U26

### U36 Same words everywhere
Result: Home, the roadmap, the film and the app use the same words and pictures.
- why: Home says "tasks at work", the roadmap "steps at work", the film "Step 4 needs you" and the app "waits for
  you". The film ends "Line clear." and no view says it. The films draw a review that checks as an amber lamp,
  while amber means "waits for you" everywhere else. Facts are written as sentences, such as "Sonnet 5.5 does the
  work", so a glance has to read a whole line to find one value.
- done when:
  - `docs/brand.md` has a content rule with examples: every text answers a question the user has on that view; a
    number always comes with its unit and a comparison (against the limit, yesterday or the median); a time is
    relative, with the exact time on hover; tasks go by title, not id; no filler. Its "Words" section is the
    glossary of the railway words, each used for one thing everywhere.
  - The content rule says a fact is a label and its value, not a sentence, with before and after examples:
    "Sonnet 5.5 does the work" becomes "Worker: Sonnet 5.5"; likewise "Reviewer: Opus 5.5", "Account: C, 62 %,
    resets 21:00" and "Running: 1 h 20 min". A sentence is used only where a person must read why: an error, or a
    decision in the Inbox.
  - Every frame in `docs/design/board.html` that writes a fact as a sentence shows it as a label, such as
    "Claude at 62% of its limit, resets 21:00" as "Account: Claude, 62 %, resets 21:00".
  - A check in `bun run check` reads the views, the README, the films and the docs, and fails on a word that
    `docs/brand.md` under "Words" does not use for that thing. A view merged before this step is fixed here; one
    merged after it passes the check before its merge.
  - A review that checks is a grey lamp in the films, `docs/design.md` and the app, as brand.md says; amber means
    only that something waits for you.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- locks: words, ui, board
- after: U25

### U37 Every tap works
Result: Every link works and every number matches its source.
- why: the screenshot tests show each view, but nothing taps every link, compares a number with its source, or
  changes the data under an open page.
- done when:
  - One UI test opens every view at 390 and 1440 px, taps every link and button, and fails on a dead one, a console
    error or an answer of 400 or more.
  - Each number on Home, the Inbox, the roadmap and Usage equals what the CLI prints for the same data.
  - The test changes the data under an open page, and each view shows the change within 3 s, with no reload.
  - It opens every view under a lost connection, a stopped service, a slow API, a malformed roadmap file and a
    roadmap of 1000 steps. Each view shows its designed state (U34, U29), and the test fails on an uncaught error,
    a blank view or sideways scrolling.
  - It fails on a call-out headline on Home, Usage or a Roadmap view, from the list in `docs/design.md` (U51).
  - It runs in `bun run ui:test`. A view merged before this step is fixed here; one merged after it passes the test
    before its merge. Screenshots before and after at 390 and 1440 px are on the pull request.
- parts: ui
- locks: ui-test
- after: U26, U29, U34

### U38 Fast on a phone
Result: Home loads fast on a phone over Tailscale with no layout shift.
- why: on a phone over Tailscale on slow 4G, Home's headline comes after 3.3 s and the layout shifts by 0.134. An
  idle roadmap of 319 steps loads 3.4 MB in 30 s, every view polls every 3 s, and the first view loads 145 kB of
  JavaScript. A budget that no check reads drifts back.
- done when:
  - Each budget below is a number in one file, `scripts/budgets.json`, and `bun run check` fails when one is broken.
    Its time limit in `scripts/check.ts` grows by the measured time of the budget run.
  - At 390 px on a network throttled to a phone over Tailscale (its latency and speed measured once and written in
    `docs/numbers.md` under "U38"), the first view shows in under 1 s, the largest paint in under 1.5 s, and the
    layout shift is under 0.01.
  - The views get changes from the server as they happen, not a poll every 3 s, and a change sends only what
    changed, never a full refetch: a test changes one task and finds one small message and no new `/api/home`. An
    idle Home moves under 50 kB a minute and an idle roadmap of 319 steps under 100 kB. Every answer is compressed,
    `/api/home` answers in under 0.2 s, and the first view's JavaScript is under the budget, at most 100 kB
    compressed.
  - The idle service uses under 1 % of a core over 60 s and its memory stays under the budget in MB, at most L40's
    300 MB, measured by the budget run.
  - `lineclear measure` prints tokens per merged step next to L57's number in `docs/numbers.md`, and a test on
    fixed data checks that line.
  - The same numbers, measured once against the Tailscale address, are in `docs/numbers.md` under "U38".
  - Screenshots before and after at 390 and 1440 px, and each run's trace, are on the pull request.
- parts: ui, server
- locks: data
- after: U26

### U54 Pages do not jump
Result: A page does not jump while loading or blink when live data comes in.
- why: a page that jumps while it loads, or blinks when live data comes in, looks broken and makes you lose your
  place, even when every number is right.
- done when:
  - A UI test opens every view at 390 and 1440 px, cold and after a reload, and measures a layout shift of 0 from
    the first paint on.
  - The test changes the data under each open view many times. Only the elements whose data changed are replaced,
    a recording of every frame shows no blank or half drawn frame, and the layout shift stays 0.
  - It runs in `bun run ui:test`. A view merged before this step is fixed here; one merged after it passes the test
    before its merge. Screenshots before and after at 390 and 1440 px are on the pull request.
- parts: ui
- locks: layout-test, kit, shell
- after: U26

### U39 A fresh look at the views
Result: A fresh reviewer judges the built views against the design board.
- why: the board is the target, and only a fresh look at the built views says whether Phase 13 got there.
- done when:
  - Every view and state at 390, 768, 1440 and 2560 px sits next to its board frame in one artifact. Each finding
    is tagged critical, major, minor or trivial. Every finding of major or above is fixed in this step, never
    deferred, and the artifact shows it fixed. Only a minor or trivial one may be raised once with `lineclear plan`.
  - The review's numbers are measured again and written in `docs/numbers.md` under "U39": headline time, layout
    shift on every view, targets under 48 px, type sizes off the scale and dead links.
  - A fresh model, not the author, looks at Home cold and answers "what is going on here?"; its answer is in
    `docs/numbers.md` under "U39". If it cannot tell what runs, how far the work is and what is done in 10 s, and
    that decisions wait in the Inbox, the
    step simplifies again.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- parts: ui
- after: U25, U26, U27, U28, U29, U30, U31, U32, U33, U34, U35, U36, U37, U38, U44, U45, U46, U47, U48, U49, U50, U51, U52, U54

## Phase 14: Everything runs on Lineclear

Why: roadmap 3. The phases before it build Lineclear beside herdr-projects 2.0, one machine at a time. This phase closes
what is still missing before all your work runs on it: every machine, the old tools gone, work where there is room,
a phone that hears the Inbox, an install for someone new, recovery, and the token savings for every user. Most of
its steps share no code and run in parallel.

### L42 All machines on Lineclear
Result: Every machine you add runs its spaces and tasks on Lineclear, with one Home and Inbox.
- why: the migration (L15) moves one machine. With two or more machines, the others stay on herdr-projects 2.0, and
  Home reads their work from Lineclear's files. Once every machine runs Lineclear, a machine that is not updated
  drifts to another version.
- done when:
  - `lineclear migrate --all` runs the L15 move on every machine added in Settings, over SSH. It installs Lineclear
    on a machine that lacks it first. `--dry-run` lists what moves on each machine.
  - Each machine runs its own spaces, tasks and slots on Lineclear. Home, `lineclear status`, the Inbox, the
    Dispatcher and Agent browsers show the work of every machine in one place, with no Lineclear file read.
  - Running `install.sh` on one machine updates every machine. Settings shows the Lineclear version of each
    machine, and `lineclear doctor` names a machine that is behind, with the command that fixes it.
  - A test with two machines, one of them reached over SSH, moves both and shows one Home. A real move of two
    machines is recorded in `docs/numbers.md` under "L42".
- locks: server, status
- after: L15

### L44 Work goes where there is room
Result: A step waits only when no machine of its project has room.
- why: the backlog's machine pool waited for a measured need, and it is measured: one machine held three to four
  ready steps for over an hour at a load of three to six times its cores, while another machine of the same
  project had a free slot.
- done when:
  - A step held for a slot or the load limit starts on another machine of the same project when that machine has
    the repo, a free slot and a load under its limit. The rule loop logs why in `decisions.jsonl`.
  - The project's secrets reach that machine over SSH, in the same place outside every repo, never in git or a
    chat.
  - The task's worktree, review and merge work there as on the first machine, and Home shows which machine runs
    it.
  - Tests with two machines cover a start on the other machine, no start when it lacks the repo or room, and the
    secrets. A real run is recorded in `docs/numbers.md` under "L44" with the load of both machines.
- locks: rules
- after: L42

### L45 Heavy tests take turns
Result: Heavy test and browser suites take a check slot and never overload a machine.
- why: check slots (L7) cover `lineclear check` only. Agents also run test and browser suites by hand, several at
  once, so the load climbs far above the cores, browser tests crash and the suites run again.
- done when:
  - A project's settings list its heavy commands. `lineclear project add` fills the list from what it detects: the
    check command and the test and browser test scripts. You can change it.
  - Lineclear's pi extension runs a heavy command only in a check slot. It waits for a free one as a `checks` wait,
    shown in `lineclear status`, and frees the slot when the command ends or is killed.
  - A test starts a heavy suite in four tasks at once with N at 2: at most two run, and the other two wait and
    then pass. A recorded run of several tasks in `docs/numbers.md` under "L45" stays under the load limit, and no
    browser test runs again because its browser closed.
- locks: rules, pi
- after: none

### L46 A full account hands on
Result: When an account is full its work moves to the next one before the task stalls.
- why: idea.md says a full subscription hands over to the next one at once. An account is marked full only when a
  reviewer reports a usage limit, so a worker on a full account moves only when the stall ladder finds it stopped.
  The mark is never cleared, and Usage does not show the move.
- done when:
  - When a model call fails because its account's session or week is full, the rule loop moves the task to the
    role's next model within one tick, before any stall rung. Where pi can, the session goes on with the new
    model; otherwise the task restarts from its notes (L13).
  - The account is marked full until its reset time, for every role, and the mark clears by itself then.
  - Usage shows each account as free or full until a time, and which tasks moved to which model.
  - Tests cover a full session, a full week, the clear at the reset and a role whose last model is full (the task
    waits, as L19 says). A real handover is recorded in `docs/numbers.md` under "L46".
- locks: rules, usage
- after: none

### L48 Only you answer the Inbox
Result: Nobody but you can answer the Inbox, not another visitor and not an agent.
- why: anyone who can open the web address can answer the Inbox, and so can an agent through the `lineclear`
  command. What protects it must be plain, and pairing each device would make work heavy.
- done when:
  - `docs/idea.md` states the decision: no device pairing. Lineclear listens on 127.0.0.1 only. Your phone reaches
    it through a private network's HTTPS proxy, such as [Tailscale Serve](https://tailscale.com/kb/1312/serve),
    whose name is in `LINECLEAR_HOSTS`. That network is the pairing. Any other name is refused.
  - An answer is a POST that carries a token only Lineclear's own pages hold, set when a page loads. A POST with
    no Origin is no longer enough, so a plain `curl` from an agent cannot answer.
  - `lineclear doctor` warns when the server listens beyond 127.0.0.1, with the command that fixes it.
  - Lineclear's pi extension refuses an Inbox answer from every agent, not only from the Dispatcher.
  - Tests cover a refused host, a refused POST from another site, a refused `curl` with no token and a refused
    answer from an agent.
- locks: secrets, pi
- after: none

### L49 New users can install it
Result: Someone new installs Lineclear from the README alone.
- why: a product is not done while only its builder has installed it. The one-line install needs a repo that
  anyone can read, and no run by someone new is recorded.
- done when:
  - The README lists what still blocks a public install (a private repo, no license). Each block is raised once
    with `lineclear ask --kind outward`, since opening the repo is your choice.
  - The one-line install works from a readable copy of the repo (`LINECLEAR_REPO`), shown by the fresh machine
    test of L31.
  - One run on a clean machine by the README alone, with a project its runner did not write, from the install to
    a merged step, is recorded in `docs/numbers.md` under "L49". Each place the README was not enough is listed
    and fixed.
- locks: install, ui
- after: L31

### L50 Recovery by itself
Result: After a reboot, a killed service, a full disk or a lost network, work comes back with no manual step.
- why: Lineclear runs day and night, so a reboot, a killed service, a full disk and a lost network will happen.
  The service starts at boot only if lingering was turned on by hand, and state files are written in place, so a
  crash in the middle of a write can leave half a file.
- done when:
  - `install.sh` turns on lingering for your user, so the service starts at boot with no login. Where that needs
    sudo it prints the one command instead. `lineclear doctor` checks it.
  - Every state file is written to a temporary file and renamed into place. A test finds no plain write of one.
  - A reboot, a killed service, a full disk and a lost network are each tested once on a test machine. Each comes
    back by itself with no lost task, wait, Inbox item or decision, and the tasks go on. The runs are recorded in
    `docs/numbers.md` under "L50".
  - A full disk or a lost network shows once on Home with what to do, and clears when it is over.
- locks: install, rules
- after: L127
- files: install.sh, test/recovery.test.ts, docs/numbers.md

### L51 Token savings for all
Result: Every user gets the measured token savings, on by default.
- why: every turn sends the whole context again, so most of what an agent costs is context. Savings that work
  belong to every user, but Lineclear's install adds only a guard to pi. Some savings are already elsewhere: the
  rule loop replaces a timed coordinator (L43), the move to the next account is L46, the ask before a paid key is
  L9, and `lineclear measure` reads pi's session files, so no usage log of its own is needed.
- done when:
  - `install.sh` installs Lineclear's pi extension with a token pack. Each saving is its own file in `pi/` that
    registers itself, so the steps that add a part share no code. Each part is on by default, with a switch in
    Settings that turns it off. `lineclear doctor` shows which parts are on.
  - A part joins the pack only with its measured saving: tokens and $ per merged step before and after, in
    `docs/numbers.md` under "Token pack", with the measurement it comes from. Each session records which parts
    were on, so `lineclear measure` splits the numbers by part.
  - No part holds an account name, a provider of one setup or a rule of one owner.
  - Tests cover the install of the pack, the switches and a second install that changes no file.
- locks: install, settings, measure, pi
- after: none

### L52 Compaction near 150 k
Result: Long sessions compact near 150 k tokens on every model, so they cost less.
- why: pi compacts a session near the end of its model's window, so a model with a large window carries a huge
  context on every turn, and a threshold set wrong compacts on every turn instead.
- done when:
  - The pack sets the compaction of each model from its window, so every model compacts near 150 k tokens, and it
    keeps a short tail after a compaction. A model with an unknown window is left as it is, and `lineclear doctor`
    names it.
  - A value you set yourself stays.
  - The saving is in `docs/numbers.md` under "Token pack".
  - Tests cover a large window, a small one, an unknown one and a value of your own.
- locks: none
- after: L51

### L53 Long output kept in a file
Result: A long log is cut in the chat and kept whole in a file the agent can read.
- why: a long test log or file stays in the context and is sent again on every later turn, though the agent needs
  only its start, its end and where to find the rest.
- done when:
  - The pack cuts a tool result over a set size to its start and its end, saves the whole result in the task's
    temporary folder and says how to read the rest. Secrets are removed before anything is saved or sent. Writes,
    edits, images and the chat with you are never cut.
  - Test output over a set size keeps its failures and its summary.
  - The saving, and the share of cut results that were read again, are in `docs/numbers.md` under "Token pack".
  - Tests cover the cut, the saved file, the secrets and each kind that is never cut.
- locks: none
- after: L51

### L54 Notes survive compaction
Result: An agent keeps its notes through a compaction, with no extra model call.
- why: pi's own compaction summary is one more model call that sends the whole history again, and it can lose what
  the agent was in the middle of.
- done when:
  - Before a worker or a planner reaches its compaction point, the pack asks it once for a state file under set
    headings. At the compaction it builds the summary from that file, with no model call. A missing or old file
    falls back to pi's own summary, and the log says why.
  - The summary keeps the task, your messages word for word and the files changed.
  - The saving, and the share of compactions that fell back, are in `docs/numbers.md` under "Token pack".
  - Tests cover a good file, a missing one, one too long and the fallback.
- locks: none
- after: L52

### L55 Fewer turns per read
Result: Agents read many files in one turn and wait without polling.
- why: an agent that reads one file per turn, or waits with `sleep` and a look at a log, sends the whole context
  again each time. These two savings are not measured yet.
- done when:
  - After several turns in a row that each made one read, the pack adds one line to the result: reads that do not
    depend on each other go in one turn. It refuses a bash call that starts with a long `sleep`, and names a
    command that blocks until done instead.
  - Each is measured first: tokens and $ per merged step over at least 20 merged steps with it on and 20 with it
    off, in `docs/numbers.md` under "Token pack". One that saves nothing measurable is dropped from the pack.
  - Tests cover the hint, the refusal and a short sleep that is allowed.
- locks: none
- after: L51

### L56 Small briefs
Result: A worker gets its step, its files and the rules, not the whole roadmap.
- why: a worker needs its step, the files it is likely to touch and the rules, not the whole roadmap. A roadmap
  read whole stays in the context on every later turn, and it grows with each phase.
- done when:
  - The brief holds the step's why and done-when, the files the step names or its `after` steps changed, and the
    project's rules, and stays under a set size.
  - `lineclear roadmap show <id>` prints one step, and the brief says to use it instead of reading the whole file.
  - `lineclear measure` counts the sessions that read the whole roadmap, before and after, in `docs/numbers.md`
    under "Token pack".
  - Tests cover the size of the brief and `roadmap show`.
- locks: rules, measure
- after: L51
- files: src/brief.ts, src/roadmap-cli.ts, docs/numbers.md

### L67 pi finds the extension
Result: The Lineclear extension loads in pi on every machine.
- why: install linked `~/.pi/agent/extensions/lineclear.ts` to the extension in the app. pi resolves an
  extension's own imports from the link's folder, not its target's, so once the extension imported `./pack.ts`
  every pi failed to start with "Cannot find module './pack.ts'", and every task's agent stopped with it. A test that
  loads the link with Bun passed, since Bun follows the link.
- done when:
  - `install.sh` writes `lineclear.ts` as a file that imports the extension by its full path, with no relative
    import, and replaces a link from an older install. A second install changes no file.
  - `lineclear doctor` fails the pi extension when it is a link or imports another path, and its fix installs again.
  - `lineclear uninstall` removes that file and the old link, and leaves any other file.
  - A test checks the file has no relative import, so a part added to the pack cannot break pi again.
- parts: install, pi
- after: L51

### U56 Inbox chat link opens
Result: The chat link on an Inbox item opens the task's chat from any address.
- why: an Inbox item for a task that waits links to its chat at this page's host on Lineclear's local port. Behind
  a private network's HTTPS proxy, such as [Tailscale Serve](https://tailscale.com/kb/1312/serve), that port is
  often not served, so the link gives "connection refused".
- done when:
  - The chat link uses the address Lineclear is reached at from your browser: a setting in Settings, then the
    page's own host and Lineclear's port when none is set.
  - `lineclear doctor` names a set address that does not answer.
  - A UI test opens the link with an address set and with none.
- locks: none
- after: none
- files: src/web-address.ts, src/web-settings.ts, src/doctor.ts

### L57 Goals checked on real work
Result: The goals in idea.md are measured on the work done so far and shown.
- why: Lineclear is done when the goals in idea.md hold on real work, on every machine. `lineclear measure` counts
  one machine, so the work of the others is missing from the numbers. The numbers come from the work already done, with
  no wait for new days.
- done when:
  - `lineclear measure` counts every machine in Settings, over SSH.
  - The real work recorded so far (every day in the logs and git, on every machine) is in `docs/numbers.md` under
    "L57", measured when the step runs, with no waiting: asks a day, the median
    wait from ready to start and the cost per merged step against the pilot's before Lineclear, each goal marked
    met or not.
  - Each line of "Done means" at the top of this file is checked against the step that shows it. A goal that is
    not met is raised once with `lineclear plan`.
- locks: measure
- after: L42, L43, L44, L45, L46, L47, L48, L49, L50, L51, L52, L53, L54, L55, L56, L67, U56

## Phase 15: A finished look

Why: the last phase, once the UI is reviewed (U39) and Lineclear is measured (L57). The README film and the UI
motion are drawn by hand in code, so their curves and depth stay simple. The pictures of the UI on the README and
docs pages are drawn or taken once, so they drift from the app. A render from a script in the repo and screenshots
from the running app fix both, and anyone can make them again. U43 is the last step: every release waits for it.

The pipeline comes first (U63 to U65 and U67), right after the live line of U24: one brand source, one command
that renders every picture and the film, a check that fails on a stale one and release notes in one template. Each
release then looks the same. The pictures themselves wait for the UI to settle: the film and the
README stills are rendered in U68, after the flagship line (LIN-149, LIN-150, LIN-152), and the README takes its
form in U66 after them. The final render of the film stays in U40 and U43.

### U63 One brand source for pictures
Result: Every picture of the app, README and film takes its look from one brand source.
- why: the app, the README, the film, the social preview and the release pictures each drew the brand on their own,
  so they drifted apart.
- done when:
  - `ui/brand/` holds the tokens, the role marks, the fonts and the motion curves. The curves are set in
    `scripts/film/motion.json`, which the film's scene script reads, and `bun run media` writes them into the motion
    tokens of `ui/brand/rail.ts`. A test fails when the two differ.
  - The app, the README pictures, the film, the social preview and the release pictures read their colours, fonts,
    marks and curves from there. No picture is drawn by hand a second time.
- parts: ui
- after: U24

### U64 Every picture, one command
Result: One command renders the film, the README stills and the social preview.
- why: a picture kept by hand goes stale the day the app changes, and only its author can make it again.
- done when:
  - `bun run media` renders into `docs/readme/`: the film with Blender, headless, and its still poster; the README
    stills from the running app on fixed real-looking data; the role chart; and the GitHub social preview at
    1280 x 640. `bun run media <kind>` renders one kind (film, stills, roles, social).
  - Each file carries the version and commit it was made from, and `docs/readme/media.json` lists each with the hash
    of what it was made from.
- parts: ui
- after: U63

### U67 Release notes in one template
Result: Each release has notes in the same form, with one picture of what changed.
- why: each release should read and look like the last one, so the project holds together.
- done when:
  - `bun run media release <version>` writes `docs/releases/<version>.md` from one template, with one picture of what
    changed made by the same pipeline. A test fails on release notes that leave the template or miss their picture.
- parts: ui
- after: U64

### U41 App and film move alike
Result: The app and the film move the same way, from one source of motion.
- why: the app and the film should move alike, and the UI's curves are guessed by hand instead of taken from one
  source. A motion can pass the 60 fps and 300 ms checks and still look worse than the board, and only a frame by
  frame comparison shows it.
- done when:
  - The key motions of U24 (a train, a lamp, laying the track, a view change) join the curves U63 put in
    `scripts/film/motion.json`, and every view reads them from `ui/brand/rail.ts`.
  - The motion still runs as CSS and the Web Animations API at 60 fps in a performance trace, never blocks input,
    stays under 300 ms per change, and shows only the end state under reduced motion (U2).
  - `bun run ui:record` records each motion of U24, U25, U35 and this step in the app and the same motion on the
    board at the same frames (start, every 50 ms, end).
  - A test compares each pair frame by frame and fails when one differs from the board by more than a threshold
    written in `docs/design.md`. The parts and graphics of each view are compared the same way, at rest.
  - The recordings before and after, and side by side with the board, are on the pull request.
- parts: ui
- locks: motion
- after: U25, U35, U63

## Phase 16: Fresh eyes before work

Why: a step that reads clear to its planner can still miss a file, a lock or a test, and the worker finds out only
after hours of work and review rounds. The Elephant-Goldfish Model
([Google Open Source Blog](https://opensource.googleblog.com/2026/10/introducing-elephant-goldfish-model-plugin.html))
has a fresh session with no context read a design, say it back and give go or no-go before anyone builds it. Here it
is part of a step's life: plan, readiness, approve, work, review, merge. A rule checks the form first with no AI, then
one short call to a model from another company than the planner checks the content. A no-go goes back to the
planner, so you see only plans whose every step got a go. `lineclear measure` keeps the check only while it saves
more than it costs.

The steps share no code with the UI steps that lead to U43, so the longest chain to U43 stays 6 steps
(U25 > U26 > U44 > U28 > U39 > U43). L60 shares the `roadmap` lock with U44 and L64 the `measure` lock with U45: each
is short and can start long before them. U55 waits for U30 and U45, shares the `roadmap-step` lock with U49, and U39
does not wait for it.

### L59 The check in the idea
Result: The idea names the fresh-eyes check, so every later step reads it.
- why: the check must be part of the design that every later step reads, not a part bolted on at the end.
- done when:
  - `docs/idea.md` has a short section on a step's life: plan, readiness, approve, work, review, merge. It says who
    does each: the planner writes, a rule and then the step check judge readiness, you approve, a worker builds, a
    reviewer reviews, the merge lane merges.
  - The roles list the step check: an AI model from another company than the planner, with no context but the step
    and the repo's map. It says the step back in its own words and answers go or no-go with what is missing. It
    never writes the step and never asks you.
  - The section names the principles it follows: no AI where a rule works (the form is a rule), no token waste (one
    short call per new or changed step, kept only while measured to pay), and a reviewer from another company.
  - "How work flows" says a no-go goes back to the planner and the Inbox shows only plans whose every step got a go.
- locks: idea
- after: none

### L60 Steps name their files
Result: A step says where its change goes, so a worker and a reviewer see its reach.
- why: a worker and a fresh reader can judge a step only when it says where the change goes, and the rule check
  needs a field to read.
- done when:
  - A step may have a `files` line: the paths or folders it is likely to touch. `roadmap check` accepts it, and a
    step written before it stays valid without one.
  - "How to read it" at the top of `docs/ROADMAP.md` names the line, and the step shape in `templates/plan.md`
    shows it.
  - `lineclear roadmap show <id>` prints it, and the worker's brief (L56) lists those files.
  - Tests cover a step with files, one without, and the brief.
- parts: planner
- locks: roadmap
- after: L59

### L61 Step form checked by rule
Result: A step missing a part is sent back at once, with no model call.
- why: a missing why, done when, lock, after or file list is plain to see, so no model call should find it.
- done when:
  - `lineclear plan submit` first checks every new or changed step of the plan's diff with no AI: a why, a done when
    with at least one item, a `locks` line, an `after` with known ids, and a `files` line that names at least one
    path.
  - A step that fails goes back to the planner as a message that lists each missing part per step. Nothing reaches
    the Inbox, and the reason is logged in `decisions.jsonl`.
  - Tests cover a plan that passes and one step missing each part.
- parts: planner
- after: L60

### L62 A fresh model reads each step
Result: A model from another company reads each new step cold and says go or no-go.
- why: a step can have every part and still be unclear to someone who did not write it, and a model from the same
  company as the planner shares its blind spots.
- done when:
  - After the form rule passes, `lineclear plan submit` makes one short call per new or changed step to a model from
    another company than the planner's, picked by a rule from the reviewer's model list. When no other company has
    room, a Claude model is fine in its own fresh session, another account or model than the planner's first; a plan
    is never refused only for that. It reads only that step and the repo's map: `AGENTS.md` and the list of tracked files.
  - The model says the step back in its own words, then answers go, or no-go with what is missing. Its input and
    answer each stay under a set size in tokens, checked by a test.
  - A no-go goes back to the planner as a message with what is missing, and the plan is checked again after its
    change. The owner never gets a no-go. After 3 rounds with a no-go the planning task ends with a report that
    names the step and why, and no Inbox item.
  - Each answer, its model and its tokens are kept in files next to the plan, and the go answers go with the plan's
    Inbox item.
  - Tests with a fake model cover a go, a no-go fixed in the next round, 3 no-gos, and a planner and checker from
    the same company that the rule accepts, on another model, when no other company has room.
- parts: planner
- after: L59, L61

### L63 Briefs know the check
Result: The planner writes steps for a cold reader, and the worker is told how they are judged.
- why: a planner that knows its steps will be read cold writes them for a cold reader, and a worker gets the
  checked reading of its step for free.
- done when:
  - `templates/plan.md` says each step is read by a fresh model that knows only the step and the repo's map, and
    that a no-go comes back as a message to fix before anything reaches the owner.
  - `templates/brief.md` gives the worker the step check's own words for its step, and says to note in its report
    where the step still lacked something.
  - Tests on both templates cover the new lines, and the brief stays under L56's size.
- parts: planner, rules
- after: L60, L62

### U55 The check shown on screen
Result: A plan's card shows that each step was read cold and what it was taken to mean.
- why: you approve a plan once, so its card should say each step was read cold and what the reader took it to mean.
- done when:
  - `docs/design.md` says how the step check shows: on a plan's Inbox card, one line per step with its go and the
    checking model, its words one tap away; on a step's page (U45), the check in its history. A no-go never shows
    in the Inbox.
  - The plan card and the step page show it, built from the kit's parts, in every state of the UI bar.
  - A test reads a plan card and a step page with a check, and finds no no-go in the Inbox. Screenshots at 390 and
    1440 px are on the pull request.
- parts: ui
- locks: inbox-view, roadmap-step
- after: L62, U30, U45

### L64 What the check costs
Result: The cost and the savings of the step check are measured.
- why: the check is kept only if it saves more than it costs, and only numbers can say so.
- done when:
  - `lineclear measure` counts per step, with no AI: no-gos, rework rounds (review rounds with a finding to fix,
    refused merges and reverts) and owner questions, and the tokens and dollars of the check.
  - It splits steps planned before the check from steps planned with it. The numbers before are in
    `docs/numbers.md` under "Step check".
  - A fixture counted by hand gives the same numbers.
- parts: measure
- after: L62

### L66 Remote agents reach the server
Result: After a migrate, agents on a remote machine still reach the server.
- why: after `lineclear migrate`, a remote machine's helper socket path differs (`~/.lineclear/helper/main.sock` vs
  the old helper socket), so its agents cannot reach the server.
- done when:
  - `docs/known-faults.md` has a row for it: how it shows, the workaround, and what the fix does.
  - `lineclear migrate` links or moves the socket on every remote machine so both paths reach the server, and
    `lineclear doctor` names a machine where they differ, with the command that fixes it.
  - A test with a fake remote machine fails before the fix and passes after: an agent there reaches the server
    after migrate.
- locks: server
- after: none

## Phase 17: Lineclear only

Why: Lineclear grew inside a fork of herdr-projects 2.0, and the fork still carries its old name: its command, skills,
environment and CSS names, its own web UI on its own port, its herdr plugin, its data folders on each machine and
its docs. A user meets two names, two UIs and two folders. This phase leaves one product: one name, one CLI, one web
UI and one data folder, `~/.lineclear`, that anyone can install. herdr stays: it runs the agents.

Every step here keeps every running task, chat, artifact and setting, merges with `bun run check` green and passes
the smoke check of an update (`scripts/smoke.ts`, run by `install.sh`). The steps run in the order of their `after`
lines. `server/LICENSE` and `server/NOTICE` keep the MIT attribution of herdr-projects 2.0, as the license requires.

### L68 Agents call lineclear
Result: Agents use the `lineclear` command in their skills and prompts, and the old name is gone.
- why: agents learn the command `lineclear` from their skills and launch prompt, so the old name is in every brief
  and every chat.
- done when:
  - `lineclear` runs every command of the old CLI's help and the skills (task, space, mode, heartbeat, set,
    automation, artifact, secret, ready, merge and the rest) with the same words and output. Where Lineclear
    already has a command of that name (status, ask, plan, doctor), one command does both jobs or one of them gets
    a new name: one meaning per name, and `lineclear help` says it.
  - Agents that have no full CLI, in the sandbox or on a remote machine, get `lineclear` as the same thin client
    their `lineclear` is today.
  - The skills are `lineclear`, `lineclear-agent` and `lineclear-coordinator`, they name only `lineclear`, and the
    launch prompt and `LINECLEAR_COMMAND` name `lineclear`. A remote machine's helper has `bin/lineclear`. An
    install or `lineclear machine update` removes the old installed skills.
  - The pi extension's merge guard knows `lineclear merge` as well as the old form.
  - `lineclear` and the old skill paths stay only as links for agents started before this step, and
    `lineclear doctor` names each running agent that still uses them.
- parts: core, server, pi, install
- after: none

### U57 Old UI views: keep or drop
Result: Each view of the old UI is marked kept or dropped, so you know what the new UI must cover.
- why: the old UI must go, but only once each view the owner still needs lives in Lineclear's UI.
- done when:
  - `docs/design.md` lists every view and panel of the old UI, one per plugin and part (places, coordinators,
    tasks, task chat, reactions, terminal, artifacts, worktree, browser, settings, voice, keyboard and search,
    health, alerts, autopilot) with "moves", "goes" or "Lineclear has it", and a reason.
  - The owner confirms the list once with `lineclear ask`.
- locks: design-doc
- after: none

### U58 A task's chat in the new UI
Result: A task's chat opens in the Lineclear UI, and the Inbox links to it.
- why: the Inbox links a task to the old UI's chat, the one view the owner opens most there.
- done when:
  - `/task/<id>` shows the task's chat: messages as they come, replies, reactions, attachments, choice and plan
    cards with their answers, and a composer, built from the kit to the bar in `docs/design.md`.
  - Every Inbox and Home link to a task opens it, never the old port. The chat address setting of U56 and its
    doctor check are removed, since no link leaves Lineclear's UI.
  - Every state of the UI bar is drawn (empty, loading, error, long text, 200 items) with screenshot tests at 1440
    and 390 px.
- parts: ui
- locks: chat, task-row
- after: U57

### U59 Terminal and artifacts, new UI
Result: You watch a task's terminal and open its artifacts in the Lineclear UI.
- why: the owner watches a task's terminal and opens its artifacts in the old UI.
- done when:
  - The task view has the task's live terminal, read and typed into, and its artifacts: each version as a card that
    opens full screen, sealed and checked as before.
  - Every state of the UI bar is drawn, with screenshot tests at 1440 and 390 px and a recording of each motion.
- parts: ui
- locks: task-row
- after: U58

### U60 The rest you keep, in the new UI
Result: Every old view you still use lives in the Lineclear UI.
- why: U57 may mark more views "moves" than chat, terminal and artifacts, settings among them.
- done when:
  - Each view the U57 list marks "moves" and no earlier step built is in Lineclear's UI, to the same bar as U59.
  - The U57 list says where each one now lives.
- parts: ui
- locks: shell, design-doc
- after: U59

### L70 One web UI, one port
Result: Lineclear has one web UI on one address to open and to secure.
- why: while the old UI serves on its own port, there are two UIs and two addresses to secure.
- done when:
  - The fork's API answers on Lineclear's port, beside Lineclear's own, and agents' commands, remote helpers and
    the sandbox relay reach it there or on a socket under `~/.lineclear`.
  - The old UI's code (`server/src`, `server/index.html`, `server/public`, `server/assets`,
    `server/vite.config.ts`, the plugins' client parts) is deleted. The old port
    serves no page: until no agent started before the step is left, it answers only the API, and
    `lineclear doctor` names each agent that still uses it. Then it closes and the `lineclear-serve-<port>`
    service is gone after an update.
  - An agent started before the step still reaches the server after the update, shown by a test.
- parts: server, install
- after: L68, U60
- dropped: Split into L164 to L167, each small enough for one task: links, no old pages, the code deleted, the lines counted.

### L164 Every link opens the new UI
Result: Every link Lineclear sends, in the Inbox, a notification, the CLI's output or an email, opens the Lineclear UI on 7420.
- why: while a link can lead to the old UI on its own port, the owner lands on a page that is about to go.
- done when:
  - A test collects each link built by the server, the push payloads, the Inbox items, the CLI's printed addresses and the emails, and fails on one that names the old port or an old page path.
  - A task, an artifact, a terminal and a browser link each open `/task/<id>`, its `?tab=` or `/browsers` of the Lineclear UI.
  - The old UI's own pages are not yet touched: only the links change.
- parts: server, inbox
- locks: none
- files: src/inbox.ts, server/server/push.ts, server/server/app.ts, test/contracts/inbox.test.ts
- after: U60

### L72 Machines use only ~/.lineclear
Result: Every machine keeps its Lineclear files in one folder, ~/.lineclear.
- why: the server already puts helpers in `~/.lineclear/helper`, but `src/spread.ts`, `src/paths.ts`, the doctor
  and what runs on each machine (a second machine's agent browsers) still use the old data folder, so that folder cannot
  go while any of them runs.
- done when:
  - Remote helpers live under `~/.lineclear/helper` on every machine, and `lineclear machine update` moves a
    machine there, agent browsers included, without stopping a running agent.
  - No code reads or writes the old data folder or `~/.herdr-projects`, except the archive step of L73.
  - Records in `agents.json` and `tasks.json` that hold old paths are rewritten by `lineclear doctor --fix`, and
    a test shows a rewritten task still opens its chat.
- parts: server, install
- locks: machines
- after: none

## Phase 18: Clean code by rule

Why: code written fast by agents gathers the same faults again and again: dead code, unclear names, comments that
say nothing, one job done in several places in several ways, files too big to read, and a small change that breaks
something far away. Asking agents to be careful does not hold. This phase makes the machine hold it: each fault has a
check in `bun run check` that fails on it, and the reviewer treats each as a major finding.

Every gate is a ratchet. It lands with a baseline of the faults main has that day, so main stays green, and it fails
on any fault not in the baseline. A baseline may only shrink: the check fails when it lists more than it finds, so a
fix also lowers the baseline in the same commit. Nothing is turned off to pass. The gates share one runner
(`scripts/gates/`) and one baseline folder (`scripts/gates/baseline/`). `docs/architecture.md` says which module owns
what and which may import which. Steps that split big files in `server/` wait for L71, which trims it first.

The check stays fast: the gates add 20 s to `bun run check` at most, and the check fails when they take longer.
Anything slower, such as coverage over the whole server or a heavy copy scan, runs in the heavy run and before a
release (L90), not on every merge.

### L77 One lint and format rule
Result: One lint and format rule catches unused names and unsafe types in every file.
- why: unused names, `any` and unexplained non-null assertions hide faults that types alone do not catch, and two
  code styles in one repo make every diff noisier.
- done when:
  - Biome (one `biome.json` at the root, chosen over ESLint for speed: the whole repo in seconds) lints and checks
    the format of every TypeScript file, `server/` included, in `bun run check`.
  - Rules on: no unused variables, imports or parameters, no `any`, no non-null assertion without a
    `biome-ignore` comment that gives the reason, type imports written as such.
  - A ratchet runner compares what each gate finds with its baseline, per file and rule, and fails on a new fault
    or on a baseline that lists more than is found. `bun scripts/gates/run.ts --lower` lowers baselines and never
    raises one.
  - Tests plant a fault in a scratch repo and see the gate fail, and see a stale baseline fail.
  - In `bun run check`, Biome looks only at the files the branch changed since main, unless `biome.json`,
    `package.json` or `bun.lock` changed. `bun run gates:full` runs it over the whole repo.
- locks: gates
- after: none

### L78 No dead code
Result: A check fails when a file, export or dependency is unused.
- why: an unused file, export or dependency costs every reader time and every agent tokens, and nothing flags it.
- done when:
  - knip runs in `bun run check` over the root and `server/`: unused files, exports, types and dependencies fail
    unless the baseline lists them. Real dynamic entries (pi parts, plugins, scripts run by path) are in
    `knip.json`, not in the baseline.
  - A test plants an unused export and sees the gate fail.
  - The baseline is smaller than when the gate landed.
- locks: gates
- after: L77

### L79 No copied code
Result: A check fails when a block of code is copied to a second place.
- why: a block copied to a second place gets fixed in one of them, and the two drift apart.
- done when:
  - jscpd runs in `bun run check` over `src`, `ui`, `pi`, `scripts`, `test` and `server/`: a copy of 50 tokens or
    more between two places fails unless the baseline lists that pair of files with at least as many copied lines.
  - A test plants a copied block and sees the gate fail.
- locks: gates
- after: L77

### L80 Modules and their borders
Result: A check fails when a file imports across a border the code does not allow.
- why: when any file may import any other, a change in one place breaks another nobody thought of, and the code has
  no shape a new reader can learn.
- done when:
  - `docs/architecture.md` names each module, its folder, what it owns and which modules it may import, in one
    table that the check reads, so the doc and the check cannot differ.
  - A check fails on an import across a border the table does not allow and on an import cycle between files,
    beyond its baseline.
  - Tests plant a forbidden import and a cycle and see each fail.
- locks: gates, docs
- after: L77

### L81 Size limits
Result: A check fails on a file or function too long to read whole.
- why: a file of 3000 lines or a function of 300 cannot be read whole, so changes to them guess.
- done when:
  - A check fails on a file over 600 lines that is not in the baseline, or on one in the baseline that grew.
  - Biome fails on a function over 80 lines or with a cognitive complexity over 25, beyond its baseline.
  - Tests plant a file over the limit and see the check fail.
- locks: gates
- after: L77

### L82 Comments say why
Result: A check fails on commented-out code and on comments that only retell the code.
- why: commented-out code, a TODO nobody owns and a comment that retells the code or its history are noise that
  goes stale.
- done when:
  - A check fails on commented-out code and on a TODO, FIXME or XXX without a task id (`TODO(LIN-123)`), beyond
    its baseline.
  - `AGENTS.md` says under its product conventions: a comment says why, not what; no commented-out code, no TODO
    without a task id, no history comments, no filler.
  - Tests plant each fault and see the check fail.
- locks: gates, docs
- after: L77

### L83 A coverage floor per module
Result: A module whose tests cover less than its floor fails the check.
- why: a module without tests for its contract breaks quietly when another changes.
- done when:
  - The heavy run and a release (L90) measure line coverage of the root tests per module of
    `docs/architecture.md`, and fail when a module falls below its floor in the baseline. A floor only rises.
    `bun run check` does not, since coverage of every module is slower than its 20 s for the gates.
  - A test shows a module under its floor fails.
- parts: gates (health)
- after: L80

### L84 Smoke check in the merge
Result: A branch that does not start as a service never reaches main.
- why: a branch can pass every test and still not start as a service, and today only an install finds out.
- done when:
  - Before the merge lane lands a branch of Lineclear's own repo, it starts the branch's service on free ports with
    a scratch data folder and runs the smoke check of `scripts/smoke.ts` against it. A failure blocks the merge and
    says which check failed.
  - A test shows a branch whose service does not start is not merged.
- parts: server
- after: none

### L85 Reviewer checks code health
Result: The reviewer flags misleading names and changes outside the step's files.
- why: some faults no rule finds, such as a name that misleads or a change outside the step's files.
- done when:
  - The reviewer's checklist in the agent skill names duplicate logic, an unclear name, dead code left behind,
    comment noise and a change outside the step's files, and each is a major finding.
- locks: server
- after: none

### L86 One way for each job
Result: Each common job, such as reading config or writing a file, is done one way only.
- why: the same job done in several ways (reading config, calling the server, writing a file atomically, formatting
  a time, a UI part per pattern) means each fix lands in one of them only.
- done when:
  - Each of these jobs has one place in the code that does it, and every other place calls it: reading config,
    calling the server, writing a file atomically, formatting a time, and one UI kit part per pattern.
  - The copy baseline of L79 is at most half of what it was when the gate landed.
- parts: gates (health)
- after: L79

### L87 Big files split, outside server
Result: Large files outside the server are split, so each is short enough to read.
- why: `src/rules.ts` and `ui/kit/parts.tsx` are near 1000 lines each and grow with every step.
- done when:
  - No file outside `server/` is over 600 lines, and the size baseline lists none of them.
  - The function size and complexity baseline lists no file outside `server/`.
- parts: rules (health), ui
- locks: kit
- after: L81

### L88 Big files split, in the server
Result: The server's largest files are split into parts short enough to read.
- why: `server/server/live/source.ts`, `engine.ts`, `agents.ts` and the chat client are 1300 to 3100 lines each.
- done when:
  - Each file the size baseline lists in `server/` is split along the module borders of `docs/architecture.md`, and
    the size baseline is empty.
- parts: server (health)
- after: L81

### L89 Every baseline empty
Result: Every list of known faults is empty, so a fault is fixed, not parked.
- why: a baseline is a list of faults to fix, not a place to keep them.
- done when:
  - Every baseline in `scripts/gates/baseline/` is empty, so each gate fails on any fault.
- parts: gates (health)
- after: L78, L82, L83, L86, L87, L88

### L90 The heavy check
Result: A long check runs on each push to main, so a slow fault still shows up.
- why: a merge's check has to stay fast, so the gates there look only at what the branch changed. A check that
  takes minutes still has to run somewhere, or the faults it finds pile up.
- done when:
  - A heavy run on GitHub on each push to main runs `bun run gates:full`, the coverage floors of L83, the cold start of L49
    (`bun run cold-start`) and any check too slow for a merge,
    and a failure shows on the board as a task to fix it.
  - A release runs the same checks first and does not go out when one fails.
  - A test shows the job reports a planted fault.
- parts: gates (health)
- after: L77, L83

## Phase 19: Machines through herdr

Why: herdr already reaches other machines. It saves them (`herdr machine add`) and forwards its own API to them
(`herdr --machine <name> <command>`), so a workspace, a worktree, an agent and its events there are the same calls
as here. Lineclear bypasses that. Each other machine gets a Lineclear worker of its own, with its own task store,
its own id series per space and its own merge lane, and the rule loop reaches it with SSH shell scripts
(`src/spread.ts`) that need a Lineclear install there. A user then sees two ids for one project's work, merges that
wait on two lanes, and faults from a second install's PATH and folders. This phase leaves one server and one store
for every machine. Other machines run only herdr, pi, git and the project's tools, and herdr is reached in one
place, so it could be swapped.

These steps replace the way L42 and L44 reach a second machine. What they promise stays: one Home for every machine,
and work that goes where there is room.

### L91 herdr pinned and tested
Result: A new herdr version that breaks a call is caught by a test, not by agents.
- why: every machine runs on herdr, and herdr changes. A new version that renames a call or a parameter breaks the
  agents of every machine at once, and nothing says why.
- done when:
  - Lineclear names the herdr version and API protocol it is tested with, in one place in the adapter
    (`server/server/live/herdr.ts`). `lineclear doctor` names a machine whose herdr differs.
  - A contract test runs the adapter against the installed herdr: every call the adapter makes exists in
    `herdr api schema --json` with the parameters it sends, and a herdr session of its own, apart from the user's,
    answers a real ping, a workspace, a command typed into its pane and read back, a worktree and an event
    subscription. It fails on a planted unknown call, parameter or event.
  - An update of herdr is a step like any dependency: it raises the pinned version with the contract test green.
- files: server/server/live/herdr.ts, server/test/herdr-contract.test.ts, src/doctor.ts
- parts: server, install
- after: none

### L92 herdr in one place
Result: Every call to herdr goes through one adapter, so an update changes one place.
- why: a call to herdr outside the adapter is a second way to reach it. It breaks on another machine and on a herdr
  update, and the contract test never sees it.
- done when:
  - Every call to herdr, in `src/` and in `server/`, goes through the adapter. A gate fails on a `herdr` command or
    socket call anywhere else.
  - The adapter takes the machine as an argument. On another machine it uses herdr's own forwarding, the same calls
    with the machine named, and no shell script of Lineclear's.
  - A small read for room (load, cores, free memory) rides the same connection.
  - The contract test covers each call through the forwarding too, against a machine saved in herdr when there is
    one, and says it skipped that part when there is none.
- files: src/herdr.ts, server/server/live/herdr.ts, server/server/live/herdr-forward.ts, server/server/live/box.ts, server/server/live/install.ts, server/server/live/machines-links.ts, server/server/live/settings-catalog.ts, server/scripts/plugin.ts, server/test/herdr-contract.test.ts, src/rules.ts, src/stalls.ts, src/starts.ts, src/board.ts, src/doctor.ts, src/herdr-world.ts, src/promote-step.ts, src/release.ts, src/retire.ts, src/try-instance.ts, test/gates.test.ts, docs/parts/core.md, scripts/gates/
- parts: server, rules, gates, core, install
- after: L91

### L93 One server for every machine
Result: One server drives all machines, so a project shows one series of task ids.
- why: a worker per machine keeps a task store, an id series and a merge lane per machine, so one project shows
  two ids for its tasks, one series per machine, and two merges into one main wait on two lanes.
- done when:
  - One server and one task store hold every task, with one id series per space. A task records its machine.
  - The server starts a task's workspace, worktree (with a `~/` path) and agent on its machine through the adapter,
    prompts it and follows its events, with the same calls it uses on its own machine.
  - The merge lane is one per project. It runs on the server's machine, or in the task's worktree on its machine over
    herdr (`herdr pane run`). Each machine has one heavy slot for checks and merges.
  - No other machine runs a Lineclear server or worker. The per-machine worker processes are gone.
  - A test with two herdr sessions, one standing for another machine, starts a task there, reviews it and merges it,
    with one id and one store.
- files: server/server/live/machines.ts, server/server/live/source.ts, server/server/live/engine/, server/server/live/task-ids.ts, server/server/live/box.ts, server/server/live/herdr.ts, server/server/live/mfs.ts, server/server/live/places.ts, server/shared/types-core.ts, server/test/machines-one-server.test.ts
- parts: server
- after: L92

## Phase 20: Each part has a keeper

Why: big teams keep quality because each team owns its part for the long term: it knows the part's purpose, rules
and debts, guards its interface and says no to a change that breaks it. Lineclear's workers are new for every step
and see only their step, so nobody owns a part over time. This phase gives each part a page that every worker on it
reads and keeps true, checks by machine that the page matches the code, and plans health work for the part in the
worst state. Locks that matched a part became that part: one word means one thing.

### L97 Parts and their pages
Result: Each part of the code has a page of its purpose, rules, interface and debts for the workers.
- why: a worker who knows a part's purpose, invariants, interface and debts changes it like its keeper would; a
  worker who sees only its step does not.
- done when:
  - `docs/architecture.md` has a Parts table of 8 to 12 parts, and each has `docs/parts/<part>.md` of at most one
    page: purpose, invariants, its interface to other parts, the files it owns, its tests and its known debts.
  - Every tracked file is in exactly one part, and `lineclear parts check` fails on a file in no part.
  - The locks that match a part are renamed to it, and the lock `check` is now `gates`.
- parts: gates, core, planner
- after: L80

### L98 Every step names its parts
Result: A step names the parts it touches, so its worker and reviewer get their pages.
- why: a step's parts say whose invariants it must keep, so its worker gets those pages and its reviewer checks them.
- done when:
  - `lineclear roadmap check` fails on a step still to do with no `parts` line, on an unknown part, and on a `files`
    entry outside the step's parts; a step's parts are its locks too.
  - A step's brief carries the pages of its parts, and its reviewer checks the change against their invariants and
    interfaces: breaking one is critical.
- parts: planner, rules, server
- after: L97
- files: src/roadmap.ts, src/roadmap-cli.ts, src/brief.ts, templates/brief.md, test/roadmap.test.ts, test/briefs.test.ts

### L99 A page stays true
Result: A part's page that no longer matches its code fails the check.
- why: a page that no longer matches its code misleads every worker after.
- done when:
  - `lineclear parts check`, in `bun run check`, fails when another part's code uses a name its provider's page does
    not list, or a page lists one nobody uses.
  - It fails when an owned file changed the declaration of an interface since main and the part's page did not
    change in the same change; tests plant both faults.
- parts: gates
- after: L97

### L101 Part health in measure
Result: `lineclear measure` prints a health number for each part that anyone can recount.
- why: a part's state has to be a number anyone can recount, or quality work is planned by feel.
- done when:
  - `lineclear measure` prints each part's health: files over the size limit, lines copied, open debts, and the
    stalls, review findings and flaky tests in the tasks of steps that touched it, with one score by the formula
    in `docs/architecture.md`.
- parts: measure
- after: L97

### L102 One step in five for health
Result: One plan step in five is about code health, aimed at the worst part.
- why: quality left over for later is never done; planned as steps, it is.
- done when:
  - A plan is refused when it leaves fewer health steps than one in five of the steps that name parts, and the
    roadmap was not already that short; a health step tags its part `(health)`.
  - A new health step is for a part with the worst health; tests show both rules refuse and pass.
- parts: planner, measure, rules
- after: L98, L101
- files: src/autoplan.ts, src/part-health.ts, test/autoplan.test.ts

### L106 Coverage in part health
Result: A part's health counts its test coverage, so thin tests score worse.
- why: a part whose tests cover little breaks quietly, and its health should say so.
- done when:
  - Part health in `lineclear measure` counts each part's line coverage against the floors of L83, and a test shows
    a part under its floor scores worse.
- parts: measure
- after: L83, L101

### L104 The server's copies shrink
Result: The server has at most half the copied code it has today.
- why: the server has the worst part health, most of it from lines copied between its files.
- done when:
  - The copies baseline lists at most half the lines it lists in `server/` today, each copy moved to one shared
    function, and the server's tests pass.
- parts: server (health)
- after: L88

## Phase 21: The builder's own setup folds in

Why: the builder ran a setup of their own beside the board, with its own secrets store, browser
dashboard, backups and timers. Agents' rules pointed to it, so every agent needed it. What agents need moves into
Lineclear, and the rest is decided part by part. Nothing stops before what replaces it
works.

### L107 The old setup, part by part
Result: Each part of the old setup has a verdict: moves, stays or goes, with its reason.
- why: a part that stops without a decision may be a job someone still needs.
- done when:
  - A page of docs gives each unit, script and pi extension of the old setup one verdict with its
    reason: in Lineclear (where), moves (which step), stays as personal machine setup, or goes.
- parts: install
- locks: docs
- after: none

## Phase 22: Only real questions wait for you

Why: the count of what waits for you is the owner's first look. A task on another machine that only ended its turn,
or one on a machine that no longer answers, is counted as a question, so the owner opens the Inbox and finds nothing
to answer. The count holds only what the owner can answer; the rest says what it really waits for.

## Phase 23: No task stops the merge line

Why: one task that hangs at the head of the merge line stops every merge behind it, in every project, until someone
notices. A head with nothing running under it or no progress is released by rule, the stall shows with its reason,
each machine's checks wait in a line of their own, and a question a task asks never waits unseen. L119 is the work
of LIN-199, at work as a task; its merge names `Step: L119`.

### L119 One check line per repo
Result: One project's checks no longer hold up the merges of every other project.
- why: one line of full checks for the whole machine lets a task of one project hold the merges of every other.
- done when:
  - `lineclear check` and the merge lane wait in the line of their own repo (`<config>/check-queue/<repo>`), and two
    repos never wait for each other's line; the machine's check slots stay the one limit shared by every line.
  - `server/test/check-queue.test.ts` holds the line of one repo while a check of another repo runs and lands.
- parts: server, rules
- locks: none
- after: none
- files: server/server/live/engine/check-queue.ts, server/server/live/engine/lane.ts, src/waits.ts, test/contracts/server.test.ts

### L120 A stuck lane head frees itself
Result: A merge lane stuck on one task frees itself instead of holding every merge.
- why: a head that waits on nothing holds its line for hours, as a merge left in "Rebasing on main" with no git
  process did, and every ready task behind it waits.
- done when:
  - The lane watches every step of a head (fetch, rebase, check, merge), not only the check. A head with no live
    process under it, or whose processes show no progress, for 15 minutes is released: its turn and its check slot
    end, the task leaves Merging, and the next head starts.
  - The released task is told why with `lineclear task tell` (the step it hung in and for how long) and to run
    `lineclear merge` again; the release is a `stall` line in `decisions.jsonl`. A task released twice in a row goes
    to the restart rung of the stall ladder instead.
  - A test plants the case: a head in "Rebasing on main" whose server process lives but which has no git process for
    15 minutes, with two ready tasks of another project and one of its own behind it. The head is released, the task
    behind it lands, and the released task is told why. A check that keeps using the CPU for 40 minutes is not
    released.
  - A turn holds its line for at most a limit, 30 minutes unless the project sets another; past it the turn is
    released the same way, with "over the limit" as its reason. A test shows a turn released at its limit.
- parts: server
- locks: none
- after: L119
- files: server/server/live/engine/check-queue.ts, server/server/live/engine/lane.ts, server/test/check-queue.test.ts, server/test/engine-lane.test.ts

### L126 Checks wait per machine
Result: A check waits only for checks on its own machine, not for the whole board.
- why: one server keeps one check line for every machine, so a merge whose check runs on this machine waits for
  checks that run on another, while this machine sits idle. The turn's process is the server itself, so the turn
  never drops.
- done when:
  - Each machine has its own check lines and slots in the server's store. A merge or `lineclear check` takes its turn
    and slot in the line of the machine its check runs on, and a turn of one machine never waits for a check of
    another.
  - `lineclear status` and Home name each line with its machine.
  - A test with two machines puts two long checks of the other machine in line, then a merge on this machine: it runs
    and lands at once.
- parts: server
- locks: none
- after: L120
- files: server/server/live/engine/check-queue.ts, server/server/live/engine/lane.ts, test/contracts/server.test.ts

### L122 Coordinator question not unseen
Result: A task's question reaches the coordinator chat at once and never waits unseen.
- why: a question a task asks in its coordinator chat is answered there by rule, but its card stays open and shows
  Needs you while the Inbox is empty, so the owner never sees what waits.
- done when:
  - A need card for a task in its coordinator chat is routed by the same rules as one in the task's own chat. Once a
    rule answers it, the card closes with that answer. One that no rule answers, such as a merge the task's settings
    keep for the owner, is an Inbox item in the same tick, and Home's count and the Inbox agree.
  - Answering the item answers the card, and closing the task closes both.
  - A test plants the two cards of the case: "Merge <task>?" and a question why a merge has not gone through, both
    in the coordinator chat. The first is an Inbox item; the second is answered by rule and closes; neither is left
    open with an empty Inbox.
- parts: inbox
- locks: none
- after: none
- files: src/asks.ts, src/cards.ts, src/inbox.ts, test/asks.test.ts

### L123 Merge speed measured
Result: Merges per hour and the longest lane wait are measured and shown.
- why: a goal of no stalled merge line holds only when the numbers show it, before and after.
- done when:
  - `lineclear measure` prints merges to main per hour and the longest wait of a turn in a merge line, from the
    check run log, for the days asked.
  - `docs/numbers.md` has both numbers under "Merge line", measured from main before L120.
  - Tests cover both numbers on a planted log.
- parts: measure (health), checks
- locks: none
- after: L119
- files: src/measure.ts, src/check-runs.ts, docs/numbers.md, test/measure.test.ts

### L124 Check line contract test
Result: A test fails when the check line's server and CLI sides stop agreeing.
- why: the server has the worst part health, and the check line it shares with the CLI has no contract test, so a
  change on one side can break the other unseen.
- done when:
  - `test/contracts/server.test.ts` covers what the CLI uses of `check-queue.ts`: joining and leaving a line, the
    line of a repo and of a machine, the check slots and a stuck head as L120 releases it. The server's page lists
    no missing contract test.
- parts: server (health)
- locks: none
- after: L120, L126
- files: test/contracts/server.test.ts, docs/parts/server.md

### L125 Merge in its own file
Result: The merge code lives in a file of its own, so a lane change cannot break the engine.
- why: the server has the worst part health, and the merge that L120 watches sits inside its largest file, where
  each change to the lane risks the rest of the engine.
- done when:
  - The merge (`merge`, `mergeNow`, `mergeOnGitHub`, `mergedOnGitHub`, `markMerged` and `nudgeToMerge`) moves from
    `engine.ts` to `server/server/live/engine/merge.ts`; `bun run gates --lower` lists `engine.ts` shorter,
    and the server's tests pass unchanged.
- parts: server (health)
- locks: none
- after: L120
- files: server/server/live/engine/engine.ts, server/server/live/engine/merge.ts

## Phase 25: Needs you means a question

Why: a task showed Needs you in the Inbox with no question in it, and sat there until someone looked. Three causes
lead there. The rule loop nudges an agent whose turn ended with no question only once per task, then treats every
later quiet turn as answered. The server's stall check looks only at working tasks, so a task in Needs you is never
called stuck. And a reply that says the agent goes on or waits ("I'll keep calling merge", "I set a 30-minute wait")
ends the turn just like a question would. This phase makes such a task ask one Inbox question or keep going, and the
stall ladder catch any that remain within minutes.

### L140 Every quiet turn is answered
Result: A task whose turn ends with no question gets a reply that sends it back to work, every time.
- why: a nudge that counts once per task leaves the second quiet turn in Needs you with nothing to answer.
- done when:
  - `test/asks.test.ts` plants a task that was already nudged once, then ends its turn three ways with no
    question: an empty reply, a reply that says it will keep calling `lineclear merge`, and a reply that says it set
    a wait with no wait declared. The test fails on main and passes after: each card is answered by a rule, none is
    left open.
  - Each quiet turn of a task gets the nudge, up to three in an hour; the next goes to the stall ladder's restart
    rung, and `decisions.jsonl` has a line for each.
  - A reply that promises the next action ("I'll keep calling", "I'll check again") counts as quiet, and its nudge
    says to run that action now or declare a wait.
- parts: inbox, rules
- locks: none
- after: none
- files: src/asks.ts, src/cards.ts, test/asks.test.ts, docs/stalls.md

### L141 A declared wait is not Needs you
Result: A task that waits for a merge or a check shows as waiting, not as asking you.
- why: a task that declared its wait is waiting for a time or a check, not for you, and showing it as Needs you
  hides the tasks that really do.
- done when:
  - A task with a declared `lineclear wait` whose turn ended shows its wait ("waits until 09:11", "waits for a
    check slot") on Home and the board, not "Waits for your reply", and is not in the Inbox count; a test shows it.
  - A wait for the owner (`lineclear wait owner`) still shows Needs you with its one question.
- parts: rules, server
- locks: none
- after: none
- files: src/waits.ts, src/waiting.ts, server/server/live/engine/engine.ts, test/waiting.test.ts

### L142 Silent Needs you is a stall
Result: A task that shows Needs you with no question is moved on within minutes.
- why: the stall check looks only at working tasks, so a task in Needs you with no question waits for ever.
- done when:
  - The server posts a "may be stuck" card for a task in Needs you with no open question and no declared wait after
    5 minutes, and the ladder moves it one rung per card from there; a test shows it.
  - A task with a real question, a plan to approve or a login never gets one; a test shows it.
  - It holds for every space the rule loop runs, a second machine's too (`test/second-machine.test.ts`).
  - `docs/stalls.md` names the rule.
- parts: server, rules
- locks: none
- after: none
- files: server/server/live/engine/engine.ts, src/stalls.ts, test/stalls.test.ts, test/second-machine.test.ts, docs/stalls.md

### L143 A merge in progress is seen out
Result: A task whose merge is still running is followed until it lands or says why not.
- why: a task that ends its turn while its merge is in progress holds every merge behind it in the lane.
- done when:
  - A task in Merging whose turn ended with no question is told to run `lineclear merge` again in the next tick,
    and a second quiet turn in Merging goes to the restart rung; a test shows both.
- parts: inbox, rules
- locks: none
- after: L140
- files: src/asks.ts, test/asks.test.ts

### L144 A pi turn never ends quiet
Result: A pi agent ends each turn with a question, a declared wait or a report.
- why: the rule loop answers a quiet turn a tick later; the agent's own extension can answer it at once, before the
  task ever shows Needs you.
- done when:
  - When a task agent's turn ends with no `lineclear ready`, `done`, `ask` or `lineclear wait` in it, the pi
    extension sends the same nudge as L140 into the session at once, at most twice in a row, then lets the turn end
    for the ladder; a test drives both cases.
  - A turn that asked one question or declared a wait ends with no nudge; a test shows it.
- parts: pi
- locks: none
- after: L140
- files: pi/extension.ts, test/pack.test.ts

### L145 Stall check in its own file
Result: The server's stall check lives in one file under the size limit.
- why: the server has the worst part health, and its stall check sits inside its largest file.
- done when:
  - `checkStalls` and the rules it uses move from `engine.ts` to `server/server/live/engine/stalls.ts`, with its own
    tests; the size baseline lists `engine.ts` shorter by those lines, and the server's tests pass.
- parts: server (health)
- locks: none
- after: L142
- files: server/server/live/engine/engine.ts, server/server/live/engine/stalls.ts

### L146 Task status in its own file
Result: The server's task status lives in one file under the size limit.
- why: the server has the worst part health, and the code that decides when a task shows Needs you sits inside its
  largest file, where L141 and L142 change it.
- done when:
  - `statusOf`, `subOf` and the `NEED` words move from `engine.ts` to `server/server/live/engine/status.ts`, with
    its own tests; the size baseline lists `engine.ts` shorter by those lines, and the server's tests pass.
- parts: server (health)
- locks: none
- after: L141, L142
- files: server/server/live/engine/engine.ts, server/server/live/engine/status.ts

## Phase 26: On the rails with no human

Why: a fault that stops work is found today by the owner, by hand, hours later: a restart that failed every run, an
update that left the service broken, a loop that kept reviving tasks for hours, finished tasks shown as waiting for
you, a step with nothing to merge started again, timing tests that failed every merge under load. Lineclear has to
find each of these itself, clear it, and file the fix when clearing is not enough, so it runs for months with no one
watching, on more projects and more machines.

### L112 Every stall has a class
Result: Every way a task stops moving has a name, and `lineclear stalls` shows which kind cost the most minutes today.
- why: the stall ladder sees only "no sign of life". Each other way a task stops moving is found by hand, and
  nobody can say which kind costs the most.
- done when:
  - Every way a task or a ready step stops moving has a named class with a detector in plain code: signed out,
    account full, revive loop, idle after done, main red (the merge check fails on main), lock held too long, no
    room, no sign of life, brief never sent, roadmap broken, a command that fails, a machine out of reach, a
    head-of-line block across projects (one project's step holds the shared check and merge line), a merge result lost
    (a merge queued for two hours), coordinator gone, and unknown for a reason no class names.
  - A stall is recorded in `decisions.jsonl` with its class when it passes its class's time limit, its remedy with
    the minutes from the stall, and its end with the minutes it cost.
  - `lineclear stalls` prints the stalls of the last day by class with the minutes lost, `/api/stalls` gives the
    same to the live picture, and the loop keeps one summary line a day.
  - Tests plant each class and check its record.
- parts: rules
- after: none

### L113 Lineclear files its own bugs
Result: A stall that comes back, or has no class, becomes one fix task on the roadmap with its evidence, at most 3 a day.
- why: a remedy clears one stall. When the same class comes back, or a stall has no class, the cause is in
  Lineclear and only a change to it ends it.
- done when:
  - Each class names its automatic remedy in the stall ladder, and the ladder runs it: a revive loop is told once to
    carry on instead of revived again, a task whose step is merged is closed, a held lock reminds its holder.
  - An unknown stall, or a known one seen twice in 24 hours, starts one planning task on Lineclear's own project
    with a title, the result it must reach and the evidence. A hard cap: at most one open per class and at most 3
    filed in any 24 hours in all, so Lineclear cannot fill its own roadmap with fixes or spend its tokens on itself.
  - A test plants a new stall and finds exactly one fix filed, however many ticks see it; a test stalls five classes
    and finds 3 filed in the day.
- parts: rules, planner
- after: L112

### L117 Running or Paused
Result: Each project has one Running or Paused switch, and the word Autopilot is gone.
- why: Autopilot was the old board's coordinator timer and is off everywhere, but the word stays and means two
  things. A project either has its next steps started by the rules or it does not.
- done when:
  - A project is Running or Paused. One switch on its track sets it, `lineclear project set <name> --paused
    on|off` too, and the rules start nothing in a Paused project.
  - The update's check keeps each project's Running or Paused as it was, and the word Autopilot is gone from
    Lineclear's docs, CLI and pages. The old board's coordinator timer can no longer be turned on.
- parts: rules, ui, install
- after: none
- locks: line, settings
- files: src/rules.ts, src/doctor.ts, ui/web/

### L118 A merge waits for its own result
Result: One `lineclear merge` call ends merged or stopped with a reason, so a ready step never waits on a retry.
- why: `lineclear merge` gives up after 90 s and tells the agent to run it again. Agents end their turn instead,
  and a ready step waits until someone looks: the stall "agent stops retrying the merge" was seen twice.
- done when:
  - `lineclear merge` waits until its merge is through, merged or stopped with a reason, however long the shared
    check line is, and says which. The agent never retries by hand.
  - A merge whose result is lost still ends as merged or stopped, and the task's status says which.
  - A test plants a merge that waits behind a long check and gets its result in one call.
- parts: server
- after: none

### L148 Agent helpers out of agents.ts
Result: The server's agent start and resume rules live in one file under the size limit.
- why: the server has the worst part health, and `agents.ts` is over the size limit with plain functions beside
  its one class.
- done when:
  - `isolatedReady`, `isolatedShell`, `carryClaudeSession`, `statusFrom`, `holdFrom` and `canResume` move from
    `agents.ts` to `server/server/live/agent-start.ts`, with its own tests; the size baseline lists `agents.ts`
    shorter by those lines, and the server's tests pass.
- parts: server (health)
- locks: none
- after: none
- files: server/server/live/agents.ts, server/server/live/agent-start.ts

### L158 A late task is not called silent
Result: A task past its own time estimate gets its own stall class, not the no-sign-of-life ladder.
- why: the rule loop reads every "may be stuck" card as no sign of life, so a task that is busy but late is
  reminded as if it were silent, and the record names the wrong cause.
- done when:
  - A "may be stuck: past its time left" card records the class `late`, with its own remedy: the agent is asked for
    a new estimate once, and the ladder climbs only if no status comes; a test plants both cards and checks each class.
  - Only a "may be stuck: quiet for" card records no-sign-of-life and climbs with "no sign of life"; a test shows it.
  - `docs/stalls.md` names the class.
- parts: rules
- locks: none
- after: none
- files: src/stall-class.ts, src/stalls.ts, test/stall-class.test.ts, test/stalls.test.ts, docs/stalls.md

### L157 One board server per data folder
Result: A second board server on the same data folder refuses to start and names the one that runs.
- why: two servers on one data folder each keep their own task list. The one an agent does not report to sees no
  life and calls a working task stuck, so the ladder reminds an agent that was busy all along.
- done when:
  - The server takes a lock on its data folder. A second one on the same folder, on any port, exits at
    once with a line that names the port and process that hold it; a test starts two and shows it.
  - A server whose lock holder died starts as usual; a test shows it.
  - A test plants the stall of LIN-231: two servers on one folder, a task that reports its status to one, and the
    other's stall check. It fails on main (the other posts "may be stuck") and passes after (no second server, no card).
  - `decisions.jsonl` has no no-sign-of-life stall in the day after this step merges for a task that reported its
    status or wrote its log in the 20 minutes before it.
- parts: server
- locks: none
- after: L158
- files: server/server/main.ts, server/server/store.ts, server/test/store.test.ts

### L159 A lock ends with its holder
Result: A lock is held only by a step's own task while it moves, so no step waits hours on a lock nobody uses.
- why: a step holds its locks while any open task has a title that starts with its id, even one that waits, sleeps
  or was never started for it. The reminder reaches only a working holder, so most of these stalls get no remedy.
- done when:
  - A step holds its locks only through the task the rules started for it (L147's record), never through a title.
  - A holder that has not moved past the lock's limit gets its own class's remedy (revived, closed when its step is
    merged, or a stall for the owner), and the lock-held remedy finds its holder from that record in any state.
  - A test plants the stall: a lock held by a task that is not working. It fails on main and passes
    after: the waiting step starts once the holder is closed, or the holder gets its remedy within one tick.
  - `decisions.jsonl` has no lock-held stall in the day after this step merges.
- parts: rules, planner
- locks: none
- after: L147
- files: src/roadmap.ts, src/rules.ts, src/stall-ladder.ts, src/stall-class.ts, test/stall-class.test.ts

### L160 The track's plans can be checked
Result: The test track's plan reaches main, and a plan whose step check cannot run is a recorded stall, not a quiet wait.
- why: the track keeps only the two cheapest models, often from one company, so the step check of L62 refuses its
  plan. The planner then waits as Ready to merge, which no stall check watches, and the run breaks with no cause.
- done when:
  - `trackProject` in `src/track.ts` adds to the track's reviewer list the cheapest reviewer of the self project
    whose company differs from the track's planner. A test shows `pickChecker` then finds a checker.
  - When the self project has no such reviewer, `lineclear track` stops at the request stage with the class
    `command-failed` and a line that says so; a test shows it.
  - When the step check cannot run, `lineclear plan submit` appends a `stall` line with the class `command-failed`
    and the task's id to `decisions.jsonl`; a test with no checker shows the line.
  - `track.jsonl` has no run that broke at plan with the class `no-sign-of-life` in the day after this step merges.
- parts: install, planner
- locks: none
- after: none
- files: src/track.ts, src/plan.ts, test/track.test.ts, test/plan.test.ts

### L161 Every held lock gets a remedy
Result: A lock held past its limit gets a remedy fit for its holder's state, so a waiting step starts within a day.
- why: the lock-held remedy reminds only a holder at work. A holder that waits, is queued or whose step is merged
  gets nothing, so the same lock stays held for hours and the stall comes back each tick.
- done when:
  - The lock-held remedy in `src/stall-ladder.ts` finds the holder as `stepStatuses` does (an open task whose title
    starts with the step id), in any status, not only `work`. It acts by status: `work` is reminded; a holder whose
    step is merged is closed; `need` with none of an open question, plan or declared owner wait, and `queued`, are
    told to resume; a holder that waits for the owner gets no tell, and its stall's reason says "waits for the owner".
  - Each remedy runs once per stall, as the ladder's other remedies do: the stall's entry in the rule loop's state
    file marks it done, so a restart or the next tick does not repeat it; a new stall after that one ends runs again.
  - A test in `test/stall-class.test.ts` plants lock 'server' held by L130 through, one at a time, a `work` task, a
    `queued` task, a `need` task with no question, a `need` task with an open question, and a task whose step is
    merged. On main only the first gets a remedy; after, each gets its own action above in one tick, and a second
    tick and a reloaded state send nothing more.
  - `docs/stalls.md` says the lock-held remedy for each holder status.
  - In `decisions.jsonl` for the day after this step merges, each lock-held stall has its remedy line from the same
    tick, or a reason that says "waits for the owner": no lock-held stall is left with no remedy.
- parts: rules
- locks: none
- after: none
- files: src/stall-ladder.ts, src/stall-class.ts, test/stall-class.test.ts, docs/stalls.md

## Phase 27: The Dispatcher always answers

Why: the Dispatcher is the owner's one point of contact, yet it gets stuck inside work: a merge that waits, a failed start (a herdr `tab.create` timeout) it re-adds by hand, a plan command that calls a dead default server. While it is busy the owner's message waits. The Dispatcher must answer within seconds, whatever else runs. L178 and L179 come first: the line has started the same step twice. The findings of the task "Research: dispatcher flow" are merged into these steps when that file is on main.

## Phase 28: Any model, any harness

### L197 Scales checklist in checks
Result: The step check applies a short Scales checklist to every plan and every merge, and a finding blocks with its reason.
- why: oversights like a whole-part lock, a process listing per dead route or a step done with no proof are cheap to stop before merge and costly to find later.
- done when:
  - `docs/design.md` has a section "Scales" with one line each for: works with N machines and N projects, any model and harness, 10x the data (tasks, routes, steps), no global or whole-part lock where a finer one works, no polling or spawning per tick that grows with history, no fallback for a state that no longer exists.
  - `src/stepcheck.ts` puts that section into the question of every step check; a test reads the question and finds all six lines in it.
  - A Scales finding in the checker's answer is a no-go that names the line it broke; a test with a planted answer shows the no-go and its reason.
  - The merge check applies the same section to the diff; a test with a planted whole-part lock in a diff fails the merge with the Scales reason.
- parts: planner, ui
- locks: stepcheck, design-doc
- after: none
- files: src/stepcheck.ts, src/plan.ts, test/stepcheck.test.ts, docs/design.md

### L198 Model registry from harnesses
Result: Lineclear lists the models every installed harness offers, so a model that did not exist yesterday is known today.
- why: a hand-kept list of model names is wrong the day a provider ships a new one; the harnesses already say what they offer.
- done when:
  - `src/models.ts` exports `readRegistry()`: it runs `pi --list-models` and each other installed harness's own listing and returns one entry per model with its harness, provider and name.
  - A harness that is not installed or fails adds no entries and no error to the others; a test with a fake harness that exits 1 shows it.
  - A test with a fake listing that names a model not found anywhere in the repo returns that model.
- parts: core
- locks: models
- after: none
- files: src/paths.ts, docs/parts/core.md

### L199 Model file for company, cost
Result: The owner can edit one file that gives a model its company, tier and cost; a model not in it still works.
- why: a name cannot reliably tell the company, the tier or the price, and a guess from the name breaks on every new family.
- done when:
  - `models.json` in the data folder holds optional `company`, `tier` and `cost` per model or per provider, and `src/models.ts` merges it over the registry; a test shows an override and a model with no entry.
  - A model with no company is its provider's own company group, never the last rank; a test shows two unknown models from different providers count as different companies.
  - A malformed file is reported by `lineclear doctor` and ignored for the rest; a test shows both.
- parts: core, install
- locks: models
- after: L198
- files: src/paths.ts, src/doctor.ts, test/doctor.test.ts

### L200 Ranking from the registry
Result: A new model family joins its project's workers and reviewers with the right company and rank, with no code change.
- why: `company()` and the family regexes rank an unknown family last or ungrouped, which breaks reviewer independence.
- done when:
  - `company()` in `src/project.ts` and `FAMILIES` and `LESSER` in `src/add-project.ts` are gone; both read company and tier from the registry of `src/models.ts`.
  - A test adds a fake model of a new family and a new provider: it ranks by its tier and a reviewer of another company is picked for its work.
  - The existing `test/add-project.test.ts` and `test/project.test.ts` pass with their fixtures moved to a registry fixture.
- parts: core, install
- locks: models
- after: L199
- files: src/project.ts, src/add-project.ts, test/project.test.ts, test/add-project.test.ts

### L201 Server models from registry
Result: The server offers every model the registry knows and has no built-in default.
- why: `TABLE` in `server/server/live/models.ts` lists Claude and Codex models by hand with a Claude default, so any other model is missing.
- done when:
  - `server/server/live/models.ts` builds its list from the registry's output and has no model names and no default model.
  - A test with a registry of one fake non-Anthropic model shows it in the list and a start with no model set refuses with a line that says to choose one.
  - The server's `bun test` passes.
- parts: server
- locks: models
- after: L199
- files: server/server/live/models.ts, server/test/models.test.ts

### L202 Quota through adapters
Result: Each account's quota comes from an adapter, and one with no adapter shows unknown, never unlimited.
- why: `src/quota.ts` knows only three providers, so any other account has no quota and the pace gate cannot see it.
- done when:
  - `src/quota.ts` has an adapter interface (`read(account)` returns used, limit and reset, or `unknown`) and the Claude, Codex and OpenCode Go readers are adapters behind it.
  - An account with no adapter gets the `unknown` adapter: it counts the account's own calls and 429 answers since its last reset; a test shows both counts.
  - The pace gate never treats `unknown` as unlimited: a test with an unknown account that returned three 429s in a row makes the gate hold new work for it until its next reset.
  - A new adapter is one file and one registration line; a test registers a fake one and the gate uses it.
- parts: rules
- locks: quota
- after: none
- files: src/quota.ts, src/model-use.ts, test/quota.test.ts

### L203 Harness interface, pi adapter
Result: A harness is one interface (start, session reader, stall signals, usage) and pi is its first adapter.
- why: about twenty places in `src/` read `~/.pi/agent/sessions`, so the core assumes pi and no other harness can be added.
- done when:
  - `src/harness.ts` exports the interface and `src/harness-pi.ts` implements it; a contract test in `test/contracts/harness.test.ts` runs any adapter through start, read a session, name a stall signal and read usage.
  - Every read of `~/.pi/agent/sessions` in `src/` goes through the interface; a test greps `src/` and fails on a path to that folder outside `src/harness-pi.ts`.
  - The existing tests that read a pi session pass unchanged.
- parts: core, pi, rules, measure
- locks: harness
- after: none
- files: src/stalls.ts, src/session-text.ts

### L204 Three more harness adapters
Result: Claude Code, Codex and OpenCode run a task as harnesses beside pi, each behind the same interface.
- why: the interface is proven only when more than one harness passes the same contract.
- done when:
  - `src/harness-claude.ts`, `src/harness-codex.ts` and `src/harness-opencode.ts` each implement the interface of `src/harness.ts`.
  - The contract test of L203 runs against each of the three with a fake binary and a recorded session file, and passes for all.
  - A harness not installed is left out of the registry of L198 and fails no test.
- parts: core
- locks: harness
- after: L203, L198
- files: src/paths.ts, src/cli.ts

### L205 No model names in code
Result: A model name written in code outside test fixtures fails `bun run gates`, so nothing is tuned to today's models.
- why: a rule that is only a habit is broken by the next quick fix; a gate keeps the system free of any one company.
- done when:
  - A gate in `scripts/gates/` fails on a model name of any known family in a `src/`, `server/` or `ui/` file outside `test/` fixtures and the docs; its baseline is empty.
  - A test plants a file with a model name and the gate fails on it with the file and line.
  - `bun run gates` passes on main with the baseline empty.
- parts: gates
- locks: none
- after: L200, L201, L202, L203
- files: scripts/gates/code-rules.ts, scripts/gates/baseline/, test/gates.test.ts

### L206 First-run setup in the CLI
Result: `lineclear setup` finds the logged-in harnesses and accounts and lets the owner choose a model per role.
- why: models are picked today by a ranking at project add, so the owner never chooses and a new account is not seen.
- done when:
  - `lineclear setup` lists the harnesses and accounts that are logged in (from L198 and L202) and asks for a model for each role: worker, reviewer, planner and step checker; no role has a built-in default.
  - The choice is saved in the settings of `src/project.ts`; a test with two fake harnesses saves a choice and reads it back.
  - Until a role is chosen, `lineclear run` and `lineclear add` stop with a line that points to `lineclear setup`; a test shows it.
  - A reviewer chosen from the same company as the worker is refused; a test shows it.
- parts: core, install
- locks: models
- after: L200, L204
- files: src/cli.ts, src/project.ts

### L207 First-run setup in the web UI
Result: The first run of the web UI shows the logged-in harnesses and accounts and lets the owner pick models per role.
- why: an owner who works from a phone or tablet has no terminal for the setup, and Settings only reorders.
- done when:
  - A first-run view lists the harnesses and accounts found and a model choice per role, with no preselected model, and saves through the same code as L206; `bun run ui:test` has a spec at 390 and 1440 px.
  - Every state of the UI bar is drawn: nothing found, loading, a failed read, a long model name and 200 models.
  - Settings shows the same choice per role and edits it afterwards; a spec changes one and reads it back.
- parts: ui
- locks: settings
- after: L206
- files: ui/web/setup.tsx, ui/web/settings-models.tsx, ui/test/setup.pw.ts

### L208 Track on a third-company model
Result: A test track runs from request to merge on a fake provider of a third company, proving nothing depends on one company.
- why: only a full run on a company that is not built in shows that the system, not the model list, does the work.
- done when:
  - `lineclear track` can run with a fake provider whose models are in no list in the repo; it is declared only in a registry fixture and `models.json`.
  - The run goes from request through plan, work, review and merge with every role on that provider and its reviewer on a second fake provider; a test checks the merge on main.
  - The run reports its quota as `unknown` and the pace gate holds when the fake provider returns 429.
  - No file in `src/` or `server/` is edited to add the provider; a test fails if the diff of the fixture touches either.
- parts: install
- locks: track
- after: L205, L206
- files: src/track.ts, test/track.test.ts

### L209 Check step log stays bounded
Result: The check's step log keeps a bounded number of lines, so a long-running machine never grows it without end.
- why: `check-steps.jsonl` is appended on every run and never trimmed, and the Scales checklist says no data file may grow with history.
- done when:
  - `recordStepTimes` in `src/check-runs.ts` keeps at most 5000 lines, the newest; a test appends 6000 lines and finds 5000, the last one the newest.
  - `fullCheckPassed` still finds a passed full check among the kept lines; a test shows it after a trim.
- parts: checks (health)
- locks: none
- after: none
- files: src/check-runs.ts, test/contracts/checks.test.ts

### L210 Quarantine knows a test by file
Result: A flaky test is quarantined by its file and name, so a same-named test in another file keeps running.
- why: quarantine matches a test by its name only, so one flaky test can silence an unrelated healthy test of the same name.
- done when:
  - The quarantine record in `src/check-runs.ts` stores the file with the name; a test quarantines `a.test.ts` "works" and finds `b.test.ts` "works" still runs.
  - The second debt in `docs/parts/checks.md` is removed.
- parts: checks (health)
- locks: none
- after: none
- files: src/check-runs.ts, test/contracts/checks.test.ts, docs/parts/checks.md

### L211 Tier names its budget fault
Result: A run that goes over its tier's budget on an idle machine says it is a fault of the check, in the check log.
- why: a slow check slows every merge, and a log line that names the cause lets the rule loop file a fix instead of rerunning.
- done when:
  - `src/check-tier.ts` writes a `budget` line with the tier, the limit and the time to `check-runs.jsonl` when an idle-machine run goes over; a test with a fake clock shows it.
  - A busy machine's run writes no such line; a test shows it.
- parts: checks (health)
- locks: none
- after: none
- files: src/check-tier.ts, src/check-runs.ts, test/contracts/checks.test.ts

## U39 minor findings

### U70 Home line fits at 1440 px
Result: The Home line shows its right end in full at 1440 px.
- why: the U39 review found the line's right end cut off, so the last station is unreadable on a desktop.
- done when:
  - A test in `bun run ui:test` opens Home at 1440 px and checks that the line's right edge is inside the viewport and its last station is fully visible.
  - Screenshots before and after at 1440 px are on the pull request.
- parts: ui
- locks: home
- after: none
- files: ui/web/home.tsx, ui/kit/line.tsx, ui/kit/kit.css, ui/test/home.pw.ts

### U72 Targets and empty repo row
Result: Touch targets at 768 px are at least 48 px, and the first-project card keeps its repo row when it has no repos.
- why: the U39 review found 44 px targets at 768 px, and the card's repo row collapsing to nothing when no repo is added.
- done when:
  - A test in `bun run ui:test` measures every tap target at 768 px and fails on one under 48 px.
  - A test renders the first-project card with no repos and checks that the repo row keeps its height and shows an add-repo target of 48 px or more.
- parts: ui
- locks: kit
- after: none
- files: ui/kit/project.tsx, ui/kit/kit.css, ui/test/kit.pw.ts

### U73 Board frames at 768 and 2560 px
Result: The design board's frames follow the Home direction and include a 768 px and a 2560 px frame for each view.
- why: the board is the target of the U39 review, but its frames predate the Home direction and lack two of the four widths.
- done when:
  - Every view in `docs/design/board.html` has frames at 390, 768, 1440 and 2560 px, and the Home frames show the Dispatcher chat as Home.
  - A test reads the board and fails when a view lacks one of the four widths.
- parts: ui
- locks: board
- after: none
- files: docs/design/board.html, ui/test/frame.pw.ts

### L163 Check log covers check --changed
Result: A `lineclear check --changed` run is written to the check log with its time, commit and load.
- why: the check log is the only source of check counts, and one way of running a check leaves no record.
- done when:
  - A test in `test/contracts/checks.test.ts` runs `lineclear check --changed` in a temp repo and finds one line in `check-runs.jsonl` with its time, commit and load.
  - The first debt in `docs/parts/checks.md` is removed.
- parts: checks (health)
- locks: none
- after: none
- files: src/check-runs.ts, src/check-tier.ts, test/contracts/checks.test.ts, docs/parts/checks.md

### L196 The helper script stands alone
Result: `server/helper/lineclear` no longer carries the guard for helper copies that lack `route.pl`.
- why: the install puts `lineclear` and `route.pl` on a machine together and replaces both on a version change, so the "older copies still work alone" branch serves a state no machine is in.
- done when:
  - `server/helper/lineclear` requires `route.pl` without the `-f` test, `server/test/cli.test.ts` copies `route.pl` beside `lineclear`, and it passes.
- parts: server
- locks: none
- after: none
- files: server/helper/lineclear, server/test/cli.test.ts

### L215 Locks age and are checked
Result: A step that locks wait too long gets its locks first, and a task that touches a file outside its step is refused at merge.
- why: a step with no files waits for every file-locked step in its part and can starve, and `files` is only a hope (red-team F7).
- done when:
  - A step skipped for locks in 10 ticks reserves its needs, and no newer narrower step takes them.
  - The merge check fails when the diff leaves the step's files and parts, and names the path.
  - Tests: a broad step among a stream of narrow ones starts within 10 ticks; a task with an undeclared file is refused.
- parts: planner, rules, gates
- locks: none
- after: none
- files: src/held.ts, src/starts.ts, src/tick-project.ts, src/rules.ts, src/parts.ts, src/parts-check.ts, test/starts.test.ts
### L230 Spaces migration out
Result: The server starts without `live/migrate.ts`, and a fresh store gets its `spaces.json` from the code that owns it.
- why: the migration moved coordinators and files of a version no store has now; on a migrated store it returns on its first line.
- done when:
  - `live/migrate.ts`, its call in `live/places.ts`, the `projects` fallback in `live/settings-store.ts` and `test/migrate.test.ts` are gone.
  - A fresh store and a store that has `spaces.json` both start; a test shows each.
  - Each machine's `spaces.json` is a list before the migration is deleted (one `head -c 1` per machine).
- parts: server
- locks: none
- after: none
- files: server/server/live/migrate.ts, server/server/live/places.ts, server/server/live/settings-store.ts, server/test/migrate.test.ts

### L231 Old settings words out
Result: `Settings` reads only today's keys and values.
- why: the heartbeat interval keys, round-count review values and old merge words were rewritten on the first start; nothing writes them now.
- done when:
  - `upgrade()`, `heartbeats()` and `OLD_VALUES` are gone from `live/settings-catalog.ts` and `live/settings-store.ts`, with their tests.
  - A settings file holding an old key loads with the key dropped, and a test shows it.
- parts: server
- locks: none
- after: none
- files: server/server/live/settings-catalog.ts, server/server/live/settings-store.ts, server/test/settings.test.ts

## Phase 29: Findings of the critical analysis

Why: a measurement found: context is read again on every call, review cost is not
measured, most red merge checks name no cause, and the Dispatcher's session and the task briefs only grow.

## Phase 30: The three goals hold

Why: L57 measured three goals of `docs/idea.md` as unmet: 3 asks on the newest day, a median wait from ready to start of 112 to 929 min, and $2.07 per merged step against a goal of $1.18. The wait is the largest gap, so it comes first. Each measure step finds the cause on real data and the next step fixes it, so no fix is guessed.

### L234 Each wait names its cause
Result: `lineclear measure` splits the wait from ready to start by cause: lock, part, check slot, machine load, quota or no tick.
- why: a median of hours has no fix until the share of each cause is known.
- done when:
  - For each started task, `lineclear measure <project> --since <date>` adds the minutes the step waited on each cause,
    read from the decision log and the lock and slot files. Minutes with no recorded cause are named as such.
  - A test on a fixture of three steps, each held by a different cause, prints the hand-counted minutes.
  - `docs/numbers.md` under "L234" lists the causes of the L57 days, largest first.
- parts: measure
- locks: measure-wait
- after: none
- files: src/measure.ts, src/measure-main.ts, test/measure.test.ts, docs/numbers.md

### L235 A free step starts in one tick
Result: A ready step whose locks, slots and load are free starts within one tick of the rule loop.
- why: any wait with no blocker is lost time, and one tick is the least a loop can add.
- done when:
  - A test with free locks, a free slot and an idle machine finds the start decision in the tick that sees the step
    ready, not a later one.
  - `lineclear measure` shows no wait over one tick for a step with no recorded cause.
- parts: rules
- locks: starts
- after: L234
- files: src/starts.ts, src/rules.ts, test/rules.test.ts, docs/parts/rules.md

### L236 Quota waits use another account
Result: A step whose model account is out of quota starts on the next account of its role's list, not at the reset.
- why: Settings keeps an ordered model list per role so that one account running out never holds work.
- done when:
  - A test with the first account at 100 % finds the start on the second account, and a start at the reset time only
    when every account of the list is out.
  - The decision log says which account the step started on and why.
- parts: rules
- locks: accounts
- after: L234
- files: src/starts.ts, src/quota.ts, test/quota.test.ts, docs/parts/rules.md

### L237 Closed tasks free their locks
Result: A lock or part held by a task that is merged, closed or dead is freed in the same tick, so steps behind it start.
- why: a lock guards one real resource and lasts only as long as it is needed (principle 4).
- done when:
  - A test holds a part with a merged task and finds the next step on that part started in the next tick.
  - `lineclear measure` shows the median minutes a lock is held after its task ends, goal 0 within one tick.
- parts: rules, measure
- locks: starts, measure-wait
- after: L234
- files: src/starts.ts, src/measure.ts, test/rules.test.ts, docs/parts/rules.md

### L238 Wait goal checked after a merge
Result: The heavy run writes the median wait from ready to start of the last 3 days and fails when it is 5 min or more.
- why: a goal without a check slips back unseen.
- done when:
  - `bun run heavy` appends the median and each day's count to `docs/numbers.md` under "L238" and exits non-zero at
    5 min or more, naming the largest cause from L234.
  - A test on a recorded fixture passes at 4 min and fails at 6 min.
- parts: measure, gates
- locks: heavy
- after: L235, L236, L237
- files: scripts/heavy.ts, src/measure.ts, test/measure.test.ts, docs/numbers.md

### L239 Cost per step is split by cause
Result: `lineclear measure` splits the cost of a merged step into work, review rounds, step check, rework and idle context.
- why: $2.07 against $1.18 needs the share of each part before any saving is chosen.
- done when:
  - The split is read from the pi session files of each task and sums to the cost per merged step within 1 %, with a
    test on a fixture of two tasks counted by hand.
  - `docs/numbers.md` under "L239" lists the shares for the L57 days and names the two largest.
- parts: measure
- locks: measure-cost
- after: none
- files: src/measure.ts, src/measure-sessions.ts, test/measure.test.ts, docs/numbers.md

### L240 Routine steps run cheap
Result: A step marked routine by rule (docs only, a rename, a baseline lowering) starts on the cheap worker model.
- why: routine work goes to a cheap model (principle 9), and a step needs no strong model to change a table.
- done when:
  - A rule marks a step routine from its files (only `docs/`, tests or a baseline) and a test finds the cheap model in
    its start; any other step keeps the worker model of Settings.
  - A routine step that fails its check twice moves to the worker model, shown in the decision log.
- parts: rules, planner
- locks: models
- after: L239
- files: src/starts.ts, src/model-use.ts, test/model-use.test.ts, docs/parts/rules.md

### L241 Reviews stay within their rounds
Result: A review round that finds nothing to fix ends the review, and a task never runs a third round.
- why: each extra round resends the whole context, and the largest cost share from L239 is likely this.
- done when:
  - A test with a clean first round finds no second round and a test with findings stops at the set limit.
  - `lineclear measure` shows review rounds per merged step, and the median does not rise on the L57 days.
- parts: rules, measure
- locks: review-rounds, measure-cost
- after: L239
- files: src/tick-project.ts, src/measure.ts, test/starts.test.ts

### L242 Cost goal checked after a merge
Result: The heavy run writes the cost per merged step of the last 3 days and fails when it is above $1.18.
- why: the goal is at least 15 % below the pilot's $1.39, and only a figure after a merge shows a slip.
- done when:
  - `bun run heavy` appends the cost and step count to `docs/numbers.md` under "L242" and exits non-zero above
    $1.18, naming the largest share from L239.
  - A test on a fixture passes at $1.10 and fails at $1.30.
- parts: measure, gates
- locks: heavy
- after: L238, L240, L241
- files: scripts/heavy.ts, src/measure.ts, test/measure.test.ts, docs/numbers.md

### L243 Each ask is named by its kind
Result: `lineclear asks --days 1` lists each ask of the day with its kind and the rule that should have answered it.
- why: 3 asks a day needs the cause of each one before a rule is written.
- done when:
  - The list counts cards of the Inbox and of every board's chat files, and a test on a fixture of five cards prints
    the hand-counted kinds.
  - `docs/numbers.md` under "L243" names the three asks of the newest L57 day and the kind of each.
- parts: inbox, measure
- locks: asks
- after: none
- files: src/asks.ts, test/asks.test.ts, docs/asks.md, docs/numbers.md

### L244 Rules answer each ask kind
Result: Each kind of ask named in L243 that a rule can answer is answered by a rule, and a kind that cannot is a task.
- why: the Inbox holds only a login, money or something that leaves the machine (principle 11).
- done when:
  - Every kind named in `docs/numbers.md` under "L243" has a rule in `docs/asks.md` with a test that plants it and
    finds no card reaching the owner, or a filed task (LIN-163) with its id in that file.
- parts: inbox, rules
- locks: asks
- after: L243
- files: src/asks.ts, src/rules.ts, test/asks.test.ts, docs/asks.md

### L245 Ask goal checked after a merge
Result: The heavy run fails when a day has 3 asks or more, and names each card.
- why: the goal is under 3 asks a day, and a check that fails on any other ask is open in principle 11.
- done when:
  - `bun run heavy` counts the asks of the last 3 days with work, appends them to `docs/numbers.md` under "L245"
    and exits non-zero at 3 on any day.
  - A test passes at 2 and fails at 3.
- parts: measure, gates, inbox
- locks: heavy
- after: L244, L242
- files: scripts/heavy.ts, src/asks.ts, test/asks.test.ts, docs/numbers.md

### L247 The check log holds slot waits
Result: Each run in the check log records the minutes it waited for a check slot, and `lineclear check` prints them.
- why: a wait for a slot is one cause of the wait before a merge, and the check log is where anyone can recount it.
- done when:
  - A run that waited behind another writes `slotWaitMin` to `check-runs.jsonl`, and a test with two runs on one slot
    finds the second one's wait within 1 s of the first one's duration.
  - A run that did not wait writes 0.
- parts: checks (health)
- locks: check-log
- after: none
- files: src/check-runs.ts, test/contracts/checks.test.ts, docs/parts/checks.md

### L248 The check log holds start load
Result: Each run in the check log records the machine load at its start, and `lineclear check` prints it with the time.
- why: a slow run on a busy machine is not a fault of the change, and the log must show which it was.
- done when:
  - A run writes `loadAtStart` to `check-runs.jsonl`, and a test with a faked load of 6 finds 6 in the run's line.
- parts: checks (health)
- locks: check-log
- after: L247
- files: src/check-runs.ts, test/contracts/checks.test.ts, docs/parts/checks.md

### L249 Check runs show their commit
Result: `lineclear check` prints the commit of each logged run beside its time, so a slow run is traced to its change.
- why: the check log keeps the commit of every run, and a time with no commit cannot be traced.
- done when:
  - `lineclear check --log` prints the short commit, time, slot wait and start load of the last 10 runs, and a test
    on a log of three runs finds each commit in the output.
- parts: checks (health)
- locks: check-log
- after: L248
- files: src/check-runs.ts, test/contracts/checks.test.ts, docs/parts/checks.md

### L260 A sent brief starts its agent
Result: A task's agent answers its brief on its own: the brief is never left unsent in the pane, and the nudge never types over it.
- why: three starts in one day sat with the brief in the pane and no answer; the nudge typed more text into a pane that still held the unsent brief, so one stuck Enter stalled the task.
- done when:
  - The server's submit step (`submitted` in `server/server/live/agents-state.ts`) presses Enter again until the agent works or the pane's input is empty, and the start ladder in `src/starts.ts` reads a pane that still shows the pasted brief and presses Enter only, never typing text on top of it.
  - A test plants the stall: a fake pane that swallows the first Enter and holds the brief unsent. It fails on main (the agent never answers, the ladder types the nudge) and passes after (the agent answers, no nudge text is typed).
  - `decisions.jsonl` in Lineclear's config folder (`$LINECLEAR_CONFIG`, else `~/.config/lineclear/`) has, in the day after this step merges, no line of the class `brief-unsent` (a "stall brief-unsent" line or a "typed its brief nudge" line).
- parts: rules, server
- locks: starts, server
- after: none
- files: src/starts.ts, test/starts.test.ts, server/server/live/agents-state.ts, server/test/agent-start.test.ts

### L265 Tests never stop a real herdr
Result: Running the tests never stops the herdr that runs your agents, so no agent dies while a test suite runs.
- why: `restartHerdr` in `src/herdr-world.ts` signals every herdr server it finds in /proc that is outside one unit, so a test that fakes the unit kills the real herdr.
- done when:
  - `herdrWorld` takes the pids it may stop as an argument with no default: `src/real-world.ts` passes the herdr servers of this install found in /proc, and `restartHerdr` signals only a pid that passes it.
  - A server in any unit of `UNITS` (`herdr.service` or `lineclear-herdr.service`) counts as in the service, so the real install never stops the herdr of the other unit.
  - The test in `test/herdr-health.test.ts` that stops a server outside the service passes in only the pid of the server it spawned, and a new test with a second spawned server left off the list finds it still running after `restartHerdr`.
  - A guard test runs the herdr tests with `process.kill` wrapped and fails when a signal goes to a pid the test did not spawn.
  - On the owner's machine, `systemctl --user show herdr.service -p NRestarts` reads the same before and after one `bun scripts/check.ts --full`, and `~/.config/systemd/user/herdr.service.d/zz-sigtrace.conf` is removed.
- parts: rules
- locks: herdr
- after: none
- files: src/herdr-world.ts, test/herdr-health.test.ts, src/real-world.ts

### L285 A flaky test passes under load
Result: The install test "a second install changes no file" passes on a loaded machine, by a fix of its cause.
- why: a test that fails only under load blocks merges of unrelated branches, and a retry would hide the cause.
- done when:
  - The test is "a second install changes no file" in `test/install.test.ts`, named from the red merge-tier runs in `check-runs.jsonl` (cause `unnamed`) and from `bun test` on main; the name goes in the commit message.
  - The root cause is fixed: `install.sh` runs under bun's 5 s default test timeout, which does not scale with load, so the first install times out and the second one then fails on the half-made repo. The file sets a timeout that scales with `loadavg` per core. No retry, no skip, no quarantine.
  - The file passes 20 times in a row while 8 busy loops (`yes > /dev/null`) run beside it, and the same run fails on main before the fix.
- parts: install
- locks: install-test
- after: none
- files: test/install.test.ts

## Phase 31: Development gets cheaper

Why: in 12 hours of one busy machine, checks ran at a load factor of 4 to 5, so a 30 s changed-only check took 120 s; 69 of 108 failed merge checks named no failing test and were retried; 25 full checks ran mostly from a release run that retried a red main every 2 minutes; about 200 task starts gave about 60 merges. No check gets weaker: each step removes a cost that is not a check.

### L300 An unnamed failure is rerun once
Result: A merge check that ends with no named failure is rerun once at low load, is never counted as a refused merge and never sends the task back.
- why: a timeout, a kill or a loaded machine says nothing about the change, so refusing the task for it wastes a round.
- done when:
  - A merge-lane run whose red verdict has no named test or gate (cause `timeout`, `exit` or `unnamed`) is rerun once when the machine's load per core is under 1, and the log line of the first run says `rerun`.
  - A test with a fake run that times out, then passes, finds the merge granted, no refusal counted in `lineclear measure` and the task not sent back.
  - A test with a run that fails again with no name finds the task held with the cause `unnamed` and one refusal counted.
  - A run that names a failing test or gate is never rerun: a test finds one run in the log.
- parts: checks (health), install, measure, server
- locks: check-rerun
- after: none
- files: src/check-runs.ts, src/candidate-check.ts, src/check-tier.ts, src/measure-main.ts, server/server/live/engine/lane.ts, server/test/engine-lane.test.ts, test/contracts/checks.test.ts, docs/parts/checks.md, src/check-tier.ts

### L301 Agents share the check slots
Result: An agent's `lineclear check` runs through the machine-wide check slots, with a cap of heavy runs per core and the lane first.
- why: tsc, bun test and Playwright run together on a few cores slow every check, and the lane's check waits behind agents that could wait one turn.
- done when:
  - `lineclear check` run by an agent takes a slot before it starts tsc, `bun test` or Playwright, and at most one heavy run per 2 cores holds a slot at a time (a setting, default 0.5 per core).
  - A test with two cores, three agent checks and one lane check finds at most one heavy run at a time and the lane's check started before the agent checks that were still waiting.
  - The wait is written as `slotWaitMin` to `check-runs.jsonl` (L247).
- parts: checks, rules, server
- locks: check-slots
- after: L300
- files: src/check-runs.ts, src/check-tier.ts, src/waits.ts, server/server/live/engine/check-queue.ts, src/spread.ts, test/contracts/checks.test.ts, test/contracts/server.test.ts

### L303 No restart on system faults
Result: A step is not restarted after a system failure; one restarted twice in 24 hours stops with a fix task naming why.
- why: a restart after a herdr crash, a provider error or a timeout repeats the same fault; 44 fix tasks said "unproven after 2 restarts" with no cause.
- done when:
  - A test with the last try's failure `herdr down`, `provider error` or `timeout` finds the step waiting (`lineclear wait` with that cause) and no start, and a start once the cause clears.
  - A test with a step started a third time in 24 hours finds it stopped and exactly one fix task filed, whose title names the cause of the last two failures.
  - A step whose last failure is its own (a failing test) restarts as before.
- parts: rules
- locks: starts
- after: none
- files: src/starts.ts, src/stalls.ts, test/starts.test.ts, src/system-fault.ts, test/system-fault.test.ts, src/tick-project.ts, src/rules.ts, src/waits.ts, docs/parts/rules.md

## Frozen by the owner 5 Nov 2026

The owner froze every open step that is not tier 1 (platform stability) or tier 2 (efficiency). The rule loop never starts a step under this heading. Nothing here is dropped: it starts again only when the owner moves it back. Until the release is green and tiers 1 and 2 are done, nothing new is added and nothing frozen starts.

### L268 Herdr calls are counted
Result: `lineclear measure --herdr` prints the herdr CLI spawns a minute and the `agent.get` calls from the CLI, and a busy board shows under 5.
- why: only a count from herdr's own log shows the polling is gone and stays gone.
- done when:
  - `lineclear measure --herdr` reads `herdr-server.log` in herdr's config folder (`~/.config/herdr`). Each line starts with an ISO time; a request is a line with `event="api.request.complete"`, and one whose `request_id` starts with `cli:` (such as `request_id="cli:agent:get" method="agent.get"`) is one herdr CLI spawn, since each `herdr` command sends one request.
  - It prints the CLI requests a minute over the last 10 minutes (or `--since <time> --until <time>`), in all and by `method`; a test reads a fixture log with CLI, socket and error lines and prints the right counts.
  - Run on the live board while at least five tasks are working, it shows under 5 CLI spawns a minute and no `agent.get` over 10 minutes. That output, with its time window and the number of working tasks, is in `docs/numbers.md` under "herdr calls", beside the figure before L267 (about 65 a minute, from L267's why).
- parts: measure
- locks: none
- after: L267
- files: src/measure.ts, test/measure.test.ts, docs/numbers.md

### L276 Home shows a looping step
Result: Home lists each step started more than 3 times in 24 hours, fix filings included, with the reason of each start.
- why: a step that starts again and again burns tokens out of sight, and the owner learns of it only when the count is huge.
- done when:
  - A start is a decision of kind `start` with the step's id in `decisions.jsonl`: a start of the step's own task or a fix filing for it, which L272 makes write one.
  - `/api/home` gives, per project, each step with more than 3 starts in the 24 hours before now, with the count and, for each start, its time and reason. A fix filing is one of these starts; fix tasks get no row or list of their own.
  - Home shows each such step under its project as its id, title, count and newest reason; the other reasons open in place. No headline or explainer.
  - A test plants a step with five start decisions in 24 hours, two of them fix filings, a step with three, and a step with five spread over two days, and gets only the first, with five reasons, from `/api/home`.
  - Screenshots at 390 and 1440 px of a project with one such step and with none are on the pull request.
- parts: ui, rules
- locks: home
- after: L272, L277, L273, L271
- files: src/home-data.ts, ui/web/home.tsx, test/home-projects.test.ts

### L219 The Dispatcher session rotates
Result: The Dispatcher's session restarts fresh from its notes near 60k of context.
- why: one session that grows with each message and event is read again on every call, and the chat role is 7.4 % of cost.
- done when:
  - At about 60k the session ends and a new one starts with the Dispatcher's overview file and the open ops as its only memory; no owner message is lost between the two.
  - The Dispatcher's median context is in `docs/numbers.md`; the goal is under 45k.
  - A test rotates a session with one op running and one message arriving and finds both in the new one.
- parts: dispatcher, pi
- locks: none
- after: L193, L216, L271
- files: pi/extension.ts, src/dispatcher.ts, templates/dispatcher.md, test/dispatcher.test.ts

### L173 Commands return a handle
Result: Every Dispatcher command returns within 10 seconds with a handle, and its result shows later in `lineclear status`.
- why: a command that waits for a merge, a start or a plan holds the Dispatcher's turn, so the owner's next message cannot be answered.
- done when:
  - `lineclear merge`, `lineclear task add`, `lineclear plan` and `move` print a handle and exit within 10 s, however slow the work behind them is.
  - The handle and its state are kept in the data folder, so they outlive the command and the server's restart.
  - `lineclear status` lists each handle with its state (queued, running, done, failed), its exit code and its result line once known.
  - A test makes the work behind each command take 60 s and finds the command back in 10 s with a handle, and the result in `lineclear status` after the work ends.
- parts: server, core
- locks: none
- after: L271
- files: src/cli.ts, server/src/

### L191 Operations have ids
Result: A long command the Dispatcher starts returns an id at once and runs on without it.
- why: a pi turn is serial, so a 2 to 10 min merge or release in the Dispatcher's own call holds every owner message
  until it ends.
- done when:
  - `lineclear op start <kind> <args>` returns an id in under 1 s and runs the command in a detached process;
    `lineclear op show <id>` reads its state and last line.
  - A test starts a 10 s command, gets its id in under 1 s, and `op show` reads running, then done with its last line.
- parts: dispatcher, core
- locks: none
- after: L271
- files: src/dispatcher.ts, src/cli.ts, test/dispatcher.test.ts, docs/parts/dispatcher.md

### L192 Op events
Result: An op's end is one short line of the event stream, with a path to its log.
- why: the Dispatcher polls with `sleep` and `tail` today, which resends about 100 k context tokens per tick.
- done when:
  - An op and a task end write one line of at most 200 characters to the event stream, which L169 keeps or replaces
    with its reader.
  - A test ends an op in a temp repo and finds exactly one line for it.
- parts: dispatcher
- locks: none
- after: L191, L169, L271
- files: src/dispatcher.ts, test/dispatcher.test.ts, docs/parts/dispatcher.md

### L174 An Operator keeps the line
Result: A headless Operator does the keeping, so the Dispatcher never polls, and the Dispatcher feed shows one line per action.
- why: polling, re-adding failed starts and promotions are chores that fill the Dispatcher's turns. A role of their own does them without taking a worker slot.
- done when:
  - The Operator role is headless, holds no worker slot and no lock, and starts and stops with the server on every space and machine.
  - It takes over the polling and retrying the Phase 20 keepers do for the Dispatcher's own chores and leaves their parts as they are; it never does a keeper's job twice.
  - It polls the handles of L173, re-adds a start that failed (a herdr `tab.create` or `pane.process_info` timeout, no room, a lost session) by itself after a pause, with a limit of 3 tries, and lowers the machine's slot count while herdr is slow and restores it when starts succeed, runs promotions, and writes one line per action to the Dispatcher feed.
  - The Dispatcher's brief tells it to hand such chores to the Operator and never to poll or sleep.
  - A test fails a start with a `tab.create` timeout and finds it re-added once and one line in the feed; a test finds the Operator holding no slot.
- parts: rules, server
- locks: none
- after: L173, L271
- files: src/rules.ts, src/tick-project.ts, server/src/, test/rules.test.ts

### L175 Owner message reaches mid-turn
Result: A message the owner sends while the Dispatcher works is answered before its next tool call.
- why: today a message waits until the turn ends, which can be minutes. The owner takes the silence for a hang.
- done when:
  - A message to the Dispatcher during a turn is delivered before its next tool call, and the Dispatcher's brief tells it to answer first and then carry on.
  - A tool call that runs long cannot hold a message: with L173 no Dispatcher tool call lasts over 10 s, and a message is delivered at the latest when that call ends.
  - The message shows in the chat as delivered, with the time it was read.
  - A test sends a message mid-turn and finds it read before the next tool call.
- parts: server, rules
- locks: none
- after: L173, L271
- files: server/src/, templates/brief.md

### L194 The Dispatcher never waits
Result: The Dispatcher cannot run a command longer than 5 s and uses `op start` for it.
- why: the owner's message must be answered in seconds, and a long call in the Dispatcher's turn blocks it.
- done when:
  - The pi extension refuses a Dispatcher bash call that runs past 5 s and names `op start`; `lineclear plan` is an op
    kind; the template says so.
  - A test shows a 6 s command refused and `op start` accepted, and `bun run dispatcher:eval` stays at 95 % or more.
- parts: dispatcher, pi
- locks: none
- after: L190, L193, L271
- files: pi/extension.ts, templates/dispatcher.md, test/dispatcher.test.ts

### L176 Answer within 30 s, tested
Result: A test proves a message sent during a long command is answered within 30 seconds.
- why: L173 to L175 are each tested alone. The promise to the owner is the whole chain, so one test holds it.
- done when:
  - A test starts a Dispatcher turn with a command that runs 120 s, sends a message after 5 s and finds the answer in the chat within 30 s of sending, on a fixture project with a stub model.
  - The same test runs in the heavy tier with a real model once a week, and a miss files a fix through L113.
- parts: measure, rules
- locks: none
- after: L173, L174, L175, L271
- files: src/measure.ts, src/tick-project.ts, test/measure.test.ts

### L195 Reply time is measured
Result: `lineclear dispatcher latency` prints the time from each owner message to the Dispatcher's first reply.
- why: the goal is an answer within seconds, and only a measure shows whether L190 to L194 reached it.
- done when:
  - The command counts from the board receiving the message, not the session's delivery stamp, and a test on a
    recorded fixture prints its median and p90.
  - The heavy run writes the live median and p90 to `docs/numbers.md`; the goal is under 10 s and under 30 s.
- parts: dispatcher, measure
- locks: none
- after: L194, L271
- files: src/dispatcher.ts, test/dispatcher.test.ts, docs/numbers.md

### L269 The UI's interface has a test
Result: A change that breaks a name the UI part offers other parts fails `bun run test` at once.
- why: ui is the one part of the worst health whose debt is a missing contract test, so a change across its interface has nothing to hold it.
- done when:
  - `test/contracts/ui.test.ts` calls `webAddress`, `roadmapData`, `lineOfRoadmap`, `projectsData`, `describeSessions` and `webApi` (with a temp repo and env, no server or herdr) and checks the shape each returns.
  - `docs/parts/ui.md` lists the file under Tests and has no Debts line left; `lineclear parts check` passes.
- parts: ui (health)
- locks: none
- after: L271
- files: test/contracts/ui.test.ts, docs/parts/ui.md

### L193 The Dispatcher wakes on an event
Result: The Dispatcher gets a turn when an op or task ends, with the events of a 2 s window in one message.
- why: "No news reaches you" in its template makes it poll; an event push removes the polling.
- done when:
  - The template no longer says no news reaches it, and a batch of events arrives as one message.
  - A test ends two ops within 2 s and the Dispatcher's session gets one turn with both lines.
- parts: dispatcher, pi
- locks: none
- after: L192
- files: pi/extension.ts, templates/dispatcher.md, test/dispatcher.test.ts

### L134 Machines updated one by one
Result: Each machine takes a new build in turn, so a bad build stops at the first.
- why: a build that breaks on one machine must not reach the others, and two machines on different builds act on
  the same tasks in two ways.
- done when:
  - After a promotion on the server's machine, each other machine gets the same build in turn (its install until L95
    removes it, then its agent kit and helper), by `lineclear machine update`, with the same smoke check there. A
    machine that fails goes back to its previous build by itself and stops the rest, with one fix task filed.
  - Settings shows one version for each machine. A machine on another build than the server's is caught: the rule
    loop starts no task there, and `lineclear doctor` and Home name it with both versions.
  - Tests with a second machine stood in by a test HOME: a good build reaches it after the first; a planted failure
    there rolls it back and leaves the next machine on its old build; a planted version mismatch holds its starts.
  - Reopened: no test or Home view shows a machine on another build named with both versions.
- parts: install, rules
- locks: release
- after: L132
- files: src/machines.ts, src/rules.ts, test/machines.test.ts, test/machine-add.test.ts

### L139 Server settings in small files
Result: The server's settings code is split into files under the size limit.
- why: the server has the worst part health, and both builds read the settings it keeps, so its 807-line settings
  file is where a format change hides.
- done when:
  - As the first file of L88's split, `server/server/live/settings.ts` is split by job into files under 600 lines, each function under 80, with no
    entry left for it in the size baseline, and `bun run gates --lower` lowered it.
  - The server's tests pass and read and write the same settings files as before.
- parts: server (health)
- locks: none
- after: L71
- files: server/server/live/settings.ts

### L9 Secrets stay with their task
Result: An agent holds only the secrets its task needs, and nothing is pushed without you.
- why: an agent holds only what its task needs, and nothing leaves without you.
- done when:
  - `lineclear secrets set <project> <NAME>` reads the value from stdin. `lineclear secrets list <project>` prints
    names only. Each project's secrets are in the server vault (`vault.json` in the data folder, mode 600).
  - Owner-only secrets are in `~/.config/lineclear/owner.env`, which nothing in Lineclear loads for an agent.
  - `eval "$(lineclear secrets env)"` in a task gives only that task's project's values.
  - Lineclear's pi extension refuses an agent's `git push`. It also refuses a command that names a secret the task
    may not see or a login file. Those are `owner.env`, the other projects' secrets, `~/.ssh`, and the git and gh
    login files. Each refusal is one line that says what and why.
  - Tests as an agent: every owner-only name and every other project's name is missing, `git push` is refused, and
    the project's check and a reviewer started with `pi -p` still work.
  - Reopened: secrets live in the server vault, not in per-project secrets files under ~/.config/lineclear/projects.
- locks: none
- files: src/secrets.ts, pi/extension.ts, test/secrets.test.ts
- after: L1, L5

### L14 Lineclear owns its server
Result: Lineclear changes its own server code instead of waiting on herdr-projects 2.0.
- why: from here on, Lineclear changes the server itself.
- done when:
  - herdr-projects 2.0 at `ebb17d5` (MIT) is in `server/`, with its LICENSE and a NOTICE that names it.
  - Only names change. Env vars become `LINECLEAR_*` and the data folder becomes `~/.lineclear`. The command is
    `lineclear serve`. The one other change is that each en or em dash in its files becomes a plain mark, so L0's
    dash check passes.
  - Its own tests and type check pass inside `bun run check`. L0's time limit grows by the measured time of the
    server's own check, and the new limit is written in the check.
  - `lineclear serve --port <free port>` starts beside a running herdr-projects 2.0 and shows an empty board.
  - Reopened: NOTICE says only names changed though the server has 75 later commits, and no run shows `lineclear serve` beside herdr-projects 2.0 with an empty board.
- locks: server
- after: L8

### U2 Parts every view shares
Result: Every view is built from the same parts, and each part meets the same quality bar.
- why: every view is built from the same parts, so each part is built once and meets one bar.
- done when:
  - The chosen direction is written as tokens and as components in the stack of idea.md. The tokens add sizes for
    type and spacing to U0's colours. There is one theme, the dark graphite one.
  - The motion spec names an animation for every state change, and no others: a task starts, moves or finishes, an
    Inbox item arrives, the view changes, and a part goes between empty, loading, error and filled. Each is under
    300 ms.
  - The UI bar, which every view step tests:
    - every component is designed in each state: empty, loading, error, long text and 200 items
    - screenshot tests at 1440 and 390 px of each state
    - each motion runs at 60 fps in a browser performance trace, with no long task over 50 ms while it runs
    - no motion blocks input: a click during a motion acts at once
    - with prefers-reduced-motion, every state change is instant
    - a short recording of each motion
  - `lineclear run` serves Lineclear's web pages, and a test page there shows every component and every motion,
    and passes the UI bar.
  - Reopened: `train-progress` runs 1200 ms, so not every motion is under 300 ms.
- locks: shell
- after: U1, L6
- files: ui/brand/tokens.css, ui/kit/, ui/web/design.tsx

### U3 Home and Inbox in the web
Result: You run your day from Home and the Inbox in the browser.
- why: these two views replace Lineclear's UI for daily use.
- done when:
  - Lineclear serves Home at `/` and the Inbox at `/inbox`, built only from U2's parts.
  - Home answers "is all clear?" first, with each project as a progress track and each task as a state shape with
    its plain title, not its id. Usage is in percent and spend in dollars, as charts. Red shows only what is broken.
  - The Inbox shows each item as a card with its answers as buttons. There are no popups, and details open with
    one click.
  - Both pass the UI bar of U2, with motion for a task starting, moving and finishing and an Inbox item arriving.
  - Reopened: the Inbox is Home's strip, not its own view, and Home has no first answer and no usage or spend charts.
- locks: home, inbox
- after: U2, L12
- files: ui/web/, src/home-data.ts, src/inbox.ts

### U4 A roadmap page per project
Result: Each project has a page that shows where it is and what comes next.
- why: your plan sets the order of the work, so its view is the one you read to know where a project is and what comes
  next.
- done when:
  - The page `/<project>/roadmap` is built only from U2's parts. It reads `lineclear roadmap status` (L2) and the
    tasks of the rule loop (L6). It shows:
    - what is at work and next first, then the rest of the current phase, later phases, and done phases folded at the
      bottom as "What you got" with their results. No headline.
    - each step as a card: its title, its result and its state as a picture of the line's parts, nothing else. The
      id shows on hover only. No lines are drawn between cards.
    - one click on a card opens its whole brief (why, done-when, locks, waits, task, review rounds and commits) in a
      side panel
  - Motion: a step whose task starts glows once, and a merged step slides to done. Nothing
    loops.
  - It passes the UI bar of U2. The screenshots include this file, and a generated roadmap of 400 steps over 12
    phases.
  - Reopened: no "What you got" fold, and a step card shows id, locks and waits as text, not as a picture with the id on hover.
- locks: roadmap
- after: U2, L6
- files: src/roadmap-view.ts, ui/web/

### U7 Settings page
Result: You set up machines, accounts and projects in one page without editing files.
- why: machines, accounts and projects are set up in one place, without editing files.
- done when:
  - The page `/settings` has three parts, built only from U2's parts:
    - machines: add one by its SSH host. Lineclear runs `install.sh` there over SSH and shows its doctor result.
      Each machine shows its state and its load against the load limit (L7).
    - accounts: each subscription with its usage in percent, and the ordered model list of each role (L5), which
      can be reordered
    - projects: each project's check command, health command and secret names, never their values (L5, L9)
  - A change is saved where the CLI saves it, so `lineclear project list` shows the same.
  - It passes the UI bar of U2. A test adds a machine on a fresh virtual machine over SSH, and doctor passes there.
  - Reopened: usage per account is on /usage, not in Settings, and no machine was added on a fresh virtual machine over SSH.
- locks: settings
- after: U2, L1, L5, L9
- files: ui/web/, src/web-settings.ts

### U5 Owner reviews the new views
Result: The new views replace the old UI only after you have judged them.
- why: the new views replace Lineclear's UI only when the owner has judged them.
- done when: the owner has Home, the Inbox, the roadmap view, the agent browsers and Settings to review. What the
  owner still misses goes to `backlog.md`, or becomes a step through the planner.
  - Reopened: no record exists of the owner reviewing the five views.
- locks: none
- after: U3, U4, U7, U8, L178

### U6 README front page
Result: The GitHub front page shows the idea at a glance.
- why: the GitHub front page is the first thing anyone sees, so it must show the idea at a glance.
- done when: `README.md` shows the logo and wordmark from U0, the one-sentence idea, one animated SVG of the core
  idea, three short lines (roadmap is the boss, rules are the manager, AI does the work), the install command marked
  "coming", links to the docs and the status. The SVG loops about 12 s on the dark theme only, honours reduced motion,
  uses no external fonts, is under 40 KB, and renders and animates on GitHub.
  - Reopened: README has no logo or wordmark, no animated SVG under 40 KB, and not the three lines or the "coming" install.
- locks: none
- after: U0
- files: README.md, ui/brand/

### L40 Service stays light
Result: The running service is measured and stays light on every machine.
- why: each fix above removes one cause; only a measure of the whole process shows that it adds no load.
- done when: over one hour of the live service with no task to start, its average CPU is under 2 % of a core
  and its memory peak is under 300 MB, measured by a script in `scripts/`. The numbers are in `docs/numbers.md`.
  - Reopened: docs/numbers.md has no one-hour reading of the live service's CPU and memory.
- locks: none
- files: scripts/measure-service.ts, docs/numbers.md
- after: L26, L27, L28, L29

### L33 Reports do not ask
Result: Reports with no question stop showing up as needs-you cards.
- why: many of the needs-you cards in a week are reports with no question, and some questions are notices
  that only take "Got it". Each one counts against "under 3 asks a day".
- done when:
  - A report card of a task that is done (the report kind in `docs/asks.md`) closes by a rule and is not an ask.
  - The brief template says to end a task with its report and no question, and to raise only a real choice with
    `lineclear ask`. A notice goes in the task's report, not in the Inbox.
  - `lineclear asks` counts reports apart from asks. A test covers a report of a done task and a question.
  - The asks per day of 7 days before and after are in `docs/numbers.md`.
  - Reopened: docs/numbers.md has no asks per day for the 7 days after the brief template change.
- locks: none
- files: src/asks.ts, templates/brief.md, docs/asks.md, docs/numbers.md, test/asks.test.ts
- after: L22, L32

### L34 Lineclear plans itself
Result: Lineclear's own steps start through its own rules and waits.
- why: this roadmap is run by the AI coordinator that Lineclear replaces, so its own steps cannot use its waits.
- done when:
  - This repo is a Lineclear project, and `lineclear project list` shows it. Its coordinator is regular, set as
    L8 sets the pilot's.
  - Every task start in its space comes from a rule, and `lineclear wait until` works from its tasks, shown by one
    real run.
  - Home links its roadmap view.
  - Reopened: docs/numbers.md says the first task start from a rule is not yet seen, so every start from a rule is not shown.
- locks: pilot
- after: L8

### U19 Talk to the Dispatcher
Result: You ask the Dispatcher about any view in the web UI.
- why: the web UI has no one to talk to. The Dispatcher (L18) is a chat only inside Lineclear, so asking about the
  projects, with a screenshot or a file, means leaving Lineclear.
- done when:
  - A Chat tab at `/chat`, reachable from every view at 390 and 1440 px, talks to the Dispatcher: who you talk to
    with the signal mark, the history, and a composer. Messages show as they are written.
  - Images and files attach by paste, drop and a button. Images show as thumbnails that open large; other files as
    chips with name and size. The Dispatcher gets each as a path in Lineclear's inbox, the same as a
    Lineclear chat attachment.
  - Answers render markdown (code, lists, links, tables) and the images they name.
  - On a phone the composer stays above the keyboard and sending is one tap.
  - Every state is designed: empty with three questions to tap, sending, streaming, error with retry, offline. New
    messages slide in, the typing dots use the signal's amber, and nothing moves with reduced motion.
  - POSTs come only from Lineclear's own pages. Tests cover the upload limits and the message path. Screenshots of
    each state at 390 and 1440 px are on the pull request.
  - Reopened: There is no Chat tab: the bar holds Home and Settings, and the chat is Home's column.
- locks: none
- files: ui/web/chat.tsx, ui/web/chat-view.tsx, src/web-chat-api.ts, src/chat-limits.ts, ui/test/
- after: L18, U3

### L43 herdr-projects 2.0 is gone
Result: Nothing runs on herdr-projects 2.0 or on a timer-driven coordinator, and one command goes back.
- why: while any work runs on herdr-projects 2.0 you keep two systems, and its AI coordinators wake on a timer and spend
  tokens when nothing changed.
- done when:
  - No space on any machine runs on herdr-projects 2.0 or its herdr plugin, and no coordinator wakes on a timer: the
    rules and the Dispatcher do that work. `lineclear doctor` names any that is left.
  - `lineclear doctor --fix` removes the old plugin and the skills it installed, on every machine, and prints what
    it removed.
  - Agents get their rules from Lineclear's brief and skills only. None of them points to herdr-projects 2.0.
  - Going back is one command, `lineclear migrate --back`, and the README says so. A test moves a machine to
    Lineclear, back and to Lineclear again, and loses no task, chat or artifact.
  - Reopened: The README does not mention `lineclear migrate --back`, and no check shows that no agent points to herdr-projects 2.0.
- locks: install, server
- after: L15, L16, L42

### L47 Your phone hears the Inbox
Result: A new Inbox item reaches your phone, so no step waits unseen.
- why: the Inbox is the only place that asks you, but nothing tells you a new item is there, so a step can wait
  hours for an answer you never saw.
- done when:
  - The web app installs on a phone home screen, with a manifest, icons and a service worker, and opens on the
    Inbox.
  - Once you allow it on a device, the device gets a Web Push for each new Inbox item and once each time main turns
    red. No service is used beyond the browser's own push. It reuses the fork's push code (`server/server/push.ts`).
  - Lineclear's own alerts go out this way, so no rule calls `lineclear alert`.
  - It works over HTTPS on a private network such as Tailscale, and the README says how in three lines.
  - Tests cover the subscription, one push per new item and one per red main. A real push to a phone is shown
    with a screenshot on the pull request.
  - Reopened: No real push to a phone is shown with a screenshot on the pull request.
- locks: inbox, shell
- after: L178
- files: server/server/push.ts, ui/web/, src/rules.ts

### U65 A stale picture fails the check
Result: A README picture that shows an older app fails the check before it ships.
- why: a README picture that shows an older app tells a user something the app no longer does.
- done when:
  - `bun run check` fails when a README picture or the film is older than the last change to `ui/brand/` or to a
    view it shows, when a file differs from what `bun run media` made, or when a picture uses a colour or a font that
    is not in the tokens. The message names the file and the command that makes it again.
  - A test plants a stale picture and sees the check fail.
- parts: ui
- locks: none
- after: U64, L271
- files: scripts/media-lib.ts, scripts/media.ts, scripts/shots-check.ts, test/media.test.ts

### U66 The README in one form
Result: The README is the film, three plain lines, the install line and a row of screenshots.
- why: a front page that changes shape with every release, and walls of text, lose a reader in the first seconds.
- done when:
  - The README is the film, three plain lines of what Lineclear is, the install line, one row of real screenshots,
    then the details folded. No "How it works" heading and no other product's name.
  - `docs/brand.md` has a short voice section: plain, concrete, no AI phrasing, and the words never used. A test in
    `bun run check` reads the README against the form and the voice.
- parts: ui
- locks: none
- after: U68, L271
- files: README.md, docs/brand.md, test/brand-voice.test.ts

### U68 Film and README stills rendered
Result: The README shows the finished film and real screenshots of the finished UI.
- why: the UI still changes a lot until the flagship line is in (LIN-149, LIN-150, LIN-152), so pictures made
  before it are thrown away. This step starts once LIN-152 is merged.
- done when:
  - `bun run media` has rendered the film, its poster, the README stills and the social preview from main as it is,
    and `docs/readme/media.json` lists each, so `bun run check` holds them.
  - The README shows the film and the stills. The SVG film of `scripts/readme-film.ts` and the hand-drawn header
    go, with the film's test.
  - The README stills are the shots of U42 (`bun run shots`, `docs/shots/`): `bun run media` takes them from there,
    and its own capture, `ui/test/media.pw.ts`, goes, so the app is captured in one place.
  - The social preview is uploaded in the repository's settings.
- parts: ui
- locks: none
- after: U64, U42, L271
- files: scripts/media.ts, scripts/media-lib.ts, scripts/readme-film.ts, README.md, docs/readme/, test/media.test.ts, test/readme-film.test.ts

### U40 README film from a script
Result: The README film moves smoothly and anyone can change it from a script.
- why: the hand-coded SVG film has flat, linear motion, and a film that only its author can change goes stale.
- done when:
  - The final render, on the pipeline of U64: `scripts/film/line.py` tells the whole story, and `bun run media`
    renders it with its still poster on any machine with Blender. `--frame <n>` renders one frame.
  - The film keeps U22's story and captions and tells it in the railway picture language of U24 and
    `docs/brand.md`: tracks, stations, trains, signals and the main line, in the graphite theme, the signal colours
    and the orange accent.
  - It plays in the README on GitHub, is under 2 MB, shows the still poster under reduced motion, and keeps its alt
    text. A test checks the format, the size and the poster.
  - `docs/brand.md` states the decision: the tool renders pictures only, and the app's motion stays CSS and the Web
    Animations API, as idea.md says. Frames of every scene at 390 and 1440 px of GitHub's render are on the pull
    request.
- parts: ui
- after: U36, U41, U68
- files: scripts/film/, scripts/media.ts, docs/readme/, test/media.test.ts

### U42 Real screenshots in one command
Result: One command takes true screenshots of the UI for the README.
- why: a picture of the UI that is a mock or an old capture tells a user something the app does not do.
- done when:
  - `lineclear run --demo` serves the app on fixed demo data: projects, steps, an Inbox ask, usage and spend, with
    no project or owner names.
  - One command, `bun run shots`, starts it and takes every view with Playwright at 390 and 1440 px into
    `docs/shots/`, with a list of what it took. AGENTS.md names it as the command a release runs.
  - The docs pages show these shots, as the README shows the stills of U68. `bun run check` fails when a picture of
    a view on a docs page is not in that list, so no picture of the app is a mock. The design directions in
    `docs/brand.md` stay, captioned as directions.
  - Reopened: The shots cover six views, not every view: no task page and no Inbox page.
- parts: ui
- after: none
- files: src/demo.ts, src/shots.ts, scripts/shots-check.ts, docs/shots/, test/shots.test.ts

### U43 Release gate
Result: The web UI is finished and proved before a release goes out.
- why: a user judges Lineclear by its web UI, so a release with a missing picture, a vague label or a dead button
  breaks trust in all of it.
- done when:
  - Every main concept of `docs/idea.md` and `docs/brand.md` is on screen and drawn as brand.md says: the line,
    stations (steps), trains (tasks) moving between them, signals (waits, locks, check slots), the Inbox as one
    decision at a time, and usage and spend. A list in `docs/numbers.md` under "U43" maps each concept to the view
    and the screenshot from `bun run shots` (U42) that shows it.
  - The train flows, rail animations and pictures promised in U22, U24, U25, U35, U40 and U41 are all built and
    play, none left as a placeholder. Under reduced motion each shows a still that tells the same. `bun run
    ui:record` records each one, and the list in `docs/numbers.md` under "U43" names each recording and its still.
  - Every label, empty state, error and tooltip says what it is and what to do next. A test in `bun run check`
    reads every table and text of every view on fixed data and fails on "something", "stuff", "various", "etc",
    "TODO", "lorem", placeholder copy, and on "boss", "manager" or "orchestra". It also fails on a figure with no
    unit, a step or task id with no title, and a glossary word of brand.md (U36) used for something else. It fails
    on a fact written as a sentence where a label fits ("Sonnet 5.5 does the work" for "Worker: Sonnet 5.5"),
    outside an error or an Inbox decision, as brand.md's content rule says.
  - Nothing is half done: every button and link works, and every view has its empty, loading, error and full state
    at 390, 768 and 1440 px, checked by the U37 tests in `bun run ui:test`.
  - A fresh model, not the author, looks at the views cold and the U39 board review is run again; both pass with no
    finding of major or above open, and their answers are in `docs/numbers.md` under "U43". Anything better than
    planned that the review finds cheap is done in this step.
  - `bun run dispatcher:eval` runs the Dispatcher's eval set on its configured model and calls at least 95 % right,
    with the share recorded in `docs/numbers.md` under "Dispatcher eval". It spends tokens, so `bun run check` leaves
    it out; every release runs it.
- parts: ui
- locks: kit, shell, words, ui-test, layout-test, motion
- after: U39, U40, U41, U42, U62

### L65 The check must pay
Result: The step check stays only while it saves more than it costs.
- why: a check that costs more than the rework and questions it saves is waste, however sound it looks.
- done when:
  - Once 20 steps planned with the check have merged, `docs/numbers.md` under "Step check" puts them beside the
    steps before: rework rounds, owner questions and dollars per step, with the dollars of the check.
  - The check stays on only when the dollars it costs are below the dollars of the rework rounds it saved and owner
    questions did not rise. Otherwise a setting turns the model call off, the form rule stays, and the section says
    why.
  - Reopened: The side-by-side waits for 20 steps planned with the check; only 2 plans have a check record.
- parts: planner, measure, rules
- after: L63, L64
- files: src/step-check-cost.ts, src/stepcheck.ts, docs/numbers.md, test/stepcheck.test.ts

### L69 Lineclear's own names inside
Result: Variables, classes and file names inside the code say Lineclear, not Lineclear.
- why: environment variables, CSS classes, the artifact API (`window.lineclear`, `lineclear-dark`,
  `lineclear-size`) and file and function names in `server/`, `src/`, `pi/`, `scripts/` and `install.sh` still say
  Lineclear, and a user sees them in artifacts and errors.
- done when:
  - Every environment variable, CSS class, event, meta tag, path (the sandbox's `/run/lineclear` too) and name in
    the code is named Lineclear (`LINECLEAR_*`, `lineclear-*`, `window.lineclear`).
  - An agent started before the step, with the old environment names, still works after the update, shown by a
    test. The old names are read only as a fallback.
  - Artifacts made before the step still draw: `lineclear doctor --fix` rewrites their old API names, keeping
    every version, and a test opens an old artifact after the rewrite.
- parts: server, ui, core, install, pi
- after: none
- locks: server, ui, core, install, pi

### L165 The old UI serves no page
Result: The old port answers the API only, and no page of the old UI is served.
- why: the new UI and the CLI use the API alone, so a served page is code to keep up that no link leads to.
- done when:
  - The old port keeps answering the API that agents' commands, remote helpers, the sandbox relay and Lineclear's UI use. Moving it to Lineclear's port and closing the old port are left to L74.
  - A request for an old page (`/`, an old view path, a built asset) gets a 404 from the server, shown by a test.
  - An agent started before the step still reaches the API after the update, shown by a test, and `bun run ui:test` passes.
- parts: server, install
- locks: none
- files: server/server/app.ts, server/server/main.ts, src/doctor.ts, src/uninstall.ts, server/test/app.test.ts, server/test/chromium.ts
- after: L164, L68

### L166 The old UI's code is deleted
Result: The old UI's code and tests are deleted, since Lineclear's UI has every view U57 kept and the rest goes.
- why: nothing serves these views, so their code and tests are only read and kept up for nothing.
- done when:
  - `server/src`, `server/index.html`, `server/public`, `server/assets`, `server/vite.config.ts`, the plugins' client parts and the tests of each, are deleted, with the build step that made them. The server's API and its tests stay.
  - The commit lists each part removed and the U57 row (kept, moved or goes) that allows it.
  - `bun run check` passes with its baselines in `scripts/gates/baseline/` lowered by `bun run gates --lower`.
- parts: server, core, gates, install
- locks: none
- files: server/src, server/test, server/public, server/assets, server/index.html, server/vite.config.ts, server/package.json, server/bun.lock, server/tsconfig.json, server/README.md, server/docs, server/scripts, server/server, server/shared, server/plugins, docs/architecture.md, test/no-old-folder.test.ts, scripts/gates/borders.ts, scripts/one-name.ts, src/serve.ts
- after: L165

### L167 Lines gone, in the numbers
Result: `docs/numbers.md` says how many lines the old UI's removal took out.
- why: the owner asked for the size of the removal, and a count that is not written down cannot be checked.
- done when:
  - A section "The old UI goes" in `docs/numbers.md` gives the lines of code and of tests under the paths L166 deletes, counted with `git ls-files <paths> | xargs wc -l` at the parent of L166's commit and at L166's commit, with both commits named. It counts those paths only, so other tasks' work does not enter.
  - `docs/design.md` marks the old UI as gone, and the line "It goes only once each view still needed lives in Lineclear's UI" is rewritten in the past tense.
- parts: server, ui, measure
- locks: design-doc
- files: docs/numbers.md, docs/design.md
- after: L166

### L71 What no one uses is gone
Result: Code nobody uses is removed, so there is less to read and keep up.
- why: unused code is read, tested and kept up to date for nothing.
- done when:
  - `server/herdr-plugin.toml`, its scripts, each plugin no feature uses and the code nothing calls are deleted.
    The commit lists each part removed and why no one used it.
  - `bun run check` and `bun run ui:test` pass, faster or no slower than before.
- parts: server
- locks: none
- files: server/herdr-plugin.toml, server/plugins.json, server/plugins
- after: L167

### L73 Old folders archived
Result: The old Lineclear folders on every machine are archived, so only current files remain.
- why: the old data folder and `~/.herdr-projects` take space and confuse what is current.
- done when:
  - `lineclear doctor` names each machine that still has either folder. `lineclear doctor --fix` packs each to
    `~/archive/<name>-<date>.tgz` and removes it, on every machine, and never while a running agent uses it: a
    file open in it, or an agent's environment, PATH, command or socket that points into it. A test covers each.
  - Files that are hard links into `~/.lineclear` stay whole there after the removal.
  - No machine has the old data folder or `~/.herdr-projects`.
  - Reopened: Only this machine is shown to lack both old folders; no proof exists for the other machines.
- parts: install
- locks: none
- files: src/old-archive.ts, src/doctor.ts, test/old-archive.test.ts
- after: L72

### L74 No more Lineclear migration
Result: The command that moves a machine from herdr-projects 2.0 is gone once no machine needs it.
- why: `lineclear migrate` moves a machine from herdr-projects 2.0, and once no machine needs it, it is code to keep for
  nothing.
- done when:
  - `lineclear migrate`, its `--back`, the retire code for herdr-projects 2.0's plugin and their tests are deleted, and
    the README and the "Done means" list no longer offer going back.
  - Every transition the steps before kept (the `lineclear` alias, old environment names, the old port, old names
    in records and artifacts) is removed once `lineclear doctor` finds none left on any machine.
- parts: core, server, install, ui
- locks: none
- files: src/cli.ts, src/migrate.ts, README.md
- after: L69, L167, L73

### L75 Only Lineclear's name
Result: The docs, README, tests and packages all say Lineclear and never Lineclear.
- why: the docs, README, assets, tests and package names, in `server/` and outside it, still read as Lineclear's.
- done when:
  - Every doc, asset and test reads as Lineclear's: `server/docs`, `README.md`, `AGENTS.md`, `docs/` and this
    roadmap too, where done steps call it "the old board" instead. A new `CHANGELOG.md` says that Lineclear began
    as a fork of herdr-projects 2.0, with its link.
  - `bun run check` fails when a tracked file other than `server/LICENSE`, `server/NOTICE` and `CHANGELOG.md`
    names Lineclear in any case, in its text or its path, like the dash check.
- parts: server, ui, planner
- locks: docs, roadmap
- after: L71, L74

### L168 One helper per job in src
Result: `src/` has one `git` runner, one `quote`, one open-fix test and one set of time constants.
- why: it found the same job written 13 times (`git`), 3 times (`quote`, `lockFile`) and twice (`isOpen` in `self-fix.ts` and `outside-fix.ts`), and each copy drifts on its own.
- done when:
  - `src/` defines `git` once and every caller imports it; `quote` is defined once in `src/ssh.ts` (the pi extension keeps its own, as `pi/` may not import `src/`); `isOpen` for fix tasks is defined once; `DAY`, `HOUR_MS` and `MIN` are defined once.
  - `bun run gates` passes with a lower jscpd baseline and `bun run test` passes.
- parts: core, install, rules, measure, checks, dispatcher, gates, inbox, planner, ui
- locks: none
- after: none
- files: docs/ROADMAP.md, docs/architecture.md, docs/parts/checks.md, docs/parts/core.md, docs/parts/measure.md, src/api-latency.ts, src/asks.ts, src/autoplan.ts, src/backup.ts, src/brief.ts, src/check-runs.ts, src/cli.ts, src/compaction-gauge.ts, src/demo.ts, src/dispatcher.ts, src/full.ts, src/git.ts, src/goals.ts, src/health-numbers.ts, src/home-data.ts, src/home-spend.ts, src/inbox-answer.ts, src/inbox.ts, src/leftovers.ts, src/limits.ts, src/machines.ts, src/main-branch.ts, src/measure-main.ts, src/measure-refiles.ts, src/measure.ts, src/outside-fix.ts, src/parts-check.ts, src/paths.ts, src/plan.ts, src/promote.ts, src/release.ts, src/remotes.ts, src/roadmap-cli.ts, src/roadmap-source.ts, src/secrets.ts, src/self-fix.ts, src/stall-class.ts, src/stalls.ts, src/start-limit.ts, src/stepcheck.ts, src/store-copies.ts, src/task-changes.ts, src/task-detail.ts, src/time.ts, src/tmpdirs.ts, src/track.ts, src/try-instance.ts, src/wait-goal.ts, src/waits.ts, src/waste-facts.ts, src/waste-watch.ts

### L169 Event stream: read or gone
Result: `events.jsonl` and `/api/events` are either read by a view of Lineclear's UI or removed with `lineclear event`.
- why: reviewers call `lineclear event` about a thousand times and `/api/events` answers it, but no page of `ui/` fetches it, so 200 lines and a growing file serve nobody.
- done when:
  - `src/events.ts`, the `event` command, the `/api/events` route and its tests are deleted, and the briefs that tell reviewers to call `lineclear event` no longer do; or a view in `ui/` reads `/api/events` and a UI test shows it.
  - `bun run check` passes.
- parts: ui, core, rules, gates, pi, install
- locks: ui, rules
- after: none

### L170 Stalls summary: one way in
Result: The stalls of the last day are read by the CLI and the day's line in `stalls-daily.jsonl` is read by someone, or the route and the file go.
- why: `/api/stalls` has no caller in `ui/` and duplicates `lineclear stalls`; `stalls-daily.jsonl` is written daily and read by no code, only by the clock that decides when `decisions.jsonl` is cut.
- done when:
  - `/api/stalls` and `stallsReply` are deleted, and `docs/stalls.md` names only `lineclear stalls`.
  - `decisions.jsonl` is cut by its own day mark, and `stalls-daily.jsonl` is no longer written.
  - `bun test test/stall-class.test.ts test/web.test.ts` passes.
- parts: rules, ui
- locks: none
- after: none
- files: src/stall-class.ts, src/stall-ladder.ts, src/web-routes.ts, src/web.ts, docs/stalls.md, docs/parts/rules.md, test/stall-class.test.ts, test/web.test.ts

### L171 Doctor drops the old setup
Result: `lineclear doctor` no longer looks for the units and processes of the old setup.
- why: no `cc-*` unit that the check names is active or enabled on either machine, so the check passes on nothing; it is 87 lines and a doctor line to keep.
- done when:
  - The old setup's check and its use in `src/doctor.ts` and `src/retire.ts` are deleted, with their tests, and `lineclear doctor` on both machines still reports no fault.
  - `OUR_TELL` in `src/stalls.ts`, which skips cards of "older versions", is deleted once the Inbox holds no card with that text.
- parts: install, rules
- locks: none
- after: L74
- files: src/doctor.ts, src/retire.ts, src/stalls.ts, test/doctor.test.ts

### L180 One load factor
Result: One function answers how many times busier than its cores the machine is, and the budget, the canary and the check use it.
- why: `scripts/budget.ts`, `scripts/canary.ts` and `scripts/check-speed.ts` each compute the same factor, so a fix to one leaves two wrong.
- done when:
  - `scripts/canary.ts` and `scripts/budget.ts` import the factor from `scripts/check-speed.ts`; the factor takes the load and cores as optional arguments, and the canary keeps its cap of 8.
  - `bun test test/budget.test.ts test/canary.test.ts test/scale.test.ts test/check-speed.test.ts` passes, and `bun run gates` shows the copies baseline did not rise.
- parts: gates (health), ui, install
- locks: none
- after: none
- files: scripts/budget.ts, scripts/canary.ts, scripts/check-speed.ts, test/budget.test.ts, test/canary.test.ts, docs/parts/gates.md

### L181 One call path in the pages
Result: Finding repos and adding a project go through the same call helper as every other page write.
- why: `findRepos` and `addProject` in `ui/web/data.ts` repeat `call` and `post` with the same error text.
- done when:
  - `findRepos` (still `[]` on a failure) and `addProject` use `call` and `post`, and `ui/web/data.ts` has no other direct `fetch` than the early home read and `get`.
  - `ui/test/add-project.pw.ts` passes at 390 and 1440 px, after its three failing tests are fixed.
- parts: ui (health)
- locks: none
- after: none
- files: ui/web/data.ts, ui/test/add-project.pw.ts, docs/readme/home.png, docs/readme/inbox.png, docs/readme/roadmap.png, docs/readme/media.json

### L182 No screenshots nobody reads
Result: An update no longer writes pictures of the pages to the data folder, and the old ones are removed.
- why: `scripts/smoke.ts shots` writes about 1 MB per update into `<data>/ui-shots/` and nothing in the repo reads it.
- done when:
  - `smoke.ts shots`, its call in `install.sh` and the sentence about it in `docs/design.md` are gone, and `lineclear doctor --fix` removes an existing `ui-shots` folder.
  - `bun test test/install.test.ts test/smoke-branch.test.ts` passes.
- parts: install, ui
- locks: none
- after: none
- files: scripts/smoke.ts, install.sh, docs/design.md, src/doctor.ts, src/leftovers.ts, test/install.test.ts, test/leftovers.test.ts

### L95 A machine needs no install
Result: You add a machine without installing Lineclear on it.
- why: every Lineclear install is one more copy to update, with its own PATH, port and folders to break.
- done when:
  - `lineclear machine add <host>` runs `herdr machine add`, installs pi, bun, git, gh and the agent kit there, and
    clones the projects that may run there. It installs no Lineclear server, and says so.
  - `src/spread.ts` and its start and room scripts are gone, and nothing reads the old data folder or a port on another
    machine.
  - The open tasks of a machine's old store move into the one store, each with a new id in its space's series and its
    old id kept as an alias, with their chats, branches and worktrees. A dry run lists them first.
- files: src/machines.ts, src/spread.ts, src/migrate.ts, server/server/live/install.ts
- parts: install, rules, server
- after: L93, L94

### L96 No leftovers on other machines
Result: Old panes, folders and rule loops are gone from every other machine.
- why: an old coordinator pane, an old helper folder or an old rule loop on another machine keeps running, spends
  memory and can act on old state.
- done when:
  - `lineclear doctor` names each leftover on every machine: a Lineclear coordinator pane, a `lineclear run` or a
    server, the old data folder's helper.
  - `lineclear doctor --fix` removes one only after it checks it holds no work (no uncommitted change, no open task,
    no unsent message), and prints what it removed and what it kept.
- files: src/doctor.ts
- parts: install
- after: L95

### L100 One contract test per interface
Result: Each part with an interface has a test that holds what other parts rely on.
- why: a change across a part's interface has to keep what the other parts rely on, and only a test proves it.
- done when:
  - Each part whose names other parts use has `test/contracts/<part>.test.ts`, or names it under Debts until it
    lands; the parts check fails otherwise.
  - A test plants a fault in a provider and sees its contract test fail.
- parts: gates, core, planner, inbox, measure
- after: L99
- files: src/parts-check.ts, test/contracts/core.test.ts, test/contracts/planner.test.ts, test/contracts/inbox.test.ts, test/contracts/measure.test.ts, test/contracts/gates.test.ts

### U61 The roadmap by part
Result: You see one part's steps and its health on the roadmap at a glance.
- why: the owner looks at one part's steps and its health at a glance.
- done when:
  - The roadmap view filters its steps by part, and shows each part's health as a small mark beside its name, with
    no extra text; the UI bar holds for it.
- parts: ui
- after: L101
- files: src/roadmap-view.ts, ui/web/, ui/test/, docs/readme/, scripts/budgets.json

### L103 Parts for other projects
Result: Another project gets its parts and their pages proposed from its code.
- why: other projects gain the same keepers, and the owner should not have to write their pages.
- done when:
  - For a project with no `docs/parts/`, Lineclear proposes its parts and their pages from its code as a plan, which
    the owner sees only as a plan to undo, like any plan.
- parts: planner, gates
- after: L100, L102
- files: src/plan.ts, src/parts.ts, test/plan.test.ts, test/parts.test.ts

### L105 Every interface has a test
Result: No part with an interface is without its contract test, with no way out.
- why: a part that owes its contract test under Debts can owe it for ever, and a change across its interface has
  nothing to hold it.
- done when:
  - rules, dispatcher, install, pi and ui each have `test/contracts/<part>.test.ts`, listed under Tests on its page.
  - `lineclear parts check` fails for a part with an interface and no contract test, with no Debts way out, and a
    test shows it.
- parts: rules, dispatcher, install, pi, ui, gates
- after: L100
- files: src/parts-check.ts, test/contracts/rules.test.ts, test/contracts/dispatcher.test.ts, test/contracts/install.test.ts, test/contracts/pi.test.ts, test/contracts/ui.test.ts, test/parts.test.ts, docs/parts/rules.md, docs/parts/dispatcher.md, docs/parts/install.md, docs/parts/pi.md, docs/parts/ui.md

### L108 One secrets store, with codes
Result: Secrets live in one store, and an agent gets a login code from it.
- why: the server keeps secrets in its vault (Settings > Secrets, `lineclear secret`), while `lineclear secrets`
  kept them in files of its own, so a secret set in one place was missing in the other. Agents also need the code of
  a login that asks for one.
- done when:
  - `lineclear secrets set`, `list` and `env` use the vault. `env` gives the folder's chain: its space, this
    machine and Everywhere, the most specific first. `set --all` sets one for Everywhere.
  - `lineclear totp NAME` prints the current code of `NAME_TOTP` from the same chain (RFC 6238, a base32 key or an
    `otpauth://` address), and nothing else. A missing or broken key names the variable, never its value.
  - Output masking, the pi extension's refusals, the Settings view and the copy to another machine read the vault.
  - Tests cover each level, the chain's order, a code against the RFC 6238 test vector, and a key that is missing
    or broken.
- parts: install, pi, server
- locks: none
- files: src/secrets.ts, src/totp.ts, pi/extension.ts
- after: L107

### L109 Lineclear keeps a backup
Result: Lineclear backs itself up every hour and restores a copy with one command.
- why: Lineclear's tasks, chats, settings and secrets live in two folders on one disk, and a lost disk loses them.
- done when:
  - `lineclear backup` saves `~/.lineclear` and `~/.config/lineclear`, and the extra paths you name, to each
    restic repository in the machine's settings, encrypted with `LINECLEAR_BACKUP_PASSWORD` from the owner-only
    secrets. It skips what can be made again (browser profiles, helpers, temp files).
  - The rule loop runs it once an hour, keeps hourly copies for two days and daily ones for a month, and
    `lineclear doctor` warns when the last good backup is older than a day.
  - `lineclear backup restore <dir>` puts the latest copy in a folder, and `lineclear backup status` names each
    repository's last copy.
  - Tests back up to a local repository, restore it and find the same files, and cover the schedule.
- parts: install, rules
- locks: none
- files: src/backup.ts, src/doctor.ts, test/backup.test.ts
- after: L107

### L110 Idle remote task asks nothing
Result: An idle task on another machine no longer counts as waiting for your reply.
- why: an agent on another machine that only ended its turn shows "Waits for your reply" with no question, and the
  count takes it for one, while the same task on this machine is left out.
- done when:
  - Home reads a task of another machine's line from its state line, without the "on <machine>" tail, the same way
    as a task here. The count of what waits for you leaves it out when that line is the idle text and no question is
    in it, so Home's headline, the Inbox badge and `lineclear status` agree.
  - A task of another machine that waits with a real question still counts, with that question as its line.
  - Tests plant a task of another machine that says "Waits for your reply" with no question: none of the three
    counts it. A task with a question is counted with its line.
- parts: rules, ui
- locks: none
- after: none
- files: src/waiting.ts, src/home-data.ts, src/status.ts, test/waiting.test.ts, test/home-data.test.ts

### L111 Silent machine says so
Result: A machine that does not answer is shown as unreachable, not as tasks waiting for you.
- why: the tasks of a machine that cannot be reached are only what it said last, so showing them as waiting for you
  now claims something no one has checked, with the time of the read instead of the time they last changed.
- done when:
  - The rule loop keeps the time of each machine's last good read. A task of a machine that did not answer the last
    read shows "<machine> not reached since <time>" on Home and in the Inbox, with that time, and is never counted as
    waiting for you. It still holds its slot and its locks.
  - A machine that has not answered for a day loses its known tasks from the views and the count, and the rule loop
    notes once in `decisions.jsonl` which tasks it dropped and why. A machine that answers again shows its tasks again.
  - `lineclear status` names each machine that does not answer once, with since when, in place of one line per task.
  - Tests cover a machine that answers, one missed read, a day without an answer, and a machine that answers again.
- parts: rules, ui
- locks: none
- after: L110
- files: src/spread.ts, src/rules.ts, src/home-data.ts, src/waiting.ts, src/status.ts, src/tick-project.ts, docs/parts/rules.md, ui/kit/parts.tsx, ui/web/home-table.tsx, docs/readme/home.png, docs/readme/inbox.png, docs/readme/roadmap.png, docs/readme/media.json, test/second-machine.test.ts, test/waiting.test.ts

### L121 Lane stall shows on Home
Result: Home shows a stalled merge lane with the reason it is stuck.
- why: a release that only the log knows leaves the owner guessing why a merge took longer, and a stall kind that
  returns is never seen.
- done when:
  - A head whose processes show no progress for 15 minutes shows as stuck in `lineclear status` and on Home's line, on
    its lane: the task, the step it hangs in, for how long and the lock or process it waits for when the kernel tells. After a release, the task's row says "Released from the merge line: <reason>" until it merges or
    joins the line again.
  - `docs/stalls.md` names the lane stall, its cure and its test, and `lineclear status` names a release of the last
    hour once.
  - Tests in `test/home-data.test.ts` cover a stuck head, a released task and one that joined the line again.
- parts: ui, rules
- locks: none
- after: L120
- files: src/home-data.ts, src/status.ts, src/waits.ts, docs/stalls.md, test/home-data.test.ts

### L127 Merge line measured again
Result: A page of numbers shows whether merges per hour rose and the longest wait fell.
- why: the phase holds only if merges per hour rise and the longest lane wait falls on real work.
- done when:
  - `docs/numbers.md` under "Merge line" has merges per hour and the longest lane wait of a week after L120, L121,
    L122 and L126 are on main, beside the numbers from before, and the longest lane wait is under 30 minutes.
- parts: measure
- locks: none
- after: L120, L121, L122, L123, L126
- files: docs/numbers.md

### L114 A test track runs the chain
Result: A fixture project runs the whole chain every night and after each update, and a broken update is rolled back.
- why: each fault of an update or a restart showed only on real work. A small project that runs the whole chain
  shows it first.
- done when:
  - `lineclear track` runs a fixture project through the whole chain: a request, its plan, the start, the work,
    the review and the merge, with a forced restart and a switch of the task to its next model (as when an account
    is full) in the middle, on the cheapest models. It prints pass, or the stall class that broke it.
  - It runs every night from a timer the install adds, and after every update. A broken run after an update puts
    the previous version back (the rollback of an update) and files the fix as L113 does.
  - A test drives the chain with a fake world: a pass, a stall that breaks it, and the rollback.
- parts: install
- after: L113
- files: src/track.ts, src/promote.ts, src/rollback.ts, test/track.test.ts

### L115 Health in numbers
Result: `lineclear measure` shows whether Lineclear stays on the rails, and a step that makes it worse fails review.
- why: whether Lineclear stays on the rails is a number that goes up or down, not a feeling.
- done when:
  - `lineclear measure` prints the health measures: the share of task time spent waiting on the system, not the
    owner, stalls per day, minutes from a stall to its remedy, merges per day and tokens per merged step.
  - `lineclear measure --health` writes them to `docs/numbers.md` under "Health", and a review fails a step
    that makes one of them worse.
- parts: measure
- after: L112
- files: src/measure.ts, src/health-numbers.ts, docs/numbers.md, test/measure.test.ts

### L116 It scales
Result: Ten projects and 1000 tasks keep the loop and Home fast, and no data file grows without bound.
- why: more projects and more tasks must not make the loop or Home slow, and files that only grow fill a disk.
- done when:
  - A test with 10 projects and 1000 tasks keeps the rule loop's tick and `/api/home` under their time limits.
  - `decisions.jsonl` and the server's task list and chat logs rotate or archive, so none grows without bound,
    and what Home and measure read still holds.
  - Tasks ended over a day ago, and their finished agents, leave `tasks.json` and `agents.json` for append logs, so
    a change writes a small file at 10,000 tasks. Before and after are in docs/numbers.md.
  - A merged or closed task's worktree folder goes once its work is committed: the branch keeps that work.
  - Work spreads over machines by room (L44) with the check slots of L45.
- parts: rules, server
- after: none
- locks: rules, server

### L147 Only a step's own task closes
Result: Only a task the rules started for a step closes when that step merges, and no closed task leaves work behind.
- why: the rules tie a task to a step by the start of its title. A task named "L43 and L107 next after 0.1" was read
  as L43's task and closed as idle after done, while its branch held work main lacked.
- done when:
  - The rules record the step each task was started for, and the stall check, the stall ladder and the closed-step
    count find a task's step only from that record, never from its title.
  - The idle-after-done remedy closes no task whose branch has commits main lacks; it records a stall for the owner.
  - A test plants the stall of LIN-198: a task titled with a merged step's id that the rules did not start, and one
    with unmerged commits. It fails on main and passes after: no idle-after-done stall, nothing closed.
  - `decisions.jsonl` has no idle-after-done stall in the day after this step merges.
  - Reopened: The day-after `decisions.jsonl` check is not yet due (the lock-held remedy and the roadmap's "work" state read the record since 4 Nov).
- parts: rules, planner, ui
- locks: none
- after: L113
- files: src/rules.ts, src/stall-class.ts, src/stall-ladder.ts, src/stalls.ts, src/roadmap.ts, src/roadmap-view.ts, src/roadmap-cli.ts, src/home-data.ts, src/task-steps.ts, test/stall-class.test.ts, test/roadmap.test.ts, test/home-data.test.ts, test/step-record.test.ts

### L162 Spend charts out of parts.tsx
Result: The UI kit's money and usage charts live in their own file, and `parts.tsx` is under the size limit.
- why: `ui/kit/parts.tsx` is the UI's one file over the size limit, and the charts are a job apart from the page parts.
- done when:
  - `SpendChart`, `MonthSpendView`, `UsageChart` and their types (`Money`, `AccountMonth`, `MonthSpend`, `AccountUse`,
    `Move`) move from `ui/kit/parts.tsx` to `ui/kit/spend-charts.tsx`; the importers use the new file; the size baseline
    lists `parts.tsx` under 600 lines or drops it, and `bun run ui:test` passes.
- parts: ui (health)
- locks: none
- after: none
- files: ui/kit/parts.tsx, ui/kit/spend-charts.tsx, ui/kit/index.ts, ui/kit/line.tsx, ui/kit/line-motion.tsx, docs/readme/media.json, docs/readme/home.png, docs/readme/inbox.png, docs/readme/roadmap.png

### U71 Task table keeps its edge gap
Result: The last column of the Home task table sits inside the card with the card's padding.
- why: the U39 review found the last column flush with the card edge, which reads as cut off.
- done when:
  - A test in `bun run ui:test` measures at 390 and 1440 px that the last cell's right edge is at least the card padding from the card edge.
  - Screenshots before and after at 390 and 1440 px are on the pull request.
- parts: ui
- locks: task-row
- after: L271
- files: ui/web/home-table.tsx, ui/kit/table.tsx, ui/kit/kit.css

### L232 Plugin take-over out
Result: A machine is added by the one install only; the `old=1` probe and `takeOver` are gone.
- why: take-over copies the records of a machine that ran the herdr plugin; no machine does.
- done when:
  - `takeOver`, the `old=1` probe line, `oldInstall` and `test/take-over.test.ts` are gone.
  - `lineclear doctor` on a machine that still has a plugin `config.json` says to remove it.
- parts: server, install
- locks: none
- after: none
- files: server/server/live/machines-links.ts, server/server/live/install.ts, server/server/live/machines-helpers.ts, server/test/take-over.test.ts, src/doctor.ts, test/doctor.test.ts, server/scripts/plugin.ts, server/scripts/take-over.ts, server/server/took-over.ts, server/server/live/source-views.ts, server/server/live/source.ts, server/docs/upgrading.md, server/server/live/places.ts, src/old-install.ts

### L233 One lineclear command client
Result: The merge wait, retry and secret masking of the `lineclear` command live in one place.
- why: `server/cli.ts` and `server/helper/lineclear` each repeat them.
- done when:
  - A decision in the step says whether the helper keeps a perl client for machines without bun.
    Decision: it stays and is the only client. Perl is on every machine and bun is not on remote ones, so `server/helper/lineclear` also serves the main machine (URL, port, socket) and `server/server/cli.ts` is gone.
  - Merge wait and retry and secret masking exist once.
  - `server/test/cli.test.ts` and `server/test/secrets.test.ts` pass.
- parts: server, install, planner
- locks: none
- after: none
- files: server/server/cli.ts, server/helper/lineclear, server/helper/lineclear, server/helper/route.pl, server/bin/lineclear, server/server/live/autopilot-sandbox.ts, server/test/cli.test.ts, test/plan.test.ts

### L246 The goals are measured again
Result: `docs/numbers.md` shows the three goals met on the last 3 days of work, or the ones still unmet raised once.
- why: L57 found them unmet, and only a new run on real work shows the plan reached them.
- done when:
  - A section "L246" holds the table of L57 again, run after L245 has been on main for 3 days with work, with each
    goal marked met or not.
  - A goal still unmet is raised once with `lineclear plan`.
- parts: measure
- locks: measure
- after: L245
- files: docs/numbers.md

### L172 A power cut leaves work intact
Result: A pulled plug on a machine with lingering on ends no work for good: tasks resume and no half-written file is read.
- why: only a real power cut tests what an orderly reboot cannot, and it ends the work of every task on that machine, so the owner chooses when.
- done when:
  - Owner only: pulling the plug is a hand test, and an agent can only wait for it.
  - The owner pulls the plug of a machine with lingering on while tasks work, and after the boot every task resumes and no state file is unreadable; the result is recorded in `docs/numbers.md`.
- parts: rules, measure
- locks: none
- after: none
- files: docs/numbers.md

### L305 Measure shows dev cost
Result: `lineclear measure` shows per day the load factor of checks, the unnamed failures and the starts per merged step, each with a goal.
- why: the plan is proved only by numbers anyone can recount, and a goal with no number cannot fail.
- done when:
  - `lineclear measure <project> --since <date>` prints per day: the load factor of checks (run time over idle time, from `loadMeter`), failed merge checks with no named failure, and task starts per merged step.
  - Goals are set in `docs/idea.md`: load factor under 1.5, unnamed failures under 5 % of merge checks, starts per merged step under 1.5; a day over a goal is marked.
  - A test on a fixed log finds each number and each mark.
  - After L300 to L304 have been on main for 3 days with work, `docs/numbers.md` records each number beside the figures of 5 Nov (4 to 5, 69 of 108, about 3.3) and whether each goal is met.
- parts: measure, core
- locks: measure
- after: L300, L301, L302, L303, L304
- files: src/measure.ts, src/measure-main.ts, docs/idea.md, docs/numbers.md, test/measure.test.ts

### L409 Format test holds on load
Result: The release-formats test "the stable build reads this tree's roadmap and store files" passes on a loaded machine.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when:
  - The test is the one named in the title, in `test/release-formats.test.ts`; the name goes in the commit message. It passes on main when the machine is idle, so the cause is load.
  - The root cause is fixed: the file sets no timeout, so the 5 s default of bun applies, while the test builds the plugin registries, writes a store and runs the stable build's own format reader (each allowed 120 s by its caller), so a busy machine times it out. The test gets a fixed ceiling of 180 s, as the install tests with several runs have. No retry, no skip, no quarantine.
  - The file passes with 14 busy loops running beside it.
- parts: install, pi (health)
- locks: install-test
- after: none
- files: test/release-formats.test.ts

### L400 Token pack test holds under load
Result: The install test "install loads the token pack" passes on a loaded machine, by a fix of its cause.
- why: a test that fails only under load blocks merges of unrelated branches, and a retry would hide the cause.
- done when:
  - The test is the one named in the title, in `test/install.test.ts`; the name goes in the commit message. It passes on main when the machine is idle, so the cause is load.
  - The root cause is fixed: the file's default timeout is 30 s times a load factor read once at import, and this test runs two installs and five commands with no limit of its own, so a machine that gets busy after the import times it out. The test gets a fixed ceiling of 180 s, as the other tests with two installs have. No retry, no skip, no quarantine.
  - The file passes with 14 busy loops running beside it.
- parts: install, checks (health)
- locks: install-test
- after: none
- files: test/install.test.ts

### L402 First install test holds on load
Result: The install test "install adds Lineclear, the extension and the service, and doctor passes" passes on a loaded machine.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when:
  - The test is the one named in the title, in `test/install.test.ts`; the name goes in the commit message. It passes on main when the machine is idle, so the cause is load.
  - The root cause is fixed: the file's default timeout is 30 s times a load factor read once at import, and this test is the first to run a full install (a fresh build of the app and its web pages) plus a doctor run, so a machine that gets busy after the import times it out. The test gets a fixed ceiling of 180 s, as the other tests with two installs have. No retry, no skip, no quarantine.
  - The file passes with 14 busy loops running beside it.
- parts: install, pi (health)
- locks: install-test
- after: none
- files: test/install.test.ts

### L403 Second install test holds
Result: The install test "a second install changes no file" passes on a loaded machine, by a fix of its cause.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when:
  - The test is the one named in the title, in `test/install.test.ts`; the name goes in the commit message. It is run on main first: if it passes there when the machine is idle, the cause is load.
  - The root cause is fixed: the file's default timeout is 30 s times a load factor read once at import, and this test runs a full install after a snapshot of the home folder, so a machine that gets busy after the import times it out. The test gets a fixed ceiling of 180 s, as the other tests with installs have. No retry, no skip, no quarantine.
  - The file passes with 14 busy loops running beside it.
- parts: install, pi (health)
- locks: install-test
- after: none
- files: test/install.test.ts

### L404 Lingering test holds under load
Result: The install test "where lingering needs root" passes on a loaded machine, by a fix of its cause.
- why: a test that fails only under load blocks merges of unrelated branches, and a retry would hide the cause.
- done when:
  - The test is the one named in `test/install.test.ts` ("where lingering needs root, install prints the one command and doctor names it"); the name goes in the commit message. It is run on main first: it passes there on an idle machine, so the cause is load or shared state.
  - The root cause is fixed: the test runs two installs and two doctor calls under the file's default timeout (30 s times a load factor read once at import), so a machine that gets busy after the import times it out; it gets a fixed ceiling of 180 s, as the other tests with two installs have. It also no longer needs the first test to have made the `linger` file: it removes it only if it exists, so it fails on its own cause and not on an earlier test's. No retry, no skip, no quarantine.
  - The file passes with 14 busy loops running beside it.
- parts: install, checks, measure (health)
- locks: install-test
- after: none
- files: test/install.test.ts

### L405 Format check test holds on load
Result: The release test "the format check reads the store this build writes and names what it would drop" passes on a loaded machine.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when:
  - The test is the one named in the title, in `test/release-formats.test.ts`; the name goes in the commit message. It passes on main when the machine is idle, so the cause is load.
  - The root cause is fixed: the test runs the plugin registry build and the store writer as child processes under bun's default 5 s test timeout, so a machine that gets busy times it out. The test gets a fixed ceiling of 180 s, as the other tests with child installs have. No retry, no skip, no quarantine.
  - The file passes with 14 busy loops running beside it.
- parts: install, checks
- locks: release-formats-test
- after: none
- files: test/release-formats.test.ts

### L406 Roadmap test holds on load
Result: The test "this repo's roadmap passes" passes on a loaded machine, by a fix of its cause.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when:
  - The test is the one named in the title, in `test/roadmap.test.ts`; the name goes in the commit message. It passes on main when the machine is idle, so the cause is load.
  - The root cause is fixed: the file sets no timeout, so bun's 5 s default applies to a test that checks the whole roadmap and reads the repo's git log, and a busy machine runs past it. The test gets a ceiling of 30 s times `loadFactor()` from `scripts/check-speed.ts`, read when the test runs, as `test/install.test.ts` does. No retry, no skip, no quarantine.
  - The file passes with 14 busy loops running beside it.
- parts: planner, pi (health)
- locks: roadmap-test
- after: none
- files: test/roadmap.test.ts

### L410 Row test holds under load
Result: The test "every process, timer, store, loop and gate has a row" passes on a loaded machine, by a fix of its cause.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when:
  - The test is the one named in the title, in `test/simplify.test.ts`; the name goes in the commit message. It passes on main when the machine is idle (about 25 ms), so the cause is load or shared state.
  - The root cause is found by running the file beside the whole `bun test` and beside 14 busy loops, and fixed there: the test reads the live `src/` and `scripts/gates/` trees through `simplifyParts`, so a timeout that does not scale with load, a file another test writes in those folders, or the real config folder are each checked and the one that fails is removed. No retry, no skip, no quarantine.
  - The file passes with 14 busy loops running beside it and while the rest of `bun test` runs.
- parts: measure (health)
- locks: simplify-test
- after: none
- files: test/simplify.test.ts, scripts/simplify-count.ts

### L411 A quiet task's cause is fixed
Result: A task that goes quiet gets its cause named and fixed, so the same task is not called "no sign of life" again within a day.
- why: the ladder (a reminder, a restart, the next model, the Inbox) treats every quiet task alike and leaves the cause, so the same tasks are called stuck again every 12 to 30 minutes.
- done when:
  - The cause is written in `docs/stalls.md` under no sign of life: from the session log and heartbeat of one task in `decisions.jsonl` (LIN-1096, OMA-258 or OMA-269), what the server saw and what the agent was doing.
  - The cause is fixed in the code that reads or sends life (`lifeOf` in `server/server/live/engine/stalls.ts`, the pi extension or the ladder in `src/stalls.ts`), not by a longer limit or a quieter card.
  - A test plants the stall: a task in that state, with the reminder and the restart already sent. It fails on main (a second "may be stuck: quiet for" card) and passes after (no card, or the cause named in the card).
  - `decisions.jsonl` in Lineclear's config folder (`$LINECLEAR_CONFIG`, else `~/.config/lineclear/`) has, in the day after this step merges, no second `stall` line of the class `no-sign-of-life` for one task whose session log or heartbeat moved in the 20 minutes before it.
- parts: server, rules, pi
- locks: stall-check
- after: none
- files: server/server/live/engine/stalls.ts, server/test/stalls.test.ts, src/stalls.ts, test/stalls.test.ts, pi/extension.ts, docs/stalls.md

### L412 A step starts three times a day
Result: A step is started at most 3 times in 24 hours, so the waste watch no longer reports L65 for 14 starts.
- why: a step starts once, and twice more after a real stop; a fourth start is a loop that burns tokens.
- done when:
  - The cause is written in `docs/stalls.md` under "starts": from `decisions.jsonl` and the task list, which path started L65 (a reopened step, a restart of an unproven step, another machine or a lost `stepStarts` record) after it passed the limit of 3 in `src/start-limit.ts`.
  - The cause is fixed in the code that starts steps (`startStep` and `startReadySteps` in `src/tick-project.ts`, or `src/start-limit.ts`), not by a higher limit or a quieter alarm.
  - A test plants the waste: a reopened step with 3 tasks started in the last 24 hours, one ended without a merge. It fails on main (a fourth start) and passes after (no start, one Inbox item).
  - `bun run check` passes, and `lineclear waste` shows no step above 3 starts in the day after this step merges.
- parts: rules
- locks: start-limit
- after: none
- files: src/start-limit.ts, src/tick-project.ts, test/start-limit.test.ts, docs/stalls.md

### L413 Red-cause tests hold on load
Result: The tests "the red share is counted by first cause" and "a gate, a test and a timeout are each named in the red run" pass under load.
- why: a test that fails only under load blocks merges of branches that never reach it, and a retry would hide the cause.
- done when:
  - The tests are the two named in the Result, in `test/red-causes.test.ts`; both names go in the commit message.
  - The cause is fixed: `redRun` gives `checkTier` no `readLoad`, so `worthRerun` reads the machine's real load and skips the rerun at a load of 1 per core or more (6 red runs, not 9, and one timeout run, not two). `redRun` passes a fixed load instead. No retry, no skip, no quarantine.
  - The file passes on a machine with a load above its core count (14 busy loops beside it) and while the rest of `bun test` runs.
- parts: checks
- locks: red-causes-test
- after: none
- files: test/red-causes.test.ts

### L414 Composer out of chat.tsx
Result: The chat's composer lives in its own kit file, and `ui/kit/chat.tsx` has room under the 600-line limit.
- why: `ui/kit/chat.tsx` is at 577 of 600 lines, and typing a message is a job apart from showing the thread.
- done when:
  - `Composer`, its `Tray` of attached files and `useKeyboardInset` move from `ui/kit/chat.tsx` to `ui/kit/composer.tsx`; `ui/kit/index.ts` exports them from there and every importer still builds.
  - `ui/kit/chat.tsx` is under 400 lines, and `bun run types`, `bun run gates` and `bun run ui:test` pass.
- parts: ui (health)
- locks: kit-chat
- after: none
- files: ui/kit/chat.tsx, ui/kit/composer.tsx, ui/kit/index.ts
