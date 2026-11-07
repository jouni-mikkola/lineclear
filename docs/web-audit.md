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

The open steps of this file are in [ROADMAP.md](ROADMAP.md).

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
