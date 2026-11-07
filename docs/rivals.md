# What rivals do better

Survey only: no code changed. Blunt on purpose.

**Method and limits.** The web search tools were not available to this run, so nothing here is freshly read from the web. Line counts for open tools come from a shallow clone of each repo on the survey day (`git ls-files`, source files in ts/tsx/js/rs/go/py, split into tests and the rest; generated and vendored files may be in the counts). Everything else about a rival, and every closed tool, is from the survey agent's memory and is marked `(memory)`. Closed tools have no line count: nobody outside can count them. Treat memory rows as leads to check, not facts.

## Lineclear's own size

About 215,000 lines in git: `src/` 20,800, `test/` 18,900, `ui/` 99,000 (includes samples and tests), `server/` 50,800, `scripts/` 2,000, `docs/` 19,900. 137 files in `src/`. The roadmap has hundreds of steps.

## Rivals

| Tool | Lines (code / tests) | Does simpler or better |
| --- | --- | --- |
| claude-squad | 7,600 / 2,100 (Go) | One binary, `curl \| bash`, needs only tmux and `gh`. Worktree plus tmux session per task, a list and a diff tab, `s` commits and pushes. No server, no database, no roadmap. Runs any agent via `-p`. |
| Crystal (stravu) | 82,000 / 2,800 (Electron) | Desktop app, session list, diff view, commit squash and rebase in the UI. Stale since Feb 2026. One install, no board. |
| Vibe Kanban | 217,000 / 3,400 (Rust + TS) | `npx vibe-kanban` starts everything. Kanban column per task, one worktree per attempt, diff review and "create PR" in the card. Several agents behind one picker. Bigger than Lineclear's `src/`+`ui/` combined, so size is no win for them either. |
| Terragon (OSS) | 100,000 / 43,800 | Cloud sandbox per task, start from phone or GitHub issue, PR opened by itself. Sandbox removes the "agent breaks my machine" fear. Stale since Feb 2026. |
| Sculptor (Imbue) | 177,000 / 209,000 | Container per agent, so parallel agents cannot clash on ports or files. Tests are larger than the code. |
| OpenHands | 180,000 / 253,000 | Sandboxed runtime, issue-to-PR resolver as a GitHub Action, benchmarks. Heavy. |
| Conductor (memory) | closed | Mac app, one click makes a workspace (worktree), diff view, "merge" button. Zero config beyond a repo. |
| Claude Code subagents and agent teams (memory) | built in | No install, no board. One agent spawns others and merges their answer in one context. Cost is the only status view: you see tokens in the session. |
| GitHub Copilot coding agent (memory) | closed | Assign an issue to Copilot, get a draft PR, comment on the PR to steer. Status is the PR itself. Nothing to install, review lives where reviews already live. |
| Cursor background agents (memory) | closed | Remote machine per agent, start from the editor or phone, PR at the end. |
| Devin, Factory, Jules, Sweep (memory) | closed | Same loop: ticket or Slack message in, PR out, status in the PR or a web page. Jules shows a plan to approve first. Sweep is GitHub-issue only. Hosted, so setup is a login. |

## What they do better, by headings

- **Setup.** claude-squad: one command, two prerequisites. Vibe Kanban: `npx`. Hosted ones: sign in. Lineclear: `install.sh`, a server, the pi harness, herdr, a doctor, machines, secrets, a canary-checked self-update. It has more to go wrong before the first task.
- **Status view.** Rivals show a list: task, state, diff. Lineclear's Home, Inbox, railway picture, usage sheet, roadmap views and task live view are several screens for the same fact.
- **Landing PRs.** Copilot, Jules, Terragon and Vibe Kanban end at a PR you merge in GitHub. Lineclear also merges, rebases, promotes and releases itself. That is reach nobody asked for.
- **Stall handling.** Rivals mostly do nothing: the human looks at the list. Lineclear has a stall ladder with classes, cards, restarts and model swap (`src/stalls.ts`, `stall-class.ts`, `unstick.ts`, `docs/stalls.md`). It may be worth the weight, but no rival's users complain about its absence.
- **Token cost.** Lineclear's Dispatcher, planner, reviewer and nudges each spend tokens on top of the worker. Rivals spend only the worker's. Lineclear's own `dispatcher:eval` exists because the routing layer costs and can be wrong.
- **Size.** claude-squad does the core loop (worktree, session, diff, push) in 7,600 lines. Lineclear needs about 28 times that.

## Five things to copy or simplify

1. **One-command start that shows a task list.** claude-squad and Vibe Kanban reach a working board with one command and no config. Make first run need nothing but a repo, and fold the doctor, machines and secrets into later, optional steps.
2. **The PR is the status.** Copilot and Jules use the PR as the single place for progress, comments and checks. Stop mirroring PR and check state in several Lineclear views; link to the PR and show one line.
3. **One status screen, not several.** Rivals use list plus diff. Keep Home and the task page; fold Inbox strips, usage sheet, roadmap views and search into those.
4. **Sandbox instead of rules.** Sculptor and Terragon run each agent in a container or cloud box, which removes classes of guards. Lineclear's rules, gates and stall classes exist partly because agents run on the owner's machine. Cheaper to isolate than to police (memory-based claim; needs a proper look before any task).
5. **Fewer helper agents.** Subagents, Copilot and Jules work with one agent plus the human. Lineclear's Dispatcher, reviewer and planner each cost tokens. Make the reviewer and planner opt-in per task (already partly the Review setting).

## Delete candidates (no rival has them)

Delete-only, per the owner's rule of 7 Nov: remove code, tests, docs and every caller. "Importers" is a quick grep of `src/`, `pi/` and `scripts/` for the module name and is **not** the deletion task's grep; that task must still check each caller, and anything still used stays.

| Candidate | Lines in `src/` | Importers | Why no rival has it |
| --- | --- | --- | --- |
| `docs/ROADMAP.md`, `src/roadmap*.ts`, `ui/web/roadmap/`, `src/step*.ts` | about 1,800 plus docs and UI | `roadmap.ts` has 31, so cut the views and import first (`roadmap-import` 1, `roadmap-view` 7) | Rivals have a task list, not a steps tree with done-when proofs. |
| `promote*.ts`, `rollback.ts`, `scripts/canary.ts`, `release-*.ts` | about 900 | `release` 9, `promote` 2, `rollback` 2 | Rivals ship by their own release process, not inside the tool. |
| `src/try-instance.ts` | 444 | 3 | A second Lineclear to try a build. No rival self-hosts its own upgrades. |
| `src/machines.ts`, `machine-list.ts`, `machine-alerts.ts`, `ssh.ts` | about 500 | `machines` 4, `ssh` 7 | Rivals run local or in their cloud. Multi-machine control is not in claude-squad, Crystal or Vibe Kanban. Check the server engine first. |
| `src/autoplan.ts`, `plan*.ts`, `company.ts`, `direction.ts`, `routine.ts` | about 700 | `autoplan` 6, `company` 8 | Automatic planning from the owner's direction. Jules has a per-task plan; nobody has a standing company direction. |
| `src/self-fix.ts`, `heal.ts`, `doneproof*.ts`, `catches.ts`, `measure.ts` | about 800 | `self-fix` 4, `doneproof` 7 | Self-repair and proof-of-done machinery. Rivals trust the PR check. |
| `src/demo.ts`, `scripts/fake-sessions.ts`, `ui/shots/`, `docs/shots/` | 287 plus | `demo` 1 | Screenshot and demo data pipeline. No rival ships one in the tool. |
| `src/search.ts`, `src/totp.ts` | 112 | 1 each | Small extras. Keep `totp` if the shared browser login rule still needs it. |
| `docs/simplify-cut.md`, `docs/server-engine-survey.md`, `docs/u*` | docs only | n/a | Earlier surveys; delete once their tasks land. |

**Keep and name.** The stall ladder and `unstick` stay until a task shows it never fires: it is the one place where Lineclear does something rivals skip and the cost is a stuck agent. `roadmap.ts` stays until its 31 importers are cut. `ssh.ts` has 7 importers and is not a cheap delete.

## Not proven

- Every `(memory)` row. No web access in this run.
- Counts for open tools include generated and vendored files I could not exclude; the ratio is right, the number is not exact.
- That any delete candidate is unused: only a file-name grep was done.
