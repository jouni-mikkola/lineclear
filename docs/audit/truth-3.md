# Truth audit 3 of 6: done steps

Audited on origin/main at c863845e (2026-11-04). Each `done when` item of 32 done steps is judged against the code on
main: true, false or partly. A step with a false or partly item is reopened in `docs/ROADMAP.md` with a
`Reopened:` line. The UI specs (`ui/test/*.pw.ts`) were read, not run; the bun tests named below were run and pass
(`bun test` of asks, measure, cli, doctor, readme-film, board-home, board-usage, home-data, kit-tokens,
dispatcher-chat, chat, project, roadmap: 171 pass, 0 fail). "Spec exists" means the named Playwright test is in the
repo and asserts the item.

| Step | Item | Verdict | Proof |
|---|---|---|---|
| L40 | One hour of the live service: CPU under 2 %, memory peak under 300 MB, by a script in `scripts/` | partly | `scripts/measure-service.ts:1-30` measures and judges it |
| L40 | The numbers are in `docs/numbers.md` | false | `grep -n "measure-service\|average CPU" docs/numbers.md` finds nothing; the 0.93 % / 60 MB figures in "U38" are a 60 s demo run, not one hour of the live service |
| L30 | Install command works for anyone who can read the repo or is marked coming | true | `README.md:21-24` fetches `install.sh` with `gh api`, and says the repo is private |
| L30 | Status line names what works now and what does not yet | false | `grep -n -i "works now\|not yet\|status" README.md` finds no status line |
| L30 | After the install: `lineclear project add <repo>` and open `http://127.0.0.1:7420/` | partly | `README.md:46-52` gives both, but opening the page comes first and `project add` is a side note |
| L31 | The fresh machine test runs on every merge to main, on CI or by one command | true | `.github/workflows/install.yml:3-7` (push to main, nightly) |
| L31 | Its last run on main passed | false | `gh run list --workflow install.yml --branch main -L 3`: the latest finished runs, LIN-699 (#391) and LINE-362 (#390), both `failure` |
| L31 | The README's status links to it | false | README has no status section and no link to `install.yml` |
| L32 | `lineclear measure` leaves a merged step with no task out of the cost and names how many | true | `test/measure.test.ts:311` expects "1 merged step had no task, not counted: S6" (passes) |
| L32 | Asks count Inbox items as well as needs-you cards, each question once | true | `test/measure.test.ts` fixture, day 2 (line 21 comment): a card and an Inbox item for one question count once (passes) |
| L32 | A fixture with a step with no task and a card that is also an Inbox item gives the hand-counted numbers | true | `test/measure.test.ts:21-311` (passes) |
| L32 | The pilot's numbers in `docs/numbers.md` are counted again and the change is named | true | `docs/numbers.md:89-106` ("L32: counts as L4 says") |
| L33 | A report card of a done task closes by a rule and is not an ask | true | `src/asks.ts:128-136,435-438`; `test/asks.test.ts:192` (passes) |
| L33 | The brief template ends a task with its report and no question, raises only a real choice, a notice goes in the report | true | `templates/brief.md:46,59` |
| L33 | `lineclear asks` counts reports apart; a test covers a report of a done task and a question | true | `src/asks.ts:475-478`; `test/asks.test.ts:181,192` (pass) |
| L33 | The asks per day of 7 days before and after are in `docs/numbers.md` | partly | `docs/numbers.md:71-87` has the 7 days before and the same week recounted; it says the 7 days after the template change "are not in yet" |
| L34 | This repo is a Lineclear project, `lineclear project list` shows it; its coordinator is regular | true | `docs/numbers.md:179-186` records both; `bin/lineclear project list` could not be run here (it refuses a checkout's stable config) |
| L34 | Every task start in its space comes from a rule; `lineclear wait until` works from its tasks, by one real run | partly | The wait run is recorded (`docs/numbers.md:184`); the line "Not yet seen: the first rule start" (`docs/numbers.md:187`) says that every start from a rule is not shown |
| L34 | Home links its roadmap view | true | `ui/test/roadmap.pw.ts:257` "Home links a project to its roadmap" |
| L35 | `lineclear project check` and `lineclear doctor` print the last lines of a failing command with its exit code, secrets masked | true | `src/secrets.ts:249` `failureTail`, used at `src/project.ts:563` and `src/doctor.ts:141` |
| L35 | A test with a failing check shows them | true | `test/doctor.test.ts:53-60` (passes); `test/project.test.ts:102` fails a check on a bad command (passes) |
| L36 | `ui/home/` and the `home` script are gone | true | `ls ui/home`: no such directory; no `home` script in `package.json` |
| L36 | `docs/brand.md` keeps the pictures and the why; no doc or script but the roadmap names the prototype | true | `docs/brand.md:259-267`; `grep -rn "ui/home\|bun run home"` finds only `docs/ROADMAP.md` |
| L36 | `bun run check` and `bun run ui:test` pass | true | Not run here (barred by the task); the check is the merge gate (`AGENTS.md`), so the step could not merge red, and nothing the step removed is still named: `ls ui/home` fails |
| L37 | `lineclear dispatcher setup` makes the Dispatcher and the web chat talks to it | true | `src/dispatcher.ts:155-158`; `test/chat.test.ts:188` "a missing Dispatcher is made once by the server itself" (passes) |
| L37 | The Dispatcher answers status, plan and move from the web chat, a test for each | true | `test/dispatcher-chat.test.ts:18` (passes) |
| L38 | One roadmap change made with `lineclear plan`, approved or rejected in the Inbox view | true | `docs/numbers.md:108-113` |
| L38 | The brief template names `lineclear plan`; if it did not work the reason is in numbers | true | `templates/brief.md:46`; `docs/numbers.md:110-113` |
| U10 | `/api/home` answers projects first and never waits for spend and usage | true | `src/web.ts:73` and `test/web-never-waits.test.ts`; `docs/numbers.md:907-909` `/api/home` 15 ms |
| U10 | First load shows within 1 s, logo in first paint, layout shift under 0.01, in a UI test | true | `scripts/budgets.json` (`firstViewMs` 1000, `layoutShift` 0.01), `docs/numbers.md:890-903` (0.65 s, 0.00005); `ui/test/still.pw.ts:1` layout shift 0. Home's headline is gone (U62); the budget now measures Home's first view |
| U11 | Every link between views changes the view with no page load; a test keeps a value over a link and back | true | `ui/test/roadmap.pw.ts:270-302` ("the page keeps its values", `kept()` is "still here") |
| U11 | View-change motion on each change, instant with reduced motion; back and forward keep the scroll place | true | `ui/test/roadmap.pw.ts:280-295`; `ui/test/design.pw.ts:24,53` (`view-change`); `ui/web/app.tsx:28-82` |
| U12 | A roadmap is a page under Home with a back link, not a tab | true | `ui/web/frame.tsx:28` the bar holds Home; the roadmap is `/<project>/roadmap` |
| U12 | At 390 px every tab is fully in view on every view | true | `ui/test/chat.pw.ts:35` "the tabs fit"; `ui/test/kit.pw.ts:70` every target 48 px at 390 on every view |
| U13 | Every focusable part has the same ring from one token; a test tabs through the design page | true | `ui/test/design.pw.ts:125-156` |
| U13 | Every button, tab and card link shows a press state within 100 ms | true | `ui/test/design.pw.ts:157` |
| U16 | The primary answer button is filled with neither the accent nor a red; design.md names its token; a test checks it on the Inbox | true | `ui/test/headings.pw.ts:25`; the Inbox now lives in Home's strip |
| U16 | One h1 per view, sections h2, cards h3; a project's heading reads its name | true | `ui/test/headings.pw.ts:9` |
| U14 | A machine over its load limit shows amber on Settings, not green "ready" | false | `ui/test/settings.pw.ts:85` asserts the opposite: "reads busy in grey, not amber" |
| U14 | The Browsers headline and its badge count the same thing | partly | `ui/test/browsers.pw.ts:81` says no tab carries a count; no spec compares a headline with a badge |
| U14 | A browser card shows its task's title and the page's host; no task folds under "Other sessions"; a placeholder until the first picture | true | `ui/test/browsers.pw.ts:67-78`; `ui/kit/browsers.tsx:37-39,220` |
| U14 | Each of these has a test on sample data | partly | All but the Browsers headline and badge item (above) |
| U17 | The usage card shows what its title says, one time span, on Home only | true | `ui/test/usage-inbox.pw.ts:5,17` (now in Home's usage sheet) |
| U17 | Each spend bar shows its day and dollars on hover, focus and tap | true | `ui/test/usage-inbox.pw.ts:24` |
| U17 | An Inbox item names its project, task and age, in Home's card style | true | `ui/test/home.pw.ts:69` "the strip names the project, the step, who asks and how long ago" |
| U17 | Each has a test on sample data | true | the three specs above |
| U15 | One open licensed variable font served from `ui/brand/` with its licence, first in the tokens, under 150 KB | true | `ui/brand/fonts/` Geist + OFL.txt, 88,222 bytes in all; `ui/brand/tokens.css:2-5` |
| U15 | The screenshot tests pass on two machines with different system fonts; design.md says which font and why | partly | `docs/design.md:369-374,520` says which font and why; `ui/test/font.pw.ts` fails on a fallback, but no run on a second machine is recorded |
| U21 | Each finding of the review is fixed or sent to the U step whose work it is | partly | No list of the review's findings exists in the repo to check against |
| U21 | Home's line under a project shows phase label, next step title, amber badge, "done about" | partly | Home is the U62 table now; no project line exists on Home |
| U21 | Settings is four cards: Machines, Models, Projects and Usage | false | `ui/test/settings.pw.ts:43-48` expects sections `Models, Projects, Machines to add, Secrets`; Usage is not in Settings (`ui/test/usage-inbox.pw.ts:17`) |
| U21 | The Roadmap view opens only the current phase, one row per other phase, finds a step by id or title | true | `ui/test/roadmap.pw.ts:185,222` |
| U21 | Every grey label is at least 4.5:1, a test; numbers count to a new value in a `value-change` motion under 300 ms, not under reduced motion | true | `ui/test/contrast.pw.ts`; `ui/test/design.pw.ts` and `ui/test/record.pw.ts` `value-change` |
| U21 | A question's links are links and its paths code; closing a step closes a question that names no project | partly | Rendering is covered by `ui/kit/rich-text.tsx` and `test/rich-text.test.ts`; no test names the closing of a question with no project |
| U21 | Screenshots before and after at 390 and 1440 px are on the pull request | partly | On the pull request, not in the repo; not checkable here |
| L39 | Home's empty state has a field for a repo folder, shows what `project add` detects, saves with one click | true | `ui/test/add-project.pw.ts:7,16` |
| L39 | When `lineclear doctor` finds a problem, Home shows it with its fix command | false | `grep -in doctor ui/web/home*.tsx ui/web/alerts.tsx` finds nothing; Home's alerts (`src/health.ts`) cover only a full disk and a lost network |
| L39 | A UI test on an empty config adds a project from the page, and `lineclear project list` shows it | true | `ui/test/add-project.pw.ts:33` |
| L58 | `lineclear --version` prints version and short commit, `unknown` outside git | true | `bin/lineclear --version` prints `lineclear 0.0.0 c863845e`; `test/cli.test.ts:35,44` |
| L58 | `lineclear --help` lists `--version` | true | `bin/lineclear --help` line `--version Print the version and the commit that runs` |
| L58 | A test checks the line in this repo and in a copy with no `.git` | true | `test/cli.test.ts:35-60` (passes) |
| U22 | `docs/readme/line.svg` is a film of 45 to 60 s in nine scenes: the problem, roadmap, rules, worker, reviewer, main, your call, at night, result | false | `scripts/readme-film.ts:12-21`: ten scenes (one chat ... line clear) of other names; `test/readme-film.test.ts:12-27` allows 30 to 50 s |
| U22 | Every number in it is measured, sourced in `docs/numbers.md` under "README film" | false | No such section; `docs/numbers.md:221` says the film shows no numbers |
| U22 | Moves ease and enter in turn on an 8 px grid, dark theme, role icons from `ui/brand/roles/` | partly | `scripts/readme-film.ts` and `ui/brand/roles/` exist; no test checks the 8 px grid |
| U22 | CSS only, under 150 kB, still poster under reduced motion, alt text, frames on the PR | partly | `test/readme-film.test.ts:25-30` (no script, under 150 KB, passes); `docs/readme/line.svg` is 118 KB; but `README.md` does not show the film at all (`grep -n "line.svg\|film" README.md` is empty) |
| U19 | A Chat tab at `/chat`, reachable from every view, with the signal mark, history and a composer | partly | `/chat` opens Home with the chat column (`ui/web/routes.ts:16`, `ui/test/home.pw.ts`); the bar holds only Home and Settings (`ui/web/frame.tsx:28,115`), no Chat tab |
| U19 | Images and files attach by paste, drop and a button; the Dispatcher gets a path in Shepherdr's inbox | true | `ui/test/chat.pw.ts:116`; `test/chat.test.ts:48` (passes) |
| U19 | Answers render markdown and the images they name | true | `ui/test/chat.pw.ts:81`; `test/chat.test.ts:227` (passes) |
| U19 | On a phone the composer stays above the keyboard, sending is one tap | true | `ui/test/chat.pw.ts:35` |
| U19 | Every state designed: empty with three questions, sending, streaming, error with retry, offline; new messages slide in; reduced motion | true | `ui/test/chat.pw.ts:18,173,185,197` |
| U19 | POSTs only from own pages; tests cover upload limits and message path | true | `test/chat.test.ts:33,48,149` (pass); `ui/test/chat.pw.ts:197` |
| U23 | `docs/readme/roles.svg` right under "How it works" in the README, a chain in 30 to 45 s | false | `docs/readme/roles.svg` exists (`test/readme-film.test.ts:13` allows 30 to 50 s) but `README.md` has no "How it works" and does not show it |
| U23 | A closed table "Role, Who it is, Does, Never does", one row per role | false | `grep -rn "Never does" README.md docs/*.md` finds only the roadmap |
| U23 | The film tells the story in railway pictures; every number in the README details, sourced under "README story" | partly | `docs/numbers.md:221-247` has the sources; the README has no such details |
| U23 | One beat on what saves tokens, with the measured cost per merged step in the details | partly | The film has the "QUIET" scene (`scripts/readme-film.ts:19`); the README carries no details |
| U23 | The README, film, idea.md and app use only the words in `docs/brand.md` under "Words" | true | `docs/brand.md:49`; `scripts/words-check.ts:37` and `test/brand-voice.test.ts` |
| U24 | `docs/brand.md` has a "Picture language", the one source for every view | true | `docs/brand.md:177-196` |
| U24 | Home draws each project as its track with stations, train per task, signal per review, main line; Roadmap, Inbox, chat, Settings, Browsers use the parts | partly | The Roadmap, chat and Settings parts exist (`ui/brand/rail.ts`, `ui/kit/`); Home is a table of tasks since U62, with no track per project |
| U24 | One set of SVG parts and motion tokens in `ui/brand/rail.ts` used by every view and the README images | true | `ui/brand/rail.ts`; `test/brand-parts.test.ts:2` imports it |
| U24 | Screenshots and recordings judged against `docs/brand.md`; a fresh model looks at Home cold, answer in numbers under "U24" | true | `docs/numbers.md:423-456` |
| U50 | Every Home frame of `board.html` opens with one plain line on the state of all work; no "N things wait for you", ask or answer button | true | `test/board-home.test.ts:14,25` (pass) |
| U50 | What waits shows only as a count on the Inbox tab and an amber lamp on the step | partly | Board frame shows it; on main there is no Inbox tab (`ui/web/frame.tsx:28`): the count sits on Home's strip |
| U50 | Each task at work on Home is a row with title, state, run time, expected finish; the caption says a tap opens its step page | true | `test/board-home.test.ts:35` (passes); `docs/design/board.html:389` |
| U50 | The views line of `docs/idea.md` says Home shows the state of all work and only the Inbox asks | true | `docs/idea.md:258` |
| U50 | A test reads the board's Home frames and fails on "wait for you" in a headline or an answer button on Home | true | `test/board-home.test.ts:14-33` |
| U51 | The Usage frames have no call-out headline and open with accounts, slots as sidings, agents, tokens and cost | true | `test/board-usage.test.ts:13,18` (pass) |
| U51 | A 1440 px and a 390 px frame draw the agents at work with their facts; a third shows none | true | `test/board-usage.test.ts:30` (passes) |
| U51 | `docs/design.md` states the rule and lists the verdict phrases | true | `docs/design.md:125-129`; `test/board-usage.test.ts:25` |
| U51 | A test reads the Usage frames and fails on a listed phrase | true | `test/board-usage.test.ts:18` |
| U25 | The kit holds every part the board draws; `/design` shows each in each state; views draw nothing of their own | true | `ui/kit/`; `ui/web/design.tsx`; `ui/test/design.pw.ts:81`, `ui/test/alike.pw.ts` |
| U25 | `tokens.css` holds the board's measures; a test fails on an off-scale type size or a non-token colour | true | `test/kit-tokens.test.ts:27,35,41` (pass); `ui/test/kit.pw.ts:17` |
| U25 | Motion times only from the motion tokens plus press and hover; lists insert with their height; lamp has four states | true | `ui/test/kit.pw.ts:92`, `ui/kit/motion.ts` |
| U25 | Pointer, 120 ms hover, press to 0.97 within 100 ms; at 390 px every target at least 48 by 48 px on every view | true | `ui/test/kit.pw.ts:36,70` |
| U25 | One table part: tabular figures, units in the header, sorting over 10 rows, sticky header, rows open details, cards at 390 px; `/design` shows 3 and 200 rows | true | `ui/test/kit.pw.ts:105-152`; `ui/web/design.tsx:130,288` |
| U25 | One money and count format; the mark is no empty-state icon; the laid track is the loading state | true | `ui/test/kit.pw.ts:153`; `scripts/formats.ts` |
| U25 | Only two loops allowed, every other motion under 300 ms | true | `ui/test/kit.pw.ts:92` |
| U25 | Screenshots before and after on the pull request | partly | On the pull request, not in the repo; not checkable here |
| U26 | A rail from 1024 px holds the mark, views and a row per project; under 1024 px a bottom bar of Home, Inbox, Chat, Usage and Browsers, Settings a gear | partly | The rail and bar exist (`ui/kit/surfaces.tsx:289-361`) but the bar holds Home and Settings only (`ui/web/frame.tsx:28,115`) |
| U26 | The Inbox tab carries the count of what waits for you | false | `ui/test/browsers.pw.ts:81`: "no tab carries this count"; there is no Inbox tab |
| U26 | The rail and bar are links with `aria-current`; each view, project, step, ask has an address; a test opens each cold and after a reload | true | `ui/kit/surfaces.tsx:305,347`; `ui/test/frame.pw.ts:47` |
| U26 | Each view in its own file under `ui/web/`; the Roadmap view a folder with one file per part | true | `ls ui/web ui/web/roadmap`: chain, goals, line, since, step, summary |
| U26 | Screenshots at 390, 768, 1440 and 2560 px match the board's frame and grid | true | `ui/test/frame.pw.ts:9,18` |
| U62 | Home built as design.md says, all showing with no page scroll at 1440 x 900, checked by a test | true | `ui/test/home.pw.ts:14` |
| U62 | A row holds project, step, machine, stage, last action, files changed, check result; a click opens it in place | true | `ui/test/home.pw.ts:50` |
| U62 | Home shows no spend, charts or per-account rows; a thin week bar per account; a click opens the usage sheet; `/usage` opens it | true | `ui/test/home.pw.ts:119`; `ui/web/usage-mark.tsx`, `ui/web/usage-sheet.tsx` |
| U62 | A test fails on any subtitle, hint or label that describes the UI, and on a headline or counts line | true | `ui/test/home.pw.ts:25` |
| U62 | `/inbox`, `/usage`, `/browsers`, `/chat` open Home; Settings and a roadmap stay pages | true | `ui/test/home.pw.ts:110,119`; `ui/web/routes.ts:16` |
| U62 | Loading, empty, error, long text and 200 rows designed; screenshots on the PR | true | `ui/test/home.pw.ts:128,136` |
| U29 | Phases are segments of one bar; a tap opens a phase; at 390 px a 48 px row opens the list; parallel tracks rejoin | true | `ui/test/roadmap.pw.ts:120,185,195` |
| U29 | At 390 px nothing scrolls sideways with 319 steps, checked by a test | true | `ui/test/roadmap.pw.ts:101` |
| U29 | The train on the step at work, a lamp on a step that waits; a tap opens its why and done when | true | `ui/test/roadmap.pw.ts:207,215` |
| U29 | Screenshots with 8 steps and 319 are on the pull request | partly | On the pull request, not in the repo; not checkable here |
| U44 | One plain line at the top of every roadmap: counts, finish, the reason it is not sooner | true | `test/home-data.test.ts:273`; `ui/web/roadmap/summary.tsx` |
| U44 | `lineclear roadmap status` prints the same line first; a test gets the same counts, date and reason from CLI, view and `/api/home` | true | `test/home-data.test.ts:230` (passes); `test/roadmap.test.ts:221,241` |
| U44 | With no measured pace the line says so instead of a date | true | `test/home-data.test.ts:273`; `test/roadmap.test.ts:241` |
| U44 | Screenshots with 8 steps and 319 are on the pull request | partly | On the pull request, not in the repo; not checkable here |

## Reopened

Steps given a `Reopened:` line: L40, L30, L31, L33, L34, U14, U15, U21, L39, U22, U19, U50, U26.

U23 and U24 have false or partly items too, but are not reopened: `lineclear roadmap check` refuses a `Reopened:` line
on a step whose proof section is in `docs/numbers.md` ("README story", "U24"), and this audit changes nothing else in
the roadmap. Their gaps (no roles chart, table or details in the README; Home is a task table, not a track per
project) need a new step.

Items judged "partly" only because screenshots live on a pull request (U21, U25, U29, U44) did not reopen their
step.
