# What each moving part costs

A part with no stated cost cannot be weighed, and only a list of costs shows what can go. One row per process the install starts, per timer, per task or check store, per rule loop and per gate in `scripts/gates/`.

Columns: seconds and tokens per merged step, restarts, and what breaks without the part. The window is the last 7 days of the logs; a number is a count, a zero is a measured zero.

## Recount

`bun scripts/simplify-count.ts` prints every row's numbers (`--days N` for another window). It reads:

- merged steps: the `lane` runs that passed in `check-steps.jsonl` (one `wall` line each). Every number below is divided by them.
- process and timer seconds: the unit's CPU time (`systemctl --user show <unit> -p CPUUsageNSec`) since it last started, over merged steps. Restarts: `-p NRestarts`.
- store seconds: one read of the file, from the config folder (`check-runs.jsonl`, `check-steps.jsonl`, `decisions.jsonl`) or `~/.lineclear` (the task store).
- loop restarts: the `stall` lines of `decisions.jsonl`, each a task the loop's rules restarted or answered. A loop runs inside `lineclear.service`, so its time is in that row.
- gate seconds: one timed run of `bun scripts/gates/run.ts <gate>` times the runs of the `gates` step in `check-steps.jsonl` per merged step. Restarts: runs in `check-runs.jsonl` that failed in the `gates` step.
- tokens: none of these parts calls a model, so each is 0. The rules decide by code, never by a model (`docs/parts/rules.md`). Review and agent tokens are in `lineclear measure`.

A zero in restarts or gate failures can mean the log has no such line on this machine (`check-runs.jsonl` is written by `lineclear check`); the command prints the same zero.

`test/simplify.test.ts` finds the parts in the repo and fails on one with no row, and on a row with no number.

## Processes

| part | seconds | tokens | restarts | breaks without it |
| --- | --- | --- | --- | --- |
| process `lineclear.service` | 113.3 | 0 | 0 | No rule loop: nothing starts, merges or answers a stall. |
| process `lineclear-serve-7421.service` | 8.9 | 0 | 0 | No board: the owner has no view and no Inbox. |
| process `lineclear-herdr.service` | 0 | 0 | 0 | No terminals for agents; a herdr already running on the machine makes it unneeded. |
| process `lineclear-track.service` | 0 | 0 | 0 | The nightly track does not run, so a bad build is found by use. |
| process `lineclear-track-update.service` | 0 | 0 | 0 | An update is not run through the chain, so a broken one does not roll back. |

## Timers

| part | seconds | tokens | restarts | breaks without it |
| --- | --- | --- | --- | --- |
| timer `lineclear-track.timer` | 0 | 0 | 0 | The track runs only after an update, never at night. |

## Stores

| part | seconds | tokens | restarts | breaks without it |
| --- | --- | --- | --- | --- |
| store `tasks.json` | 0 | 0 | 0 | The tasks and their facts are lost. |
| store `tasks-cold.jsonl` | 0 | 0 | 0 | Tasks ended over a day ago are lost from history and cost counts. |
| store `task-ids.sqlite` | 0 | 0 | 0 | Ids repeat: one id series for one brain breaks. |
| store `check-runs.jsonl` | 0 | 0 | 0 | No flake, quarantine or catch counts; red runs have no cause. |
| store `check-steps.jsonl` | 0 | 0 | 0 | No time per check step, and a release re-runs the full check. |
| store `decisions.jsonl` | 0 | 0 | 0 | The loop's choices and stalls cannot be audited or counted. |

## Rule loops

| part | seconds | tokens | restarts | breaks without it |
| --- | --- | --- | --- | --- |
| loop `TICK_MS` | 0 | 0 | 156 | Steps that are ready never start and stalls stay stuck. |
| loop `PROMOTE_EVERY_MS` | 0 | 0 | 0 | A built update waits as a candidate and never goes live. |
| loop `CANDIDATE_EVERY_MS` | 0 | 0 | 0 | A new build is not tried on a side instance before it is offered. |
| loop `FETCH_EVERY_MS` | 0 | 0 | 0 | A project's main goes stale, so steps start from old code. |
| loop `EVERY_MS` | 0 | 0 | 0 | The home doctor stops: faults on the board show late. |
| loop `REFRESH_MS` | 0 | 0 | 0 | Other machines' tasks and load are read late. |
| loop `SWEEP_EVERY_MS` | 0 | 0 | 0 | Temp folders and compile caches of finished runs fill the disk. |
| loop `CHECK_EVERY_MS` | 0 | 0 | 0 | A built update is never checked, so it is never promoted. |
| loop `BACKUP_EVERY_MS` | 0 | 0 | 0 | No hourly backup of the stores. |
| loop `PRUNE_EVERY_MS` | 0 | 0 | 0 | Old backups pile up. |

## Gates

| part | seconds | tokens | restarts | breaks without it |
| --- | --- | --- | --- | --- |
| gate `lint` | 3.3 | 0 | 0 | Style and likely bugs reach main. |
| gate `dead-code` | 65.4 | 0 | 0 | Unused exports and files pile up. |
| gate `copies` | 10 | 0 | 0 | Copied blocks spread. |
| gate `borders` | 1.1 | 0 | 0 | A module reaches into another's inside, or modules import each other in a ring. |
| gate `size` | 0.9 | 0 | 0 | Files and functions grow past the limits. |
| gate `comments` | 3 | 0 | 0 | History comments, filler and untracked TODOs stay in. |
| gate `code-rules` | 0.4 | 0 | 0 | A model name is hard-coded where a setting should hold it, or herdr is called outside its one adapter. |
| gate `old-name` | 0.2 | 0 | 0 | The old product's name comes back into code, a brief or a skill. |

`dead-code` is the largest cost on the page (a cold run: knip reads the whole repo). It is the first candidate to move to the heavy run.

## Existing measuring steps

`lineclear roadmap check` (L319) refuses a new step whose parts include `measure`, or whose files include `src/measure*`, `docs/numbers.md` or a report view, unless L271 is in its `after` chain. Each step below was in the roadmap before the rule and is kept.

Existing: L319, L284, L318, L274, L218, L252, L264, L216, L217, L306, L307, L310, L153, U22, U27, U52, U62, U45, L50, L56, L64, L101, L102, L106, L123, L203, L234, L237, L238, L239, L241, L242, L243, L245, L300, L268, L176, L195, L40, L33, L65, L167, L168, L100, L127, L115, L246, L172, L305
### Gates that caught nothing (L318)

`lineclear measure` lists the faults each gate and each merge-check step caught in the last 7 days (`catches in 7 days, gate X: N`). The gates step now ends a failed run with `gates failed: <names>`, and that line is what the count reads. Older runs named no gate, so every gate counts 0 until it fails once; the step `gates` itself caught 2 faults in the 7 days before this change. No gate is cut, because each guards a fault class that can still occur; the ones that read the same files are merged:

| merged gate | into | why the files are the same | summed seconds, before | after |
| --- | --- | --- | --- | --- |
| `cycles` | `borders` | both read the import graph of the same files | 1.5 + 2.1 | 1.1 |
| `model-names`, `herdr-calls` | `code-rules` | both scan the same source text of `src/` and `server/` | 2.2 + 1.4 | 0.4 |

The summed gate time per merge fell from 7.2 s to 1.5 s, a saving of 5.7 s of machine time. The gates run side by side, so the whole step's wall time did not move beyond noise: 26 to 33 s before, 29 s after, set by `dead-code` and `lint`. The fault classes stay: `test/gates.test.ts` plants one fault per remaining gate, an import ring, a model name and a herdr call included, and finds the gates step refuse it.
