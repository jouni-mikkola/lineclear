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
