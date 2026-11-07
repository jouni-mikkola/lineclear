# Numbers

## Lock waits on another area

`decisions.jsonl` was read from the first L263 start (2026-11-05 05:51 UTC, before L263 merged) to 2026-11-06 07:40 UTC,
a window wider than the 24 hours after the merge, while the rule loop started this repo's open steps as usual. It has
four `stall` lines of the class `lock-held` for this repo, none between 04:11 and 12:35 UTC on 2026-11-05.
Each is a wait on the same area:

```
waiter  lock     holder  shared
L172    rules    L212    part rules
L302    release  L281    lock release, part install
L69     ui       U71     part ui, which L69 needs whole
L100    inbox    L47     part inbox, lock inbox
```

No line has a holder and waiter that share no lock, no file and no part.

## Core baseline

The speed today, measured on 2026-11-07 on one 12-core laptop (load about 1.5, 2 tasks working), from a fresh main.
The Speed and stability steps compare against it. `bun scripts/core-baseline.ts` prints each number again.

| Measure | Median | Worst | Runs | Measure again |
| --- | --- | --- | --- | --- |
| `lineclear task add` to the agent's first tool call | 24 s | 131 s | last 20 done tasks | `bun scripts/core-baseline.ts start` |
| `lineclear task list` wall time | 0.07 s | 0.08 s | 7 | `bun scripts/core-baseline.ts time 7 lineclear task list` |
| `lineclear room` wall time | 0.27 s | 0.28 s | 7 | `bun scripts/core-baseline.ts time 7 lineclear room` |
| `lineclear show` wall time | 0.06 s | 0.07 s | 7 | `bun scripts/core-baseline.ts time 7 lineclear show` |
| Board page, navigation start to the first task title on screen | 451 ms | 633 ms | 7 | see below |
| GitHub `check.yml` on main, whole run | 75 s | 95 s | last 20 runs | `bun scripts/core-baseline.ts gh` |

The first tool call is the task's created time to the first assistant message with a tool call in its agent session file.
The page is the web app on port 7420 (4 KB transferred, load event at 20 ms). Measure it with `playwright-cli`: open
the app in a session, then for each of 7 runs `goto` it and `eval` a function that polls until the page text holds a
task title and returns `performance.now()`.

GitHub check time per job (last 20 runs of `check.yml` on main, 19 with jobs):

| Job | Median | Worst |
| --- | --- | --- |
| check | 3 s | 5 s |
| full check (1/4) | 65 s | 71 s |
| full check (2/4) | 21 s | 41 s |
| full check (3/4) | 51 s | 75 s |
| full check (4/4) | 20 s | 30 s |

Command: `bun scripts/core-baseline.ts gh` (it needs `gh` signed in).

Tokens per task by role, from the session files of the last 20 done tasks
(`bun scripts/core-baseline.ts tokens`). New input is input plus cache writes. The reviewer ran on 14 of the 20.

| Role | New input | Cache reads | Output |
| --- | --- | --- | --- |
| Agent, median | 36 k | 650 k | 7 k |
| Agent, worst | 379 k | 6570 k | 52 k |
| Reviewer, median | 21 k | 148 k | 4 k |
| Reviewer, worst | 90 k | 1054 k | 11 k |

Stalls and failed starts (`bun scripts/core-baseline.ts stalls`):

- The board's task history on this machine (elitebook) holds 38 tasks over 6.7 hours. It recorded no stall card
  ("may be stuck"), so 0 stalls per hour. It recorded no failed start. 3 tasks needed their brief sent again.
- The rule loop's `decisions.jsonl` (`~/.config/lineclear/`) holds 209 `stall` lines from 2026-11-01 to 2026-11-07, about
  1.7 per hour: 178 flaky test, 31 command-failed. This is the older loop, not the board.
  Count again: `grep -c '"kind":"stall"' ~/.config/lineclear/decisions.jsonl`.
- Other machines: the board keeps no history of them here, so there is no number yet.
