# Truth audit 2: done steps

Each `done when` item of 32 done steps, checked on origin/main at `c863845e` (4 Nov). Verdicts: true, partly, false.
Proof is a file and line, a test that passes now (run for this audit), or a line of `docs/numbers.md`. Tests run:
`secrets`, `stalls`, `asks`, `close`, `waiting`, `views-count`, `home-data`, `rules`, `web`, `web-never-waits`,
`dispatcher`, `plan`, `dispatcher-pick`, `migrate`, `roadmap`, `inbox-updates`, `browsers` and `notify`: all pass.
Browser specs were read, not run. A step with a partly or false item is reopened in `docs/ROADMAP.md`.

Reopened: L9, L12, L19, L14, L20, L15, L16, U1, U2, U3, U4, U7, U5, U6, U18, U20, U9, L28.
Fully true: L13, L17, L18, L41, U0, U8, L21, L22, L23, L24, L25, L26, L27, L29.

| Step | Item | Verdict | Proof |
| --- | --- | --- | --- |
| L9 | `secrets set` reads stdin, `list` prints names, project secrets in `~/.config/lineclear/projects/<name>/` mode 600 | partly | set and list work (`test/secrets.test.ts` "set keeps the value ... mode 600"), but the values live in the server vault `vault.json` (`src/secrets.ts:19-20,300`); the per-project file is only a copy sent to another machine (`src/secrets.ts:17`) |
| L9 | Owner-only secrets in a file nothing loads for an agent | true | `src/secrets.ts:15`; test "an agent in alpha: owner-only ... names and files are refused" |
| L9 | `secrets env` in a task gives only its project's values | true | test "env in a task's worktree gives only that project's values" |
| L9 | Extension refuses `git push`, secret names and login files, one line each | true | tests "git push is refused in each form", "the extension blocks through pi's tool_call event" |
| L9 | Tests as an agent: names missing, push refused, check and `pi -p` still work | true | test "as an agent in a task: its shell has no owner-only or other project name ..." |
| L12 | `lineclear inbox` lists the five kinds | true | `src/inbox.ts:15`; each kind appears in tests (plan: `test/plan.test.ts`; step: `test/waiting.test.ts`; login: `test/browsers.test.ts`; outward: `test/rules-waits.test.ts`; stuck: `test/close.test.ts`) |
| L12 | `inbox answer` reaches the task with `task tell` | true | `src/inbox.ts:415-422`; `test/asks.test.ts:407` |
| L12 | `lineclear ask` adds an Inbox item | true | `src/inbox.ts:270-311` (now only login and outward, `askableKinds`, line 184) |
| L12 | Each new item reaches the phone once, with `shepherdr alert` | partly | one push per item to each device (`test/notify.test.ts` "each new Inbox item is one push to each device"), but through Web Push (`src/notify.ts:53,74`), not `shepherdr alert` |
| L12 | Brief template tells workers to raise an outward action with `lineclear ask` | true | `templates/brief.md:42-43` |
| L12 | Tests cover each kind and an answer reaching its task | true | see the list above |
| L13 | "May be stuck" card after 20 min climbs reminder, restart, next model, Inbox; declared wait holds it | true | `test/stalls.test.ts` "each stall card moves the task one rung ...", "a task with a declared wait is not moved up"; `src/stalls.ts:464` |
| L13 | Rung 3 is one start in the loop's tick | true | `test/stalls.test.ts` "the handover is one start" |
| L13 | Shepherdr handles out of allowance with a backup agent; leftover goes to rung 3 | true | `server/server/live/engine/engine.ts:1158-1164`; `test/stalls.test.ts` "a task Shepherdr left waiting for a login goes straight to rung 3" |
| L13 | Full subscription, ended free account: straight to rung 3; paid key asks once | true | `test/stalls.test.ts` lines 186, 195, 209 |
| L13 | Each rung to `decisions.jsonl`; fake clock and fake `shepherdr` | true | `test/stalls.test.ts` (whole file passes, 56 with asks) |
| L19 | Last week's needs-you cards sorted into kinds with counts in `docs/asks.md` | partly | the table is headed "An example week ... 23 cards", not a counted real week |
| L19 | The three most frequent kinds a rule can answer get a rule and a test | partly | rules and tests exist (`test/asks.test.ts`), but they are allowance, merge-chat and login; the table's own next kinds are question (4) and plan (2), and merge-chat and login have a count of 1 |
| L19 | Other kinds listed with their Inbox kind | true | `docs/asks.md` "Goes to" column |
| L14 | Shepherdr 2.0 at `ebb17d5` in `server/` with LICENSE and NOTICE naming it | true | `server/LICENSE`, `server/NOTICE:1` |
| L14 | Only names change; the one other change is dashes | partly | `server/NOTICE` still says "Only names changed", but `git log -- server` has 75 commits, among them the L16 lane and L20 fixes |
| L14 | Own tests and type check pass inside `bun run check`; the limit grows and is written in the check | true | `scripts/check.ts:2,97-99,8` (server steps; 180 s budget in `docs/numbers.md:808`) |
| L14 | `lineclear serve --port <free port>` starts beside a running Shepherdr 2.0 and shows an empty board | partly | `test/serve.test.ts` tests only the flags and the help; no test or numbers line starts it beside Shepherdr 2.0 |
| L20 | `docs/known-faults.md` lists every fault with how it shows and the workaround, including the five named | true | `docs/known-faults.md` rows 1-5 (name loss, `ready` crash, waiting for merged, conflict markers, brief while starting) |
| L20 | Each fault has a test that fails on `ebb17d5` and passes on the fork | partly | tests exist and pass (`server/test/source*.test.ts`, `shepherdr-faults.test.ts`), but five rows name only an issue id (LIN-86, 87, 97, 108, 110) as the test, and no run on `ebb17d5` is recorded |
| L20 | Each workaround says it is no longer needed | true | "In the fork" column of `docs/known-faults.md` |
| L20 | A fault needing a rewrite is named and moved to the backlog | true | `docs/known-faults.md:5` "None needed a large rewrite" |
| L15 | `migrate --dry-run` lists, `migrate` copies and never changes `~/.shepherdr` | true | `test/migrate.test.ts` "dry run lists ...", "migrate copies ... and leaves the old folder as it was" |
| L15 | Rule loop, waits and Inbox talk to the fork | true | `src/shepherdr-client.ts` and `test/rules.test.ts` run against the one `shepherdr` command; no Shepherdr 2.0 path remains in `src/rules.ts` |
| L15 | A check right after the move: a task starts, waits and merges, no extra cards | partly | `lineclear migrate --check` is tested with fakes (`test/migrate.test.ts` "check passes when the fork added no more cards"); `docs/numbers.md:406-422` says the real move is not recorded |
| L15 | Shepherdr 2.0 stopped, doctor says so; `install.sh` no longer adds it | true | `src/doctor.ts:183-185` "old install stopped"; no Shepherdr 2.0 install in `install.sh` |
| L16 | An agent merges its own task after review; every merge goes through the lane | true | `templates/brief.md` and the server's merge lane (`server/server/live/engine/engine-merge.ts`) |
| L16 | Merged as is when main did not touch its files, else the check runs on the merged result | true | `src/candidate-check.ts`, `server/server/live/engine/git.ts:161,305` |
| L16 | A conflict goes back to the worker with the files | true | `server/server/live/engine/git.ts:258-262,305-331` |
| L16 | Two failed health commands revert the last merge and the Inbox says so | true | `test/rules.test.ts:222` |
| L16 | `measure` fourth number, in `docs/numbers.md` before and after | false | `docs/numbers.md:35-52` has the before; the line "After: add here once a day of merges has gone through the lane" is still open |
| L17 | `lineclear plan` starts a planning task from `templates/plan.md` | true | `test/plan.test.ts:95` |
| L17 | Result passes `roadmap check`, comes to the Inbox as one approval; approve merges; reject sends back once | true | `test/plan.test.ts` lines 107, 130, 143 |
| L17 | A fake-planner test covers both answers | true | `test/plan.test.ts:130,143` |
| L18 | Dispatcher is a regular-mode chat space with pi, no tasks, prompt `templates/dispatcher.md` | true | `test/dispatcher.test.ts:121` |
| L18 | Tools: status, plan, move, inbox; `move` goes to the Inbox for approval | true | `test/dispatcher.test.ts:54,73,89`; `templates/dispatcher.md` |
| L18 | Status for all projects under 2000 tokens | true | `test/dispatcher.test.ts:138` |
| L18 | Extension refuses `inbox answer` and any merge; a task event does not wake it | true | `test/dispatcher.test.ts:99,172` |
| L41 | A request with no project goes to the right one; two fit asks with buttons; none says so | true | `test/dispatcher-pick.test.ts:146,163,204,224` |
| L41 | Hands on with `lineclear plan`; one approval in chat and Inbox; never starts or merges | true | `test/dispatcher-pick.test.ts:163,239` |
| L41 | Answers with a live link; `status --plan <task>` says where the steps stand | true | `test/dispatcher-pick.test.ts:138`; `src/cli.ts:172` |
| L41 | Tests with fake planner and two projects; one real run in `docs/numbers.md` | true | `test/dispatcher-pick.test.ts`; `docs/numbers.md:265-285` |
| U0 | Three options, each a mark that reads at 16 and 512 px, a one-colour version and the wordmark, in one picture | true | sixteen concepts, `docs/brand/concepts/`, `docs/brand/contact-sheet.png`, `docs/brand.md:14-30` |
| U0 | One dark graphite theme, no light variant | true | `ui/brand/tokens.css` has no light scheme |
| U0 | Green, amber, red tokens with one meaning each | true | `ui/brand/tokens.css:58,60,62` |
| U0 | Green `#5fa883`, amber `#e7b25a`, accent `#d97757`, base `#0b0b0c` | true | `ui/brand/tokens.css:34,53,58,60` |
| U0 | One option picked with a line of why; files in `ui/brand/` | true | `docs/brand.md:7`; `ui/brand/mark.svg`, `mark-mono.svg`, `wordmark.svg`, `tokens.css` |
| U1 | Three finished Home pictures at 1440 px with real data from Shepherdr's files | partly | `docs/brand/home/direction-{line,box,board}.png` exist; `docs/brand.md` calls them "drawings of the three directions", so the real data is not shown |
| U1 | Graphic first, answers instead of headings, state colours only with their meaning | true | `docs/brand.md` Home section; `ui/test/taste.pw.ts` |
| U1 | The chosen one judged, with one line of why, and pictures of each state at 1440 and 390 px | true | `docs/brand.md` "Chosen: The line"; `ui/test/screens/home-{empty,loading,error,filled}-{1440,390}.png` |
| U1 | A clickable prototype of a task starting and finishing, recorded, 60 fps, instant with reduced motion | partly | `docs/brand.md`: "the prototype that held them is gone"; the real Home has the recordings `docs/design/motion/home-task-start.webm`, `home-task-finish.webm` and the checks in `ui/test/bar.ts:193-240` |
| U2 | Direction as tokens and components; one theme | true | `ui/brand/tokens.css`, `ui/kit/`, `docs/design.md:352-380` |
| U2 | Motion spec names an animation for every state change, each under 300 ms | partly | `ui/kit/motion.ts:16-17` `train-progress` runs 1200 ms (named as the one exception); the rest are at most 300 ms (`ui/kit/motion.ts:58`) |
| U2 | The UI bar: states, screenshots at 1440 and 390, 60 fps with no long task, no blocking, reduced motion, recordings | true | `ui/test/bar.ts:8-16,193-240`; `ui/test/screens/` (233 pictures); `docs/design/motion/` |
| U2 | `lineclear run` serves a test page showing every component and motion that passes the bar | true | `docs/design.md:6-9`; `ui/test/design.pw.ts` |
| U3 | Home at `/` and the Inbox at `/inbox`, from U2's parts | partly | `/inbox` is Home with a strip on top (`ui/web/routes.ts:3-4`; `ui/test/home.pw.ts:110` "/inbox opens Home") |
| U3 | Home answers "is all clear?" first; tracks, state shapes, plain titles, usage in percent, spend in dollars as charts | partly | tracks and shapes are there (`docs/design.md:283-320`); Home has no headline (`ui/test/home.pw.ts:25`) and usage is at `/usage` (`ui/web/routes.ts:5`) |
| U3 | The Inbox shows cards with buttons, no popups, details in one click | true | `ui/test/home.pw.ts:60-100` |
| U3 | Both pass the UI bar with the four motions | true | `ui/test/bar.ts` motions `task-start`, `task-move`, `task-finish`, `inbox-arrive` in `ui/kit/motion.ts` |
| U4 | `/<project>/roadmap` from U2's parts, reading `roadmap status` and the loop's tasks | true | `ui/web/routes.ts:7`, `ui/web/roadmap/index.tsx` |
| U4 | At work and next first, then the phase, later phases, done phases folded as "What you got" | partly | done phases fold to one line (`docs/design.md:169`), but "What you got" appears nowhere in `ui/` or `src/` |
| U4 | Each step a card with title, result and state as a picture, id on hover only | partly | `docs/design.md:166-168`: a card shows id, title, state, locks and waits as text |
| U4 | One click opens the whole brief in a side panel | true | `docs/design.md:169`; a step has its own page (`ui/web/roadmap/step.tsx`) |
| U4 | Motion: a started step glows once, a merged step slides to done | true | `ui/web/roadmap/index.tsx:203-206`; `docs/design/motion/roadmap-task-{start,finish}.webm` |
| U4 | Passes the UI bar; screenshots include this file and 400 steps over 12 phases | true | `ui/test/roadmap.pw.ts:324`, `ui/test/roadmap-this.md` |
| U8 | `/browsers` shows each session as a card with its task title and a live picture; open to watch, then take over | true | `ui/test/browsers.pw.ts:35-50`; `test/views-count.test.ts:25` |
| U8 | An Inbox item for a login or code links to its session | true | `src/inbox.ts:34-35`; `test/browsers.test.ts` |
| U8 | Passes the UI bar with open and close motions | true | `ui/kit/motion.ts:34-35`; `docs/design/motion/browser-{open,close}.webm` |
| U7 | `/settings` machines: add by SSH host, run `install.sh`, show doctor, state and load | true | `ui/web/settings.tsx:137`; `test/machine-add.test.ts`; `ui/test/settings.pw.ts:85,95` |
| U7 | Accounts: each subscription's usage in percent and the reorderable model list | partly | the model list reorders in Settings (`ui/web/settings-models.tsx`); usage is on `/usage`, not in Settings (`ui/web/settings.tsx:30` sections: Models, Projects, Machines to add, Secrets) |
| U7 | Projects: check command, health command, secret names | true | `ui/web/settings.tsx:97-98,132-137` |
| U7 | A change is saved where the CLI saves it | true | `ui/web/settings.tsx:97`; `src/web-settings.ts` |
| U7 | A test adds a machine on a fresh virtual machine over SSH and doctor passes | partly | only a stand-in `ssh` (`ui/test/fake-ssh`, `test/machine-add.test.ts`); no fresh virtual machine run is recorded |
| U5 | The owner has the five views to review; what is missed goes to `backlog.md` or a step | partly | the views exist, but no record of the owner's review; `docs/backlog.md:47` only names the idea |
| U6 | `README.md` shows the logo and wordmark from U0 | false | `README.md` has no logo or wordmark; its image is a Home screenshot (line 7) |
| U6 | One animated SVG of the core idea, looping about 12 s, dark only, reduced motion, no external fonts, under 40 KB | false | the README embeds none; `docs/readme/line.svg` is 118209 bytes and is not linked |
| U6 | Three short lines (roadmap is the boss, rules the manager, AI the work); install command marked "coming"; links | partly | links and install are there, but the three lines are not (`grep -i boss README.md` is empty) and the install is live, not "coming" |
| U18 | The README animation tells three beats and loops under about 15 s | false | no animation in `README.md` |
| U18 | Uses signal colours, renders on GitHub, reads at 680 px and on a phone; alt text tells the story | false | the only README image has a Home alt text (`README.md:7`) |
| U18 | A "How it works" section of about 12 lines naming eight roles; `idea.md` uses the same words; README about 30 lines plus images | false | `README.md` has no such section and 77 lines; `docs/idea.md:24` says "no 'How it works'" |
| U18 | Screenshots of each beat at 390 and 1440 px on the pull request | false | no beats to show; the pull request is not in the repo |
| U20 | Home opens with the line of six stations; each task a token at its stage, labelled with its step id; hover shows title, model, time | partly | `docs/design.md:283-320`: four zones (In line, At work, In review, main), a Dispatcher box, tokens labelled by a wagon; no Roadmap, Rules, Worker, Reviewer stations |
| U20 | Token glides, green pulse at Main, amber blinks and links to the Inbox, red only when main is broken, 60 fps with 30 tasks in `docs/numbers.md` | true | `ui/kit/line-glide.tsx`; `docs/numbers.md:248-262` (61 fps, no long task) |
| U20 | Each project has the same line in small | true | `ui/web/home.tsx:84-86` |
| U20 | One small icon per role on Home, Settings, Inbox, roadmap and README | partly | `ui/brand/roles.ts`, `docs/design.md:321-326`; the README does not show them (`docs/readme/roles.svg` is not linked) |
| U20 | At 390 px the line runs down the page; the states are designed with screenshots | partly | `docs/design.md:313-314`: at 390 px wagons are dropped, the line still runs left to right; states exist (`ui/test/screens/home-{idle,clear,thirty,offline}-*`) |
| L21 | Home, roadmap and `status` take each task's state from `shepherdr task list` | true | `test/home-data.test.ts:24` "the task list decides" |
| L21 | A test: a task at work after a "Waits for your reply" card is at work; a waiting one amber with its text | true | `test/home-data.test.ts:24`, `test/dispatcher.test.ts:188` |
| L22 | Each tick closes an item of a done or closed task, or after a reply, with the reason in the item and `decisions.jsonl` | true | `test/close.test.ts:31,50,61,68,110` |
| L22 | A done or closed task's wait is removed | true | `test/close.test.ts:78` |
| L22 | `inbox` shows open items, `--all` the closed ones with the reason | true | `test/close.test.ts:91` |
| L22 | Tests cover a done task, a closed task and a reply | true | `test/close.test.ts` |
| L23 | One waiting list; Home, badge and `status` give its count | true | `test/waiting.test.ts:59,68,135` |
| L23 | The Inbox view shows every entry; a waiting task with no item shows its card text and chat link | true | `test/waiting.test.ts:68,82` |
| L23 | The Browsers badge counts open browsers that wait | true | `test/views-count.test.ts:34` |
| L23 | A test with an item, a card and a waiting task counts 2 | true | `test/waiting.test.ts:59` |
| L24 | Home and the roadmap take done and total from one function; a test compares | true | `test/home-data.test.ts:207,230` |
| L24 | The roadmap headline and the line under the phase track name the same phase | true | `test/home-data.test.ts:207` |
| L25 | Every project with a roadmap file links to `/<project>/roadmap`, also Now, Next, Later | true | `test/home-data.test.ts:188`; `ui/web/routes.ts:7` |
| L25 | Screenshot tests at 1440 and 390 px include a Now, Next, Later roadmap | true | `ui/test/roadmap.pw.ts:89`; `ui/test/screens/roadmap-lists-{1440,390}.png` |
| U9 | The line names phase, next step, blocker and finish date once each, plain title, blocker by kind with a link | true | `test/home-data.test.ts:230`; `test/roadmap.test.ts:241` |
| U9 | At 390 px it wraps to at most three lines and nothing is cut | partly | no spec or test asserts the line count or the cut (`grep -i wrap ui/test/roadmap.pw.ts ui/test/home.pw.ts` is empty) |
| U9 | The finish date is never earlier than a dated wait | true | `test/home-data.test.ts:387` |
| U9 | Screenshot tests cover phased, Now/Next/Later, a blocker and long text | partly | `ui/test/roadmap.pw.ts:82,89` cover two layouts; no screenshot is named for a blocker with long text |
| L26 | The model list is read only when a step starts and the list is over 10 minutes old | true | `test/rules.test.ts:105` |
| L26 | A test counts no `--list-models` over 20 ticks, then one for a start | true | `test/rules.test.ts:107-113` |
| L27 | Counts cached under `~/.cache/lineclear/` by path, size and time; refresh reads only new and grown files | true | `src/home-spend.ts:125-126`; `test/home-data.test.ts:402` |
| L27 | 500 files: same totals, warm refresh under 200 ms | true | `test/home-data.test.ts:402`; `docs/numbers.md:381` (26 ms warm) |
| L28 | The tick runs its commands without blocking the web server | true | `src/projects-feed.ts`; `docs/numbers.md:934-946` |
| L28 | A fake `shepherdr` of 5 s: `/api/home` answers in under 200 ms | true | `test/web-never-waits.test.ts:30` |
| L28 | Slowest `/api/home` over 10 minutes of the live service in `docs/numbers.md` | false | `docs/numbers.md:934-946` has a simulated 20 s run (max 4 ms), not 10 minutes of the live service |
| L29 | `install.sh` builds the pages; `lineclear run` serves built files and never builds; says so in one line when missing | true | `install.sh:109-117`; `src/web.ts:219` |
| L29 | `ui:test` and `ui:record` build first | true | `package.json:11,14` |
| L29 | Scripts and styles go out compressed; a test checks header and size | true | `src/web-files.ts:1-15`; `test/web.test.ts:28` |
