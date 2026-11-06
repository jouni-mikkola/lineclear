# gates

The check: `bun run check` with the types, the tests, the dash and word checks, the roadmap and parts checks, and
the code gates of each a ratchet whose baseline only shrinks.

## Invariants

- A gate fails on any fault.
- Nothing is turned off to pass: a fault is fixed.
- Every file is in one part, every name another part uses is on that part's page, and a changed interface changes its page.
- `docs/architecture.md` is the one map: the gates read its modules and parts tables, never a copy.

## Interface

`bun run check`, `bun run gates`, `lineclear parts check`, and these
names:

- `src/parts.ts`: `Part`, `readParts`, `ownerOf`, `stepParts`, `stepFiles`, `stepLocks`, `holdsPartsWhole`, `stepHeld`, `stepNeeds`, `fileClash`, `unblockedByFiles`, `stepPartFaults`, `HEALTH_TAG`
- `src/parts-check.ts`: `partsMain`
- `scripts/check-speed.ts`: `loadFactor`

## Files

- code: `scripts/gates/`, `scripts/public-tree.ts`, `scripts/check.ts`, `scripts/check-speed.ts`, `scripts/result-cache.ts`, `src/parts.ts`, `src/parts-check.ts`, `scripts/under-load.ts`, `scripts/changed.ts`, `scripts/load-map.ts`, `test/load-map-preload.ts`, `scripts/flaky.ts`, `scripts/fast-gates.ts`, `scripts/ui-changed.ts`
- config: `biome.json`, `knip.jsonc`
- tests: `test/result-cache.test.ts`, `test/one-word.test.ts`, `test/parts.test.ts`, `test/bin-lineclear.test.ts`, `test/changed.test.ts`, `test/flaky.test.ts`, `test/check-speed.test.ts`, `test/check-steps.test.ts`

## Tests

- `test/result-cache.test.ts`, `test/parts.test.ts`, `test/bin-lineclear.test.ts`, `test/contracts/gates.test.ts`

## Debts

None.

