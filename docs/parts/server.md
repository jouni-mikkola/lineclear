# server

The fork of herdr-projects 2.0 (MIT, `server/NOTICE`) that runs the agents: tasks, chats, the engine, the merge lane, the
helper on remote machines, its plugins and its own screen. `bin/lineclear serve` starts it.

## Invariants

- Its own types and tests pass in `bun run check` (within the check's time limit).
- Its modules keep the borders of `docs/architecture.md`.
- Every fault of herdr-projects 2.0 in `docs/known-faults.md` keeps a test that fails on the old code.
- A running task survives a restart of the server.
- The merge lane lands a branch of Lineclear's own repo only after its service starts on free ports with a scratch data folder and passes the web and API checks of `scripts/smoke.ts branch` (a scratch folder has no space to chat with).

## Interface

The `lineclear` command agents run, its HTTP API, the agent skills in `server/skill/`, and its data folder.
No file outside `server/` imports its code, except the check line:

- `server/server/live/engine/check-queue.ts`: `*`, `machineLimits`, `slotsHeld`, used by the CLI
- `server/server/live/timer-rule.ts`: `timerAllowed`, used by the CLI's doctor and heal

## Files

- code: `server/`
- tests: `test/known-faults-doc.test.ts`
- docs: `docs/known-faults.md`

## Tests

- `server/test/`, run by `server/scripts/test.ts`.
- `test/contracts/server.test.ts`


## Debts

