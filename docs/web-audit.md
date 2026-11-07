# Web UI audit

Survey only, no code changed. Method: `playwright-cli` on `lineclear run --demo` (a few tasks, two projects) and on `lineclear run` with an empty config (no tasks), at 1440 and 390 px, on Home `/`, `/inbox`, `/task/<id>`, `/settings` and `/<project>/roadmap`. Severity: broken (does not work), wrong (works against `docs/design.md` or the UI bar in AGENTS.md), ugly (works, looks unfinished).

## Findings

| # | Page | What happens | What should happen | How bad |
| --- | --- | --- | --- | --- |
| F1 | Home, 1440, tasks | The line is cut at the right edge: the `main` column, the `merged` end of billing-api and the track are clipped inside the content column. | The line fits its column (design.md, The line) at every width. | broken |
| F2 | Home, 1440, tasks | The working-tasks table clips its last column: "Last" shows "Which paymen". | Long text ends in an ellipsis or wraps inside the cell; no part clipped by the column edge. | wrong |
| F3 | Home, 1440, tasks | Every working row reads `Min 0`, `Input -`, `Wait -`, `Last -`. A row of dashes is shown as data. | A cell with no value is left out or says what is missing; the row shows its model, account and context (U62). | ugly |
| F4 | Home, 1440 | The Dispatcher panel opens on one sentence repeated 6 times ("Its agent stopped, and starting it again didn't help…") followed by an unrelated reply, also on an install with no tasks and no Dispatcher run. | The panel shows only real lines; an empty chat has an empty state with the composer. | wrong |
| F5 | Home, 1440, tasks | The 4 working tasks sit on the line twice (line chips and table) and the Dispatcher caption says "1 waits in the Inbox" under the same ask card above it. | Each thing once (design.md, Say each thing once). | wrong |
| F6 | Home, 390, tasks | The ask card's header is cut ("Agent · Age…"); the Dispatcher mark and label sit left of the page margin; `main` on the line is cut to "mai". The three W tasks fold into a "+3" chip that opens nothing obvious. | Header wraps, margins hold, the chip names what it opens. | wrong |
| F7 | Home, 390, tasks | Table rows show `Wait: - Check: -` with no state, model or time. The row that matters (state) is absent. | Each row leads with its state shape and the one fact that matters. | ugly |
| F8 | Home, 390 | No Dispatcher chat: the panel that is a column at 1440 has no entry (no Chat button on Home, only on other views). | A reachable chat entry on Home at every width. | wrong |
| F9 | Home, 390 and 1440, no tasks | The doctor's lines print raw as a wall of amber text: paths, `curl … \| sh`, `systemctl …` and full URLs, 5 to 7 lines tall, above the real content. | One line with a count and a `Details` row; a command only inside Details; no wall above the first thing to do (design.md, Say each thing once). | wrong |
| F10 | Home, 1440, no tasks | The empty state shows a repo picker ("Which repo should Lineclear work on?") with 9 repo names as buttons, then "Nothing is at work." as a second empty card. Two empty states, no one next step. | One empty state with one next step; repo names not listed as 9 equal chips. | ugly |
| F11 | Home, 1440 and 390 | `/inbox` renders the same as `/`; with no ask there is no Inbox page, no Inbox tab and no count in the rail or bottom bar. design.md says the Inbox tab carries the count. | An Inbox view or tab with the count in the rail and the bar. | wrong |
| F12 | Frame, 390 | The bottom bar has one item, "Home", in tiny grey text, centred, no icon, on every view; Settings is only the gear. | A bar of the views with icons, `aria-current`, and a 44 px target. | wrong |
| F13 | Task page, 1440 and 390 | The tabs (Chat, Terminal, Artifacts, Changes) float above the title, start at x=468 while the title starts at 272, and at 390 they overlap the header. | One header: title, state, then tabs aligned to the content edge. | wrong |
| F14 | Task page, 1440 | `/task/NOPE-9` (no such task) draws the same page as a real one, "No chat", with a working composer. A real task with no chat says "This task has no chat." three times (subtitle, empty state, composer). | An unknown id shows a not-found state; a task with no chat says it once and its composer is off. | wrong |
| F15 | Task page, 1440 | No state, branch, step, machine or cost in the header; the page does not say what the task is. | The header says what the task is (step title, state, model, time). | wrong |
| F16 | Settings, 1440, tasks | "No harness is logged in." sits above a populated model list (Worker, Reviewer, Planner). The empty state and the data both show. | One or the other, from one source. | wrong |
| F17 | Settings, 1440, tasks | The price row breaks badly: "/ month" wraps onto two lines and the Retired checkbox crowds it; the page ends mid-section with no bottom margin. | Fields align on one baseline; the form ends with margin. | ugly |
| F18 | Settings, 1440, no tasks | Models shows two dashed empty cards, the second ("No projects yet.") under the Models heading, which is not the Projects tab. | An empty state per tab, in its own tab. | wrong |
| F19 | Settings, 1440 | A "Chat" pill at top right opens the Dispatcher; on Home the same chat is a column. The pill is red-orange, the colour reserved for broken (design.md, tokens). | One chat entry style; orange only where something is broken. | ugly |
| F20 | Roadmap, 1440 | The Phase 1 bar is an outlined white pill, a focus-ring look on an unfocused part; "0/4" while the summary says 2 done. The big gap under the headline and above Find a step is empty. | The bar uses the track style; the count matches the line; spacing from the 8 px scale. | ugly |
| F21 | All, 1440 | The rail has no Inbox, Usage or Browsers entry and no count; Browsers exists at `/browsers` but nothing leads to it. | Every view the design lists is one click from the rail. | wrong |
| F22 | All, tasks | The demo data has no chat, artifact or change for any task, so the task page's Terminal, Artifacts and Changes tabs and long-text, 200-item and loading states could not be reached by a user going by the pages. | Demo data covers each state the UI bar lists. | wrong |

Not audited: Terminal, Artifacts and Changes tabs with data (F22), `/browsers`, `/usage`, the loading and error states of each view (they need a stopped server; `ui/test/errors.pw.ts` covers them).

## Steps

### W1 The line fits its column
Result: The line on Home shows every project to its `main` end at 1440 and 390 px, with no clipped label or track.
- why: F1, F6: the `main` column and the right end of each track are cut off at both widths.
- done when: A screenshot test at 1440 and 390 px of Home with two projects shows the whole line; no element of `The line` has a right edge past its region; the "+3" chip names what it opens.
- locks: line
- after: none
- files: ui/web/home.tsx, ui/kit, ui/test/home.pw.ts

### W2 The table shows facts, not dashes
Result: Each working row shows its state, model and time, and long text ends in an ellipsis inside its cell.
- why: F2, F3, F5, F7: cells clip, empty values show as `-` and `0`, and the line repeats the table.
- done when: No cell is clipped by the table edge at 1440 or 390; a value that is not known is left out; the 390 row leads with its state; a test with a 200-character `Last` and 200 rows passes.
- locks: task-row
- after: none
- files: ui/web/home-table.tsx, ui/web/home-rows.ts, ui/test/home.pw.ts

### W3 The Dispatcher chat is real and reachable
Result: The Dispatcher panel shows only real lines, has an empty state, and opens from Home at 390 px.
- why: F4, F8, F19: fake repeated lines, no chat entry on mobile Home, a red Chat pill.
- done when: A fresh install's chat is empty with its composer; Home at 390 px has a chat entry; the Chat pill is not the broken colour; a test reads the panel on an empty config and fails on repeated or sample lines.
- locks: chat
- after: none
- files: ui/web/chat.tsx, ui/web/chat-view.tsx, ui/web/chat-samples.ts, ui/web/frame.tsx

### W4 Health shows one line
Result: The doctor's findings are one line with a count on Home and its commands appear only in Details.
- why: F9: raw doctor text, paths and `curl | sh` push the page's first content below the fold.
- done when: Home with 7 findings shows one line and a Details row at 390 and 1440 px, the first content stays above 400 px, and no command text shows outside Details.
- locks: home
- after: none
- files: ui/web/alerts.tsx, ui/web/health.ts, ui/test/once.pw.ts

### W5 An empty Home has one next step
Result: A fresh install's Home shows one empty state with one next step instead of a repo picker and a second empty card.
- why: F10: two empty cards and nine equal repo chips.
- done when: Home with no tasks shows one empty state; the repo picker is a single field with at most 3 suggestions; screenshots at 1440 and 390 px.
- locks: home
- after: W4
- files: ui/web/home.tsx, ui/web/setup.tsx, ui/web/settings-empty.ts

### W6 The frame leads to every view
Result: The rail and the bottom bar list Home, Inbox, Browsers and Settings with icons, and the Inbox carries the count.
- why: F11, F12, F21: no Inbox tab or count, a one-item bottom bar, Browsers unreachable.
- done when: Both bars list the views of design.md with `aria-current`, 44 px targets and the Inbox count; `/inbox` with no ask shows an Inbox view; `ui/test/frame.pw.ts` passes at 390, 768 and 1440 px.
- locks: shell
- after: none
- files: ui/web/frame.tsx, ui/web/inbox-strip.tsx, ui/web/routes.ts, ui/test/frame.pw.ts

### W7 The task page has one header
Result: A task page shows its title, state, step and model in one header with the tabs beneath it, and says once when there is no chat.
- why: F13, F14, F15: floating tabs, no state, an unknown id drawn as a real task, "no chat" three times.
- done when: The tabs align to the content edge at 1440 and 390 px; `/task/NOPE-9` shows a not-found state with a link Home; a task with no chat says it once with the composer off; screenshots at both widths.
- locks: task-row
- after: none
- files: ui/web/task.tsx, ui/web/task-live.tsx, ui/web/task-changes.tsx, ui/test/task.pw.ts

### W8 Settings has one source per tab
Result: Each Settings tab shows its own empty state or its data, never both, and its form fields align.
- why: F16, F17, F18: an empty harness card above a model list, the Projects empty card under Models, a broken price row.
- done when: Models shows either the no-harness card or the list; "No projects yet." appears only in Projects; the price row aligns on one baseline at 1440 and 390 px; screenshots of each tab in both states.
- locks: settings
- after: none
- files: ui/web/settings.tsx, ui/web/settings-models.tsx, ui/web/settings-empty.ts, ui/web/settings-samples.ts

### W9 Roadmap bars use the track style
Result: A project's roadmap shows its phase bar in the track style with a count that matches the line and spacing from the scale.
- why: F20: a focus-ring-looking bar, "0/4" against "2 done", loose gaps.
- done when: The bar has no outline at rest; the phase count equals the summary; gaps are values from the 8 px scale; screenshot at 1440 and 390 px.
- locks: roadmap
- after: none
- files: ui/web/roadmap, ui/test/roadmap.pw.ts

### W10 The demo covers every state
Result: the demo states (`?state=` on the pages `lineclear run` serves) have a chat, changes, a long task title and 200 tasks in one project, so each state of the UI bar can be shot. The task page has no Artifacts tab yet, so there is no artifact state.
- why: F22: demo tasks have no chat, so the task tabs and the long-text and 200-item states cannot be reached.
- done when: The demo has one task with a chat and a change, one with a 200-character title (`?state=title`) and a project with 200 tasks (`?state=tasks200`); `ui/test` shoots each at 1440 and 390 px.
- locks: none
- after: none
- files: ui/web/samples.ts, ui/test

## Round 2

Survey only, no code changed. Method: `playwright-cli` on the pages `lineclear serve` serves from a fresh config, with the `?state=` samples (`many`, `tasks200`, `title`, `filled`, `task`), at 1440 and 390 px, on Home, `/inbox`, `/task/<id>`, `/settings`, `/<project>/roadmap`, `/browsers`, `/usage` and the Dispatcher panel. Motion was read from the code (`ui/kit/kit.css`, `ui/kit/motion.ts`), not measured in a trace. Severity as in round 1.

W1 to W10 still hold, with these exceptions: W1 (F23), W3 (F24), W6 (F27), W7 (F28). W4, W5 and W10 hold.

| # | Page | What happens | What should happen | How bad |
| --- | --- | --- | --- | --- |
| F23 | Home, 1440, `many` | The line's region ends after four projects: docs-site's track is cut in half at the region's bottom edge, above the table. | The line shows every project, or scrolls with a visible edge; no track is cut mid-row. | wrong |
| F24 | Home, fresh config, 1440 and 390 | The Dispatcher panel still opens on the same "Its agent stopped…" sentence 6 times. At 200 messages the panel draws all of them with no window. | Repeated notices collapse into one with a count; a long chat is windowed. | wrong |
| F25 | Home, 1440, `many` | The table cuts facts: "Waits for your ans…", "vendor-b/model…", "Wrote the retry …". Time reads "7 days" for a task at work. | A cut value can be read in full (title or wrap); Time is how long the task has run. | ugly |
| F26 | Home, 390, `many` | The table head is three grey boxes (State, Time, Model) that look like buttons and sit under the line; the first row starts below the fold, 900 px down. | The head is a sort control that says so, and the first row of what needs me is above the fold. | ugly |
| F27 | `/browsers` and `/task/NOPE-9`, 390 | `/browsers` with no sessions draws Home (repo picker, Dispatcher) under a Browsers tab; the not-found task page marks Inbox as the current view. | `/browsers` has its own empty state; a not-found page marks no view as current. | wrong |
| F28 | Task page, 1440 and 390 | The page opens on the tabs and the chat only: no title, state, step or model, and at 1440 the tabs start 12 px left of the chat column. F13 and F15 are only half fixed. | One header with title, state, step and model; tabs on the content edge. | wrong |
| F29 | `/web-shop/roadmap` on a project with no roadmap file, 1440 | The page is a black screen: the API answers 404 and the view draws nothing, with no frame, no message, no way back. | A not-found or error state with the frame and a link Home. | broken |
| F30 | Inbox, 390 and 1440, `many` | 200 asks show as one card and "+199 more asks"; the page has no list, no filter, no way to reach ask 2 except that link. The header count reads "99+". | The Inbox lists the asks (windowed at 200), newest first, and the count is the real number. | wrong |
| F31 | Settings, 1440, sample states | Models shows a ghost bar and an empty grey box that never resolve; no loading, empty or error text; "Tell this device about new Inbox items" floats under the card as a bare underlined link. | Loading, empty and error are each drawn and named; the notify link is a row of the Secrets or Notifications tab. | wrong |
| F32 | `/usage`, 1440 | The page has no frame (no rail, no bar) and a Close button that shows an orange focus ring on load, the colour reserved for broken. With no use it draws "$0.00" and an empty chart. | Usage sits in the frame; focus is not moved on load; no use has an empty state in words. | wrong |
| F33 | Roadmap, 1440 and 390 | The status line is one 200-character sentence ("Done about 23 Jan at the pace of the last 7 days, not sooner: 7 steps use the same part…"); every step card repeats "A customer can X and it just works." and fills the first screen. | A short status (done, at work, left, date) with the reason in Details; a card shows its result only when it differs. | ugly |
| F34 | All views | Reduced motion is handled only in `ui/kit` (`kit.css`, `motion.ts`). Route changes, tab switches, list additions and the panel opening in `ui/web` have no named motion; only one transition sits in the web CSS. | Each state change has a named motion in the kit and none under `prefers-reduced-motion`; a trace shows 60 fps. | wrong |
| F35 | Task page, Terminal and Changes tabs | Loading, error and long-output states of the tabs are not drawn in a sample (`?state=task` only fills Chat and Changes). | A sample for each state, shot at both widths. | wrong |

Not audited: `/setup`, `/chat` as a page, Terminal tab with output, motion in a performance trace.

### W11 A missing page says so
Result: A roadmap, task or view that cannot load shows its state inside the frame with a way back, never a black screen or another page.
- why: F27, F29: a 404 roadmap is blank, `/browsers` draws Home, and the not-found task marks Inbox.
- done when: `/<project>/roadmap` for an unknown project, a failed API call and `/browsers` with no session each show a named state in the frame at 1440 and 390 px; the not-found page marks no view as current; a test covers each.
- locks: routes
- after: none
- files: ui/web/app.tsx, ui/web/routes.ts, ui/web/frame.tsx, ui/test/errors.pw.ts

### W12 The line never cuts a project
Result: Home's line shows every project whole, however many there are.
- why: F23: the fifth project's track is cut in half at the region's edge.
- done when: With `?state=many` and `?state=tasks200` no track is cut by its region at 1440 and 390 px; a region that scrolls has a visible edge; screenshots at both widths.
- locks: line
- after: none
- files: ui/web/home.tsx, ui/kit, ui/test/home-line.pw.ts

### W13 The table says what it cuts
Result: A cut value in the table can be read in full, and Time is how long the task has run.
- why: F25: ellipsised state, model and last line with no way to read them; "7 days" for a running task.
- done when: Each cut cell has the full text in its title and in the row's detail; Time is the run time of the task; a test with a 200-character `Last` reads it in full.
- locks: task-row
- after: none
- files: ui/web/home-table.tsx, ui/web/home-rows.ts, ui/test/home.pw.ts

### W14 The table head sorts and the first row shows
Result: At 390 px the table head is a labelled sort control and the first row of what needs me is above the fold.
- why: F26: three unlabelled grey boxes and a table 900 px down.
- done when: The head says "Sort by" with the current key; with `?state=many` at 390 px the first table row starts above 700 px; screenshot at 390 px.
- locks: table-head
- after: W12, W13
- files: ui/web/home-table.tsx, ui/web/home.tsx, ui/test/home.pw.ts

### W15 The Dispatcher chat folds repeats and windows
Result: The Dispatcher panel shows one line with a count for a repeated notice and stays fast at 200 messages.
- why: F24: the same sentence six times on a fresh install, and every message drawn at 200.
- done when: Six equal notices in a row show as one with "x6"; 200 messages draw at most 40 nodes and scroll to the newest; a test on an empty config fails on repeats.
- locks: chat
- after: none
- files: ui/web/chat.tsx, ui/web/chat-view.tsx, ui/web/chat-samples.ts, ui/test/chat-panel.pw.ts

### W16 The task page header
Result: A task page opens on one header with title, state, step and model, with the tabs on the content edge.
- why: F28: only tabs and chat show, and the tabs sit 12 px off the column.
- done when: The header shows the four facts at 1440 and 390 px; the tabs share the chat column's left edge; screenshots at both widths and with a 200-character title.
- locks: task-page
- after: none
- files: ui/web/task.tsx, ui/web/task-live.tsx, ui/test/task.pw.ts

### W17 The task tabs draw every state
Result: Terminal and Changes each have a drawn loading, empty, error and long state.
- why: F35: only Chat and Changes are sampled, and only filled.
- done when: A sample per tab and state exists (`?state=` on the task page); each is shot at 1440 and 390 px; none shows raw error text.
- locks: task-tabs
- after: none
- files: ui/web/task-changes.tsx, ui/web/samples.ts, ui/web/lazy-samples.ts, ui/test/demo-states.pw.ts

### W18 The Inbox lists the asks
Result: The Inbox view lists every ask, windowed at 200, with the real count.
- why: F30: one card and a link for 199 asks, and a "99+" count.
- done when: `/inbox?state=many` shows a list with the newest first and at most 40 nodes drawn; the count in the rail and bar shows the number up to 999; screenshots at both widths.
- locks: inbox
- after: W11
- files: ui/web/inbox-strip.tsx, ui/web/frame.tsx, ui/test/home-inbox.pw.ts

### W19 Settings draws loading, empty and error
Result: Each Settings tab shows named loading, empty and error states, and the notify link is a row inside a tab.
- why: F31: a ghost bar that never resolves, and a bare link under the card.
- done when: Each tab has a shot of each state at 1440 and 390 px; the notify link is in the Secrets tab; no ghost bar stays after the data loaded.
- locks: settings
- after: none
- files: ui/web/settings.tsx, ui/web/settings-models.tsx, ui/web/settings-account.ts, ui/test/settings.pw.ts

### W20 Usage sits in the frame
Result: Usage shows inside the frame, without a focus ring on load, and says so when there is no use.
- why: F32: no rail or bar, an orange ring on Close, and "$0.00" over an empty chart.
- done when: `/usage` shows the rail at 1440 and the bar at 390 px; no element has focus on load; zero use shows one sentence; screenshots at both widths.
- locks: usage
- after: none
- files: ui/web/usage-sheet.tsx, ui/web/usage-mark.tsx, ui/test/usage-inbox.pw.ts

### W21 The roadmap's first screen is short
Result: The roadmap opens on a short status and at most a few steps, not a run-on sentence and repeated card text.
- why: F33: a 200-character status and "A customer can X and it just works." on every card.
- done when: The status is under 80 characters with the reason in Details; a card shows its result only when it differs from its title; screenshots at 1440 and 390 px.
- locks: roadmap
- after: none
- files: ui/web/roadmap, ui/test/roadmap.pw.ts

### W22 State changes have named motion
Result: Route changes, tab switches, list additions and the Dispatcher panel each play a named motion from the kit, and none under reduced motion.
- why: F34: only the kit handles reduced motion, and the web pages have almost no motion.
- done when: Each of the four has a motion id in `ui/kit/motion.ts`; a test with `prefers-reduced-motion: reduce` sees none play; a performance trace of each stays at 60 fps and a recording of each is stored.
- locks: motion
- after: W11, W16, W18
- files: ui/kit/motion.ts, ui/kit/kit.css, ui/web/app.tsx, ui/test/kit.pw.ts
