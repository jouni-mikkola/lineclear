# Plan v0.2: the web UI

The web steps of v0.2. They come after the core steps they read from and rank last, by the owner's order in
[release.md](../release.md). Roles and views: [roles.md](../roles.md). Earlier findings: [web-audit.md](../web-audit.md)
(F1 to F35, round 2 at `0d4689c2a`).

## What is wrong today

Walked with `playwright-cli` on the running board (one project, 8 tasks at work) and on its `?state=` samples, at
1440 and 390 px, on main at `ca37f44`.

| # | What | Where | How bad |
| --- | --- | --- | --- |
| V1 | The rail's project link opens `/lineclear/roadmap`, but the API knows the project as `lineclear-eb`: "There is no project named lineclear." The step page's back link says "lineclear-eb roadmap". One project, two names. | `ui/web/frame.tsx:155` (`p.roadmap ?? p.name`; `/api/home` sends no `roadmap`), `ui/web/roadmap/step.tsx` | broken |
| V2 | The roadmap says "82 done, 0 at work" while Home shows 8 at work on the same project. | `src/progress.ts`, `ui/web/roadmap/summary.tsx` | wrong |
| V3 | A task page marks Inbox as current in the rail and the bar, also for `/task/NOPE-9`. It opens on the bottom of the brief, with no title, state, step, model or machine (F27, F28 still open). | `ui/web/frame.tsx`, `ui/web/task.tsx` | wrong |
| V4 | Since L509 a task agent is a pi RPC child with no pane: its Terminal tab is always empty (`server/server/live/agent-terminals.ts:26` returns `''` for an RPC pane). 399 lines still draw it. | `ui/web/task-live.tsx` (75), `ui/kit/terminal.tsx` (160), `src/task-live.ts` (164) | wrong |
| V5 | The Dispatcher panel opens on one notice 6 times ("Its agent stopped, and starting it again didn't help.") on the real board (F4, F24 still open). | `ui/web/chat-view.tsx` | wrong |
| V6 | Orange (`--lc-accent`, `#d97757`) paints states: a working train (`ui/brand/rail.ts:122`, `paint("accent")`), the idle Dispatcher box (`ui/kit/line-labels.tsx:103`), chat icons (`ui/kit/chat.tsx:51,68,271`). brand.md: orange is the mark, the focus ring and the selected tab only, and a train at a station is white. Next to stop red (`#e5484d`) a working train reads as broken. | brand, kit | wrong |
| V7 | Home's table: Step reads "lineclear L587" (project name on every row of one project, an id, not the result); Model is "claude-bridge/c…" on all 8 rows; Last is empty on all 8. At 390 the same row reads "LE-398: L587 One way to run on a machine". | `ui/web/home-table.tsx`, `ui/web/home-rows.ts` | wrong |
| V8 | No window on long lists: `?state=tasks200` draws 2,865 nodes and 80 rows, `?state=many` 4,518 nodes and a 3,948 px page. At 390 a train label overlaps "merged". | `ui/kit/table.tsx`, `ui/kit/line*.tsx` | wrong |
| V9 | `/browsers` with no session draws Home under the Browsers tab (F27 still open). | `ui/web/browsers.tsx` | wrong |
| V10 | `/usage` is a dialog over Home with an orange ring on Close at load (F32 still open). It shows "$0.00 today" while 8 agents spend tokens on subscriptions: no tokens per merged step, no budget per role or task. | `ui/web/usage-sheet.tsx`, `ui/kit/spend-charts.tsx` | wrong |
| V11 | Two ways to set a role's model: the select-and-Save form (the `/setup` form, `ui/web/setup.tsx`, 150 lines) above the ordered lists (`ui/kit/model-list.tsx`). The planner is still listed. | `ui/web/settings-models.tsx` | wrong |
| V12 | Three machines run v0.2, but a machine shows only as "Runs on" inside a row's details (`ui/web/home-table.tsx:129`); the health line says "3 things on this machine need fixing" for one (`ui/web/health.ts:91`). | Home | wrong |
| V13 | Pages stay current four ways: the `/api/live` stream (`src/live.ts` re-reads every watched answer every 6 s), a 1.5 s poll every query falls back to (`ui/web/data.ts:52`), a 1.5 s Browsers poll that spawns a process per read (`ui/web/data.ts:180`), and a fixed 3 s reconnect (`ui/web/live.ts:101`). | `ui/web/data.ts`, `ui/web/live.ts`, `src/live.ts` | wrong |
| V14 | The roadmap status is a 130-character sentence; "At work and next" lists 6 steps, none at work; the step page says "no evidence yet" under each done-when, from the proof checker L567 deletes. | `ui/web/roadmap/` | ugly |

Size (`wc -l` of `.ts`, `.tsx` and `.css`): `ui/` is 10,976 lines (brand 472, kit 5,808, web 4,696); `ui/test` is
4,608 lines of `.ts`, 2,450 of them in 27 `.pw.ts` files. No
check runs them (`test/light-checks.test.ts` forbids a browser in a workflow): they run with `bun run ui:test`.

## Target

Eight views, as roles.md decides, all in one frame: Home, Chat, Roadmap and Step, Task, Browsers, Usage, Settings.
The Inbox view is gone (L605) and `/setup` becomes the first open of Settings > Models. The rail and the 390 px bar
list Home, Chat, Browsers, Usage and Settings; Chat is the right column from 1024 px.

Home answers "is the line clear": the line, the working tasks by result title, one row per machine (agents, slots,
free memory; red only when down), and one Needs you line (L606). The task page opens on one header (title, state,
step, model, machine, time, tokens) over Chat and Changes; the agent's tool calls are in its chat, so no terminal.
Usage shows tokens per merged step per role against its budget; dollars only for a paid key.

Any repo works: a project has one key in every link, and a repo with no `docs/ROADMAP.md` gets progress from
merged tasks and a roadmap page that says so. One theme: green clear, amber waits for you, red only broken, orange
only the mark, the focus ring and the selected tab; a UI test fails on any other use. Pages update one way: the
server sends a change when the store changed (`PRAGMA data_version`, [SQLite](https://www.sqlite.org/pragma.html#pragma_data_version)),
with no poll beside it. Long lists draw a window. Each step deletes more than it adds, or names the core job only it
serves.

The open steps W1 to W22 of ROADMAP.md are replaced: W1, W12 by W122; W2, W13, W14 by W120; W3, W15 by W114;
W4 by W123; W5 by W115; W6, W18 go with the Inbox (L605) and W112; W7, W16 by W110; W8, W19 by W116; W9, W21 by
W107; W10, W17 by W111; W11 by W105, W112, W113; W20 by W117; W22 by W126.

## Steps

Each step is in [ROADMAP.md](../ROADMAP.md), or dropped with the step that does its job.

- W100 Theme gate for every view: in ROADMAP.md.
- W101 Working trains are white: in ROADMAP.md.
- W102 Chat and box marks not orange: in ROADMAP.md.
- W103 One project key in links: in ROADMAP.md.

### W104 The step page names its project
Result: A step page's back link shows the project's name, and its done-when items carry no "no evidence yet".
- why: V1, V14; the proof checker is gone after L567.
- done when: the back link text equals the rail's project name; the page text holds no "evidence"; `ui/test/step-page.pw.ts` at 1440 and 390 px.
- locks: step-page, file-ui-web-roadmap-step-tsx
- after: L567, W103
- files: ui/web/roadmap/step.tsx, ui/test/step-page.pw.ts

- W105 A repo with no roadmap works: in ROADMAP.md.
- W106 Roadmap counts match Home: in ROADMAP.md.

### W107 Roadmap opens short
Result: The roadmap opens on a status under 80 characters, a phase bar in the track style, and the steps at work first.
- why: V14, F20, F33.
- done when: the status line is at most 80 characters with the reason in Details; "At work and next" starts with the steps that have a working task; `ui/test/roadmap.pw.ts` at 1440 and 390 px.
- locks: roadmap-summary, file-ui-web-roadmap-summary-tsx, file-ui-web-roadmap-bar-tsx
- after: W106
- files: ui/web/roadmap/summary.tsx, ui/web/roadmap/bar.tsx, ui/test/roadmap.pw.ts

- W108 No Terminal tab on a task: in ROADMAP.md.

### W109 No terminal route
Result: The web server has no task terminal route, so no page asks herdr for a task's screen.
- why: V4, owner priority 2: `src/task-live.ts` (164 lines) serves only the deleted tab.
- done when: `src/task-live.ts` and `test/task-live.test.ts` are deleted, and `src/web.ts` and `src/web-ctx.ts` no longer import it; `GET /api/task/<id>/terminal` answers 404; the server's `agent-terminals.ts` is named for the core plan, not changed here.
- locks: web-routes, file-src-web-routes-ts, file-src-web-ts, file-src-web-ctx-ts
- after: W108
- files: src/task-live.ts, src/web-routes.ts, src/web.ts, src/web-ctx.ts, test/task-live.test.ts

### W110 The task header says what it is
Result: A task page opens on one header: result title, state, step, model, machine, run time and tokens so far.
- why: V3, F28, owner priority 3 (tokens per task show where the task is).
- done when: the header shows the 7 facts at 1440 and 390 px, also with a 200-character title; the tabs share the chat's left edge (0 px apart); `ui/test/task.pw.ts` checks both.
- locks: task-head, file-ui-kit-task-head-tsx, file-ui-web-task-tsx
- after: W108
- files: ui/kit/task-head.tsx, ui/web/task.tsx, ui/test/task.pw.ts

- W111 Changes tab draws every state: in ROADMAP.md.

### W112 Rail and bar after the Inbox
Result: The rail and the 390 px bar list Home, Chat, Browsers, Usage and Settings, and mark only the view you are on.
- why: V3, F12, F19, F21, F27: a task page marks Inbox, a red-orange Chat pill sits on other views.
- done when: `ui/test/frame.pw.ts` at 390, 768 and 1440 px: 5 entries, 48 px targets at 390, `aria-current` on exactly one for each view and on none for a task or a not-found page; no Chat pill.
- locks: frame, file-ui-web-frame-tsx, file-ui-kit-rail-tsx
- after: L605, W103
- files: ui/web/frame.tsx, ui/kit/rail.tsx, ui/test/frame.pw.ts

- W113 Browsers has its own empty state: in ROADMAP.md.
- W114 Chat folds repeats, windows 200: in ROADMAP.md.

### W115 Setup is a Settings tab
Result: The first run opens Settings > Models with one ordered list per role; the select-and-Save form and `/setup` are gone.
- why: V11, owner priority 2: two ways to set one model.
- done when: `ui/web/setup.tsx` and `ui/test/setup.pw.ts` are deleted; `/setup` lands on `/settings`; `first-run.pw.ts` passes on a fresh config at 1440 and 390 px; `ui/` loses at least 150 lines.
- locks: settings-models, file-ui-web-settings-tsx, file-ui-web-settings-models-tsx, file-ui-web-routes-ts
- after: L603, L605
- files: ui/web/setup.tsx, ui/web/settings-models.tsx, ui/web/settings.tsx, ui/web/routes.ts, ui/test/setup.pw.ts, ui/test/first-run.pw.ts

### W116 Settings draws every state
Result: Each Settings tab draws its own loading, empty and error state, and alerts are one row of a tab, not a bare link.
- why: F16 to F18, F31, V12.
- done when: each tab has a shot of each state at 1440 and 390 px in `ui/test/settings.pw.ts`; Settings imports no `Alerts` and shows no machine finding (Home has them, W123).
- locks: settings-states, file-ui-web-settings-tsx
- after: W115, W123
- files: ui/web/settings.tsx, ui/web/settings-account.ts, ui/test/settings.pw.ts

### W117 Usage is a view in the frame
Result: Usage opens inside the frame at 1440 and 390 px, with no dialog over Home and no focus moved on load.
- why: V10, F32.
- done when: `/usage` shows the rail or the bar; `document.activeElement` is the body on load; `usage-sheet.tsx` becomes `usage.tsx`; `usage-inbox.pw.ts` becomes `usage.pw.ts` with its Inbox cases deleted.
- locks: usage-view, file-ui-web-app-tsx
- after: L605
- files: ui/web/usage-sheet.tsx, ui/web/usage.tsx, ui/web/usage-mark.tsx, ui/web/app.tsx, ui/test/usage-inbox.pw.ts, ui/test/usage.pw.ts

### W118 Usage shows tokens per step
Result: Usage shows each role's tokens per merged step over 7 days against its budget, and dollars only where a paid key spent them.
- why: V10, owner priority 3.
- done when: on a fixture usage store (3 roles, 10 merged steps) Usage draws 3 role rows whose numbers equal L609's measure on the same store; a subscription account never shows `$0.00`; shots at 1440 and 390 px.
- locks: usage-charts, file-ui-kit-spend-charts-tsx
- after: W117, L609, L717
- files: ui/kit/spend-charts.tsx, ui/kit/account-price.tsx, ui/test/usage.pw.ts

### W120 Home rows say the result
Result: Each working row shows its step's result title, a short model name and its state; the project shows only with two or more.
- why: V7, F2, F3, F25, F26.
- done when: with one project no row holds the project name; Model is the name without the provider; an empty column is not drawn; 1440 and 390 px show the same words; a 200-character title reads in full in the row's details; `ui/test/home.pw.ts`.
- locks: home-rows, file-ui-web-home-table-tsx, file-ui-web-home-rows-ts
- after: L606
- files: ui/web/home-table.tsx, ui/web/home-rows.ts, ui/test/home.pw.ts

- W121 Tables draw a window: in ROADMAP.md.
- W122 The line never cuts a project: in ROADMAP.md.

### W123 Home shows each machine
Result: Home shows one row per machine with its agents, free slots and memory, red only when it is down, and its findings in Details.
- why: V12; the core job Machines has no view, and "this machine" is wrong with 3.
- done when: with 3 fixture machines (one down) Home shows 3 rows at 1440 and 390 px; the down one has the red lamp and its doctor lines only in Details; `ui/web/health.ts` names no "this machine"; `ui/test/once.pw.ts` passes.
- locks: home-machines, file-ui-web-home-tsx, file-ui-web-health-ts, file-ui-test-once-pw-ts
- after: L580, L606
- files: ui/web/machines.tsx, ui/web/health.ts, ui/web/home.tsx, ui/test/once.pw.ts

- W124 Pages update one way: in ROADMAP.md.

### W125 The server sends on change
Result: The live stream sends an answer only when the store changed, with no 6 s re-read of every watched answer.
- why: V13; 45 agents on 3 machines with pages open must cost nothing while nothing changes.
- done when: with 45 fixture tasks and 3 open streams on an unchanged store, `/api/home` is built 0 times in 60 s; a task's state change reaches a stream in under 2 s; `test/live.test.ts` holds both.
- locks: live-server, file-src-live-ts, file-src-web-ts
- after: L701, W109
- files: src/live.ts, src/web.ts, test/live.test.ts

### W126 State changes have named motion
Result: View changes, tab switches, list additions and the chat panel play one named motion each, and none under reduced motion.
- why: F34.
- done when: each of the 4 has an id in `ui/kit/motion.ts`; with `prefers-reduced-motion: reduce` 0 animations run; a trace of each holds 60 fps; a recording of each is stored.
- locks: motion, file-ui-kit-motion-ts, file-ui-web-app-tsx
- after: W112, W117
- files: ui/kit/motion.ts, ui/kit/kit.css, ui/web/app.tsx, ui/test/motion.pw.ts

### W127 The web passes the UI bar
Result: Every view passes the UI bar and the theme gate, and `ui/` is smaller than at the start of v0.2.
- why: AGENTS.md (the UI bar), owner priorities 2 and 5.
- done when: `bun run ui:test` has 0 failures on one machine; W100's list of known uses is emptied here and the gate passes; `ui/` is under 10,500 lines (10,976 at `ca37f44`); docs/design.md lists the 8 views as built.
- locks: web-bar, file-docs-design-md, theme-gate
- after: W101, W102, W104, W105, W107, W109, W110, W111, W113, W114, W116, W118, W120, W121, W122, W124, W125, W126
- files: docs/design.md, ui/test/theme.pw.ts

## Run at once

With no core step open, W100, W101, W103, W105, W106, W108, W111, W113, W114, W121, W122 and W124 share no file
and run at once (12), with W102 too (13). W104, W107, W109, W110 follow one web step each. W112, W115, W117 wait for L605; W120 and
W123 for L606; W104 for L567; W118 for L609 and L717; W123 for L580; W125 for L701. L701 and L717 are in
[core.md](core.md); the other `after` ids are in ROADMAP.md at `ca37f44`. Where core.md replaces one, its new id holds.
