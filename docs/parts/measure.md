# measure

The readers of Lineclear's and pi's files, with no AI: spaces, tasks, chats, session usage and cost, each part's health, and what the step check costs and saves.

## Invariants

- No AI and no network: only Lineclear's files, pi's session files and git are read.
- A number it cannot price or place is named as not counted, never guessed.
- Part health counts only what anyone can recount: lines, copies, debts, stalls, review findings and flaky tests.

## Interface

These names:

- `src/measure.ts`: `chatFiles`, `findSpace`, `lineclearDir`, `spaceTasks`, `costOf`, `priceFinder`, `Price`, `taskStart`, `worktreeCost`
- `src/session-text.ts`: `sessionUsage`, `Usage`
- `src/kit.ts`: `readKit`, `kitDiff`, `kitOthers`, `wantedKit`, `Kit`, `Wanted`
- `src/kit-cli.ts`: `kitMain`, `remoteKitDiffs`
- `src/part-health.ts`: `partHealth`, `taskSignals`, `worstParts`
- `src/step-check-cost.ts`: `allChecks`
- `src/time.ts`: `MIN`, `HOUR_MS`, `DAY`

## Files

- code: `src/time.ts`, `src/measure.ts`, `src/catches.ts`, `src/kit.ts`, `src/kit-cli.ts`, `pi/kit.json`, `src/part-health.ts`, `scripts/fake-sessions.ts`, `src/session-text.ts`, `src/step-check-cost.ts`
- docs: `docs/simplify-cut.md`, `docs/kit.md`
- tests: `test/kit.test.ts`, `test/catches.test.ts`, `test/part-health.test.ts`

## Tests

- `test/contracts/measure.test.ts`, `test/kit.test.ts`, `test/part-health.test.ts`

## Debts

- `src/measure.ts` is near the size limit.
- Coverage per part is not in health yet (L106).
