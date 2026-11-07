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
| `pi` | `pi/` | the pi extension | none |
| `cli` | `src/` | the CLI and its commands, the rules loop, config and data paths, the web API | `pi`, `check-line`, `registry`, `secrets`, `store` |
| `bin` | `bin/` | the `lineclear` command | `cli` |
| `kit` | `ui/kit/` | the design system's parts and motion | `brand`, `cli` |
| `web` | `ui/web/` | the pages `lineclear run` serves | `kit`, `brand`, `cli`, `samples` |
| `samples` | `ui/test/samples/` | the sample data of each `?state=` page, loaded only on such a page | `web`, `kit`, `cli` |
| `ui-test` | `ui/test/`, `ui/budget/`, `playwright.config.ts`, `playwright.budget.config.ts` | the UI bar's browser tests and their fixture | `web`, `kit`, `brand`, `cli`, `pi`, `samples` |
| `gates` | `scripts/gates/` | the check's gates | `check-line` |
| `scripts` | `scripts/` | repo tools: the check, the smoke check, measurements | `cli`, `brand`, `gates`, `check-line` |
| `tests` | `test/` | the bun tests, one file per command | `cli`, `pi`, `kit`, `web`, `brand`, `scripts`, `gates`, `ui-test`, `samples`, `check-line`, `registry`, `secrets` |
| `shared` | `server/shared/` | types and pure helpers the server shares | none |
| `server` | `server/server/` | the server: the live source, agents, chats, the engine and the merge lane | `shared`, `check-line`, `registry`, `secrets`, `project-models`, `store` |
| `registry` | `src/models.ts` | the models every installed harness lists | none |
| `store` | `server/server/store.ts` | how a `store.sqlite` is opened, with its transactions | none |
| `secrets` | `server/server/live/secrets.ts` | the vault, and the `secrets` and `totp` words that read it | `cli`, `shared`, `check-line` |
| `project-models` | `server/server/live/project-models.ts` | the model each role of a space starts on, read from and moved into the project's settings | `cli`, `shared` |
| `check-line` | `server/server/live/engine/machine.ts`, `src/check-runs.ts`, `src/task-work.ts`, `src/git.ts`, `src/ssh.ts`, `src/time.ts` | each machine's name and load limit, a branch's GitHub checks read with gh, the log of the work a task does on its machine, and the one git helper, the one SSH command builder and time constants | none |
| `helper` | `server/helper/` | what runs on a remote machine | `shared` |
| `server-scripts` | `server/scripts/` | the server's test runner and store scripts | `server`, `shared`, `server-tests` |
| `server-tests` | `server/test/` | the server's tests | `server`, `shared`, `server-scripts`, `helper`, `check-line`, `registry`, `secrets`, `project-models`, `store` |

## Rules of thumb

- Code that two modules share lives in the lower one. `shared` holds what the server's parts both need.
- Tests may import what they test, never the other way round.
- An import across a border that is not allowed fails the gate.
