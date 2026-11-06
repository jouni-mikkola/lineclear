# gates

The check: `bun run check` with the types, the tests, the dash and word checks, the roadmap and parts checks, and
the code gates of `scripts/gates/`, each a ratchet whose baseline only shrinks.

## Invariants

- A gate fails on any fault its baseline does not list, and on a baseline that lists more than it finds.
- Nothing is turned off to pass: a fault is fixed or stays in a baseline that only shrinks.
- The gates add 20 s at most to the check; slower checks run in the heavy run after a merge (L90).
- Every file is in one part, every name another part uses is on that part's page, and a changed interface changes its page.
- `docs/architecture.md` is the one map: the gates read its modules and parts tables, never a copy.

## Interface

`bun run check`, `bun run gates`, `lineclear parts check`, the baselines in `scripts/gates/baseline/`, and these
names:

- `src/parts.ts`: `Part`, `readParts`, `ownerOf`, `stepParts`, `stepFiles`, `stepLocks`, `holdsPartsWhole`, `stepHeld`, `stepNeeds`, `fileClash`, `unblockedByFiles`, `stepPartFaults`, `HEALTH_TAG`
- `src/parts-check.ts`: `partsMain`
- `src/heavy-run.ts`: `heavyTasks`, `slowFailures`
- `scripts/check-speed.ts`: `loadFactor`

## Files

- code: `scripts/gates/`, `scripts/personal-scan.ts`, `scripts/personal-words.ts`, `scripts/public-tree.ts`, `scripts/check.ts`, `scripts/check-speed.ts`, `scripts/result-cache.ts`, `scripts/dash-check.ts`, `scripts/words-check.ts`, `src/dashes.ts`, `src/parts.ts`, `src/parts-check.ts`, `scripts/coverage.ts`, `scripts/under-load.ts`, `scripts/changed.ts`, `scripts/load-map.ts`, `test/load-map-preload.ts`, `scripts/flaky.ts`, `scripts/fast-gates.ts`, `scripts/ui-changed.ts`, `src/heavy-run.ts`, `scripts/heavy.ts`
- config: `biome.json`, `knip.jsonc`
- tests: `test/gates.test.ts`, `test/result-cache.test.ts`, `test/personal-scan.test.ts`, `test/prose.test.ts`, `test/dashes.test.ts`, `test/one-word.test.ts`, `test/parts.test.ts`, `test/coverage-floor.test.ts`, `test/bin-lineclear.test.ts`, `test/changed.test.ts`, `test/flaky.test.ts`, `test/check-speed.test.ts`, `test/check-steps.test.ts`, `test/heavy-run.test.ts`

## Tests

- `test/gates.test.ts`, `test/result-cache.test.ts`, `test/dashes.test.ts`, `test/parts.test.ts`, `test/coverage-floor.test.ts`, `test/bin-lineclear.test.ts`, `test/heavy-run.test.ts`, `test/contracts/gates.test.ts`

## Debts

None.

