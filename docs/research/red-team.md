# Red team: the fixes (4 Nov 2026)

Method: read the code on main (`src/tick-project.ts`, `src/roadmap.ts`, `src/parts.ts`, `src/self-fix.ts`,
`src/waste-watch.ts`, `src/roadmap-cli.ts`), the Open part of `docs/ROADMAP.md` and `/tmp/dispatcher-overview.md`. Nothing was
run. Findings marked "check" are read from code but not reproduced. Severity: critical loses work or burns it without
end; major a user or the loop hits it; minor rarely.

## Verdict

The foundation is **not stable yet: it is a ring of patches around one weak centre**. A step's state (open, done,
reopened, unproven, working) is derived from five sources by five readers, and every incident adds a guard on one
reader (`closedSteps`, `reopenFixes`, `proofFixes`, `proofRestarts`, `whyStale`). Each guard counts something different
(merged commits, a day, a line number, a title prefix), so any two can disagree and loop. The patches themselves are
sound; the class they patch is not removed.

Stop doing: (1) a new `state.*` map per incident; (2) a guard that fails open when its input is missing; (3) fix filers
that bypass the daily cap; (4) detection (waste watch) without a brake.

## Findings

### F1 critical: reopened + closed-empty loops again (the 125-task class is not closed)
Scenario:
1. A step carries `Reopened:` (33 do today; many ask for an owner act: "no record of the owner reviewing", "no real push
   to a phone", "no machine added on a fresh virtual machine").
2. The line starts the step (`tick-project.ts:520`, `whyNotStart`). The agent finds nothing it can do and runs `done`
   with nothing to merge.
3. `closedSteps` (`roadmap.ts:225`) records it, but `stepStatuses` ignores `done` for a reopened step
   (`roadmap.ts:256`), so the step is `ready` at the next tick.
4. `refileReopened` (`tick-project.ts:441`) fires only when a **merged** commit is newer than the line. No merge
   happened, so it returns false. `restartUnproven` counts only the `unproven` state, not reopened. Nothing counts these
   starts: step 2 repeats on every tick, as fast as slots free up.
Fix, the class: one **start breaker** in `startStep`, keyed by step id and independent of why the step is ready: at
most N starts (3) in 24 h, counted from the task list itself (tasks titled `<id> ` created in the window, any end).
Over N the step goes to the Inbox as an owner step (L178) with its done-when, and no further start. Invariant: "no step
starts more than N times a day, whatever the rules say". Test: for each state in {ready, reopened, unproven}, a world
where every task closes empty; count starts after 10 ticks <= N.

### F2 major: the unproven restart cap resets at midnight
`restartUnproven` (`tick-project.ts`, `n < MAX_RESTARTS_A_DAY` comes before the `proofFixes` check). Day 1: two
restarts, then one Fix task. Day 2: `n` is 0 again, the function returns true before it looks at `proofFixes`: two more
empty restarts, for ever. R3 (needs a tag only the owner can push) is the live case. Fix: covered by F1's breaker
(rolling window, not a calendar day) plus the order of the checks (a filed fix blocks first). Test: a step unproven for
three simulated days starts at most N times in all while its fix is open.

### F3 major: guards fail open
`refileReopened` returns false when `commitsSince` is undefined (`tick-project.ts:445`), i.e. the Reopened line was
reworded, moved or the world cannot answer: the step then starts, the loop F1 describes, with no guard. The
`whyStale` merged-check is skipped for reopened steps (`:372`). Invariant: a guard that cannot read its input **stops
the start** and says so (one Home line), never allows it. Test: `commitsSince` returns undefined, the step does not
start.

### F4 major: three fix filers, three rules, one of them forgotten
- `self-fix.ts` (stall + waste fixes): cap `DAY_CAP = 3` in all, shared. A waste storm eats the budget that stall
  fixes need, and the other way round.
- `refileReopened`, `restartUnproven`, `proveClosed` call `world.addTask` directly: no cap, no dedupe by title.
- `reopenFixes[step]` / `proofFixes[step]` are cleared only when the step stops being reopened/unproven. If the Fix
  task is closed, fails or is dropped, the entry stays: the step is skipped for ever, one "skip" note per tick, no
  alarm, no owner item (a deadlock with a log line). Also `Fix <id> ...` does not start with `<id> `, so `whyStale`
  (`:380`) does not see it: a Fix and a normal start for one step can run side by side and merge-conflict.
Fix: one `fileFix(kind, key, brief)` in `self-fix.ts` used by all four callers: the cap, a dedupe by (kind, key) against
the task list (not a state map), an expiry (open fix = blocks; ended without merge = owner item), a title that carries
the step id. Test: kill the fix task, the next tick shows an Inbox item, not silence.

### F5 major: Reopened is an order to agents, and half the orders are not for agents
The audits (`docs/audit/truth-*.md`) reopen by writing a line. 33 lines now; items like "no record of the owner
reviewing the five views" or "real push to a phone" cannot be done by an agent, and the brief tells the agent "never
write a proof that did not happen". Result: either F1, or a Fix task that can only say "cannot". Also the reverse:
`proofFaults` refuses a `Reopened:` line when `numbers.md` holds the proof (`truth-1.md:132`, `truth-4.md:3`, ten
steps), so a false audit verdict **cannot be represented** and the finding is dropped in a docs file nobody reads.
Fix: an item prefix `Reopened (owner):` that routes to the Inbox through L178 and never to a task; and a verdict
`false` in `docs/audit/` that has no reopen anywhere fails `roadmap check`. Test for both.

### F6 major: five readers of "is this step done", two answers
`tickProject` builds status from main, `state.closedSteps` (hand entries, sticky for ever, even after a revert),
other machines' tasks and the proof records (`tick-project.ts:208-222`). `roadmap-cli.ts:102`, `roadmap-view.ts:161`
and `progress.ts:92` call `stepStatuses` with other inputs (no `taskSteps`, no remote tasks, no `closedSteps`).
`lineclear roadmap status` can say `ready` while the loop says `work`, and the owner and the Dispatcher read the first.
`closedSteps` itself makes a step done on one agent's `done` with nothing to merge: the exact thing LINE-370 (done
needs proof) was meant to end; `proveClosed` runs only a test the done-when happens to name (`testOf`), else nothing.
Fix: one `stepFacts(world)` that returns the inputs, passed to every caller; `state.closedSteps` entries expire with a
revert; a closed-empty task counts as done only with a checker record. Invariant test: for a fixture with a remote task
and a hand entry, all four readers return identical status.

### F7 major: locks starve and are honour-only (LIN-710)
`stepNeeds`/`stepHeld` (`parts.ts:118-160`): a step with no `locks` and no `files` (the default) holds `=part` and needs
`~part`, so it waits for every file-locked step in that part; narrow steps are ready more often and the loop starts in
file order, so the broad step starves with no aging. `files` is "likely to touch": nothing compares it with the real
diff, so a step that touches more takes locks it never held and conflicts show late, at merge. Fix: (a) aging: a step
skipped by locks in K ticks reserves its needs, so no new narrower step takes them; (b) the merge check fails when the
diff leaves the declared files + parts, naming the extra path. Tests: a broad step with a stream of narrow ones starts
within K ticks; a task touching an undeclared file is refused at merge. Also (check) `whyNotStart` counts a lock skip
as a note per tick: 600 notes in 6 h is the measure, so the same note stream hides new faults; collapse to a change log.

### F8 major: the Operator and the slots (plan L174)
"Lowers the machine's slot count while herdr is slow and restores it when starts succeed": with slots lowered to 0 no
start happens, so none "succeeds": a latch. A third controller on a knob that `capacityOf` (`tick-project.ts:253`) and
the overload test already set. Also "re-adds a failed start, 3 tries" runs beside L179's check and the rule loop's own
retry: two machines deciding the same start. "Never does a keeper's job twice" is a promise, not a mechanism. L173 adds a
handle table, a fourth store beside tasks, `state.json` and `remoteSeen`. Fix: the Operator proposes, the one rule loop
decides (one writer per decision); the slot floor is 1; the restore is time-based (probe a start every 5 min). Test: herdr
fails 10 starts then recovers: slots return to normal with no manual step.

### F9 major (check): one queued task blocks the space
`capacityOf`: `free = queued ? 0 : ...`. Any task `queued` that is not "After ..." stops all starts. A task queued by
the Dispatcher "to wait for a go" holds the whole project. Fix: the queued task counts only when a slot could take it;
test: a queued task with a free slot is started by the server within a tick, or it no longer blocks.

### F10 major: the waste watch only watches
`waste-watch.ts`: 24 h windows, 10 min look, one Fix task per alarm, `QUIET_AFTER_FIX` one day. During the 125-task
storm it would have alarmed after hours, filed a Fix (cap 3), and been quiet for a day after the fix closed while the
loop kept going. Detection without a brake. A fix that ends without removing the cause is silenced by the rule that
protects against noise. Fix: alarms of class "start loop" pause the named step in `state` (F1's breaker, lowered to 1)
until a person or the fix task's merge clears it; the quiet period ends when the 1 h rate is still high. Test: replay of
the 4 Nov log yields at most N starts.

### F11 major: done-needs-proof flips (LINE-370)
`proveMerged` asks a model per step (`CHECKS_PER_TICK`, retry 30 min, keyed on `head`). A model verdict is not stable:
true on one head, false on the next. A flip makes `unproven` and takes the step out of `finished`, so steps after it fall
back to `waiting` and the line, Home and the lock table move for no change in the code. Cost grows with 241 steps ×
every new main commit (check: `needsProof` decides). Fix: a verdict changes the state only after two equal reads, and
only a verdict on the **files the item names** re-opens it (record the file hashes); test: two reads that differ do not
change status.

### F12 minor/major: AI independence plan (LIN-728, from the overview only; the plan was not read)
Risks to hold the plan to: a quota adapter that cannot read must be an explicit state (`unknown`), not fail-open
(spends past the cap) and not fail-closed (`whyNotStart`: "no worker model has room" stops all work, which is how one
provider's outage halts the line). The "Scales" checklist in the step check adds a model call to every step; L61/L62
say the check stays only while it saves more than it costs, so give it a number before it ships. A registry beside the
name regexes (`add-project.ts`, `project.ts`) is a second source until the regexes are deleted in the same step.

### F13 minor: the Dispatcher overview is a snapshot
`/tmp/dispatcher-overview.md` holds counts with times ("191 done, unproven") and a hand list `state.closedSteps L108,
L109, L115, L56` to be removed by hand "once the fixes merge": a manual step with no owner and no test. Add the
removal to F6's change so it cannot be forgotten.

## Pairs of rules that can loop or deadlock (checklist for review)
| Pair | Loop or deadlock | Covered by |
| --- | --- | --- |
| done-never-restarts / reopened-restarts (known) | 125 empty tasks | patched, F1 shows a second path |
| reopened-restarts / closed-empty-is-done | F1 | F1 breaker |
| unproven-restart (daily) / proofFix (once) | F2 | F1, order of checks |
| fix filed / fix ends unmerged | F4: silent for ever | `fileFix` expiry |
| Operator lowers slots / start must succeed to restore | F8 latch | floor + timed probe |
| Operator re-adds start / rule loop starts | F8 double start | one writer |
| queued task / free slot | F9 | server or rule |
| broad step / narrow steps (locks) | F7 starvation | aging |
| waste alarm quiet / loop still running | F10 | brake |
| checker verdict / successor start | F11 flip | two equal reads |
| CLI status / tick status | F6 | one `stepFacts` |
| wait for a go (human) / project-wide queue | F9 | check |

## What to do
1. F1 first: it is the only one that burns tokens at once. Then F3, F4, F6 (one change each, each with its invariant
   test). These are L212 to L215 in the roadmap.
2. Every new guard comes with a **replay test**: the 4 Nov log (or a fixture of it) must stay under a stated number of
   starts. The class is "unbounded repeat"; one breaker plus a replay test covers it, the per-incident maps do not.
3. Delete a patch when its breaker lands: `reopenFixes`, `proofFixes`, `proofRestarts` become one rolling count.
