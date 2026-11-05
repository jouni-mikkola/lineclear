# pi

Lineclear's pi extension and its token pack: it keeps an agent inside its task (no push, no secret or login file
that is not its own), loads the pack's pieces that save tokens, notes how full each account is, and gives Lineclear's
agents the kit: `kit/rules.md` in the system prompt and `kit/skills/` (plus playwright-cli's own skill when installed).

## Invariants

- An agent never pushes and never reads another task's secrets or the owner's login files.
- The merge guard refuses `lineclear merge` and the old `shepherdr merge` alike; the idle nudge names `lineclear`.
- Each piece of the pack can be turned off with `lineclear pack off <piece>`, and each is on by default once measured to pay.
- A piece never changes what a tool did, only how much of it the model reads, and says where the rest is.
- The extension imports nothing from `src/`: it runs inside pi.
- After a compaction a session still has its task, its notes and the owner's words: an agent the owner's messages, a
  coordinator, the Dispatcher and your own session the owner direction log.
- The kit names no personal file: an agent on a fresh home works by it alone.

## Interface

The pi extension file install links, `lineclear pack`, and these names:

- `src/harness-pi.ts`: `piHarness`, `sessionFolder`
- `src/pack.ts`: `packMain`, `parts`
- `pi/atomic.ts`: `writeAtomic`, `createAtomic`
- `pi/compaction.ts`: `unknownWindows`
- `pi/nudge.ts`: `IDLE_NUDGE`, `PROMISE_NUDGE`, `promisesNext`
- `pi/config.ts`: `configDir`, `decisionsPath`, `readJson`
- `pi/extension.ts`: `Limits`, `Window`, `callsOf`, `LIMITED_STREAK`
- `pi/heavy-tool.ts`: `toolRun`
- `pi/parts/compaction-notes.ts`: `logFile`, `logLines`, `notesStats`
- `pi/parts/cut-output.ts`: `cutStats`, `logFile`

## Files

- code: `pi/`, `kit/`, `src/pack.ts`, `src/harness.ts`, `src/harness-pi.ts`, `src/harness-claude.ts`, `src/harness-codex.ts`, `src/harness-opencode.ts`
- tests: `test/contracts/harness.test.ts`, `test/pi-parts.test.ts`, `test/agent-kit.test.ts`, `test/pack.test.ts`, `test/pack-reads-sleep.test.ts`, `test/cut-output.test.ts`, `test/compaction-notes.test.ts`, `test/compaction-planted.test.ts`, `test/stub-results.test.ts`

## Tests

- `test/agent-kit.test.ts`, `test/pack.test.ts`, `test/pack-reads-sleep.test.ts`, `test/cut-output.test.ts`, `test/compaction-notes.test.ts`, `test/compaction-planted.test.ts`, `test/stub-results.test.ts`

## Debts

- The pack calls its pieces "parts" (`pi/parts/`), a second meaning of the word.
- No contract test yet: `test/contracts/pi.test.ts`.
