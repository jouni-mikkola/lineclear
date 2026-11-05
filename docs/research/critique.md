# Critique: Lineclear as it runs

Question: what costs the most, what is slow, what does not scale, and what to build better. Every number below was
read from the source named beside it, on 4 Nov 2026. Prices are list price (`equiv_cost` in the ledger), not what was
paid. A gain marked "est." is arithmetic on these numbers, not a measured result.

## Sources and window

- Token ledger `~/.local/state/control-center/usage/*.jsonl`, 1 to 4 Nov, both machines: 67,144 calls (laptop
  39,827, desktop 27,317), 1,379 USD. Cost split by a fit of the rows: cache reads 37 %, cache writes 38 %, output
  25 %, fresh input 0 %. 96 % of all tokens are cache reads.
- `decisions.jsonl` (12,790 lines since 31 Oct: 9,902 skip, 1,162 stall, 862 wake, 654 start, 153 stop),
  `check-runs.jsonl` (923 runs), `check-steps.jsonl` (10,455 steps), `~/.lineclear/tasks.json` (573 tasks) and
  `tasks-cold.jsonl`, the Dispatcher's notes `/tmp/dispatcher-overview.md`.
- A ledger task joins to its outcome through `tasks.json`. 430 tasks merged, 531 did not, 40 are unknown. Chat,
  coordinator and one-shot calls carry no task (6,640 calls, 168 USD).

## Ranking

| # | Finding | Gain (est.) | Covered by |
|---|---|---|---|
| 1 | Context grows to 57k median and is read again on every call | up to 15 % of worker cost, about 185 USD of 4 days at most, less the cache rewrite a stub causes | L52 sets 150 k. New: L216 |
| 2 | Review is not measured apart from the agent, and a docs-only change gets one | about 75 USD of 4 days on Sonnet-agent tasks at most | `templates/brief.md:35` sizes rounds already. New: L217 |
| 3 | 47 % of merge checks are red, and 288 of 420 red runs name no cause | 30.6 h of 47.9 h of merge-tier time | LIN-699 and LINE-85 merged on 4 Nov. New: L218 |
| 4 | The Dispatcher chat is one 150k-token session | 7.4 % of cost (102 of 1,379 USD) is chat | L173 to L195 fix time, not size. New: L219 |
| 5 | The brief is 91 % of a 6.9 MB `tasks.json` rewritten per change | 10x fewer bytes per write | L116 holds (hot tasks only). New: L220 |
| 6 | Whole-part locks and a load far above cores | about 1,700 lock skips since 3 Nov; load 18 on 8 cores | L159, L161, LIN-710 |
| 7 | Two machines: 145 of 654 starts on desktop, 9 failed | herdr start failures | L92 to L96 |
| 8 | "Done" is not checked | R3 done with no tag | LIN-718, LIN-712 to 717 |

## 1. Context is the cost

- Number: median context per worker call 56,767 tokens, p90 112,478; chat 90,862 median, p90 139,067. A session's
  first call is 12.5k (median), so the base prompt is small. The rest is history. Worker cost by context band
  (25k steps, USD): 0 to 25k 178, 25 to 50k 239, 50 to 75k 312, 75 to 100k 284, 100 to 125k 125, 125 to 150k 105.
  Two thirds of the worker cost (826 of 1,243 USD) is spent above 50k. The cost of a call rises in a straight line
  with its context; there may be no knee, only a trade between cache reads and compactions.
- Compaction: 461 drops of over 40 % in a session against 2,065 worker sessions. Worker sessions are short (median 10
  calls, p90 72, max 1,236).
- Cause: `pi/compaction.ts` and `pi/parts/compaction.ts` set the reserve so a session compacts near 150k (L52). The
  price of a call grows with the context, so the late calls are the dearest. Tool output stays in the context after
  it was used (`pi/parts/cut-output.ts` cuts only an output that is too long when it arrives).
- Does not scale: per call cost grows with the length of the task, so a step twice as large costs about four
  times. More models with big windows raise the ceiling, not the median.
- Fix: measure the cost by band first, then try compacting at 60 to 80k and replacing old tool results with a
  one-line stub (observation masking), keeping the notes of L54. A stub changes the middle of the prompt, so each
  later call writes the cache again (cache writes are already 38 % of cost): the step must measure that trade
  before it sets a goal.
- Gain (est.): cache reads are 37 % of cost; moving the median context from 57k to 35k cuts that part by about 40 %,
  so up to 15 % of worker cost, less the cache rewrites. Not measured.
- Covered: L51, L52, L54, L56 set the pack and the 150k line. None measures cost against context, and none masks
  old output. New step L216.

## 2. Review is not measured, and a docs-only change gets one

- Number: Opus made 15,316 of about 62,000 worker-role calls and 512 USD of the 1,246 USD of worker cost. On tasks
  whose agent is Sonnet, Opus calls cost 187 USD against 670 USD for the agent: at most 22 % of those tasks is
  review. On tasks whose agent is Opus (291 USD) the ledger cannot tell the reviewer from the agent: every worker
  row has `round: null`, and no row has the role reviewer.
- Cause: the ledger does not split review from work, so the cost is a guess. `templates/brief.md:35` already says
  one round for a diff under 150 lines that touches neither the rules nor the server core, and
  `src/project.ts:39` caps the rounds. A docs-only change still gets a review.
- Does not scale: review cost follows the number of tasks; an Opus review of a roadmap-only change reads the same
  repo rules as one of the merge lane.
- Fix: write the reviewer's role and round in the ledger row so review cost is read, not guessed; skip the review
  for a change that touches only docs or a roadmap file and passed the check.
- Gain (est.): about 75 USD of 4 days at most (40 % of the 187 on Sonnet-agent tasks); the Opus-agent share is unknown until the split exists.
- Covered: the one-round rule by `templates/brief.md:35` (LIN-184); not the split, and not docs-only. New step L217.

## 3. Red merge checks

- Number: 887 merge-tier runs in two days, 415 red (47 %). Red runs took 30.6 h of machine time, green ones 17.3 h.
  Red runs take 150 s median, green 87 s. 89 % of runs started with the load above the core count (median load
  18.5 on 8 cores). The pass rate hardly differs (54 % at load above 8, 48 % at or below, only 100 runs), so load is
  not the main cause of red.
- Causes: 288 of the 420 red runs have an empty `failed` list, so their cause is not recorded. Of the rest, the
  failure texts "the stable build reads this tree's roadmap" (64), "the format check reads the store this
  build..." (59) and "...the task id database" (59) sit in the same 64 runs, all up to 3 Nov 21:00Z, and `ui/test/bar.ts`
  appears in 10. LINE-85 (format check flake) and LIN-699 (merge checks fail less: `docs/numbers.md` says "red with
  no test named (a fast gate failed) 119 of 163") merged on 4 Nov, so those causes may be gone. Steps with the most
  time: tests 1/4 to 4/4 1,672 + 1,269 + 1,260 + 1,215 min over the window, `ui tests` 365 min at 730 s median,
  `wall` 2,777 min.
- Does not scale: red probability per merge rises with the number of concurrent tasks (more real-state changes)
  and each red run costs about 2.5 min of a slot plus a rework turn of the agent (tokens).
- Fix: make every red run record its cause (the failed gate, test or timeout), then fix the largest cause by the
  record, not by guess.
- Gain (est.): the state-reading causes were 64 runs, about 5 h; the cause of 288 red runs is unrecorded, so the
  gain of the next fix is not yet known.
- Covered: LIN-699 and LINE-85 (merged 4 Nov), L126 (checks wait per machine), L118. None makes a red run name its
  cause. New step L218.

## 4. The Dispatcher's design

- Number: chat role 2,329 calls, 102 USD (7.4 % of 1,379 USD; the ledger shows chat on laptop only). Its biggest session has 1,220 calls, 49.6 USD, and 150k context
  at the end; three more reach 150k. Median chat context is 91k. Owner's figures (not from the ledger): 405 calls at about 106k each
  today; 100 of 1,089 tool calls took over 2 min; it answered 2 h late because it ran long commands itself.
- Cause: one never-ending session is the Dispatcher's memory (`/tmp/dispatcher-overview.md` is its notes; the file
  `~/.config/lineclear/dispatcher/overview.md` is 54 lines), and it does the work in its own turn.
- Does not scale: the session grows with every owner message and every event, and each call re-reads all of it.
  L52 already compacts it near 150k; the ledger shows it still sits there for long stretches.
- Fix: rotate the Dispatcher's session at about 60k with `overview.md` as the memory, and keep reads to small
  commands. The time half is L173 to L195.
- Gain (est.): from 91k to about 40k median context on 2,300 calls: roughly half of 102 USD. L216 compacts every
  session by measured cost; L219 is the Dispatcher's own rotation and goes with it.
- Covered for time: L173 handles, L174 Operator, L175 mid-turn, L176 answer within 30 s, L190 to L195. Not covered
  for size. New step L219.

## 5. Stores that only grow, per tick and per write

- Number: `tasks.json` 6.88 MB (578 tasks, none ended over a day ago: `tasks-cold.jsonl` takes the older ones, so L116 works), of which `desc` (the brief) is 6.26 MB (91 %), 11 KB per task. `agents.json` 2.3 MB,
  `decisions.jsonl` 2.4 MB (12,790 lines in 5 days; 3,400 to 4,200 a day on busy days), `tasks-cold.jsonl` 4.3 MB,
  `agents-cold.jsonl` 3.3 MB, `check-steps.jsonl` 1.6 MB. A parse and print of `tasks.json` takes 54 ms.
- Cause: `server/server/store.ts:33` writes the whole value with `JSON.stringify(value, null, 2)` for every change.
  `rotateDecisions` (`src/stall-class.ts:345`) keeps 90 days, but 90 days at 3,500 lines a day is 315,000 lines
  (about 60 MB), read whole by `readDecisionsSince` (`src/stall-class.ts:306`) for Home (`src/home-data.ts:296`),
  measure and the stall classes. The loop skips the same reason again each tick: 9,902 skips against 654 starts,
  of which 1,381 are "kept off this machine" and about 1,700 lock skips since 3 Nov.
- Does not scale: the size of `tasks.json` follows the tasks of one day, not all tasks, and the brief copy is 91 %
  of it, so a busy day of 1,000 tasks would write about 12 MB per change. `decisions.jsonl` follows history. Chat
  logs, agents and machines poll on timers (`server/server/live/source.ts:123` every 1 s, `agents-delivery.ts:51`
  every 2 s, `machines.ts:28` every 5 s).
- Fix: keep the brief outside `tasks.json` (file per task, loaded on demand); append events instead of rewriting;
  log a skip once when its reason changes, not each tick; read `decisions.jsonl` through an index of the last day.
- Gain (est.): `tasks.json` from 6.9 MB to about 0.6 MB, a 10x cut in bytes written per change; skip lines cut by
  about 80 %.
- Covered: L116 "It scales" has the rotation of ended tasks and `docs/numbers.md` records its split; the brief copy
  inside a live task is not named anywhere. New step L220. The skip repeats and the 90-day read of `decisions.jsonl`
  stay with L116.

## 6. Locks and load

- Number: of 9,902 skips, lock skips are `server` 644, `install` 482, `rules` 299, `ui` 242 (since 3 Nov), 215 stalls
  ended on "lock-held". Median lock-held stall 356 min.
- Cause: a lock names a whole part, so any two steps in one part wait for each other (LIN-710 "whole-part locks",
  working). Load: the limit is `loadPerCore` 3 on laptop, so up to 24 on 8 cores before a start is refused; the
  median merge run saw 18.5.
- Covered: L159, L161, LIN-710. Nothing new.

## 7. Two machines and herdr

- Number: 145 of 654 starts say "slot free on desktop"; 50 "held task started on desktop, closed here"; 9 starts
  failed on desktop herdr (`tab.create`, `pane.process_info`, provision). The ledger of desktop is a second file
  set read by ssh; there is no single view of cost.
- Cause: per-machine servers and an ssh script for room (see L93 to L95).
- Covered: L92 to L96, L179. Nothing new; the cost view is covered by L32.

## 8. What "done" means

- Number: 191 steps done, unproven; R3 shows done with no tag. Fix and audits are LIN-718, LIN-712 to 717, LIN-719.
  Nothing new.

## Waste on tasks that merged nothing

- 430 merged tasks cost 1,020 USD (mean 2.37, median 1.08 per merged task). 531 unmerged cost 165 USD (489 of them
  under 1 USD, 64 USD together); calls without a task 168 USD; unmatched 24 USD. Waste on non-merging tasks is 12 %
  of cost, small next to findings 1 and 2. The restart loop (125 empty tasks in 2 h) cost little in tokens and
  filled the board: guarded by LIN-701 and LIN-709, and L179.
- Worker error calls: 561, 0.1 USD. Not worth a step.

## Steps added

L216 Compaction by measured cost, L217 Review cost is read, not guessed, L218 A red check names its cause, L219 The Dispatcher
session rotates, L220 A task's brief is stored once. See Phase 29 of `docs/ROADMAP.md`.
