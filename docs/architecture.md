# Architecture

Lineclear is a CLI with a rules loop (`src/`), a web UI (`ui/`), a pi extension (`pi/`) and a server (`server/`, the
fork of herdr-projects 2.0 that runs the agents). This page names each module, what it owns and which modules it may
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
| `ui-test` | `ui/test/`, `ui/budget/`, `playwright.config.ts`, `playwright.budget.config.ts` | the UI bar's browser tests and their fixture | `web`, `kit`, `brand`, `cli`, `pi` |
| `gates` | `scripts/gates/` | the check's gates | none |
| `scripts` | `scripts/` | repo tools: the check, the smoke check, measurements | `cli`, `brand`, `gates`, `check-line` |
| `tests` | `test/` | the bun tests, one file per command | `cli`, `pi`, `kit`, `web`, `brand`, `scripts`, `gates`, `ui-test`, `check-line`, `registry` |
| `shared` | `server/shared/` | types and pure helpers the server shares | none |
| `server` | `server/server/` | the server: the live source, agents, chats, the engine and the merge lane | `shared`, `generated`, `check-line`, `registry`, `timer-rule` |
| `registry` | `src/models.ts` | the models every installed harness lists | none |
| `check-line` | `server/server/live/engine/machine.ts`, `src/check-runs.ts`, `src/task-work.ts`, `src/git.ts`, `src/time.ts` | each machine's name and load limit, the log of every check run and of the work a task does on its machine, files `lineclear check` and the merge lane share, and the one git helper and time constants | none |
| `timer-rule` | `server/server/live/timer-rule.ts` | whether a coordinator may wake on a timer, one rule for the server's refusal and the CLI's heal | none |
| `generated` | `server/generated/` | the plugin registries the build writes | `plugins` |
| `plugins` | `server/plugins/` | the server's plugins, each a server part | `server`, `shared` |
| `helper` | `server/helper/` | what runs on a remote machine | `shared` |
| `server-scripts` | `server/scripts/` | the server's build, update, supervisor and test runner | `server`, `plugins`, `shared`, `server-tests` |
| `server-tests` | `server/test/` | the server's tests | `server`, `plugins`, `shared`, `server-scripts`, `generated`, `helper`, `check-line`, `registry`, `timer-rule` |

## Rules of thumb

- Code that two modules share lives in the lower one. `shared` holds what the server's parts both need.
- `generated` is written by `server/scripts/build-plugins.ts`: it imports every plugin, and only `server` reads it. That is how the server loads plugins that use the server's own parts.
- Tests may import what they test, never the other way round.
- An import across a border that is not allowed fails the gate.
