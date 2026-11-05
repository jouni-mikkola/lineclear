# Truth audit 6 of 6: done steps

Each `done when` item of 31 done steps, checked on main at 7e69ea3f on 4 Nov. Verdict: true, false or partly.
Tests named were run and passed unless said otherwise. Steps with a false or partly item are reopened in `docs/ROADMAP.md`:
L90, L107, L123, L147, L157, L161.

| Step | Item | Verdict | Proof |
| --- | --- | --- | --- |
| L90 | Nightly job on main runs gates:full, coverage, cold start and slow checks; failure becomes a fix task | true | `proposeTiers` gives `ui:test`, `coverage`, `gates:full`, `cold-start`; `src/nightly.ts:83` files one fix task per failure; `test/nightly.test.ts` passes |
| L90 | A release runs the same checks first and stops on a failure | partly | `scripts/media.ts:187` (`media release`) runs `slowFailures`; `bun run release` (`scripts/release-tag.ts`, `src/release.ts:274-281`) runs only the full check and never names nightly, gates:full, coverage or cold-start |
| L90 | A test shows the job reports a planted fault | true | `test/nightly.test.ts` "a planted fault in a slow check is reported with its output" |
| L91 | Tested herdr version and protocol named in one place; doctor names a differing machine | true | `server/server/live/herdr.ts:12` `HERDR_TESTED`; `src/doctor.ts:82,310` `herdrVersions`, `testedHerdr`; `test/doctor.test.ts` imports and tests them |
| L91 | Contract test checks every call against the schema and a herdr of its own; fails on planted fault | true | `server/test/herdr-contract.test.ts` 6 pass, incl. "a planted unknown call, parameter or event is refused" |
| L91 | An update raises the pin with the contract test green | true | pin 0.9.5 equals `herdr --version` (0.9.5) and the contract test passes |
| L97 | Parts table of 8 to 12 parts, each with a page of at most one page | true | `docs/architecture.md` Parts table has 12 rows; `docs/parts/` has 12 pages, longest 45 lines |
| L97 | Every file in one part; `parts check` fails on a file in none | true | `bun src/cli.ts parts check .` exits 0; `test/parts.test.ts` "fails on ... a file in no part" |
| L97 | Locks renamed to parts; lock `check` is now `gates` | true | no `locks:` or `parts:` line in `docs/ROADMAP.md` uses `check`; part `gates` exists |
| L99 | `parts check` fails on a used name not on the page, or a listed name nobody uses | true | `test/parts.test.ts` lines 52 and 63 pass; the check runs in `bun run check` |
| L99 | Fails on an interface changed with no page change; tests plant both faults | true | `test/parts.test.ts:69` pass |
| L101 | `lineclear measure` prints per-part health (size, copies, debts, stalls, findings, flaky) with one score by the formula | true | `src/measure-main.ts:233,283` prints `partHealth`; formula at `docs/architecture.md:82`; `test/part-health.test.ts` passes (the live command printed no health block for a project without a roadmap, so the code and test are the proof) |
| L106 | Part health counts line coverage against the floors; a test shows a part under its floor scores worse | true | formula `docs/architecture.md:83`; `test/part-health.test.ts:52` pass |
| L104 | Server copies baseline lists at most half the lines it listed; tests pass | true | `scripts/gates/baseline/copies.json` server lines: 285 at 7c2171ea (before), 130 now; server tests pass |
| L107 | `docs/control-center.md` gives each unit, script and pi extension one verdict with a reason | partly | Units, scripts and extensions are listed, but on this machine `cc-cap-report`, `cc-check`, `cc-gate`, `cc-run-hermetic` (scripts) and the `claude-bridge-b`, `claude-bridge-c` extensions have no entry (`grep` of `docs/control-center.md` finds none); `cc-check-slot`, `cc-clean-code`, `cc-language`, `cc-machine-status` are named |
| L119 | `lineclear check` and the merge lane wait in a line per repo; slots stay one shared limit | true | `server/server/live/engine/check-queue.ts:41` `check-queue` folder, `join(queueRoot, line)`; test "the machine slots stay one limit for every line" |
| L119 | `check-queue.test.ts` holds one repo's line while another repo's check lands | true | test "a stuck head in one repo does not delay a check in another" pass |
| L120 | Lane watches every step; a head with no progress for 15 min is released | true | `server/server/live/engine/lane-watch.ts:8` `IDLE_MS = 15 * 60_000`; `server/test/engine-lane-watch.test.ts` |
| L120 | Released task told why, `stall` line written, second release goes to the restart rung | true | test "a head released twice in a row has its agent restarted" pass |
| L120 | Planted case (Rebasing, no git process, other projects behind) and a 40 min CPU check not released | true | tests "a head in 'Rebasing on main' ..." and "a check that keeps using the CPU for 40 minutes is not released" pass |
| L120 | A turn holds its line at most a limit (30 min); past it released as "over the limit" | true | test "a turn past its limit is released with 'over the limit'" pass |
| L126 | Each machine has its own check lines and slots; a turn never waits for another machine | true | `check-queue.ts` lines named by machine; test "a line per machine" pass |
| L126 | `lineclear status` and Home name each line with its machine | true | `src/waits.ts:43-51` `checkLines`, `projectCheckLines` used by `src/status.ts:38` and `src/home-data.ts:257` |
| L126 | Two-machine test: a merge lands at once behind two long checks of the other machine | true | test "two long checks of another machine in line do not hold a merge on this one" pass |
| L122 | A need card in the coordinator chat is routed like the task's own; unanswered ones are Inbox items the same tick | true | `test/asks.test.ts:336` pass |
| L122 | Answering the item answers the card; closing the task closes both | true | `test/asks.test.ts:394` pass |
| L122 | Test plants the two cards of the case | true | `test/asks.test.ts:336` pass |
| L123 | `lineclear measure` prints merges per hour and the longest turn wait from the check run log | true | `docs/numbers.md:56-59` describes it; `test/measure.test.ts` passes; `mergeLine` in `src/measure-main.ts:235` |
| L123 | `docs/numbers.md` has both numbers under "Merge line", measured from main before L120 | partly | `docs/numbers.md:65` has merges per hour (2.88, 1.21, 3.00); line 66 says the longest wait is "not measurable: the machine had no check run log before L120" |
| L123 | Tests cover both numbers on a planted log | true | `test/measure.test.ts` passes |
| L124 | `test/contracts/server.test.ts` covers joining and leaving a line, repo and machine lines, slots, a stuck head; the server page lists no missing test | true | 7 tests in the file (lines 16, 31, 44, 53, 68, 81, 88) pass; `parts check` exits 0 |
| L125 | The six merge functions moved from `engine.ts` to `engine/merge.ts`; `engine.ts` listed shorter; server tests pass | true | `merge.ts` defines `merge`, `mergeNow`, `mergeOnGitHub`, `mergedOnGitHub`, `markMerged`, `nudgeToMerge`; `engine.ts` is 85 lines and not in `size.json`; `engine-lane.test.ts` (25 pass) covers the merge |
| L140 | `asks.test.ts` plants three quiet turns of a nudged task; each card is answered by a rule | true | `test/asks.test.ts:292` pass |
| L140 | Each quiet turn nudged, up to three an hour, then the restart rung, with a `decisions.jsonl` line each | true | `test/asks.test.ts:247` pass |
| L140 | A reply that promises the next action counts as quiet | true | `test/asks.test.ts:292` pass |
| L141 | A declared wait shows its wait, not "Waits for your reply", and is not in the Inbox count | true | `test/waiting.test.ts:82,119` pass |
| L141 | A wait for the owner still shows Needs you with its question | true | `test/waiting.test.ts:119` pass |
| L142 | Server posts a "may be stuck" card after 5 min of silent Needs you; ladder climbs one rung per card | true | `server/server/live/engine/stalls.ts:34-45` `SILENT_NEED`; `test/stalls.test.ts:152` pass |
| L142 | A real question, a plan or a login never gets one | true | `test/stalls.test.ts:152` pass |
| L142 | Holds for a second machine's space | true | `test/second-machine.test.ts:360` pass |
| L142 | `docs/stalls.md` names the rule | true | `docs/stalls.md:17-18` |
| L143 | A quiet turn in Merging is told to merge again; the second goes to the restart rung | true | `test/asks.test.ts:272` pass |
| L144 | A pi turn with no ready/done/ask/wait is nudged at once, at most twice, then left to the ladder | true | `test/pack.test.ts:246` pass |
| L144 | A turn that asked or declared a wait is not nudged | true | `test/pack.test.ts:257` pass |
| L145 | `checkStalls` moved to `engine/stalls.ts` with its own tests; `engine.ts` shorter | true | `server/server/live/engine/stalls.ts:12` (112 lines); `server/test/stalls.test.ts` pass; `engine.ts` not in `size.json` |
| L146 | `statusOf`, `subOf`, `NEED` moved to `engine/status.ts` with tests | true | `engine/status.ts:10,50` (98 lines); `server/test/status.test.ts` pass |
| L112 | Every stall class has a named class and a detector | true | 18 classes in `src/stall-class.ts:28-46`, every class the item names plus `late`, `repo-off-main` and `unknown` |
| L112 | Stall recorded with class, remedy minutes, end minutes in `decisions.jsonl` | true | `test/stall-class.test.ts:100` pass |
| L112 | `lineclear stalls`, `/api/stalls` and a daily summary line | true | `src/web-routes.ts:230`; `stallsDailyPath` `src/stall-class.ts:428`; test "the loop keeps one summary line a day" pass (the line goes to `stalls-daily.jsonl`) |
| L112 | Tests plant each class | true | `test/stall-class.test.ts:119` "every class is planted" pass |
| L113 | Each class names its remedy and the ladder runs it (revive loop, merged step, held lock) | true | `test/stall-class.test.ts:178,196,210` pass |
| L113 | Unknown or twice-in-24h stall files one fix; one open per class, 3 a day | true | `test/stall-class.test.ts:251,285,301` pass |
| L113 | Tests: exactly one fix per planted stall; five classes file 3 | true | `test/stall-class.test.ts:251,301` pass |
| L118 | `shepherdr merge` waits until merged or stopped with a reason, however long the line | true | `server/test/engine-lane.test.ts` test "a merge behind another one's long check gets its result in one call" pass |
| L118 | A lost merge result still ends merged or stopped | true | test "a merge cut short by a restart ends as stopped with its reason, not Merging for good" pass |
| L118 | Test plants a merge behind a long check | true | same test as the first item |
| L147 | Rules record the step of each task; the stall check, ladder and closed-step count use only that record | partly | record `taskSteps`, `src/roadmap.ts:212` `stepOfTask`; but the lock-held remedy finds its holder by title (`src/stall-ladder.ts:103`) and `src/roadmap.ts:242` sets a step to "work" by title |
| L147 | Idle-after-done closes no task whose branch has commits main lacks | true | `test/stall-class.test.ts:365` pass |
| L147 | Test plants the LIN-198 stall | true | `test/stall-class.test.ts:365` pass |
| L147 | `decisions.jsonl` has no idle-after-done stall in the day after the merge | partly | merged 4 Nov 09:45 UTC; 0 idle-after-done lines since (`grep -c` gives 0), but the day is not over |
| L148 | The six helpers moved to `agent-start.ts` with tests; `agents.ts` shorter | true | `server/server/live/agent-start.ts:10-103` defines all six; `agents.ts` is 21 lines, not in `size.json`; `server/test/agent-start.test.ts` pass |
| L158 | A "past its time left" card records class `late`; asked once for an estimate; ladder climbs only without status | true | `test/stalls.test.ts:97,111` pass |
| L158 | Only a "quiet for" card records no-sign-of-life and climbs | true | `test/stalls.test.ts:123` pass |
| L158 | `docs/stalls.md` names the class | true | `docs/stalls.md:3,86` |
| L157 | The server locks its data folder; a second one exits and names the port and process | true | `server/server/lock.ts`; `server/test/one-server.test.ts` "a second server ... exits at once and names the port and process" pass |
| L157 | A dead holder's lock is taken over | true | `one-server.test.ts` "a server whose lock holder died starts as usual", `lock.test.ts` pass |
| L157 | A test plants the LIN-231 stall | true | `one-server.test.ts` (title names LIN-231) pass; it starts two servers and shows the second refused, so no second stall check runs |
| L157 | `decisions.jsonl` has no no-sign-of-life stall in the day after the merge for a reporting task | partly | merged 4 Nov 14:27 UTC; 0 no-sign-of-life lines since, but the day is not over |
| L161 | Lock-held remedy finds the holder in any status and acts by status | true | `src/stall-ladder.ts:103`; `docs/stalls.md:79-81`; `test/stall-class.test.ts:382` pass |
| L161 | Each remedy runs once per stall; a restart or tick repeats nothing | true | `test/stall-class.test.ts:382` "once" pass |
| L161 | Test plants the five holder cases | true | `test/stall-class.test.ts:382` pass |
| L161 | `docs/stalls.md` says the remedy for each holder status | true | `docs/stalls.md:79-81` |
| L161 | In the day after the merge each lock-held stall has its remedy or "waits for the owner" | partly | merged 4 Nov 12:26 UTC; no lock-held stall in `decisions.jsonl` since, but the day is not over |
| L163 | `check --changed` leaves one line in `check-runs.jsonl` with time, commit and load | true | `test/contracts/checks.test.ts:136` pass |
| L163 | The first debt in `docs/parts/checks.md` is removed | true | commit 3998582f removed "`lineclear check --changed` runs as it did before the tiers..." |
