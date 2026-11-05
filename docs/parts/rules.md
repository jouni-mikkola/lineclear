# rules

The rule loop, `lineclear run`: each tick it starts every step whose `after` is done and whose locks and parts are free, on a machine with room, with a worker and a reviewer of different companies. It answers stalls, waits, limits, full accounts, a red main and an unhealthy herdr by rule, never by a model.

## Invariants

- No AI decides what runs: a step starts only from the roadmap, the locks, the slots and the settings. A task belongs to a step only by the record kept when the rules start it, never by its title. A step starts on the first account of its role's list that has room, and its start decision names the account and any full one it passed; only when every account is out does it wait for the first reset.
- A step's locks are its `locks` and its `parts`: two open steps never hold the same one. A task with a declared wait is not nudged, and only a login, money or something that leaves the machine waits for the owner.
- Machine news, load and quota never wake an agent; a tell to an agent says why (`resume` or `answer`).
- A restart loses nothing: what a tick decided is on disk before it acts, and a held task's branch is pushed to origin before it moves. A step never starts twice: tasks on every machine and main are read again just before a start. A ready step with free locks, a free slot and an idle machine starts in the tick that first sees it ready.

## Interface

`lineclear run`, `lineclear wait`, `lineclear resume`, `lineclear check` and `slot`, the waits folder, and these names:

- `src/waits.ts`: `writeWait`, `clearWait`, `waitsMain`, `readWaits`, `waitsForOwner`, `Wait`, `findProject`, `findTask`, `loadLimit`, `limitOf`, `checkLines`, `WaitGroup`, `waitGroups`
- `src/remotes.ts`: `fetchExportSync`, `Export`, `relationOf`, `Relation`, `remoteExports`, `refreshRemotes`, `staleRemotes`
- `src/rules.ts`: `Decision`, `decisionsPath`, `runMain`, `realWorld`, `World`, `TICK_MS`
- `src/waste-watch.ts`: `wasteLines`, `noteTokens`
- `src/herdr-health.ts`: `herdrLines`
- `src/api-latency.ts`: `recordLatency`
- `src/status.ts`: `status`
- `src/stall-class.ts`: `stallsMain`, `median`, `summarize`, `readDecisionsSince`, `CLASS_INFO`, `StallClass`, `stallsReply`
- `src/self-fix.ts`: `fileFixNow`, `selfProject`
- `src/health.ts`: `diskTrouble`, `freeBytes`, `networkTrouble`, `Trouble`
- `src/spread.ts`: `remoteTasks`, `cloneOn`
- `src/limits.ts`: `AccountUse`, `usageLimits`
- `src/full.ts`: `Account`, `Move`, `readAccounts`, `readMoves`, `setPrice`, `setRetired`, `providerOf`
- `src/model-use.ts`: `modelNote`, `ModelReason`, `modelReasons`
- `src/routine.ts`: `modelPrice`
- `src/stalls.ts`: `stallCards`, `availability`
- `src/waiting.ts`: `waitingForYou`, `WaitingTask`

## Files

- code: `src/rules.ts`, `src/world.ts`, `src/real-world.ts`, `src/tick-project.ts`, `src/decision-dedupe.ts`, `src/wait-service.ts`, `src/stalls.ts`, `src/starts.ts`, `src/start-limit.ts`, `src/system-fault.ts`, `src/owner-steps.ts`, `src/pace.ts`, `src/waits.ts`, `src/process-group.ts`, `src/waiting.ts`, `src/held.ts`, `src/spread.ts`, `src/remotes.ts`, `src/full.ts`, `src/limits.ts`, `src/quota.ts`, `src/model-use.ts`, `src/routine.ts`, `src/health.ts`, `src/status.ts`, `src/stall-class.ts`, `src/stall-ladder.ts`, `src/self-fix.ts`, `src/outside-fix.ts`, `src/waste.ts`, `src/waste-facts.ts`, `src/waste-watch.ts`, `src/herdr-health.ts`, `src/herdr-world.ts`, `src/api-latency.ts`
- words: `templates/brief.md`, `templates/brief-review.md`, `templates/fix-brief.md`, `docs/stalls.md`, `docs/research/scheduler.md`, `docs/research/red-team.md`
- tests: `test/rules.test.ts`, `test/stalls.test.ts`, `test/pace.test.ts`, `test/waiting.test.ts`, `test/quiet.test.ts`, `test/close.test.ts`, `test/recovery.test.ts`, `test/second-machine.test.ts`, `test/limits.test.ts`, `test/quota.test.ts`, `test/model-use.test.ts`, `test/routine.test.ts`, `test/heavy.test.ts`, `test/agent-check-first.test.ts`, `test/rules-waits.test.ts`, `test/rules-world.ts`, `test/starts.test.ts`, `test/start-limit.test.ts`, `test/system-fault.test.ts`, `test/owner-steps.test.ts`, `test/stall-class.test.ts`, `test/scale.test.ts`, `test/fake-world.ts`, `test/waste.test.ts`, `test/herdr-health.test.ts`, `test/herdr-health-tick.test.ts`, `test/routing-closed-cli.test.ts`

## Tests
- `test/rules.test.ts`, `test/stalls.test.ts`, `test/waiting.test.ts`, `test/quiet.test.ts`, `test/close.test.ts`, `test/recovery.test.ts`, `test/second-machine.test.ts`, `test/limits.test.ts`, `test/quota.test.ts`, `test/model-use.test.ts`, `test/routine.test.ts`, `test/heavy.test.ts`, `test/starts.test.ts`

## Debts
- `src/waits.ts` is near the size limit; no `test/contracts/rules.test.ts` yet.
