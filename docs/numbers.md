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

## Install of a new worktree

Limits: under 5 seconds and under 50 MB of new disk for a worktree. Measured for 10 worktrees in a row, each a copy of this
repo's `package.json` and lock files (root and `server/`), Bun's download cache warm, new disk from `df` on a Linux machine.

Before: every worktree ran `bun install --frozen-lockfile` and kept its own `node_modules`.

```
install seconds  0.8 each, 0.7 to 1.2
new disk         425 MB each, 4245 MB for 10
```

The disk limit was over, so a new worktree now links `node_modules` from a store keyed by the hash of the lock file
(`storePath` in `server/server/live/engine/git.ts`). The first worktree of a lock file installs and moves its `node_modules`
into the store. A changed lock file makes a new entry.

After, 10 more worktrees with the same lock files:

```
install seconds  0.02 to 0.08 each
new disk         0.7 MB for 10 (the first, 460 MB, filled the store once)
```

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

- The board's task history on one machine holds 194 tasks over 62 hours. It has no per-machine failed-start record,
  only 22 tasks that needed their brief sent again (0.11 per task).
- The rule loop's `decisions.jsonl` (`~/.config/lineclear/`) holds 2614 `stall` lines from 2026-10-31 to 2026-11-07
  (about 169 hours), 15.5 per hour. 1559 of them are `stall <class>` lines and 1055 are ladder steps (`rung N`,
  `remedy`). By class: lock-held 552, unknown 545, no-sign-of-life 386, brief-unsent 32, coordinator-gone 16,
  head-of-line 12, no-room 6, machine-unreachable 4, roadmap-broken 2, idle-after-done 2, command-failed 2.
  Count again: `bun scripts/core-baseline.ts stalls`.
- Other machines: the board keeps no history of them here, so there is no number yet.

## Speed and stability baseline

Measured on the one machine with this repo's history, under light load. The Speed and stability steps of
[ROADMAP.md](ROADMAP.md) compare against these rows, not the older "Core baseline" above (a smaller sample). Medians and p90 come from `bun scripts/core-baseline.ts`.

| Measure | Median | p90 | Runs | Measure again |
| --- | --- | --- | --- | --- |
| `lineclear task add` to the agent's first tool call | 23 s | 131 s | last 20 done tasks | `start` |
| `lineclear task list` wall time | 0.23 s | 0.23 s | 7 | `time 7 lineclear task list` |
| `lineclear show` wall time | 0.09 s | 0.09 s | 7 | `time 7 lineclear show` |
| `lineclear room` wall time | 0.47 s | 0.68 s | 7 | `time 7 lineclear room` |
| Board `GET /api/snapshot`, 24.5 MB | 0.19 s | 0.28 s | 7 | `snapshot http://127.0.0.1:<board port>` |
| `check.yml` on main, whole run | 66 s | 86 s | last 20 runs | `gh` |
| Agent new input per task | 55 k | 276 k | last 20 done tasks | `tokens` |
| Agent cache reads per task | 798 k | 10502 k | last 20 done tasks | `tokens` |
| Coordinator new input per session | 227 k | 12702 k | last 6 sessions | `chat-tokens` |
| Dispatcher new input per session | 38 k | 2773 k | last 11 sessions | `chat-tokens` |
| Stall-kind lines per hour in `decisions.jsonl` | 15.5 | | 169 hours | `stalls` |

The reviewer ran in 2 of the last 20 done tasks' session folders, so its tokens have too few runs to set a target.

Runs of `check.yml` on main, the last 50: 20 success, 14 failure, 15 cancelled, 1 still running
(`gh run list --workflow check.yml --branch main --limit 50`). The workflow's `concurrency` group is the branch ref with
`cancel-in-progress`, so each push to main cancels the run before it.
