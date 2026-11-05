# Architecture

Lineclear is a CLI with a rules loop (`src/`), a web UI (`ui/`), a pi extension (`pi/`) and a server (`server/`, the
fork of Shepherdr 2.0 that runs the agents). This page names each module, what it owns and which modules it may
import. `bun run check` reads the table below (`scripts/gates/borders.ts`): an import that the table does not allow
fails, and so does a source file in no module. A file belongs to the module with the longest folder that holds it.

An import cycle between files fails too: a file that imports, by any path, a file that imports it back. Type-only
imports count for the borders but not for cycles, since they are gone when the code runs.

## Modules

| Module | Folder | Owns | May import |
| --- | --- | --- | --- |
| `brand` | `ui/brand/` | the mark, the wordmark and the colour tokens | none |
| `pi` | `pi/` | the pi extension and the token pack's parts | none |
| `cli` | `src/` | the CLI and its commands, the rules loop, config and data paths, the web API | `pi`, `check-line`, `registry`, `timer-rule` |
| `bin` | `bin/` | the `lineclear` command | `cli` |
| `kit` | `ui/kit/` | the design system's parts and motion | `brand`, `cli` |
| `web` | `ui/web/` | the pages `lineclear run` serves | `kit`, `brand`, `cli` |
| `ui-test` | `ui/test/`, `ui/shots/`, `ui/budget/`, `playwright.config.ts`, `playwright.shots.config.ts`, `playwright.budget.config.ts` | the UI bar's browser tests and their fixture | `web`, `kit`, `brand`, `cli`, `pi` |
| `gates` | `scripts/gates/` | the check's gates and their baselines | none |
| `scripts` | `scripts/` | repo tools: the check, the smoke check and canary, measurements, film and icons | `cli`, `brand`, `gates`, `check-line` |
| `tests` | `test/` | the bun tests, one file per command | `cli`, `pi`, `kit`, `web`, `brand`, `scripts`, `gates`, `ui-test`, `check-line`, `registry` |
| `shared` | `server/shared/` | types and pure helpers the server and its screen share | none |
| `server` | `server/server/` | the server: the live source, agents, chats, the engine and the merge lane | `shared`, `generated`, `check-line`, `registry`, `timer-rule` |
| `registry` | `src/models.ts` | the models every installed harness lists | none |
| `check-line` | `server/server/live/engine/check-queue.ts`, `src/check-runs.ts` | one line of full checks per repo and machine, each machine's check slots, the stuck head and the log of every check run, files `lineclear check` and the merge lane share | none |
| `timer-rule` | `server/server/live/timer-rule.ts` | whether a coordinator may wake on a timer, one rule for the server's refusal and the CLI's heal | none |
| `generated` | `server/generated/` | the plugin registries the build writes | `plugins` |
| `screen` | `server/src/`, `server/vite.config.ts`, `server/public/` | the server's own screen: kernel, layout and parts | `shared`, `generated` |
| `plugins` | `server/plugins/` | the server's plugins, each a screen part and a server part | `screen`, `server`, `shared` |
| `helper` | `server/helper/` | what runs on a remote machine | `shared` |
| `server-scripts` | `server/scripts/` | the server's build, update, supervisor and test runner | `server`, `plugins`, `shared`, `server-tests` |
| `server-tests` | `server/test/` | the server's tests | `server`, `screen`, `plugins`, `shared`, `server-scripts`, `generated`, `helper`, `check-line`, `registry`, `timer-rule` |

## Rules of thumb

- Code that two modules share lives in the lower one. `shared` holds what the server and its screen both need.
- `generated` is written by `server/scripts/build-plugins.ts`: it imports every plugin, and only `server` and
  `screen` read it. That is how the server loads plugins that use the server's own parts.
- Tests may import what they test, never the other way round.
- An import across a border that is not allowed fails the gate. `scripts/gates/baseline/borders.json` stays empty.

## Coverage floors

`bun run coverage` runs the root tests and measures line coverage per module of the table above. A module below its
floor in `scripts/gates/baseline/coverage.json` fails. `bun run coverage --raise` lifts floors to what is measured and
never lowers one. It is slower than the check allows, so the nightly job and a release run it, not `bun run check`.
The run gives each test 60 s, since coverage slows it and a timed-out test leaves its lines out of the count.
`bunfig.toml` leaves out `scripts/media.ts`, `scripts/budget.ts` and `scripts/smoke.ts`: they drive Blender, Chromium and a live
service, so only a run of the tool itself reaches them (`bun run media`, the budget step, the smoke check).

## Parts

A module is where code sits and what it may import. A part is what one keeper looks after over time: its purpose,
what must stay true, its interface to the other parts, its files, its tests and its debts. A part may span modules
(the planner has code in `src/` and words in `templates/`), and every file of the repo is in exactly one part, the
one whose page lists the longest path that holds it.

Each part has one page, `docs/parts/<part>.md`, at most 45 lines. A step names its parts (`- parts:` in
`docs/ROADMAP.md`), its `files` fall inside them, and its worker's brief carries their pages. Parts are locks too:
two open steps never hold the same part. `lineclear parts check` keeps the pages true: every file in one part, every
name another part's code imports listed under the provider's Interface, an interface changed since main changes its
page in the same change, and each part with an interface has its contract test `test/contracts/<part>.test.ts`, or
names it under Debts until it lands.

| Part | What it keeps | Page |
| --- | --- | --- |
| `core` | the CLI's frame, data paths, settings, safe writes, the repo's rules and map | [core](parts/core.md) |
| `rules` | the rule loop: starts, locks, slots, stalls, waits, limits | [rules](parts/rules.md) |
| `planner` | the roadmap's format and check, plans and their rule checks, a step's brief | [planner](parts/planner.md) |
| `dispatcher` | the owner's chat, requests to the planner, roadmap moves | [dispatcher](parts/dispatcher.md) |
| `inbox` | the six kinds of item, routing asks, pushes to the phone | [inbox](parts/inbox.md) |
| `measure` | `lineclear measure`: asks, wait, cost, savings and part health | [measure](parts/measure.md) |
| `checks` | the check tiers, the check log, flake quarantine | [checks](parts/checks.md) |
| `install` | install, doctor, uninstall, migrate, machines, projects, secrets | [install](parts/install.md) |
| `ui` | the web pages, the kit, the brand, the web API, the README and its film | [ui](parts/ui.md) |
| `pi` | the pi extension and the token pack | [pi](parts/pi.md) |
| `gates` | `bun run check`, the code gates and the parts check | [gates](parts/gates.md) |
| `server` | the Shepherdr 2.0 fork that runs the agents | [server](parts/server.md) |

**Health.** `lineclear measure` gives each part a health score, higher is worse: 3 for each file over the size limit,
1 for each 50 lines copied (the copies baseline), 1 for each open debt on its page, 1 for each 5 points (rounded up) its line coverage is under the floors of its modules
(`bun run coverage` records the last measure; none recorded, none counted), 2 for each stall and 2 for each
flaky test in the tasks of steps that touched it, and 1 for each review finding those tasks reported. The planner
keeps about one step in five for the part with the worst score: a step whose parts line tags it, `rules (health)`.
