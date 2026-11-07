# Design system

Every view of Lineclear is built from the parts here, so each part is built once and meets one bar. The look is
U1's chosen Home direction, The line ([brand.md](brand.md)): projects as tracks that fill green, tasks as state
shapes, one answer first.

`lineclear run` serves the web pages at `http://127.0.0.1:7420/` (`LINECLEAR_HOST` and `LINECLEAR_PORT` change
it). Its data answers only to an address, `localhost` or a name listed in `LINECLEAR_HOSTS` (comma separated), so
a web page cannot point its own name at this machine to read it.

## The views as they are

The pictures of the states below are the UI bar's own sample states.

## The frame

Every view sits in one frame, `ui/web/frame.tsx`. From 1024 px a rail on the left (`SideRail`) holds the mark, the
views and a row per project. The mark goes Home and opens nothing. Content runs up to 1128 px on 12 columns, centred in the
room right of the rail. Home has no bar; under 1024 px the other views have a bottom bar (`BottomBar`) that leads Home, and
Settings is a gear at the top right.

- The rail and the bar are links, with `aria-current` on the view you are on. Only the Inbox tab carries a count: what
  waits for you.
- Each view, project, step and ask has its own address, listed in `ui/web/routes.ts`: `/`, `/inbox`, `/inbox/<ask>`,
  `/chat`, `/usage`, `/browsers`, `/browsers/<session>`, `/settings`, `/<project>/roadmap` and
  `/<project>/roadmap/<step>`. A reload lands on the same thing.
- Each view is its own file under `ui/web/`; the Roadmap view is the folder `ui/web/roadmap/`, one file per part.
- `ui/test/frame.pw.ts` shoots every view at 390, 768, 1440 and 2560 px and opens each address cold and after a reload.

### When a read fails

A failed read never takes the data away: each view keeps its last answer and the frame draws one notice above it
(`Notice`). Grey and quiet while it waits: "Not updated since 14:02.
Retrying." (any other failure), "No connection. Not updated since 14:02. Retrying." (the browser is offline) and
"The server is slow to answer." (no answer after 5 s). Red only for what is broken, with the one command that fixes
it: "Lineclear is not running." with `lineclear run`, and "The roadmap file does not pass its check." with the file,
the line and the message of `lineclear roadmap check .`. The laid track shows only where no data came yet. Each view
sits in a `ViewBoundary`: an answer a view cannot draw shows the broken state in its place and the rest of the page
stays. `ui/test/errors.pw.ts` tests each.

## The views

Home is at `/`, one page, built only from the parts below. Both read the
server's data, again every 1.5 seconds, so a change shows within 3 s and whenever the page shows again, with no AI:

- `GET /api/home`: each project's tasks from Lineclear's files, and its progress from its roadmap and git.
  Projects are read at most once a second.
  - A task's state is its Lineclear state, and "waits for you" when its last card asks for you. A project's main is
    broken when Lineclear marks it red: only then is anything red.
  - Progress is roadmap steps merged on main when the project has `docs/ROADMAP.md`, else merged tasks.
- `GET /api/inbox`: the open Inbox items, newest first. `POST /api/inbox/<n>` with `{"choice": "..."}` answers one,
  as `lineclear inbox answer` does, with `"note"` for a plan's reason to reject. It takes only JSON from the
  server's own pages.

### The step check

A fresh model from another company reads each new step cold (L62). Its answer shows in two places, both built from the
kit's `ColdRead`:

- On a plan's Inbox card: one line per step, its id, `go` in green and the checking model. The model's own words, the
  step said back, open one tap away on the line. The line is the card's only mention of the check.
- On a step's page (`/<project>/roadmap/<step>`, U45): a "Read cold" row at the top of its history, one line per answer,
  oldest first. A no-go shows here in amber with what the model found missing, and the go that followed it; a step with
  no answer says "not reported".

A no-go never shows in the Inbox: the planner gets it and fixes the plan first, so the card carries go lines only, and
the server sends none other (`stepChecks` of an Inbox item). The states of the UI bar hold: a long model name or text
truncates or wraps inside the width, a plan with no check shows no check line, and the page reads in its loading and
error states like the rest of the step page. Screenshots: `ui/test/step-check.pw.ts`.

Home is the command center: one page, and what happens opens on it, in place. Usage, the Inbox and the browsers are
parts of Home, not pages. A page exists only where it earns one: Settings, and a project's full roadmap
(`/<project>/roadmap`). `/inbox`, `/usage`, `/browsers` and `/chat` open Home.

No part of Home has an explanation, a subtitle, a hint or a label that describes the UI. A part is its figures and its
names; an empty part is empty, drawn with its own shape. No headline and no counts line: what waits for you is a lamp
on its task and the Inbox strip.

Parts, at 1440 x 900, with no scroll of the page (each part scrolls inside itself when it holds more):

- **The line** across the top, 25 % of the height at most. A lane per project, its steps as stations, the work in
  progress as trains that move along it through build, check, review and merge. Past about 8 projects the lanes fold to
  one row each, the ones with a lamp first. A project's name opens its full roadmap.
- **The Inbox strip** above the line, only when something needs the owner: one row, the first ask with its answers
  as buttons, and a count when more. It is absent otherwise, and its height is not reserved. Answering turns the lamp
  green and the strip leaves with its height; Undo stays 5 s.
- **What is happening now** in the centre: one dense row per working task, in a table (`DataTable`, aligned numbers).
  Columns: project, step, machine, stage, what the agent did last and how long ago, files changed and check result.
  Cost so far is not a column: it shows in the opened row only. A stuck task names its reason in its row, in the stage
  column, in amber. A click opens the row in
  place: the log tail, the diff stat, the check output, the review findings, the task's browser to watch or take
  over, and the answer field when it waits for you. Opening pushes the rows below down with `part-change` and shifts
  nothing above it. One row open at a time. With nothing working the table is empty and its columns still show.
- **The Dispatcher chat** in the right column, 400 px, always there, its input at the bottom. Repeated system cards
  fold into one line with a count.
- **Usage mark** in the footer of the chat column: one thin week bar per account side by side in one strip, with no numbers and no labels.
  It is neutral, amber only when the pace says that account's week runs out before its reset, and never red (red is
  broken only). Home shows no spend figures, no charts and no per-account bar rows. Hover or focus shows the exact
  figures. A click opens a sheet over Home with the full usage (accounts, session and week, reset times, pace, "not
  reported" where a source says nothing) and the spend (this month paid and API equivalent, the last 14 days, and per
  merged step). Spend lives in that sheet only; the one exception is a task's cost so far in its opened row. `/usage` opens Home with the sheet open.
- **390 px.** One column: the Inbox strip, the chat, and under it a bar that opens a sheet
  with the line, and the usage mark, which a tap opens as its sheet like a click on a desktop.
  Rows of the table become two-line cards that open the same way.
- **Motion** on Home carries information or is not there: a train moving, a lamp turning, a row opening, a bar
  growing. No idle loop, shimmer or hover wiggle. Details open at once.
- Every part has its states designed: loading (its own shape laid still), empty, error that keeps what was shown,
  long text, and 200 items.

What waits for you and what each part reads comes from `/api/home`; the table's rows, the log tail and the check
output come from the same data, with no AI.

An overview (Home, Usage, Roadmap) states facts plainly with no call-out: no headline that gives a verdict the facts
would let you judge for yourself. Usage opens with each account's use, limit and reset time, then the machines' slots
as sidings, then the agents at work, then tokens and cost. `test/board-usage.test.ts` fails when a Usage frame of
`docs/design/board.html` holds a verdict phrase. The phrases:
"Work can start now", "Work can wait", "Nothing can start", "You are good", "All good", "Plenty of room",
"Running low".

A change in the files plays its motion: a task starting, moving or finishing on Home, an item arriving in the Inbox.

| State | Home 1440 px | Home 390 px | Inbox 1440 px | Inbox 390 px |
|---|---|---|---|---|
| Filled | [picture](../ui/test/screens/home-filled-1440.png) | [picture](../ui/test/screens/home-filled-390.png) | [picture](../ui/test/screens/inbox-filled-1440.png) | [picture](../ui/test/screens/inbox-filled-390.png) |
| Empty | [picture](../ui/test/screens/home-empty-1440.png) | [picture](../ui/test/screens/home-empty-390.png) | [picture](../ui/test/screens/inbox-empty-1440.png) | [picture](../ui/test/screens/inbox-empty-390.png) |
| Loading | [picture](../ui/test/screens/home-loading-1440.png) | [picture](../ui/test/screens/home-loading-390.png) | [picture](../ui/test/screens/inbox-loading-1440.png) | [picture](../ui/test/screens/inbox-loading-390.png) |
| Error | [picture](../ui/test/screens/home-error-1440.png) | [picture](../ui/test/screens/home-error-390.png) | [picture](../ui/test/screens/inbox-error-1440.png) | [picture](../ui/test/screens/inbox-error-390.png) |
| Long text | [picture](../ui/test/screens/home-long-1440.png) | [picture](../ui/test/screens/home-long-390.png) | [picture](../ui/test/screens/inbox-long-1440.png) | [picture](../ui/test/screens/inbox-long-390.png) |
| 200 items | [picture](../ui/test/screens/home-many-1440.png) | [picture](../ui/test/screens/home-many-390.png) | [picture](../ui/test/screens/inbox-many-1440.png) | [picture](../ui/test/screens/inbox-many-390.png) |

### Roadmap for leaders

`/<project>/roadmap` is one page of goals for someone who leads the work: no step ids, no rail. Each line of "Done
means" in the project's roadmap is a goal (a roadmap without it uses its phases), a row in a Now, Next or Later
column: Now has a step in progress, Next has a ready step, Later waits on others. A finished goal is listed apart. A goal
shows a progress bar, its expected date (its open steps at the merge pace of the last 7 days) and a lamp with one
sentence why. A tap opens its phases and steps. Below: what was delivered lately (the newest merges) and the
decisions that wait for the owner, each a link to its Inbox ask. The page prints on one A4 page, in light colours.
The phase track is at `/<project>/roadmap/track`; a step's page is `/<project>/roadmap/<step>`.

The confidence is plain code (`src/goals.ts`), the same every time:

- At risk: a step on the goal's critical path (its longest chain of open steps) waits for you, waits for a model
  quota, or has stalled.
- Late: the expected date is later than it was 7 days ago, read from git (one day of slack for the hourly rounding).
- On track: otherwise.

Pictures: [goals 1440 px](../ui/test/screens/roadmap-goals-filled-1440.png), [goals 390 px](../ui/test/screens/roadmap-goals-filled-390.png).

Each project's phase track is at `/<project>/roadmap/track`, linked from the goals page. It reads
`GET /api/roadmap/<project>`: the roadmap and its states as the rule loop reads them from `origin/main`, the tasks
of the project's space, and the recent merges, at most once a second. The headline says which phase and what
starts next. The phase track fills each phase with its share done. Each step is a card with its id, title, state,
locks and waits as text; pointing at a card or focusing it marks the cards it waits for and the cards that wait for
it, with no lines between them. One click opens its why, done-when, task, review rounds and commits. Done phases fold
to one line, and the page opens on the first phase with open steps. The history lists recent merges, newest first.

A step whose task starts glows once (`task-start`), and a merged step slides to done while its phase fills
(`task-finish`).

| State | Roadmap 1440 px | Roadmap 390 px |
|---|---|---|
| Filled | [picture](../ui/test/screens/roadmap-filled-1440.png) | [picture](../ui/test/screens/roadmap-filled-390.png) |
| Empty | [picture](../ui/test/screens/roadmap-empty-1440.png) | [picture](../ui/test/screens/roadmap-empty-390.png) |
| Loading | [picture](../ui/test/screens/roadmap-loading-1440.png) | [picture](../ui/test/screens/roadmap-loading-390.png) |
| Error | [picture](../ui/test/screens/roadmap-error-1440.png) | [picture](../ui/test/screens/roadmap-error-390.png) |
| Long text | [picture](../ui/test/screens/roadmap-long-1440.png) | [picture](../ui/test/screens/roadmap-long-390.png) |
| 400 steps, one waits for 250 | [picture](../ui/test/screens/roadmap-many-1440.png) | [picture](../ui/test/screens/roadmap-many-390.png) |
| Lineclear's own roadmap | [picture](../ui/test/screens/roadmap-this-1440.png) | [picture](../ui/test/screens/roadmap-this-390.png) |

The agents' browsers are at `/browsers`. It reads `GET /api/browsers`: each open
[playwright-cli](https://github.com/microsoft/playwright-cli) session (`playwright-cli list --all --json`), named after its
Lineclear task with an optional suffix such as `-review`, with that task's plain title. Each is a card with a live
picture, read through `playwright-cli run-code` at most once a second per session and two at a time, and only
while the card is on screen. A session an
Inbox login or code item names comes first and is marked "Waits for you", and that Inbox item links straight to it.
A card shows its task, its project and the page's host, never the page title, and an outlined page with that host
until its first picture comes. A session no task has folds under "Other sessions", unless it waits for you. The headline and the Browsers
badge both count the browsers that wait for you, and the badge says so to a screen reader and on hover.
One click opens `/browsers/<session>` to watch it, one more takes it over: a click on the picture clicks the page,
and a box and a few keys type into it. The server takes input only for a session taken over here, only as JSON from
its own pages, and only as a click, text, a listed key or a scroll. `LINECLEAR_PLAYWRIGHT_CLI` sets the command.

A session that opens grows in at its place (`browser-open`) and one that closes shrinks away (`browser-close`),
while the other cards slide.

| State | Browsers 1440 px | Browsers 390 px |
|---|---|---|
| Filled | [picture](../ui/test/screens/browsers-filled-1440.png) | [picture](../ui/test/screens/browsers-filled-390.png) |
| Empty | [picture](../ui/test/screens/browsers-empty-1440.png) | [picture](../ui/test/screens/browsers-empty-390.png) |
| Loading | [picture](../ui/test/screens/browsers-loading-1440.png) | [picture](../ui/test/screens/browsers-loading-390.png) |
| Error | [picture](../ui/test/screens/browsers-error-1440.png) | [picture](../ui/test/screens/browsers-error-390.png) |
| Long text | [picture](../ui/test/screens/browsers-long-1440.png) | [picture](../ui/test/screens/browsers-long-390.png) |
| 200 sessions | [picture](../ui/test/screens/browsers-many-1440.png) | [picture](../ui/test/screens/browsers-many-390.png) |
| Watching one | [picture](../ui/test/screens/browser-watch-1440.png) | [picture](../ui/test/screens/browser-watch-390.png) |
| Taken over | [picture](../ui/test/screens/browser-taken-1440.png) | [picture](../ui/test/screens/browser-taken-390.png) |
| Closed while watched | [picture](../ui/test/screens/browser-gone-1440.png) | [picture](../ui/test/screens/browser-gone-390.png) |

Settings are at `/settings`. It reads `GET /api/settings`.

Each role's models for a project, best first: one click moves a model up or down, and
the order is saved in the project's settings. Last, each project's check and health commands, editable, and its
secrets by name only: a value never reaches a page.

A machine that is added drops in at its place (`machine-add`), a machine's new state shape pops in
(`machine-state`) and a model slides to its new place (`model-move`). A new load reading changes the bar at once.

| State | Settings 1440 px | Settings 390 px |
|---|---|---|
| Filled | [picture](../ui/test/screens/settings-filled-1440.png) | [picture](../ui/test/screens/settings-filled-390.png) |
| Only this machine, no project | [picture](../ui/test/screens/settings-empty-1440.png) | [picture](../ui/test/screens/settings-empty-390.png) |
| Loading | [picture](../ui/test/screens/settings-loading-1440.png) | [picture](../ui/test/screens/settings-loading-390.png) |
| Error | [picture](../ui/test/screens/settings-error-1440.png) | [picture](../ui/test/screens/settings-error-390.png) |
| Long text | [picture](../ui/test/screens/settings-long-1440.png) | [picture](../ui/test/screens/settings-long-390.png) |
| 200 machines, 200 projects | [picture](../ui/test/screens/settings-many-1440.png) | [picture](../ui/test/screens/settings-many-390.png) |
| A doctor open | [picture](../ui/test/screens/settings-doctor-1440.png) | [picture](../ui/test/screens/settings-doctor-390.png) |

The Chat is at `/chat`, a tab in every view, a word like every tab. You talk to the
Dispatcher there, the one chat for every project. Its head shows who you talk to, with the signal mark, and what it
does now. The thread is a normal chat: your words on the right, its answers on the left with the mark, rendered as
markdown (code, lists, links, tables) with the images they name. A picture shows as a thumbnail that opens large
with one tap; any other file as a chip with its name and size. The composer stays at the bottom, above a phone's
keyboard, and takes words and files by paste, drop or its button; one tap sends. Enter sends with a keyboard; on a
touch screen it is a new line.

The page reads `GET /api/chat/events`, the chat as server-sent events. Each message shows the moment Lineclear reads
it, and while the Dispatcher works its current step shows under the dots. Lineclear reads an answer whole, so the
words of one message do not come one by one. A file goes first to `POST /api/chat/files`, at most 10 MB, and only
images (PNG, JPEG, GIF, WebP), PDF and text, each checked by its first bytes. Lineclear hands it to Lineclear's own
upload, which saves it in Lineclear's inbox on the Dispatcher's machine, and its path goes with the message
(`POST /api/chat`): the same as an attachment in Lineclear's chat, so each chat shows the other's files. An answer
shows an image it names by its full path in the Dispatcher's folder or a project's repo, never one from the web: that
is a link. Lineclear talks to the Dispatcher through Lineclear's own server on the same machine.

Empty shows one line on what the Dispatcher does and three questions to tap. A message on its way says Sending; one
that did not go says why with Try again. While the Dispatcher writes, three grey dots beat (`chat-typing`) with what
it does now. Offline, a line says so and Send waits. A new message slides up into place (`chat-arrive`).

| State | Chat 1440 px | Chat 390 px |
|---|---|---|
| Filled, files attached | [picture](../ui/test/screens/chat-filled-1440.png) | [picture](../ui/test/screens/chat-filled-390.png) |
| Empty | [picture](../ui/test/screens/chat-empty-1440.png) | [picture](../ui/test/screens/chat-empty-390.png) |
| Loading | [picture](../ui/test/screens/chat-loading-1440.png) | [picture](../ui/test/screens/chat-loading-390.png) |
| Error with retry | [picture](../ui/test/screens/chat-error-1440.png) | [picture](../ui/test/screens/chat-error-390.png) |
| Long text | [picture](../ui/test/screens/chat-long-1440.png) | [picture](../ui/test/screens/chat-long-390.png) |
| 200 messages | [picture](../ui/test/screens/chat-many-1440.png) | [picture](../ui/test/screens/chat-many-390.png) |
| Sending | [picture](../ui/test/screens/chat-sending-1440.png) | [picture](../ui/test/screens/chat-sending-390.png) |
| Streaming | [picture](../ui/test/screens/chat-streaming-1440.png) | [picture](../ui/test/screens/chat-streaming-390.png) |
| Offline | [picture](../ui/test/screens/chat-offline-1440.png) | [picture](../ui/test/screens/chat-offline-390.png) |
| No Dispatcher yet | [picture](../ui/test/screens/chat-none-1440.png) | [picture](../ui/test/screens/chat-none-390.png) |

The UI bar for the views is `ui/test/views.pw.ts`, `ui/test/roadmap.pw.ts`, `ui/test/browsers.pw.ts`,
`ui/test/settings.pw.ts` and `ui/test/chat.pw.ts`, with `ui/test/fake-playwright-cli` for playwright-cli and
`ui/test/fake-lineclear-server.ts` for Lineclear's server. It writes the files the server reads (`ui/test/fixture.ts`) and
checks each motion.

### The line

Home draws all projects as one railway. The signal box (Dispatcher) sits top left with its writing dots. Each project is a
track that runs left to right through four zones: In line (sidings), At work, In review, main. The zone names stand over
the first track with their counts.

| Role | Drawn form | Colour |
|---|---|---|
| Dispatcher | Signal box, three dots that beat while it writes | Outline `--text-2`, dots `--accent` |
| Rules | Points (a blade) at the start of At work | `--text-3` |
| Step waiting | Empty siding, an outlined wagon with its id | `--text-3` outline |
| Worker | Train, 28 px high, 4 px grid; its wagon is the context load | `--accent` fill |
| Reviewer | Signal before the junction: grey while review runs, green when clear | `--text-3`, `--ok` |
| Waits for you | Amber signal on the train | `--wait` |
| Planner | Pencil with dashed track laid ahead, count `+N` | `--text-3` dashed |
| Account | Engine with a fill bar and its percentage | `--ok`, `--wait` near full |
| Merged | Train joins main, the count at the station steps up | `--ok` |
| Broken main | Red main track | `--bad` |

A train sits in At work at a spot by its progress, so a move along the track shows real work. A train waits with no
motion. Past what fits a zone shows a `+N` pill. Point at a train: a card with title, result, role, model, time and its
load; click opens its Inbox item when it waits, else the project's roadmap. On touch the first tap shows the card.

Layouts: 1440 px has all four zones, wagons and five engines; 768 px keeps wagons and shortens engine names; 390 px drops
wagons and shows two engines. One project fills the row height of one track; six projects stack tracks at 4 px grid
spacing under one signal box. Zero trains show empty sidings; twelve show the pills. Dark theme only.

Motion (all in the table under Motion): `request-run`, `task-start` (points throw), `train-progress` (1200 ms, the one
long move), `task-wait` (one ring), `task-finish`, `load-shrink`, `track-ahead`, `engine-swap`. Nothing loops at rest.
Reduced motion shows the end state at once. Offline, the line dims and says when it was last read.

| State | Home 1440 px | Home 390 px |
|---|---|---|
| Nothing at work | [picture](../ui/test/screens/home-idle-1440.png) | [picture](../ui/test/screens/home-idle-390.png) |
| Line clear | [picture](../ui/test/screens/home-clear-1440.png) | [picture](../ui/test/screens/home-clear-390.png) |
| 30 tasks | [picture](../ui/test/screens/home-thirty-1440.png) | [picture](../ui/test/screens/home-thirty-390.png) |
| Offline | [picture](../ui/test/screens/home-offline-1440.png) | [picture](../ui/test/screens/home-offline-390.png) |

### Role icons

Each role has one small icon, on a 16 unit grid with a 1.5 stroke, drawn in the colour of the text around it:
You, Dispatcher, Roadmap, Rules, Worker, Reviewer, Main and Planner. `ui/brand/roles.ts` holds the shapes,
`RoleIcon` draws them on the pages (the line, Settings models, Inbox cards, the roadmap view).

## The old UI's views

The old UI was the herdr-projects 2.0 fork in `server/`, one row per plugin (`server/plugins.json`) or view. It is gone (L166; its size is in `docs/numbers.md`, "The old UI goes"). It went only once each
view still needed lived in Lineclear's UI. Each part gets one word: "Lineclear has it",
"moves" (needed, to be built as a Lineclear page from the parts here) or "goes" (not carried over).

| Part | Verdict | Reason |
|---|---|---|
| Places | Lineclear has it | Projects are the tracks on Home and their models and commands are in Settings. Nothing else in the list of spaces is needed. |
| Coordinators | Lineclear has it | The Dispatcher chat at `/chat` is the one chat for every project, and the rule loop replaces a coordinator per place. |
| Tasks | Lineclear has it | Home, the line and the roadmap show every task, its stage and what it waits for. Answers go through the Inbox. |
| Task chat | moves, now `/task/<id>` | Reading what a task's agent says, and answering it, is how you steer a task. It is a per-task page that opens from a token on the line (U58). |
| Reactions | moves, now on each message of `/task/<id>` | A reaction is the cheapest answer to an agent. It is one tap on a message in the task chat (U58). |
| Terminal | moves, now `/task/<id>?tab=terminal` | Watching an agent's live screen is the way to see why it is stuck. It is a tab of the task view (U59). |
| Artifacts | moves, now `/task/<id>?tab=artifacts` | Agents show plans, boards and mock-ups as artifacts. Each version is a card that opens sealed off, full screen (U59). |
| Worktree | moves, now `/task/<id>?tab=changes` | Review needs a task's diff against its base and its pull request. It is a read only tab of the task view, file by file (U60). |
| Browser | Lineclear has it | `/browsers` lists every agent's browser, lets you watch one and take it over. |
| Settings | Lineclear has it | `/settings` has machines, commands and secret names; the order of the models per role and the chat address have a card each. Settings the new product does not have do not move. |
| Voice | goes | Calls through a hosted voice agent need a paid third party service and a second route to the Dispatcher. Typed chat is enough. Dictation in the composer, if wanted, goes to `docs/backlog.md`. |
| Keyboard | moves, now `1` to `4` | On a task, `1` to `4` pick its tab. The other key bindings go with the old layout (U60). |
| Health | Lineclear has it | Settings shows each machine's load against its limit and holds new tasks over it. Memory, disk, GPU and herdr readings go: the doctor names a machine that needs a fix. |
| Alerts | Lineclear has it | The page registers a service worker and pushes each new Inbox item, so you can leave the page. |
| Coordinator timer | goes | A coordinator that wakes itself is replaced by the rule loop, which acts by written rules and asks the Inbox only for what waits for you. |

## Tokens

All in `ui/brand/tokens.css`, one theme only, the dark graphite one. U0's colours are unchanged. U2 adds:

| Token | Values |
|---|---|
| Font | `--lc-font` Geist, `--lc-font-mono` Geist Mono for code (below) |
| Type | `--lc-text-xs` 12, `sm` 14, `base` 16, `lg` 18, `xl` 22, `2xl` 32, `answer` 48 px, each with its line height (`-lh`) |
| Spacing | one 4 px unit, `--lc-space-1` to `--lc-space-16` (4 to 64 px) |
| Corners | `--lc-radius-sm` 8, `--lc-radius` 12, `--lc-radius-lg` 16 px |
| Focus | `--lc-ring`, a 2 px accent line, `--lc-ring-offset` 2 px: the one ring on every focusable part |
| Press | `--lc-press-scale` 0.97 and `--lc-press-dim` while a button, tab or link is held, at once |
| Surfaces | `--lc-raised`, `-raised-2`, `-raised-3` for panel, card and hover; `--lc-line`, `-line2`, `-line3` for edges; `--lc-rail-bg` for the rail. A view uses these and no white with alpha |
| Measures | `--lc-rail-w` 232, `--lc-content-w` 1128, `--lc-row` 44 and `--lc-row-phone` 48 px |
| Hover and target | `--lc-hover-ms` 120 and `--lc-press-ms` 100; `--lc-target` 48 px, the least size of anything that acts at 390 px |
| Action | `--lc-action`, a calm light grey with base text: the fill of the primary button. Neither the accent nor a state colour, so an answer never reads as an alert |

The font is [Geist](https://github.com/vercel/geist-font), variable from weight 100 to 900, under the SIL Open Font
License (`ui/brand/fonts/OFL.txt`). `ui/brand/fonts/` serves it, Latin and Latin Extended, with Geist Mono for code, in
under 90 KB. A system font looks different on each machine, and on Linux it falls back to a wide one; a served font
draws the same letters everywhere, so the pictures of the UI bar match on any machine. Geist is plain and narrow, reads
well at 12 px, has tabular numbers, and its mono is drawn to sit beside it. A script outside Latin falls back to the
system font.

Motion times are in `ui/kit/motion.ts` with the motions themselves. `ui/kit/kit.css` maps the tokens into Tailwind, so `text-sm`, `p-4` and `rounded-lg` are these tokens.

## Parts

In `ui/kit/`, React with Base UI and Tailwind, as idea.md sets the stack.

| Part | What it is |
|---|---|
| `Part` | Any part in one of four states: loading is its track being laid, empty says what to do, error says what failed with a retry, filled is the part. |
| `Answer` | The one answer a view gives first, with its signal lamp. `answer(projects)` makes it. |
| `Shape`, `Stop`, `Lamp` | Task states in the picture language: an outlined train in line, a lit train at work, an amber signal waits for you, a green station merged. The red square only for broken. |
| `SignalPic`, `TrainPic`, `StationPic`, `EnginePic`, `SidingsPic` | The parts of the picture language ([brand.md](brand.md#picture-language)) on their own, drawn from `ui/brand/rail.ts`. |
| `Track`, `Count` | A project's progress track that fills green, and a count that steps up. |
| `TaskChip`, `TaskList` | A task as its shape and plain title; a list shows twelve and opens the rest with one click. |
| `ProjectCard` | A project's name, track and open tasks. |
| `SpendChart`, `UsageChart` | Spend in dollars per day as bars; each bar names its day and dollars on hover, focus and tap. Each account as an engine with its session and week limits as bars in percent and their reset times. |
| `InboxCard`, `InboxList` | A question with its answers as buttons and its details behind one click; twenty shown, the rest behind one click. |
| `ViewNav`, `ViewFrame` | The views as tabs, and the frame a view changes in. Every tab and link between views changes it in place, without a page load. |
| `Button` | The action button (`--lc-action`) for the first answer, a quiet one for the rest. |
| `Panel` | A raised panel that holds one part, such as a chart. |
| `DispatcherHead`, `ChatEmpty` | Who you talk to and what it does now; the empty chat with three questions to tap. |
| `ChatThread`, `Typing` | The thread, oldest first, and the grey dots while the Dispatcher writes. |
| `Composer`, `FileChip`, `Thumb`, `Lightbox` | The box with its files, a file as name and size, a picture small, and a picture large. |
| `Row`, `RowList`, `Card`, `Tile` | The one row (a lamp, a title, a note, a figure), the list that holds rows, the raised card, and a figure with its label and unit. A view draws none of its own. |
| `StateLamp` | The lamp in four states: grey while a review checks, amber waits for you, green clear, red broken. |
| `Reveal` | Inserts and removes what it holds with its height. |
| `BarChart` | Bars that name their value on hover, focus and tap. |
| `Toast`, `SidePanel`, `BottomBar`, `SideRail` | A message with Undo, the side panel for details, the phone's bottom bar and the desktop rail. |
| `ParallelTracks`, `StaleBar`, `LaidTrack` | Steps in parallel lanes; the bar that says the data is old, with a retry; the laid track a loading part shows. |
| `DataTable` | The one table. See below. |
| `count`, `dollars` | The one number format: thousands separators, `$12.40` under $100 and `$1,234` above. |
| `Markdown` | An answer as React elements, never HTML from the text; links only to the web or mail. |

### Hover, press and targets

Everything that acts has a pointer. Hover changes the fill in 120 ms, the one CSS transition in `kit.css`. Press
scales to 0.97 and dims at once, within 100 ms. At 390 px every target is at least 48 by 48 px; a link inside a
sentence is marked `data-inline` and is exempt. `ui/test/kit.pw.ts` reads this.

### The table

`DataTable` shows rows that share figures: tabular figures aligned right, units in the header and not in each cell,
a sticky header, sorting when there are more than 10 rows, and a row that opens its details with one click. At 390 px
each row becomes a card with its two figures that matter. Do not use it where a picture says it better: a track, a
bar or a lamp.

Long text truncates on one line where a title has a tooltip (task chips, project names) and wraps where it is the
content (answers, questions, details).

## Motion

Every animation starts in `ui/kit/motion.ts`, one named motion per state change and no others. Their times and easings
are the motion tokens in `ui/brand/rail.ts`. Each runs on transform
and opacity with the Web Animations API, is under 300 ms, starts from where things are on screen, and never blocks
input. Under prefers-reduced-motion none runs and every change is instant.

| Motion | When | What moves | Time |
|---|---|---|---|
| `task-start` | A task starts | The points throw, its train leaves the siding and glides to its station | 280 ms |
| `task-move` | A task changes stage, or its state other than starting or finishing | Its token glides to its new station, its new shape pops in | 240 ms |
| `task-finish` | A task merges | Its token glides to Main, a green signal pulses there, the track fills, the count steps up | 280 ms |
| `task-wait` | A task waits for you | An amber ring spreads once around its signal, then the signal stays lit | 280 ms |
| `request-run` | A request reaches the Dispatcher | A dot leaves the signal box, runs to its project's track and pulses once at the new station | 280 ms |
| `train-progress` | A worker makes progress | The train moves along its track to the new spot; it stands still while the worker waits | 1200 ms |
| `load-shrink` | A worker's context is compacted | The train's wagon shrinks with its number | 280 ms |
| `track-ahead` | A planner writes steps | New dashed track is laid ahead of the line | 280 ms |
| `engine-swap` | An account fills up and another takes over | The engines swap places, the fill moves | 280 ms |
| `inbox-clear` | You answer an Inbox item | Its signal turns green at once and pulses, then the item leaves | 280 ms |
| `inbox-arrive` | An Inbox item arrives | It drops in at the top, the items below slide down | 240 ms |
| `view-change` | The view changes | The new view slides 24 px the way you went as it fades in; back slides the other way; a page opened from a card grows out of that card | 280 ms |
| `chat-open` | The Chat panel opens | It slides in from the right edge | 240 ms |
| `browser-open` | An agent's browser opens | Its card grows in at its place, the cards after it slide over | 240 ms |
| `browser-close` | An agent's browser closes | Its card shrinks away where it was, the cards after it slide into the gap | 240 ms |
| `machine-add` | A machine is added | Its card drops in at its place, the cards below slide down | 240 ms |
| `machine-state` | A machine is installing, ready, busy or broken | Its new state shape pops in | 200 ms |
| `model-move` | A model moves in its role's list | It slides to its new place, the one it passed slides the other way | 200 ms |
| `chat-arrive` | A chat message arrives | It slides up 12 px into place as it fades in | 240 ms |
| `chat-typing` | The Dispatcher writes | Its three grey dots rise and brighten one after another, a beat each | 280 ms |
| `part-change` | A part goes between empty, loading, error and filled, or its line changes on an event | The new state fades in | 160 ms |
| `value-change` | A number or a bar changes: a count, spend, a load | The number counts to its new value in fixed-width digits, the bar grows or shrinks to it | 280 ms |

Anything else changes at once: hover, details opening. Nothing moves at rest but two loops (`LOOPS` in `ui/kit/motion.ts`): `lamp-wait` (2 s) blinks the lamp of a row that waits for someone, and `track-lay` (1.4 s) lays a loading part's track
from left to right, sleeper by sleeper, until the part is read. Under reduced motion the track stands laid. The typing dots beat only while the Dispatcher writes.

## Say each thing once

Each fact shows once, where it is acted on.

- No page headline restates a count or state shown elsewhere. The Inbox badge carries "waits for you"; the Inbox
  page does not repeat the number.
- No explainer subtitle: a page does not say what it is.
- No empty-state slogan. An empty part shows nothing, or one short neutral line ("No browser is open.") only where
  the empty area would look broken. No hint under it.
- Never ask the user to run a command in the web UI. A problem Lineclear can fix, it fixes (or a rule starts a task
  for it). One it cannot fix shows once in Settings > Machines, with a button that fixes it.

`ui/test/once.pw.ts` fails when a view's text holds `lineclear ` followed by a command, or when a headline repeats
the Inbox count.

## What done means

A step is `done` only when its proof holds. At merge the independent checker (`src/stepcheck.ts`, codex first, else a
fresh session of another model) reads each `done when` item against the merged tree and records it true or false, with
its proof, in the project's `plan-checks/` (`src/doneproof.ts`). An item that is an action outside the repo (a tag, a
GitHub release) is proven by a command the checker runs (`git ls-remote --tags origin`, `gh release view`), never by
reading text. A task closed with nothing to merge counts only with that same proof.

- A merged step with a false item is `unproven`, shown as "merged, unproven: <item>". It counts as not done in the
  progress and the ETA, and the steps after it wait.
- The runner starts an unproven step again with the missing item as the brief: twice a day at most, then one Fix task.
- The checker runs only read-only commands (an allow-list: git reads, `gh ... view|list`, `bun test <file>`); a write is refused. The model that judges plain items has no tools.
- A step with no record yet counts as done until the checker has read it (two steps a tick). A checker that does not
  answer records nothing.

## The UI bar

Every view step passes it, with the helpers in `ui/test/bar.ts`:

- every part is designed in each state: empty, loading, error, long text and 200 items
- screenshot tests at 1440 and 390 px of each state
- each motion runs at 60 fps in a browser performance trace, with no long task over 50 ms while it runs
- no motion blocks input: a click during a motion acts at once
- with prefers-reduced-motion, every state change is instant
- tabbing through a view, every focusable part shows the one ring; every button, tab and card link shows its
  press within 100 ms, on a click and on a tap
- a short recording of each motion
- each thing once: no command text, no headline that repeats the Inbox count (`ui/test/once.pw.ts`)

`bun run ui:test` runs it in headless Chromium (once per machine: `bunx playwright install chromium`) against `lineclear run` on an empty config. For each motion it checks
that only named motions run and each is under 300 ms, reads the compositor's frames and the main thread's tasks from a
DevTools trace, clicks again halfway through and wants the change on the next frame, and repeats with reduced motion
and wants no animation at all. After a change to a picture on
purpose, `bunx playwright test --update-snapshots` writes the new ones.
## Finish

The UI bar says a view works. Finish says it is done. The checklist below is scored by a reviewer.

### Reference products

The bar is [Linear](https://linear.app), [Things 3](https://culturedcode.com/things/),
[Raycast](https://www.raycast.com) and the [Vercel dashboard](https://vercel.com/dashboard). A view should not look
worse than the one of these that does the same job.

### Checklist

A reviewer reads the real-data pictures and the recordings before and after the step, and scores each line as at or
below the reference bar. Any line below it is a major finding.

1. Alignment: edges, baselines and gutters line up on the 4 px grid.
2. Rhythm: spacing repeats; related things sit close, unrelated things far.
3. Hierarchy: one thing reads first, then the next; size and weight carry it, not colour alone.
4. One accent per view: green clear, amber waits for you, red only broken; no second highlight.
5. Density: a glance gives the answer; 300 tasks do not become 300 equal rows.
6. Nothing decorative: every mark means something.
7. Motion only when it informs a change, and never in the way.
8. Words: no command to run, no repeated counts, no label that says what the picture already shows.
9. Real data: a long title, a full account, a wait and a broken machine all look designed.
10. None of the AI-look faults: gradient or glow for its own sake, a card around everything, icons with no meaning,
    centred hero text on a tool, the same rounded box at every level, emoji as icons, filler empty states, headlines that
    repeat the numbers beside them.

## Scales

Every step check and every merge check reads these six lines. A change that breaks one is a no-go.

- Works with N machines and N projects, not one of each.
- Works with any model and any harness, not one named.
- Works with 10x the data: tasks, routes, steps.
- No global or whole-part lock where a finer one works.
- No polling or spawning per tick that grows with history.
- No fallback for a state that no longer exists.

## Who writes to an agent

Machine news never wakes an AI (idea.md principles 1 and 4). Load, memory, disk, quota and account state, provider
cut-offs, check slots and task status changes are handled by rules and shown on the status line and Usage. They never
become a message to an agent. Only the lines below reach an agent's chat or start a model turn. Each is a step's own
line, an owner's, or a rule resuming work that stopped. Every other model turn is a fault
(goal 0): the brief, owner messages, `<lineclear><go>` and the two marks below are not.

Marks in an agent's log: `[lineclear:resume]` goes on with the step's own work, `[lineclear:answer]` is a rule answering
the agent's own question. A `[lineclear]` line with no kind, and any `<lineclear>` line other than `go`, is counted.

| Where | Trigger | Kind |
|---|---|---|
| `src/rules.ts` `tickProject`, `lineclear task add` | A step is ready, a slot and a model have room | Step: its brief |
| `src/stalls.ts` `handover` | The account of the task's model is out, or it left the task signed out | Step: a new task with the brief and the old branch |
| `src/rules.ts` `serviceWaits` | A declared wait ends: its time came or the task it waits for is done | Resume, once per wait |
| `src/stalls.ts` `climb` | A "may be stuck" card: a reminder (rung 1), a restart (rung 2) | Resume, one rung per card |
| `src/starts.ts` `serviceStarts` | A start whose agent has not answered its brief: the nudge typed into its pane (2 min), a restart (4 min) | Resume, at most twice |
| `src/asks.ts` `routeAsks` | An open need card a rule can answer (a refused merge, a stored login) | Answer, once per card |
| `src/inbox.ts` `answer` | The owner answers an Inbox item | Owner |
| `server/server/live/source.ts` `send`, `slashCommand`, `react` | The owner writes, reacts or answers a card in the chat | Owner |
| `server/server/live/engine/engine.ts` `go`, `tell`, `youWrote` | A task starts, or the owner writes to a task not started | Step / owner |
| `server/server/live/engine/engine.ts` github, queue, `sendBack` | News of the task's own pull request (a failed check, a review), a queue line when the owner or a coordinator queues the task, a refused merge sent back | Step. github and queue lines are counted by `measure`; `sendBack` is plain text, so it is not |
| `server/server/live/engine/engine.ts` `tell`, `source.ts` `send` | The owner or a coordinator runs `lineclear task tell` or writes in a task's chat | Owner. A coordinator is an AI, so there is none by default |
| `server/server/live/source.ts` `relaunch` | An agent that was working stopped (herdr restarted, its CLI exited) and is started again | Resume: a `restart` line, once per restart. `measure` counts it |

What does not reach an agent, and where it goes:

| Where | Event | What happens |
|---|---|---|
| `server/server/live/quiet.ts`, `Agents.send` | A `news` or `health` line from any caller: machine load or memory or disk (`onHealth`), another task's status (`overview`, requested news), "the human answered", and the same left in an old outbox | Held back before the outbox. Nothing goes into any pane. A task that wants to hear that another is done declares `lineclear wait`, which a rule resumes |
| `src/rules.ts` `tickProject` | Load above the limit | No new task starts; the decision log says so |
| `src/stalls.ts` `markLimitedReviewers` | A reviewer reports a usage limit | The account is marked out until its reset. Nobody is told |
| `src/stalls.ts` `serviceStalls` | A model call failed on a full account | The account is marked, the task is handed on to the next model, or waits for the reset and is resumed once by `serviceWaits` |
| `src/rules.ts` `alert` | Main is red, a key question, a stuck task | A phone alert to the owner, not an agent |

A cut-off agent is resumed by a rule: when its account has room again, `serviceWaits` resumes it once. When its own
account is still out and another model has room, `handover` starts the step on that model, once per step. The reviewer
of a step is picked by the worker from its brief, so a reviewer cut-off needs no message.

Not covered: a coordinator (an AI) can still pass a line on with `task tell`, which counts as an owner message; there is
no coordinator timer in Lineclear. Provider errors that pass by themselves (overloaded, a dropped connection) are
retried by pi itself.

The tests are `test/quiet.test.ts` (a burst of load, quota and status events in a tick: no tell, no Enter) and
`server/test/quiet.test.ts` (a burst of news, health and heartbeat lines: nothing goes into a pane).
