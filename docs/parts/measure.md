# measure

`lineclear measure`: the numbers that say whether Lineclear works, from files and git with no AI. Asks, wait, cost
per merged step, the token pack's savings, each part's health, and what the step check costs and saves (no-gos, rework
rounds, owner questions, tokens and dollars of the check, for steps planned before it and with it).

## Invariants

- No AI and no network: only Lineclear's files, pi's session files and git are read.
- A number it cannot price or place is named as not counted, never guessed.
- A reviewer's calls carry their role and round, so `lineclear measure` prices the review apart from the agent's work.
- Part health counts only what anyone can recount: lines, copies, debts, stalls, review findings and flaky tests.
- The numbers in `docs/numbers.md` carry no project names.

## Interface

`lineclear measure <project> --since <date> [--json]`, and these names:

- `src/measure.ts`: `chatFiles`, `findSpace`, `lineclearDir`, `spaceTasks`, `costOf`, `priceFinder`, `Price`, `taskStart`, `worktreeCost`, `Numbers`
- `src/wait-goal.ts`: `appendGoalLine` (text, line, heading), `goalSince`, `waitGoal`, `waitGoalFailure`, `waitGoalLine`
- `src/cost-goal.ts`: `costGoal`, `costGoalFailure`, `costGoalLine`
- `src/ask-goal.ts`: `askGoal`, `askGoalFailure`, `askGoalLine`
- `src/measure-main.ts`: `measureMain`
- `src/session-text.ts`: `sessionUsage`, `Usage`
- `src/kit.ts`: `readKit`, `kitDiff`, `kitOthers`, `wantedKit`, `Kit`, `Wanted`
- `src/kit-cli.ts`: `kitMain`, `remoteKitDiffs`
- `src/part-health.ts`: `partHealth`, `taskSignals`, `worstParts`
- `src/step-check-cost.ts`: `allChecks`
- `src/time.ts`: `MIN`, `HOUR_MS`, `DAY`

## Files

- code: `scripts/simplify-count.ts`, `src/time.ts`, `src/measure.ts`, `src/measure-main.ts`, `src/catches.ts`, `src/measure-server.ts`, `src/measure-bands.ts`, `src/measure-refiles.ts`, `src/measure-remote.ts`, `src/measure-sessions.ts`, `src/wait-causes.ts`, `src/wait-goal.ts`, `src/cost-goal.ts`, `src/ask-goal.ts`, `src/kit.ts`, `src/kit-cli.ts`, `pi/kit.json`, `src/part-health.ts`, `scripts/measure-service.ts`, `scripts/browsers-speed.ts`, `scripts/measure-speed.ts`, `scripts/fake-sessions.ts`, `src/health-numbers.ts`, `src/session-text.ts`, `src/step-check-cost.ts`
- docs: `docs/numbers.md`, `docs/simplify.md`, `docs/simplify-cut.md`, `docs/kit.md`
- tests: `test/kit.test.ts`, `test/simplify.test.ts`, `test/measure.test.ts`, `test/catches.test.ts`, `test/measure-server.test.ts`, `test/measure-bands.test.ts`, `test/measure-refiles.test.ts`, `test/wait-causes.test.ts`, `test/wait-goal.test.ts`, `test/cost-goal.test.ts`, `test/ask-goal.test.ts`, `test/measure-service.test.ts`, `test/part-health.test.ts`

## Tests

- `test/contracts/measure.test.ts`, `test/kit.test.ts`, `test/measure.test.ts`, `test/measure-bands.test.ts`, `test/measure-refiles.test.ts`, `test/wait-causes.test.ts`, `test/wait-goal.test.ts`, `test/cost-goal.test.ts`, `test/ask-goal.test.ts`, `test/measure-service.test.ts`, `test/part-health.test.ts`

## Debts

- `src/measure.ts` is near the size limit.
- Coverage per part is not in health yet (L106).
