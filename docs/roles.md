# Roles and flow

Who does what in Lineclear, so the flow is simple and the web UI shows only what serves it. The order of work is in
[ROADMAP.md](ROADMAP.md); each module's fate is in [scope.md](scope.md). This file decides roles. The steps at the end
change the code to match.

## The flow

1. The owner states a goal in the Dispatcher chat.
2. The Dispatcher writes and keeps the roadmap of each project by default. It checks the plan with the rules, and the
   plan applies without a second approval.
3. A task agent builds one step in its own worktree.
4. A reviewer from another model reads the diff and tags findings. The merge lane merges on green.
5. A question from a task goes to its project's chat or to the Dispatcher chat. The Dispatcher answers what the
   roadmap and docs answer. It notifies the owner only for what needs them: a login or code, money beyond the budget,
   something that leaves the machine, or a real product choice.

Everything else (a silent task, a failed check, a reviewer that did not answer, a plan to apply) is the Dispatcher's or
the rule loop's job, never an owner's question.

## The first measure: parallel work must beat one agent

Every role and process below must pass this before it stays. The test:

- Where: the devbox, one machine, the same project and the same 5 consecutive roadmap steps (disjoint locks, a
  mix of small and medium).
- Two runs: the swarm as it runs today (Dispatcher, planner, coordinators, rule loop, reviewers, Inbox) and one pi
  agent doing the 5 steps one after the other with the same model, the same review setting and no other role.
- Numbers for each run: merged steps per hour (start of the first to merge of the last) and tokens per merged step
  (every role's tokens, from the usage stores, added).
- The rule: a role or process that costs more tokens or more time per merged step than it saves goes. A role
  passes only if the swarm's merged steps per hour is higher and its tokens per merged step is not more than the
  single agent's by more than the review and merge steps it adds that the single agent does not need. The swarm run
  is repeated with one role off at a time (the planner, the coordinator, the night watch, the Inbox) to see which
  one pays.

A rough figure that exists today and is not this measure: `git log` on this checkout's main shows 54 step commits in
about 37 hours, about 1.5 merged steps an hour across all projects, with no token count. Step L609 runs the real
measure.

## 1. The role map

The owner's model has five roles: **Dispatcher**, **task agent**, **reviewer**, **rule loop** (a program, not a model)
and the **owner**. Each role the code has today maps to one of them or is gone.

| Today | Files | Becomes | Why |
| --- | --- | --- | --- |
| Dispatcher | `src/dispatcher.ts`, `src/direction.ts`, `src/heal.ts`, `src/chat.ts`, `src/inbox-answer.ts` (`applyMove`), `ui/kit/chat.tsx`, `ui/web/chat*.tsx` | **Dispatcher**, grows | It keeps the roadmap and answers task questions. Its space already exists as the coordinator of space `dispatcher`. |
| Planner | `src/plan.ts`, `src/plan-brief.ts`, `templates/plan.md`, `settings.models.planner`, `src/requests.ts`, `ui/web/roadmap/since.tsx` | **Dispatcher** (the check stays, the separate planning task goes) | `lineclear plan` starts a task agent only to write steps. The Dispatcher writes them. `lineclear plan submit` and the rule checks (`autoplan.ts`, `stepcheck.ts`, `roadmap.ts`) stay, because the rules check any plan. |
| Coordinator (a space's chat) | `server/server/live/prompts.ts` (`coordinatorPrompt`), `src/asks.ts` (`coordinatorCards`, `routeCoordinator`), `server/server/live/chats-logs.ts`, `restart.ts`, `source-restarts.ts` | **Project chat**: the chat of a project where its task agents ask. Not a second manager | It is the place a task's question goes first. Its work of planning and steering moves to the Dispatcher. |
| Coordinator's run commands (`progress`, `checkpoint`, `complete`, stopping goals, `autopilot-runs.json`) | `src/cli.ts` lines 56 to 58, `server/server/live/source-cli.ts`, `source-subcommands.ts` | **Gone** | A roadmap step with a done-when is the stopping goal; a second way to run a long goal costs tokens and a second state. |
| Task agent | `server/server/live/engine/engine-launch.ts`, `engine-helpers.ts`, `worktrees.ts`, `src/task-work.ts`, `src/task-steps.ts`, `pi/` | **Task agent** | Builds one step. Unchanged. |
| Reviewer | `src/review-call.ts`, `server/server/live/engine/merge.ts`, `engine-merge.ts`, `settings.reviewer`, `src/doneproof.ts` | **Reviewer** | One model call on the diff, from another company. Unchanged. It stays only if the first measure says a review pays. |
| Rule loop | `src/rules.ts`, `src/tick-project.ts`, `src/starts.ts`, `src/stalls.ts`, `src/stall-class.ts`, `src/waits.ts`, `src/spread.ts`, `src/start-failures.ts` | **Rule loop**, a program | Starts ready steps, runs the stall ladder (nudge, restart, next model), merges. It needs no model. |
| Night watch | `src/night-watch.ts` (76 lines), called from `src/rules.ts` | **Dispatcher** (its checklist becomes one Dispatcher message the rule loop sends) | The rule loop already finds stalls and unstarted steps. A model checking again every 2 hours at night costs tokens for what the loop knows. The first measure decides if it stays at all. |
| Backup | `src/store-copies.ts` (195 lines), called from `src/rules.ts:133`, read by `src/doctor.ts` | **Rule loop** (one more job) | An hourly copy of the stores is a program. It needs no role of its own. |
| Inbox (a role by name) | `src/inbox.ts`, `src/inbox-answer.ts`, `src/asks.ts`, `src/cards.ts`, `src/notify.ts` | **Owner's pushes and the Dispatcher chat**, see section 2 | |
| `owner` | `ui/web/*`, `server/server/push.ts` | **Owner** | Gets a push for the four needs, and the chat. |

Nothing is a "supervisor" over another role. `ui/brand/roles.ts` names nine icons (you, dispatcher, roadmap, rules,
worker, reviewer, main, planner, inbox): `planner` and `inbox` go with the roles above.

## 2. The Inbox

### What reaches it

Counted from the store `~/.config/lineclear/inbox/*.json` (one file per item, field `kind`, `since`, `answer`,
`closed`), items whose `since` is in the last 7 days. The store holds 211 items in all, first on 5 Nov 12:33 and last
on 5 Nov 19:50 UTC: all items were added in about 7 hours, so the 7 days count is the whole store. The count below
is that burst, not a steady week.

| Kind | Items | Share |
| --- | --- | --- |
| stuck | 168 | 84% |
| plan | 14 | 7% |
| step | 12 | 6% |
| outward | 6 | 3% |
| login | 1 | 0.5% |
| release | 0 | 0% |
| **All** | **201** | |

How they ended: 137 closed because the owner wrote to the task anyway, 28 answered in the Inbox, 19 closed because the
task was done, 9 because it was gone, 5 applied by themselves (auto), 3 still open.

By project: omalabra 98, lineclear 95, omatalous 2, the rest 6.

### How many the Dispatcher could answer

Each item was read by hand (the question text and the answer given). The Dispatcher can answer an item when the
roadmap, the docs or the rule loop's own state answer it, and the owner need is none of the four named above.

| Kind | Items | The Dispatcher answers | Needs the owner | Why |
| --- | --- | --- | --- | --- |
| stuck | 168 | 168 | 0 | The answer is a restart, a nudge or "keep waiting". 164 are tasks with no sign of life or a turn with no question; 4 are notices that an update was put back (a notice, not a question). 11 were answered by the owner with "keep waiting", "I will look" or "ok". |
| plan | 14 | 14 | 0 | A plan the rules checked and the owner always approved (9 approved, 5 applied by themselves). Under the owner's model the Dispatcher writes it, so there is no one to approve it. |
| step | 12 | 11 | 1 | 11 are a reviewer that did not answer, a check that failed on load or a step started many times with no merge: a rule or a retry. 1 is a step that needs a real power cut by hand (L172). |
| outward | 6 | 2 | 4 | Make the repo public, choose a licence, a power cut, an expired Graph token (a login): the owner. 2 asked the owner to confirm a docs list (`docs/design.md`) that the docs answer. |
| login | 1 | 0 | 1 | A login to a portal: the owner. |
| **All** | **201** | **195 (97%)** | **6 (3%)** | |

### Decision: merge into the chats, then delete the view

- Keep the ask as a thing: a task asks with `lineclear ask` or `lineclear wait owner`, and the owner can answer by a
  push, a chat card or a link. 6 of 201 items (3%) are the owner's; they are 1 or 2 a day at most.
- Delete the Inbox as a place the owner has to visit: 195 of 201 items (97%) were questions the Dispatcher can answer, and
  137 (68%) closed because the owner wrote to the task in its chat instead.
- A task's question goes to its project's chat first (the code already reads those cards: `routeCoordinator` in
  `src/asks.ts`). The Dispatcher answers it. A card for the owner appears in the Dispatcher chat only for a login, money,
  something that leaves the machine or a real product choice, with the push to the phone that exists today.
- The kinds are cut to `login`, `outward` (money included, `--about spending`) and `choice`. The kinds `stuck`, `plan`,
  `step` and `release` go: the rule loop and the Dispatcher handle them, and a roadmap change that applies by itself
  can be undone in the chat.
- A task is in Needs you only with an open card or `lineclear wait owner` (L430 already makes this true).

## 3. The views

Routes are in `ui/web/routes.ts`. Each view names the role it serves.

| View | Route | Files | Serves | Decision |
| --- | --- | --- | --- | --- |
| Home | `/` | `ui/web/home.tsx`, `home-table.tsx`, `home-rows.ts`, `inbox-strip.tsx` | Owner and Dispatcher: which projects and tasks run | Keep. The ask strip on top becomes one "Needs you" line that opens the Dispatcher chat. |
| Inbox | `/inbox`, `/inbox/<ask>` | `ui/web/inbox-strip.tsx`, `ui/kit/inbox-card.tsx`, `routes.ts` | Nobody once asks go to the chats | **Delete** (L605, L606). |
| Chat | `/chat` | `ui/web/chat.tsx`, `chat-view.tsx`, `ui/kit/chat.tsx`, `markdown.tsx`, `no-dispatcher.tsx` | Dispatcher, owner | Keep. It shows the owner's cards. |
| Roadmap | `/<project>/roadmap` | `ui/web/roadmap/index.tsx`, `chain.tsx`, `line.tsx`, `summary.tsx`, `common.tsx` | Dispatcher (writes it), owner (reads it) | Keep. |
| Step | `/<project>/roadmap/<step>` | `ui/web/roadmap/step.tsx`, `since.tsx` | Task agent (its step), Dispatcher | Keep. `since.tsx` shows a planner's request: it follows the Dispatcher's plans instead (L603). |
| Task | `/task/<id>` | `ui/web/task.tsx`, `task-live.tsx`, `task-changes.tsx`, `ui/kit/task-chat.tsx`, `task-head.tsx`, `terminal.tsx`, `diff.tsx` | Task agent, reviewer (the diff) | Keep. The project's chat for the task lives here. |
| Browsers | `/browsers`, `/browsers/<session>` | `ui/web/browsers.tsx`, `ui/kit/browsers.tsx` | Task agent, owner (takes over a login or captcha) | Keep. It serves the login need and nothing else. |
| Usage | `/usage` | `ui/web/usage-sheet.tsx`, `usage-mark.tsx`, `ui/kit/spend-charts.tsx`, `account-price.tsx` | Owner: money beyond the budget | Keep. The first measure's numbers show here. |
| Settings | `/settings` | `ui/web/settings*.tsx`, `ui/kit/settings.tsx`, `model-list.tsx`, `run-switch.tsx` | Owner, rule loop (its models and limits) | Keep. The planner's model list goes (L603). |
| Setup | `/setup` | `ui/web/setup.tsx` | Owner, first run | Keep. |

No view serves the reviewer or the rule loop on its own: the reviewer's findings show in the task view, the rule
loop's decisions in Home. None is added. `ui/web/routes.ts` has 9 views today (Step is a part of Roadmap); Inbox is the
one removed, so 8 remain.

## 4. The steps

Written in the roadmap step format. They go after the core steps of [ROADMAP.md](ROADMAP.md): each names the open
core step it waits for when their files overlap. The locks are disjoint from every lock there and from each other.
Copy them into ROADMAP.md when the owner takes the plan; this file is the reasoning.

### L600 Questions go to the project chat
Result: A question from a task lands in its project's chat first, and the Dispatcher chat gets it only when the project chat does not answer.
- why: 195 of 201 Inbox items in the measured burst were answerable by the Dispatcher, and 137 closed because the owner wrote to the task.
- done when: `lineclear ask` and `lineclear wait owner` from a task put a card in its project's chat, not the Inbox view; a test asks a question the roadmap answers and sees no owner push.
- locks: ask-route
- after: L485, L430
- files: src/asks.ts, src/cards.ts

### L601 The Dispatcher answers tasks
Result: The Dispatcher answers a task's question from the roadmap and docs and asks the owner only for a login, money, an outward act or a choice.
- why: the owner's model says the Dispatcher answers what the roadmap and docs answer; today the 168 stuck items and 11 step items reach a person.
- done when: the Dispatcher prompt names the four owner needs; an eval case in `test/dispatcher-eval/` asks a stuck task, a reviewer that did not answer and a licence choice, and sees an answer, an answer and an owner card.
- locks: dispatcher-answers
- after: L600
- files: src/dispatcher.ts, server/server/live/prompts.ts, test/dispatcher-eval

### L602 The Inbox keeps three kinds
Result: The Inbox has login, outward and choice items only, so a stuck task or a plan never becomes an item.
- why: of 201 items in the measured burst 168 were stuck, 14 plan and 12 step, and 97% of all were answered without the owner.
- done when: `src/inbox.ts` has the kinds `login`, `outward` and `choice`; `KIND_LABEL` and the code of `stuck`, `plan`, `step` and `release` are deleted with their tests; `wc -l` of `src/inbox.ts`, `src/inbox-answer.ts` and `src/notify.ts` is 400 or less in all (561 today).
- locks: inbox-kinds
- after: L601, L430, L485
- files: src/inbox.ts, src/inbox-answer.ts, src/notify.ts

### L603 The Dispatcher plans itself
Result: A plan is written by the Dispatcher in its own chat, so no separate planning task starts and Settings has no planner model.
- why: `lineclear plan` starts a task agent only to write steps, which costs a worktree, a start and tokens that the Dispatcher already has in context.
- done when: `lineclear plan <project> "<goal>"` hands the goal to the Dispatcher chat and starts no task; `lineclear plan submit` and the rule checks run unchanged; `templates/plan.md` is read by the Dispatcher, and `models.planner` is gone from settings. A test plans a goal and sees no new task in `lineclear task list`.
- locks: dispatcher-plans
- after: L601, L496
- files: src/plan.ts, src/plan-brief.ts, src/requests.ts, templates/plan.md, ui/web/roadmap/since.tsx

### L604 A plan applies without the owner
Result: A plan that passes the rule checks applies by itself and can be undone from the chat, with no approval card.
- why: 9 of 14 plan items were approved without a note and 5 applied by themselves; none was rejected.
- done when: `plansAreAuto` is gone and a plan that passes `planProblems` merges; a rejected check sends it back to the Dispatcher; `lineclear undo` of an applied plan is reachable from the chat card; a test sees no Inbox item for a plan.
- locks: plan-apply
- after: L603, L602
- files: src/autoplan.ts, src/dispatcher.ts

### L605 The Inbox view is gone
Result: The web UI has no Inbox page: `/inbox` and `/inbox/<ask>` land on the Dispatcher chat with the card.
- why: 3% of the items need the owner, and the chat shows those cards.
- done when: `ui/web/inbox-strip.tsx` and `ui/kit/inbox-card.tsx` no longer hold a view; `View` in `ui/web/routes.ts` has no `inbox`; an old `/inbox/7` link opens `/chat` on that card; `bun run ui:test` has no Inbox page screenshot.
- locks: view-inbox
- after: L602
- files: ui/web/routes.ts, ui/web/app.tsx, ui/web/inbox-strip.tsx, ui/kit/inbox-card.tsx

### L606 Home shows one Needs you line
Result: Home shows a single "Needs you" line when a login, money, an outward action or a product choice waits, and nothing when none does.
- why: the ask strip of 345 lines was built for 201 items in 7 hours; the owner's need is 1 or 2 a day.
- done when: `ui/web/home.tsx` shows the line with a link to the chat card; `wc -l ui/web/inbox-strip.tsx` is 120 or less or the file is deleted; the screenshot at 1440 and 390 px has the line, the empty state and 3 items.
- locks: home-needs
- after: L605
- files: ui/web/home.tsx, ui/web/home-table.tsx, ui/web/home-rows.ts

### L607 Run commands of a chat gone
Result: `lineclear progress`, `checkpoint` and `complete` and stopping-goal runs no longer exist; a step's done-when is the one stopping goal.
- why: two ways to run a long goal (a stopping goal and a roadmap step) cost a second state and tokens.
- done when: the three commands are deleted from `src/cli.ts` and `server/server/live/source-cli.ts`; `autopilot-runs.json` is not read; `lineclear --help` lists none; the project chat still answers.
- locks: coordinator-cli
- after: L442
- files: src/cli.ts, server/server/live/source-cli.ts, server/server/live/source-subcommands.ts

### L608 Watch and backup are loop jobs
Result: The night watch is one message the rule loop sends only on a stall, and the hourly store copy is a plain rule-loop job.
- why: the rule loop already finds a stalled task and an unstarted step, so a model checklist every 2 hours at night costs tokens for what a program knows.
- done when: `src/night-watch.ts` is deleted or under 30 lines; a night tick with nothing stalled sends nothing; a test stalls a task at night and sees one Dispatcher message. `src/store-copies.ts` stays and is called from `rules.ts` only.
- locks: watch-backup
- after: L601
- files: src/night-watch.ts, src/rules.ts, src/store-copies.ts

### L609 Swarm against one agent
Result: A table shows merged steps per hour and tokens per merged step on the devbox, swarm against one agent, and names roles that cost too much.
- why: parallel work is worth keeping only if it merges more steps an hour for no more tokens each; no number says so today.
- done when: a doc in `docs/numbers.md` has two runs on the devbox on the same 5 steps with disjoint locks: the swarm as it runs and one pi agent in a row with the same model and review setting; each run lists merged steps per hour and tokens per merged step summed over every role; then the swarm run repeated with the planner, the coordinator, the night watch and the Inbox off one at a time. Each role whose run costs more tokens or time per merged step than it saves gets a step that deletes it.
- locks: swarm-measure
- after: L603, L608
- files: docs/numbers.md, src/measure.ts

## What this file does not decide

- The reviewer stays as a role for now. L609's numbers can still remove it.
- A merge lane, the checks and the install are not roles; they are not touched here.
- A step's lines count is `wc -l` on the commit that merges it, as in ROADMAP.md.
