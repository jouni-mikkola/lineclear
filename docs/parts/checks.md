# checks

The check tiers of each project and what keeps its checks honest: `lineclear check`, the check log, flake quarantine.

## Invariants

- Each project has three tiers with a time budget: inner (changed files, while working), merge (once per task, in the
  merge lane) and heavy (the slow rest, run after a merge). A tier it leaves out is proposed from its repo.
- Every check run is in the check log, with its time, its commit, the load, the load at its start (`loadAtStart`) and the minutes it waited for a check slot (`slotWaitMin`, 0 when it did not wait): the counts come from the log only. `lineclear check --log` prints the short commit, time, slot wait and start load of the last 10 runs.
- A test that failed and then passed on one commit is in quarantine: it no longer blocks a merge, it is never rerun
  past. A failure passes on quarantine only when nothing went unrun: a bare test runner, or a check that printed
  `check: every step ran`, never a chain, a timeout or a run with no failure count. A third run of a commit that
  failed twice is refused.
- Quarantine keys a test by file and name, as `scripts/flaky.ts` does. A second flake in 24 hours files one fix task; 10 clean
  runs in a row release the test; 3 failures in a row make it broken. A tier runs each command and prints the counts.
- A tier over its budget on an idle machine is a fault of the check, not of the change: the run says so, writes a `budget` line
  (tier, limit, time) to `check-runs.jsonl` for the rule loop, and its verdict stands. A busy machine's run is not counted.
- Each run names the machine it ran on (`machine`, from `whereRun`): a task started on another machine checks there and waits in that machine's check line, never the main one. Its agent, step check and done proof name their machine too: a `run` line in `decisions.jsonl` (`src/task-work.ts`), and `lineclear measure` counts runs per machine.
- The repo's own check (`bun run check`) runs only what the branch's change reaches, its independent steps side by side,
  and writes each step's time to the steps log `check-steps.jsonl`. A test over 2 s, a spec over 20 s or a run over
  180 s fails it by name, unless the file is in `scripts/gates/baseline/slow.json` (docs/numbers.md). `--full` runs
  everything: the release loop, on the newest main, after waiting up to 30 minutes for a quiet machine. Times are scaled
  by the busiest load from the run's start to its end (`loadMeter`).
- `check.where` = `github` (default `local`): a landing opens its pull request and waits for GitHub's checks (`.github/workflows/`: changed tests per pull request, the full check in 4 shards in the merge queue, heavy suites after a merge on main, .github/workflows/heavy.yml), naming failing tests from the job log.

## Interface
`lineclear check [--tier <tier>] [command]`, `lineclear check --release <test>`, the check
log `check-runs.jsonl`, and these names:
- `src/check-runs.ts`: `Tier`, `CheckRun`, `loadMeter`, `recordStepTimes`, `readRuns`, `laneDays`, `redByCause`, `refusedMergeBranches`, `whereRun`, `machineOf`, `testKey`
- `src/task-work.ts`: `recordWork`, `readWork`, `runsPerMachine`, `machineRunLine`
- `src/git.ts`: `git`, `gitWith`, `gitText`, `gitAsLineclear`
- `src/check-tier.ts`: `checkTier`, `flakeFixIn`

## Files

- code: `src/check-runs.ts`, `src/check-tier.ts`, `src/task-work.ts`, `src/git.ts`
- tests: `test/contracts/checks.test.ts`, `test/red-causes.test.ts`, `test/light-checks.test.ts`

## Tests

- `test/contracts/checks.test.ts`

## Debts

- The merge lane runs a merge tier of several commands as one chain, so quarantine does not apply there. Moving an unearned check to heavy is not in yet.
