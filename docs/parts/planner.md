# planner

The roadmap and its plans: the format of `docs/ROADMAP.md`, its check, which steps are done, a planning task's brief,
`lineclear plan submit` with its rule checks, and a worker's brief of one step. A task row carries `stopped`.
## Invariants

- A step is done only by a commit on main (`<TASK>: <id> ...` or `Step: <id>`), and a revert of it opens it again. It is `done` only when the checker recorded every item of its `done when` true (`src/doneproof.ts`); with a false one it is `unproven`.
- A step is never deleted: it is dropped with a reason. A done-when line stays as strict. A task Done with nothing to merge marks its step done only when its own agent finished it (`closedBy: done`); a moved or hand-closed one proves nothing. A step is in work, and holds its locks, only through the task the rules started for it (`taskSteps`), never a title. A task whose worktree is gone and whose agent has been dead over 2 h (`orphaned`) holds no locks.
- A plan reaches main only through the rule checks: the form (each new or changed step names its parts, and its files
  fall inside them), locks, `after`, the longest chain, and about one step in five for the part with the worst health. Then a model from another company
  than the planner's reads each new or changed step with the repo's map and says go or no-go (`src/stepcheck.ts`); a no-go goes
  back to the planner, and three rounds with one end the planning task with a report.
- A worker's brief stays under `BRIEF_MAX` characters; the rules give way first, then the part pages, then the files. The critical path, the longest chain of open steps that wait on each other, comes from one function: the roadmap line's reason, the step page's rail and the status command all read it.

## Interface

`docs/ROADMAP.md`'s format, `lineclear roadmap` and `lineclear plan`, and these names:

- `src/roadmap.ts`: `Step`, `checkRoadmap`, `closedSteps`, `Task`, `doneIds`, `parseRoadmap`, `State`, `stepStatuses`, `resultOf`, `resultFlag`, `fitTitle`, `stepOfTask`, `isFrozen`
- `src/goals.ts`: `goalsOf`, `Goal`, `Hold`
- `src/plan.ts`: `planMain`
- `src/roadmap-cli.ts`: `roadmapMain` (its tasks come from the Lineclear server)
- `src/task-steps.ts`: `statusesOf`, `taskOfStep`, `titledByStep`
- `src/autoplan.ts`: `planProblems`, `plansAreAuto`, `recordApplied` (the item, base, commit, time, env, and the commits when there are several), `undoApplied`, `settlePlans`
- `src/progress.ts`: `Blocker`, `countSteps`, `day`, `readPlan`, `whereTo`, `Where`, `currentPhase`, `lineOf`, `Plan`, `RoadmapLine`, `roadmapLine`
- `src/brief.ts`: `DEFAULT_ROUNDS`, `fill`, `stepBrief`, `template`
- `src/plan-brief.ts`: `planBrief`
- `src/direction.ts`: `ownerDirection`
- `src/stepcheck.ts`: `StepCheck`
- `src/doneproof.ts`: `StepProof`, `readProofs`, `unprovenOf`, `needsProof`, `missingItem`, `CHECKS_PER_TICK`, `ProveTools`, `doneItems`, `testOf`
- `src/doneproof-run.ts`: `proveStep`

## Files

- code: `src/plan.ts`, `src/autoplan.ts`, `src/roadmap.ts`, `src/roadmap-cli.ts`, `src/task-steps.ts`, `src/roadmap-import.ts`, `src/brief.ts`, `src/progress.ts`, `src/goals.ts`, `src/direction.ts`, `src/stepcheck.ts`, `src/doneproof.ts`, `src/doneproof-run.ts`, `src/ask-model.ts`, `src/reader-ask.ts`, `scripts/direction-check.ts`, `scripts/scales-check.ts`, `src/plan-brief.ts`
- words: `templates/plan.md`, `docs/ROADMAP.md`, `docs/import.md`, `templates/direction.md`
- tests: `test/plan.test.ts`, `test/autoplan.test.ts`, `test/autoplan-apply.test.ts`, `test/roadmap.test.ts`, `test/frozen-steps.test.ts`, `test/reopened.test.ts`, `test/goals.test.ts`, `test/roadmap-import.test.ts`, `test/briefs.test.ts`, `test/direction.test.ts`, `test/stepcheck.test.ts`, `test/stepcheck-pi.test.ts`, `test/doneproof.test.ts`

## Tests

- `test/contracts/planner.test.ts`, `test/plan.test.ts`, `test/autoplan.test.ts`, `test/autoplan-apply.test.ts`, `test/roadmap.test.ts`, `test/roadmap-import.test.ts`, `test/briefs.test.ts`, `test/direction.test.ts`, `test/stepcheck.test.ts`, `test/stepcheck-pi.test.ts`, `test/doneproof.test.ts`

## Debts

- Only `lineclear plan submit` on a project that plans by itself runs every rule check; one that asks first runs the form only. Steps written before parts name locks, not parts. `lineclear plan` reaches the server the way the server command does: `--url`, then `LINECLEAR_URL`, then the data folder's `server.json`, then the default port. With none running it prints one line naming `lineclear serve`.
