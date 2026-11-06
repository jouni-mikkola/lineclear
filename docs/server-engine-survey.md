# Server engine overlap survey

Task 13 of [simplify-cut.md](simplify-cut.md). Survey only: no code changed. Sizes are `wc -l`.

## What was read

| side | files | lines | tests |
| --- | --- | --- | --- |
| `server/server/live/engine/` | 21 | 5,203 | about 3,700 (`server/test/engine-*`, `check-queue`) |
| `server/server/live/source*.ts` | 10 | 3,900 | about 2,600 (`server/test/source-*`) |
| `src/retire.ts`, `src/worktree.ts`, `src/status.ts`, `src/stalls.ts` | 4 | 1,045 | in `test/` |

## Finding: the four pairs do different jobs

The survey's premise, "same jobs in two modules", holds for none of the four named pairs.

| `src/` file | engine file | same job? |
| --- | --- | --- |
| `retire.ts` (244): doctor checks and fixes that remove the old herdr-projects install | `engine/retire.ts` (51): moves ended tasks and chats older than 90 days to `archive/` | No. Same word, different job. Task 6 (old-name code) takes the first. |
| `worktree.ts` (76): reads one task's worktree for the rule loop (clean, commits ahead, owner wrote, push) | `engine/worktrees.ts` (328): creates, moves and puts away worktrees | No. One reads for rules, the other manages. |
| `status.ts` (126): text of `lineclear status` | `engine/status.ts` (98) and `status-line.ts` (34): the one task status the board shows | No. One prints, the other decides. |
| `stalls.ts` (599) with `stall-*.ts`: the ladder that acts on a stall | `engine/stalls.ts` (112): finds a stall and posts its card | No. They are two halves of one flow ([stalls.md](stalls.md)): the engine detects, the rule loop acts. Merging them would put rule-loop logic in the server. |

So the 3,000 to 5,000 lines expected from merging these do not exist. The `source-*` layer (the live source of
the server's board, spaces, restarts, views, CLI subcommands) has no counterpart in `src/` at all.

## What does overlap

Small, and each needs its own task:

1. **Two git helpers.** `engine/git.ts` (400, async, with broker-repo guard) and `src/git.ts` (30, sync). The
   server cannot take the sync one without losing its guard, and `src/` cannot take the async one in sync rules.
   Saving: at most about 100 lines, high risk. Not worth a task alone.
2. **Shared files already work.** `check-queue`, `check-runs`, `task-work` and `models` are written once and
   imported by both sides (`check-line` border in [architecture.md](architecture.md)). No copy to remove.
3. **Test splits.** `engine-merge*`, `engine-queue*`, `engine-b/c`, `live-b/c`, `source-b` to `source-g` are one
   area split by letter to stay under the file size limit, not copies. Merging cases that cover the same branch of
   code could save some of the 8,000 test lines, but only by reading each case. Not measured here.

## Where the lines are

The larger saving is not overlap but features, and tasks 12 and 6 already own it:

- `source-*` mentions `autopilot`/`Pilot` in `source-cli` (20), `source-spaces` (14), `source-state` (13),
  `source-upkeep` (12), `source-actions` (7), `source-restarts` (6), `source-views` (4). `places` is named in
  every file of the layer. Cutting autopilot and places (task 12) therefore shrinks `source-*` and its tests too.
  Task 12 must edit these files and their `source-*` tests, not only the feature files it lists.
- The largest single engine files are `engine-handoff.ts` (568), `check-queue.ts` (544), `engine-state.ts` (463),
  `engine-launch.ts` (454), `merge.ts` (432). Whether handoff (an agent taking over for another) is used by the
  owner is not answered by the code. If it is not, it is the one engine feature worth a cut: about 570 lines plus
  its tests. The owner decides.

## Recommendation

- No overlap-removal task. Honest total stays at about 30 % of code; the survey does not add a third lever.
- Add to task 12: the autopilot and places references in `source-*` and their tests.
- Ask the owner one question: is engine handoff (`engine-handoff.ts`) used? If not, a task deletes it.
- Leave the test splits until the other deletions land, then count cases that cover the same code.

## Not proven

- Line counts of tests per area are from file sizes, as in the survey, not from coverage.
- "Different jobs" is from reading the heads and exports of each file and `docs/stalls.md`, not from a call graph.
- Handoff use is not checked against a running board.
