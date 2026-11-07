# Scope

Each module of Lineclear, the core job of [idea.md](idea.md) it serves, its lines outside tests, and whether it stays.
A module that serves no core job is deleted. Two modules that do one job become one: the one marked merge goes into
the other. Each delete or merge names its area (D1 to D9 below). What is left to build, the open areas too, is in
[ROADMAP.md](ROADMAP.md). Lines are counted on main as of the commit that last changed this file.

## The core jobs

- **Dispatcher**: the one chat that takes a request and hands it to the planner.
- **Plan**: the roadmap, the planner, the rule checks of a plan and the step check.
- **Rules**: the rule loop that starts ready steps on locks and slots, declared waits and the stall ladder.
- **Run**: a worker in its own worktree, through herdr and pi.
- **Review and merge**: a reviewer from another company, the done-when proof and the merge lane on green.
- **Inbox**: only a login, money beyond the budget or what leaves the machine, with a push to the phone.
- **View**: Home, the Roadmap and step pages, a task's terminal and diff, Agent browsers, Settings.
- **Models**: model lists per role, accounts and their fallback, tokens and cost.
- **Machines**: other machines over SSH through herdr.
- **Install**: the one-command install, update with rollback, doctor and uninstall.
- **Secrets**: secrets per project and the page's safety.
- **Checks**: the light check and the gates that keep main green.

## The delete areas

| Area | What goes | State |
| --- | --- | --- |
| D1 | The demo world and `lineclear run --demo` | gone |
| D2 | Every agent CLI but pi; the catalog beyond pi in `settings-catalog.ts` is left | open: L443 |
| D3 | The parts of the old board screen no page uses: sidebar order, unread, folders, slash commands, the side panel, the activity rows | open: L442 |
| D4 | The agent-browser stack, so playwright-cli (`src/browsers.ts`) is the one browser | gone |
| D5 | Automations and their triggers | gone |
| D6 | Artifacts | gone |
| D7 | The plugin loader and the herdr plugin route with its own self-update | gone |
| D8 | Search and "since you last looked" | gone |
| D9 | The second secrets command | gone |

The open areas hold 2115 of 48492 lines.

## The server (`server/`), 19367 lines

| Module | Core job | Lines | Verdict | Why |
| --- | --- | ---: | --- | --- |
| `server/scripts/store-formats.ts` | Install | 159 | keep | store files an update must still read |
| `server/scripts/test.ts` | Checks | 215 | keep | the server's test runner |
| `server/server/app.ts` | Run | 283 | keep | the server's API and live link |
| `server/server/live/activity.ts` | none | 246 | delete (D3) | the old screen's chat rows of tool steps; no page reads them |
| `server/server/live/agent*` | Run | 1315 | keep | agents: records, events, start, delivery, state |
| `server/server/live/args.ts` | Run | 193 | keep | the board command's words |
| `server/server/live/box.ts` | Machines | 295 | keep | SSH to another machine until herdr's forwarding does it all (L95) |
| `server/server/live/chatlines.ts` | Dispatcher | 255 | keep | trim: no reactions or artifact lines (D3, D6) |
| `server/server/live/chats*` | Dispatcher | 1021 | keep | chats, the Dispatcher's among them |
| `server/server/live/commands.ts` | none | 153 | delete (D3) | slash commands typed into an agent from a chat |
| `server/server/live/engine/` | Run | 3019 | keep | tasks: launch, briefs, worktrees, state, retire |
| `server/server/live/engine/branch-work.ts` | Review and merge | 19 | keep | what a branch holds before a merge |
| `server/server/live/engine/engine-merge.ts` | Review and merge | 169 | keep | checks and merge of a task |
| `server/server/live/engine/engine-tidy.ts` | Rules | 281 | keep | lets go of stuck merge heads |
| `server/server/live/engine/github.ts` | Review and merge | 362 | keep | pull requests and their checks |
| `server/server/live/engine/lane*` | Review and merge | 168 | keep | the merge lane |
| `server/server/live/engine/merge.ts` | Review and merge | 402 | keep | the merge |
| `server/server/live/engine/stalls.ts` | Rules | 108 | keep | quiet and late tasks |
| `server/server/live/estimates.ts` | View | 75 | keep | how long tasks took, for time left |
| `server/server/live/folders.ts` | none | 175 | delete (D3) | the old sidebar's add project; src/add-project.ts does it |
| `server/server/live/health.ts` | Rules | 353 | keep | machine load: slots and the load limit |
| `server/server/live/herdr-forward.ts` | Machines | 142 | keep | herdr's forwarding to other machines |
| `server/server/live/herdr.ts` | Run | 371 | keep | the herdr adapter |
| `server/server/live/install.ts` | Machines | 207 | keep | the helper on another machine, until L95 |
| `server/server/live/log-list.ts` | Run | 29 | keep | an agent's logs |
| `server/server/live/machines*` | Machines | 770 | keep | machines and their links |
| `server/server/live/mfs.ts` | Machines | 103 | keep | a machine's own files |
| `server/server/live/paste-watch.ts` | Run | 32 | keep | the pasted brief |
| `server/server/live/project-models.ts` | Models | 19 | keep | a project's model per role, read from its settings |
| `server/server/live/places.ts` | Run | 295 | keep | spaces (projects) on machines |
| `server/server/live/prompts.ts` | Run | 221 | keep | what each agent is told at its start |
| `server/server/live/quiet.ts` | Rules | 20 | keep | machine news wakes no model |
| `server/server/live/readers/` | Run | 436 | keep | reads pi's log |
| `server/server/live/readers/steps.ts` | none | 370 | delete (D3) | tool calls in plain words for the old screen |
| `server/server/live/recovery.ts` | Machines | 44 | keep | retry of a failed link |
| `server/server/live/requested-news.ts` | Run | 60 | keep | news to the agent that asked |
| `server/server/live/restart.ts` | Rules | 120 | keep | the stall ladder's restart |
| `server/server/live/revive.ts` | Rules | 136 | keep | the stall ladder's restart from notes |
| `server/server/live/runtime.ts` | Run | 15 | keep | what a CLI reports of itself |
| `server/server/live/secret*` | Secrets | 45 | keep | secret capabilities and paths |
| `server/server/live/secrets.ts` | Secrets | 378 | keep | the one vault |
| `server/server/live/settings-catalog.ts` | Models | 282 | merge (D2) | keep pi only; the rest of the catalog goes |
| `server/server/live/settings-store.ts` | Models | 474 | keep | role, model and effort settings |
| `server/server/live/settings.ts` | Models | 15 | keep | settings entry |
| `server/server/live/source*` | Run | 2636 | keep | the live source: state, actions, the board command |
| `server/server/live/streaming.ts` | Dispatcher | 37 | keep | a reply as it streams |
| `server/server/live/task-ids.ts` | Run | 170 | keep | one id series |
| `server/server/live/terminal-clock.ts` | View | 50 | keep | the task's live terminal |
| `server/server/live/trust.ts` | Run | 71 | keep | trusted worktrees |
| `server/server/live/tunnel.ts` | Machines | 83 | keep | the way back from another machine, until L95 |
| `server/server/live/unread.ts` | none | 56 | delete (D3) | the old screen's unread marks |
| `server/server/live/user-name.ts` | View | 16 | keep | the owner's name |
| `server/server/live/worktree.ts` | none | 234 | delete (D3) | the old side panel; src/task-changes.ts reads the diff |
| `server/server/lock.ts` | Run | 52 | keep | one server per store |
| `server/server/main.ts` | Run | 88 | keep | trim: drop the demo switch (D1) |
| `server/server/push.ts` | Inbox | 106 | keep | push alerts to the phone |
| `server/server/root.ts` | Install | 4 | keep | trim: no frozen releases (D7) |
| `server/server/source.ts` | Run | 57 | keep | trim: one live source, no demo (D1) |
| `server/server/store.ts` | Run | 37 | keep | the server's small files |
| `server/shared/` | Run | 1007 | keep | types and helpers the server shares |
| `server/shared/activity.ts` | none | 387 | delete (D3) | the old screen's steps in plain words |
| `server/shared/alerts.ts` | Inbox | 214 | keep | what a push says |
| `server/shared/attention.ts` | none | 19 | delete (D3) | native menus of the old screen |
| `server/shared/order.ts` | none | 193 | delete (D3) | the old screen's sidebar order |

## The CLI and rule loop (`src/`, `pi/`, `bin/`, `install.sh`), 15483 lines

| Module | Core job | Lines | Verdict | Why |
| --- | --- | ---: | --- | --- |
| `bin/` | Install | 13 | keep | the `lineclear` command |
| `install.sh` | Install | 529 | keep | the one-command install |
| `pi/` | Run | 410 | keep | the pi extension: rules, guards, nudge, compaction |
| `src/add-project.ts` | Plan | 201 | keep | a new project from a repo |
| `src/agent-status.ts` | View | 72 | keep | what runs where |
| `src/ask-model.ts` | Plan | 70 | keep | one model question |
| `src/asks.ts` | Inbox | 436 | keep | rule or Inbox for each ask |
| `src/autoplan.ts` | Plan | 304 | keep | the planner's chain check |
| `src/board.ts` | Install | 40 | keep | starts the board where no service manager does |
| `src/brief.ts` | Run | 160 | keep | a step's brief |
| `src/browsers.ts` | View | 354 | keep | the agents' browsers (playwright-cli) |
| `src/builds.ts` | Install | 65 | keep | release folders and rollback |
| `src/cards.ts` | Inbox | 55 | keep | reads a needs-you card |
| `src/chat-limits.ts` | Dispatcher | 66 | keep | what one message takes |
| `src/chat.ts` | Dispatcher | 517 | keep | the web chat with the Dispatcher |
| `src/check-runs.ts` | Review and merge | 63 | keep | a branch's GitHub checks |
| `src/cli.ts` | Install | 216 | keep | the CLI entry; drop `run --demo` (D1) |
| `src/company.ts` | Models | 21 | keep | which company a model is from |
| `src/decision-dedupe.ts` | Rules | 25 | keep | one decision line per reason |
| `src/direction.ts` | Plan | 32 | keep | the owner's direction for planners |
| `src/dispatcher.ts` | Dispatcher | 198 | keep | the Dispatcher's space and routing |
| `src/doctor*` | Install | 417 | keep | doctor |
| `src/doneproof*` | Review and merge | 295 | keep | the done-when proof gate |
| `src/fill-setup.ts` | Models | 22 | keep | setup defaults |
| `src/full.ts` | Models | 151 | keep | an account that ran out |
| `src/git.ts` | Run | 30 | keep | the one git helper |
| `src/harness-pi.ts` | Models | 34 | keep | pi's sessions |
| `src/heal.ts` | Rules | 15 | keep | slow fixes in their own process |
| `src/health.ts` | Install | 62 | keep | disk and service health for doctor |
| `src/herdr.ts` | Run | 10 | keep | herdr's command and socket |
| `src/hold.ts` | Rules | 21 | keep | hold new work while a machine is busy |
| `src/home*` | View | 653 | keep | Home's data |
| `src/inbox*` | Inbox | 466 | keep | the Inbox and its answers |
| `src/install-paths.ts` | Install | 85 | keep | install folders |
| `src/kept-read.ts` | View | 89 | keep | cached reads for Home |
| `src/lineclear-client.ts` | View | 87 | keep | the web server's link to the board server |
| `src/live*` | View | 215 | keep | live changes to the pages |
| `src/main-branch.ts` | Run | 22 | keep | a repo's main branch |
| `src/measure.ts` | Models | 150 | keep | tokens and cost per step |
| `src/models.ts` | Models | 272 | keep | the model registry |
| `src/night-watch.ts` | Rules | 76 | keep | the night watch: its window and its sends to the Dispatcher |
| `src/notify.ts` | Inbox | 95 | keep | an Inbox item as a push |
| `src/owner-steps.ts` | Rules | 52 | keep | the owner's steps in a tick |
| `src/parts.ts` | Plan | 94 | keep | parts, locks and files of a step |
| `src/paths.ts` | Install | 116 | keep | data and config paths |
| `src/plan-brief.ts` | Plan | 9 | keep | a planning task's brief |
| `src/plan.ts` | Plan | 235 | keep | `lineclear plan` |
| `src/prefs.ts` | View | 24 | keep | what the owner chose to see |
| `src/process-group.ts` | Checks | 21 | keep | ends a check and its children |
| `src/progress.ts` | View | 260 | keep | a roadmap's progress |
| `src/project*` | Plan | 742 | keep | projects, their settings and their feed |
| `src/published.ts` | Secrets | 22 | keep | the tailnet name the page answers on |
| `src/read-aside.ts` | View | 34 | keep | slow reads in their own process |
| `src/reader-ask.ts` | Plan | 3 | keep | the step check's question |
| `src/real-world.ts` | Rules | 239 | keep | the rule loop's real world |
| `src/requests.ts` | Dispatcher | 182 | keep | a request handed to the planner |
| `src/resolve.ts` | Dispatcher | 121 | keep | a project by name |
| `src/roadmap*` | Plan | 721 | keep | the roadmap: parse, check, view |
| `src/routine.ts` | Rules | 43 | keep | routine steps |
| `src/review-call.ts` | Review and merge | 155 | keep | a review as one model call on the diff |
| `src/rules.ts` | Rules | 252 | keep | the rule loop |
| `src/serve.ts` | Install | 151 | keep | `lineclear serve` and the board's words |
| `src/session-text.ts` | Models | 57 | keep | tokens read from pi's sessions |
| `src/setup.ts` | Models | 77 | keep | `lineclear setup` |
| `src/spread.ts` | Machines | 269 | keep | steps on other machines |
| `src/ssh.ts` | Machines | 11 | keep | SSH commands |
| `src/stall-class.ts` | Rules | 299 | keep | the stall classes |
| `src/stalls.ts` | Rules | 383 | keep | the stall ladder |
| `src/starts.ts` | Rules | 133 | keep | starts a ready step |
| `src/status.ts` | View | 124 | keep | `lineclear status` |
| `src/step-check-cost.ts` | Plan | 13 | keep | the step check's cost |
| `src/step-page.ts` | View | 170 | keep | a step's page |
| `src/stepcheck.ts` | Plan | 274 | keep | the step check |
| `src/store-copies.ts` | Install | 195 | keep | copies of the store |
| `src/task-changes.ts` | Review and merge | 73 | keep | a task's diff |
| `src/task-detail.ts` | View | 115 | keep | a task's row |
| `src/task-live.ts` | View | 164 | keep | a task's terminal; drop the artifacts tab (D6) |
| `src/task-read.ts` | Run | 45 | keep | one task list call |
| `src/task-steps.ts` | Rules | 104 | keep | the loop's record of a project |
| `src/task-work.ts` | Models | 64 | keep | what a task runs, in decisions.jsonl |
| `src/tick-project.ts` | Rules | 458 | keep | one project's tick |
| `src/time.ts` | Run | 3 | keep | time constants |
| `src/tmpdirs.ts` | Checks | 163 | keep | temp and cache folders |
| `src/top-cmd.ts` | View | 8 | keep | `lineclear top` |
| `src/totp.ts` | Secrets | 54 | keep | login codes |
| `src/uninstall.ts` | Install | 96 | keep | `lineclear uninstall` |
| `src/wait*` | Rules | 485 | keep | declared waits |
| `src/web*` | View | 857 | keep | the web server and its routes |
| `src/web-guard.ts` | Secrets | 39 | keep | page token and host check |
| `src/worktree.ts` | Run | 64 | keep | a task's worktree fields |
| `src/world.ts` | Rules | 75 | keep | what a tick needs from outside |
| `src/zone.ts` | Run | 21 | keep | time zones |

## The web UI (`ui/`), 12044 lines

| Module | Core job | Lines | Verdict | Why |
| --- | --- | ---: | --- | --- |
| `ui/brand/` | View | 354 | keep | the mark and tokens |
| `ui/kit/` | View | 3829 | keep | the design system |
| `ui/kit/account-price.tsx` | Models | 92 | keep | an account's price |
| `ui/kit/chat.tsx` | Dispatcher | 582 | keep | the Dispatcher chat |
| `ui/kit/cold-read.tsx` | Plan | 44 | keep | the step check's answer |
| `ui/kit/inbox-card.tsx` | Inbox | 208 | keep | an Inbox card |
| `ui/kit/markdown.tsx` | Dispatcher | 332 | keep | answers as markdown |
| `ui/kit/model-list.tsx` | Models | 138 | keep | a role's model list |
| `ui/kit/no-dispatcher.tsx` | Dispatcher | 36 | keep | chat with no Dispatcher yet |
| `ui/kit/settings.tsx` | Models | 183 | keep | Settings parts |
| `ui/kit/spend-charts.tsx` | Models | 271 | keep | spend per account |
| `ui/kit/task-chat.tsx` | View | 75 | keep | a task's chat; drop reactions (D3) |
| `ui/web/` | View | 4004 | keep | the pages |
| `ui/web/chat*` | Dispatcher | 754 | keep | the chat view |
| `ui/web/inbox-strip.tsx` | Inbox | 345 | keep | the ask strip |
| `ui/web/roadmap/since*` | Plan | 119 | keep | applied plans and the steps of a request |
| `ui/web/settings*` | Models | 529 | keep | Settings |
| `ui/web/setup.tsx` | Models | 149 | keep | first run |

## Repo tools (`scripts/`), 1598 lines

| Module | Core job | Lines | Verdict | Why |
| --- | --- | ---: | --- | --- |
| `scripts/` | Checks | 934 | keep | the check and its tools |
| `scripts/canary.ts` | Install | 9 | keep | the canary |
| `scripts/formats.ts` | Install | 36 | keep | old store files still read |
| `scripts/gates/` | Checks | 293 | keep | lint, dead code, borders |
| `scripts/release*` | Install | 116 | keep | releases |
| `scripts/smoke.ts` | Install | 210 | keep | the update's smoke check |
