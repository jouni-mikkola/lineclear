# Code audit: src

What static tools cannot see in `src/`: features no one uses, the same job done twice, shims for states that are gone, tests of removed code. knip is clean, so each row was found by reading callers in the repo, the UI's fetch calls, pi session logs and the service journal.

| What | Where | Proof | Lines saved | Risk | Action |
|---|---|---|---|---|---|
| `LINECLEAR_TRACK_DIR` env read | `src/track.ts` | no hit in the repo outside the read | 0 (1 expression) | none | deleted here |
| `LINECLEAR_TRACK_NO_ROLLBACK` env read | `src/track.ts` | no hit in the repo outside the read | 1 | none | deleted here; `test/track.test.ts` passes |
| `git` helper defined 13 times | parts-check, plan, try-instance, brief, track, waits, check-runs, dispatcher, demo, task-detail, roadmap-view, autoplan, roadmap-cli | the same spawn wrapper in each | about 60 | low | L168 |
| `quote` 3 times | `ssh.ts`, `secrets.ts`, `pi/extension.ts` | same shell quoting; `pi/` may not import `src/` | about 10 | low | L168 |
| `isOpen` for fix tasks 2 times | `outside-fix.ts`, `self-fix.ts` | same open-task test (`inbox.ts` has a different one) | about 8 | low | L168 |
| `DAY`, `HOUR_MS`, `MIN` about 20 times | many | `measure.ts` already exports `DAY` | about 30 | low | L168 |
| `/api/events`, `events.jsonl`, `lineclear event` | `src/events.ts`, `web-routes.ts`, `cli.ts` | no `ui/` fetch; only `ui/budget/budget.pw.ts` and `test/events.test.ts` read it | about 330 with tests | medium: reviewers call `lineclear event` | L169 |
| `/api/stalls` | `src/stall-class.ts`, `web-routes.ts` | no `ui/` caller; `lineclear stalls` does the same | about 40 | low | L170 |
| `stalls-daily.jsonl` | `writeDaily` in `stall-class.ts` | no reader; only its return value times the `decisions.jsonl` cut | about 30 | low | L170 |
| Control Center doctor check | `src/control-center.ts` | no active or enabled `cc-*` unit it names on either machine | about 90 | low | L171 |
| `OUR_TELL` for "older versions" cards | `src/stalls.ts:136` | cards of versions that no longer run | 2 | low | L171 |

Kept, with the reason: `LINECLEAR_BROWSER_LIST_MS` (used by `playwright.config.ts`); `track.jsonl` (read by a test and cited as evidence in the roadmap); every CLI command (each has real calls in the session logs). `migrate`, the old-path and archive code, and the old UI are already deleted by L71 to L74 and L165 to L166.
