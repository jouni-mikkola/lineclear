# Research: the merge line and its tests

Question: how do popular merge queues, affected-test tools and flaky-test tools solve what the merge line struggles
with, and what should Lineclear copy? Read from each project's own README or docs (links below). Where a page gave no
number, none is quoted. Vendor gains are the vendor's claims, not measured by us.

## What Lineclear does today

Read from `docs/architecture.md`, `docs/parts/checks.md`, `docs/numbers.md` and Phase 23 of `docs/ROADMAP.md`.

- One merge turn at a time per repo and machine (L119, L126). The lane rebases only when its turn comes, runs the
  merge-tier check on main as it is, then merges. A head idle 15 min, or a turn over 30 min, is released (L120).
- `bun run check` runs what the change reaches (`testsFor` in `scripts/changed.ts`): the files each test loaded in the
  last full run (the load map), imports for files the map lacks, files a test names by path, and every test on a
  lock or config change. Steps run side by side; budget 180 s, a test file under 5 s, a spec under 20 s.
- The same check reruns a failed test alone; a pass is a flake, recorded in `decisions.jsonl` by file and name, and a
  second flake of one test within 24 h files a fix task (`scripts/flaky.ts`).
- Check slots per machine limit heavy runs (`lineclear slot`, 2 at once). Times are scaled by load.
- Quarantine in `lineclear check`: a test that failed then passed on one commit stops blocking. It still runs; only
  the verdict is overridden. It is known by name only, leaves only by a manual `lineclear check --release`, and a
  chained merge tier skips it (debts in `docs/parts/checks.md`).
- Measured before L120: 2.9, 1.2 and 3.0 merges per hour as day averages (69, 29 and 72 merges a day); queue depth
  was not measured (`docs/numbers.md`, Merge line). No batching, no speculation, no result cache.

## Merge queues

**GitHub merge queue.** Tests each PR on a temporary `merge_group` branch made of main plus the PRs ahead, then
fast-forwards. Settings worth noting: build concurrency (1 to 100), min and max group size with a wait time for
the minimum, a status-check timeout, and "only merge non-failing PRs" off, so a PR that flaked can ride in a group whose
last member passed. Groups of PRs are tested once, not one by one.
[docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

**Bors-ng** (deprecated, points users to GitHub's queue). The origin of the pattern: copy main to a `staging`
branch, merge the batch into it, test, fast-forward main when green, so main holds bit-for-bit what was tested.
Batches fill while one runs. On failure it bisects: split in two, requeue both halves, down to a single PR which goes
back to its author. It assumes tests usually pass.
[README](https://github.com/bors-ng/bors-ng/blob/master/README.md)

**rust-lang/bors** (rewrite of homu, runs rust-lang's gate). Separate `try` and `auto` branches: a try build is a
dry run on request, the auto build is the real gate; rollups merge several PRs into one candidate.
[README](https://github.com/rust-lang/bors/blob/main/README.md)

**Mergify merge queue.** Every PR is tested against latest main. Levers: `batch_size` with `batch_max_wait_time`,
dynamic batch size, parallel speculative checks (each PR on top of those ahead), scopes (unrelated parts of a monorepo
do not block each other), priority rules (hotfix first), pause and freeze windows, "two-step CI" (cheap tests on
every push, costly ones only in the queue), and re-running only the previously failed jobs after a batch splits.
[queue](https://docs.mergify.com/merge-queue/) · [batches](https://docs.mergify.com/merge-queue/batches/)

**Trunk merge queue.** Batching groups compatible PRs; failures bisect by halves with its own bisection concurrency
and test caching during bisection. Optimistic merging lets an earlier failing PR merge if a later PR containing it
passes. Parallel queues per impacted target. Claims 3 to 5 times more PRs per hour with batching and 20 to 30 %
less wait with optimistic merging.
[batching](https://docs.trunk.io/merge-queue/optimizations/batching) · [optimistic](https://docs.trunk.io/merge-queue/optimizations/optimistic-merging)

**Aviator MergeQueue.** Parallel mode: a bot opens draft PRs that stack the queued changes, each with its own CI,
capped by "max bot builds in parallel"; on a failure it falls back and rebuilds. Affected targets: the CI or the
repo (Bazel, Nx, Turborepo, or top-level folders) tells which targets a PR touches, and PRs with no overlap go to
separate dynamic queues, so a failure resets only its own queue.
[parallel](https://docs.aviator.co/mergequeue/concepts/parallel-mode) · [affected targets](https://docs.aviator.co/mergequeue/concepts/affected-targets)

**Graphite merge queue.** Stack-aware: a stack of PRs is validated as one unit, in parallel, without a second CI run
per PR; "fast-forward merge" lands the stack's PRs together.
[docs](https://graphite.dev/docs/graphite-merge-queue)

**Zuul gate (OpenStack).** The dependent pipeline tests each change on top of those ahead of it, speculatively, as if
merged one at a time. A failure drops the change and restarts those behind it. A window starts at 20 changes, grows by
1 per merge and halves per failure (TCP-style flow control), so a flaky period cannot flood the runners. Projects that
couple share a queue; others do not wait for each other.
[gating](https://zuul-ci.org/docs/zuul/latest/gating.html)

## Test impact analysis

**Bazel.** Each action declares inputs and outputs, so its result is cached under a hash of them. An unchanged
action is a cache hit on any machine. No guessing which tests matter: the build graph says.
[remote caching](https://bazel.build/remote/caching)

**Nx affected.** Git finds the changed files; each task whose declared inputs they touch runs, the rest are skipped.
Ignore files (`.gitignore`, `.nxignore`) are left out. A lock file change affects every task unless narrowed, a
safe default. Results of the other tasks come from cache.
[affected](https://nx.dev/ci/features/affected)

**Turborepo `--affected`.** Packages changed between the PR's base and head, plus their dependents. Needs git
history; on a shallow clone it falls back to running everything instead of guessing.
[CI guide](https://turborepo.com/docs/crafting-your-repository/constructing-ci)

**Jest `--findRelatedTests`, `--onlyChanged`, `--changedSince`.** Walk the import graph from the given source files
to the tests that import them. Static: misses tests tied by config, fixtures, files read at run time.
[CLI](https://jestjs.io/docs/cli)

**Vitest `related` and `--changed`.** Same idea over its module graph; `--changed [since]` picks tests affected by files
changed since a commit or branch.
[CLI](https://vitest.dev/guide/cli)

**Launchable predictive test selection.** A model trained on past runs and the change picks a subset to run first,
with a stated time-saving versus confidence trade-off. Needs run history and a vendor service.
[docs](https://www.launchableinc.com/docs/features/predictive-test-selection)

## Flaky tests

**Google (Testing Blog, 2016).** About 1.5 % of all test runs are flaky; 84 % of pass-to-fail transitions in post-submit
involved a flaky test; fix rate roughly equals insertion rate, so flakiness stays. Mitigations: rerun only failing
tests, auto-rerun, a "flaky" mark that fails only after 3 failures in a row (which delays a real break by 3 runs),
and a monitor that quarantines a test when its flakiness is too high and files a bug.
[post](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)

**Trunk Flaky Tests.** Detection by independent monitors (failure rate, failure count, pass-on-retry), branch-aware.
A test is flaky or broken: broken tests are not quarantine candidates, since that would hide a real failure. A
quarantined test keeps running and uploading results; only its exit code is overridden. Dashboard counts PRs rescued.
[detection](https://docs.trunk.io/flaky-tests/detection) · [quarantine](https://docs.trunk.io/flaky-tests/quarantining)

**Buildkite Test Engine.** States: enabled, muted, skipped. Muted tests still run, their failures do not affect the
build, and the collected data lets it see when they turn reliable. Docs advise muting over skipping, since a skipped
test gives no data. Automatic quarantine is a plan feature.
[state and quarantine](https://buildkite.com/docs/test-engine/test-suites/test-state-and-quarantine)

## Cost budgets

No project above publishes a CI budget rule. What they offer are caps and waits that bound spend: GitHub's build
concurrency and status-check timeout, Aviator's max bot builds, Zuul's window, Mergify's batch wait, Trunk's wait
time ("higher wait lowers CI cost per PR but raises time in queue"). Lineclear has its own: tier budgets that
name a check as too slow, the repo check's limits that fail by name, and a log of every run.

## Comparison

| Lineclear today | What they do | Gap | Recommendation | Expected gain | Cost |
| --- | --- | --- | --- | --- | --- |
| One turn at a time, one check per merge | Bors, Mergify, Trunk, GitHub test several PRs as one batch and bisect on red | Two ready tasks pay two checks | Batch heads waiting together (R1), only if queue depth shows a need | Check time per merge falls by the batch size when a burst waits; none when the line is empty | Medium: lane, bisect, tests |
| Rebase when the turn comes, check on main as it is | Nx, Turborepo, Bazel reuse a result when inputs are unchanged | A rebase onto an unrelated main change reruns the reached tests | Cache a step's pass keyed by a hash of its inputs (R2) | Rebase-only reruns drop to a cache read, most of the 180 s | Medium: key design, safe invalidation |
| Load map, imports and named paths pick tests; lock or config change runs all | Nx, Turborepo fall back to all on doubt; Launchable ranks by history | A file read without a load or a path in the test text (fixture by glob, env-driven config) is not seen; a miss is found only in `--full` | Learn a changed-file to failing-test map from the check log and run those first (R3) | Red found in seconds, not at the end; fewer misses reach main | Small to medium |
| Quarantine on fail-then-pass on one commit, by name; the test still runs. The repo check keys flakes by file and name and files a fix task | Trunk: monitors over history, broken is not flaky; Buildkite: muted tests keep running and can heal | In `lineclear check`: release only by hand, no fix task, names clash across files, a chain skips it | Give `lineclear check` the repo check's key and fix task, release on N clean runs (R4) | Fewer blocked merges and a shrinking flaky list | Small: the debts already named |
| Stuck head and 30 min turn limit | Mergify pause, freeze and priority; GitHub status timeout | A red main or a dead machine fails each turn in turn, and a fix for red main waits in line | Pause the lane on a red main or a failed infra check; priority to the fix task (R5) | One failure, not a string of bounced tasks | Small |
| Slots limit heavy runs | Zuul window shrinks on failure; Aviator max builds | None now: nothing runs speculatively | None | None | None |
| Tier budgets, 180 s | Others only cap concurrency | None | Keep | None | None |
| About 30 to 70 merges a day | Trunk, Mergify claim 3 to 5 times more with batching | Depth of the line is unknown, so the gain of queue tricks is unknown | Measure depth first (new, R1) | Avoids building what is not needed | None |

## Top 5 recommendations

Each is sized for a roadmap step. The order is by gain per cost for a line this size.

1. **R4: quarantine that heals.** Parts: checks. Reuse the repo check's key (file and name) and fix-task filing from
   `scripts/flaky.ts` in `lineclear check`'s quarantine, instead of a second design. Release a test after 10 clean
   runs in the check log (Buildkite: muted tests keep data and heal); keep the repo check's rule for the fix task (second flake of one test within 24 h); never quarantine a test that fails on every run (Trunk's broken versus flaky). Done when `lineclear check`
   prints each quarantined test with its run counts and a test plants fail, flake, heal and broken cases. It also
   closes the chained-tier debt: run each command of a chain, so quarantine applies there.
2. **R2: a pass cache per step.** Parts: checks, gates. Hash a step's inputs (the test file, the files the load map
   lists for it, the lock file, the runtime version) and store the pass in the check log. A rebase that changes none of them reads the pass
   instead of running. A lock file or config change invalidates all (Nx default); an unknown input means a miss, never
   a hit. Done when a test rebases a branch onto an unrelated main commit and no reached test reruns, and a
   changed loaded file reruns exactly its tests. Measure first how often the merge check reruns tests only because of
   a rebase; the 180 s is a ceiling, not a measured gain.
3. **R3: run likely failures first.** Parts: checks. From `check-runs.jsonl`, record which tests failed after which
   changed files; run those tests before the rest and stop at the first red. It only orders and adds tests, so a wrong
   guess costs nothing and no ML or vendor is involved. Done when a planted history makes the check fail within the
   first step, and a planted fixture that neither the load map nor path matching sees now reaches its test through the history.
4. **R5: pause on a red main.** Parts: server, rules. When the lane's last merge-tier run on main is red or a check fails
   for an infra reason (out of disk, killed, over its slot wait), pause the lane and show it on Home, instead of
   bouncing each head with a failure it did not cause. A task whose step is the fix for the red main goes first
   (Mergify priority). Done when a test shows three heads waiting through one red main and none told to fix it.
5. **R1: batch the heads, behind a measure.** Parts: server. First, record the queue depth at each turn start in the check log (the log has no queue entry today; L127 measures
   only merges per hour and the longest wait), and read its median and 90th percentile after a week. Only if the 90th percentile is 2 or more: when several heads wait, rebase them in order
   into one candidate, run the merge tier once, merge all on green; on red, bisect by halves (Bors, Trunk), and
   re-run only the failed steps on a half (Mergify). Cap the batch at 3 and wait for company at most 30 s. Done when
   a test plants three heads, one bad, and the two good land after the bad one is named and released.

## What not to copy, and why

- **Parallel draft PRs (Aviator) and Zuul's speculative pipelines.** They need many runners; Lineclear has two check
  slots per machine. A failed guess burns slots the next head needs. Zuul's window idea
  returns only if speculation ever does.
- **Optimistic merge (Trunk).** It merges a PR that failed because a later one passed. With flaky tests that lets a bad
  change in on a lucky pass; our quarantine and bisect cover the same ground more safely.
- **Rerun-three-times "flaky" mark (Google).** It delays a real red by three runs of that test: 45 min for a 15 min
  integration test, by Google's own example. Our check reruns a failed test once, alone, which is cheaper; R4 adds
  the history side.
- **Skip, not mute (Buildkite warns).** A skipped test makes no data and never heals.
- **Predictive ML selection (Launchable).** It adds a vendor and a model to trust, and a wrong skip lands on main. R3
  uses our own history, only to order.
- **Static-graph selection as the only gate (Jest, Vitest).** Ours is richer (load map) and already runs all on a
  lock or config change, as Nx does; the `--full` loop catches the rest.
- **Stacked-PR queues (Graphite) and `merge_group` branches.** Our tasks are independent branches in a local worktree
  with no PR required. Bors' staging idea is the part that applies (R1), not its app or comment commands.
- **Two-step CI (Mergify).** We already split inner, merge and nightly tiers.

## Sources not reached

Docs were fetched directly. Not read: Launchable's model papers,
Meta's and Google's internal submit-queue papers, Trunk's published detection thresholds, Mergify's parallel-checks
page (fetched empty). Claims about those are left out.
