# Audit: the task engine

Read-only audit of `server/server/live/engine/*`, `recovery.ts`, `revive.ts`, `restart.ts` and `quiet.ts` on main
(`18a1693`). Paths below are relative to `server/server/live/`. Step ids L520 to L529.

## The answer

**There is no state machine per task. There are 58 fields on `TaskRec` (39 of them flags, counts or timestamps:
`engine/engine-helpers.ts:7`) and 19 in-memory maps and sets (`engine/engine-state.ts:60-130`), and a status
function that reads a dozen of them in a fixed order.** Transitions are not named: any code path writes any flag
(`reported`, `landing`, `todo`, `held`, `after`, `stopped`, `paused`, `going`, `trouble`, `stuck`, `told`, `posted`), then calls
`settle()`. What the flags cannot say (a turn that ended, an agent that never began, a merge that hangs) is patched
by a timer that sets another flag. The in-memory half is lost on a restart, and a second set of repair code puts it back
(`resumeQueue`, `endLostMerges`, `briefLate`, `going` re-sent).

What is already right and stays: the herdr event subscription (`herdr.ts:262-341`), `Revivals`' explicit counters
(`revive.ts:62`), `LinkBackoff` for a reconnect (`recovery.ts:2`; a bounded backoff on a socket that can really be down is
not a patch), `restart.ts` (pure functions, no timers, no catches), the `ColdLog` append log (`engine/cold.ts`).

## How pi and herdr expose events (checked)

- herdr: `events.subscribe` over the socket API keeps a connection open and streams `pane.agent_status_changed`,
  `pane.exited` and more ([Socket API](https://herdr.dev/docs/socket-api/)). Lineclear already subscribes
  (`herdr.ts:262-341`) and re-reads a snapshot on `onOpen`. So an agent's working/idle/gone needs no poll.
- pi: extensions get `agent_start`, `agent_end`, `agent_before_settle`, `agent_settled`, `turn_end`, `tool_execution_start/end`
  ([extensions.md, Events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)).
  `agent_settled` is "final: pi will not continue running automatically" and is meant for status integrations. `agent_end`
  alone is not final (auto-retry, auto-compact, queued follow-ups may continue). `pi/extension.ts` uses `agent_end`
  (line 60, 101) and `tool_call`/`tool_result` but not `agent_settled` or `agent_start`.
- GitHub has no push to a local process without a public endpoint. The honest replacement is one conditional read
  per repo (ETag / `If-None-Match`, which does not count against the rate limit when it answers 304), shared by every waiter.

## Findings

Numbers: measured here where it says "measured", else counted from the code. A `gh` spawn is taken as 0.15 to 0.3 s
of CPU and a process spawn (not measured here; L524 starts by measuring it).

#### A. State: flags instead of phases

| # | file:line | what it does | why it is a patch / does not scale | replacement | step |
|---|---|---|---|---|---|
| 1 | `engine/engine-helpers.ts:7-120` | `TaskRec` has 58 fields; the state of a task is the combination of `reported, landing, merged, closed, trouble, stuck, todo, held, after, stopped, paused, going, archived, cleaned, told, posted` | 16 booleans-ish flags = 65,536 combinations, a handful valid; nothing rejects an invalid one (`reported` + `todo` + `held` is writable) | one `phase` enum with a transition table; flags that remain are data (timestamps), not state | L521 |
| 2 | `engine/status.ts:27-49` | `rawStatus` is 15 ordered `if`s over flags, in-memory sets and 3 live lookups (`agents.status`, `chats.openCard`, `agents.waiting`) | status is recomputed, not stored: `checkStalls`, `recheck`, `autoArchive`, `count`, `busy`, `working()` each call it per task. At 45 tasks, one `settle()` = `recheck()` (all queued) + `release()` (all held) + 1 settleOne; `working()` is O(tasks) with a status call each, called from `room()` for every held task: 45 held x 561 tasks = 25,000 status calls per release | status read from `phase` (O(1)); the three live lookups only change the phase at an event | L521 |
| 3 | `engine/engine-state.ts:60-130` | 19 in-memory maps/sets (`starting, briefing, handing, cleaning, landings, merging, runOf, cut, released, frees, callerLeft, wrote, heard, beat, later, took, sweeps…`) | state that decides what the owner sees (`starting`, `briefing`, `handing`) is lost on restart. `resumeQueue` (`engine-launch.ts:146`), `endLostMerges` (`merge.ts:125`), `briefLate` (`engine-state.ts:477`) and the re-sent `going` exist only to rebuild it | the phase is persisted (`starting`, `briefing`, `handing`, `cleaning` become phases); only handles (promises, timers) stay in memory | L521 |
| 4 | `engine/engine-launch.ts:33-37` | `settle()` = `settleOne` + `recheck()` + `release()` on every change | each `settleOne` can `save()` (680 KB) and `emit('changed')` (snapshot rebuild); `recheck` runs `filter(queued)` over 561 tasks and `release` over all held, per call. 45 agents x ~3 changes/min = 135 settles/min = 135 x 2 full scans | a queue/held index kept by the transition (`phase` change moves the id in or out); settle touches only the task and its dependents | L521 |
| 5 | `engine/engine-state.ts:347-352` | `busy()` counts a go as "at work" for `BRIEF_WAIT` (120 s) after it was written | a clock stands in for "the agent started": a slow start (> 2 min under load) frees a slot that is still taken, a fast one holds it for the rest of the 2 min | slot counted from the phase `starting`/`working`; `agent_start` from pi moves it | L522 |
| 6 | `engine/engine-state.ts:145-152` | `save()` writes all hot tasks whole on every call | see C | see C | L520 |
| 7 | `engine/engine-launch.ts:54-58` | `orphaned()`: a worktree gone + agent dead + `updated` older than `ORPHAN_AFTER` (2 h) | a 2 h clock decides when a task stops holding locks. A task stuck in an impossible combination is released by waiting | phase `lost` entered by the event that loses the worktree (`worktree.removed`, `pane.exited` with no worktree) | L521 |

#### B. Timers where an event exists

| # | file:line | what it does | why it is a patch / does not scale | replacement | step |
|---|---|---|---|---|---|
| 8 | `engine/engine-launch.ts:40-50`, `engine-handoff.ts:156`, `engine-tidy.ts:274`, `merge.ts:460`, `engine-launch.ts:170` | `settleSoon`: wait 4 s (or `ANSWER_GRACE + 500` = 6.5 s) after a turn ends "in case the next turn starts" before telling anyone | a guess at what `agent_settled` says exactly. 4 s of wrong status per turn end; a turn that starts 4.1 s later is announced as Ready/Needs you and corrected. One `setTimeout` + one `later` map entry per task | pi extension sends `agent_settled` (aborted flag included); the engine moves phase on it | L522 |
| 9 | `engine/status.ts:43`, `engine/engine-helpers.ts:287` | `Date.now() - wrote < ANSWER_GRACE (6000)` makes a task read as work for 6 s after something was written to it | a wall-clock window inside a status function: the status of a task changes without any event, so no listener hears it; a task flickers by clock | phase `working` entered when the message is delivered, left on `agent_settled` | L522 |
| 10 | `engine/engine-launch.ts:434-442`, `engine/engine-state.ts:477-495`, `engine/engine-helpers.ts:290` | after start, a 120 s timer; if the agent is still idle with no turn in its log, the brief is sent once more (`briefResent`) | "send again if nothing happened" around a send that should not be lost; one timer and one `later` entry per starting task; `briefResent` is a one-shot flag | `agent_start` event from pi marks the brief taken; if the send fails the delivery layer reports it (`briefLost` already exists at `engine-handoff.ts:196`) | L522 |
| 11 | `engine/engine.ts:45`, `:67`, `:76` (`RECHECK_FIRST` 15 s, `SWEEP_FIRST` 20 s, `WATCH_FIRST` 30 s) | first run of queue recheck, tidy and PR watch after a fixed delay; the comment at line 59 says "once herdr has told which agents are at work" | the condition is an event (herdr `onOpen` snapshot read), the code is a guess of 15 to 30 s. Slow herdr: runs before agents are known (a go sent twice, the case `engine-helpers.ts:189` warns about); fast herdr: waits for nothing | start these when the agents' first snapshot is in (`agents.ready` promise) | L523 |
| 12 | `engine/engine.ts:81-84`, `engine/stalls.ts:12-37` | every 60 s: 3 loops over all 561 tasks (`checkReady`, `checkSilentNeed`, stall), each calling `statusOf`/`rawStatus` and `lifeOf` (`statSync` of 2 log files per working task) | 3 x 561 status evaluations + 90 `statSync` per minute (measured cost small, 45 agents) but every answer is "nothing" 99 % of the time; the three one-shot flags (`stalled`, `silentAt`, `readyNudged`) exist only to dedupe a poll | a deadline per task set on the transition that starts the wait (`working` +20 min, `ready` +20 min, `silent` +5 min), one timer for the earliest deadline, cleared by the next transition | L523 |
| 13 | `engine/engine.ts:68`, `:77` | tidy every 3,600 s (autoArchive, retireOld, sweep) and PR/main watch every 120 s | hourly sweep exists to repair what an event missed (`cleaned` unset after a restart, `endLostMerges`) | with persisted phase, `cleaning` is a phase resumed at start; archive is a deadline (`doneAt + archiveAfter`) | L523 |
| 14 | `engine/merge.ts:45` | `for (…; status === 'working' && now < end; ) await Bun.sleep(500)` up to `TURN_END_WAIT_MS` (120 s) | 240 polls of an in-memory value in the worst case; the value changes by a herdr event the engine already receives (`agentStatus`, `engine-tidy.ts:247`) | `await this.agents.settled(key, {timeout})` backed by that event | L525 |
| 15 | `engine/merge.ts:285` (`holdWhileRed`) | `while (!closing && await red()) await Bun.sleep(10 s)` with **no upper bound** | each held merge makes one `gh run list` every 10 s for as long as main is red: 10 held merges = 1 spawn/s for hours; `holdForRedMain` below has a 9 min cap, this one has none; two ways to hold for a red main (`merge.ts:278-290` and `engine-merge.ts:127-145`) | one red-main watch per repo (L524) that resolves a promise when main is green; merges `await` it; one way | L525 |
| 16 | `engine/engine-merge.ts:141-143` (`holdForRedMain`) | `for (…; red && now - t0 < 9 min) { sleep(10 s); watchMain(p) }` | up to 54 `watchMain` per held merge, each a `hub()` (`gh auth status` + `git remote` + `recheckGithub`) plus `branchRuns` = 3 to 4 spawns: 54 x 3.5 = ~190 spawns per held merge | same repo watch as 15 | L524 |
| 17 | `engine/merge.ts:388-393` | after merge into a queue: poll `viewPr` every 10 s up to `QUEUE_WAIT_MS` (15 min) | 90 `gh pr view` per queued merge; GitHub reports `autoMergeRequest`/`mergeQueueEntry` | repo watch resolves the PR's merged state | L525 |
| 18 | `engine/engine-handoff.ts:386-398` (`checksOf`) | `for (;;) { prChecks; sleep(10 s) }` up to 9 min (`CHECKS_WAIT`) | 54 `gh pr checks` per `lineclear checks`; 45 agents waiting = 4.5 spawns/s, and the same PR is also read by `watchPrs` (finding 19) | `await` the repo watch for the PR's head sha | L524 |
| 19 | `engine/engine-merge.ts:28-50`, `:56-90` (`watchPrs`/`watchPr`) | every 120 s, for each reported task with a PR: `hub()` once per repo, then `viewPr` + `prChecks` + `prComments` (+ `failedLog`) | 3 to 4 `gh` per task per tick; 45 tasks = ~150 spawns per 120 s = 1.2/s, ~35 % of one core at 0.25 s per spawn. Output is parsed from `gh` text/JSON per call | one GraphQL query per repo for all open PRs (checks, reviews, comments, head sha) with ETag; 1 call per repo per tick, 0 when 304 | L524 |
| 20 | `engine/engine-merge.ts:94-100` (`watchMains`) | each tick, for each space: `watchMain` → `hub()` → `branchRuns`; `MAIN_WATCH` is 3 h of attention after a merge | 3 to 4 spawns per space per 120 s while any task merged in 3 h: with 10 spaces ~20/min | same repo watch (main's runs are one more query in it) | L524 |
| 21 | `engine/lane-watch.ts:44-60`, `engine/machine.ts:32-50`, `engine-tidy.ts:14` | every 60 s `HeadWatch.look` reads every `/proc/*/stat` (475 processes, measured 2.1 ms) per merge head to see whether anything moved; head is released after 15 min of no CPU change or `turnLimit` (30 min) | detects a hung step by looking at the process table because the steps are not cancellable. Cost is small (2.1 ms x heads per minute) but it is a guess at progress (a legit 15 min quiet `bun install` is released) and it ends in `killWork`, kill by directory | run each lane step with an `AbortSignal` and its own timeout (`git.ts:30` already has `timeoutMs`); the step kills its own process group when aborted; no `/proc` scan | L525 |
| 22 | `engine/merge.ts:90`, `:141`, `engine/engine-state.ts:96` | `mergeDeadline` timer per merge call (marks `callerLeft`), `Promise.race([allSettled, sleep(deadline)])` at stop | a timer per merge to remember "the caller may be gone"; the CLI call is an HTTP request whose disconnect is known (`req.signal`) | the merge route passes the request's `AbortSignal`; `callerLeft` becomes `signal.aborted` | L525 |
| 23 | `revive.ts:62-121`, `source-upkeep.ts:42-60`, `source.ts:99` | every 15 s, for every agent record (45): `agents.wrong(key)` = one `herdr.processInfo(pane)` RPC (`agents-sending.ts:17`) to see whether the CLI exited or runs on other files; `Revivals` keeps 6 maps (`wrong, tries, given, last, well, working`) fed by that poll, with `grace` 20 s, gaps 0/60 s/5 min, `steady` 10 min, `loop` 60 min | 45 agents / 15 s = 3 RPC/s, 180/min, each returning the process tree (argv of every foreground process) which is then hashed (`revive.ts:15`, `sha256` of the prompt file per agent per poll). The facts it looks for arrive as events: `pane.exited` and `pane.agent_status_changed` are already subscribed; "stale flags" can only change when the agent starts (compare once there) or herdr restarts (compare on `onOpen`) | revive on `pane.exited`/status `gone`/`onOpen`; stale-flag compare once per start and once per reconnect; `Revivals` keeps its counters (it is the one explicit machine here) but is fed by events and its grace is a deadline, not a poll count | L526 |
| 24 | `recovery.ts:17-44` (`WorkerHealth`) | `observe()` called by a poll; `restartDue` polled; 180 s, cooldown doubling to 15 min, reset after 60 s healthy | bounded backoff on a link that can be down: acceptable. Only the poll is a smell; the link already knows when it is closed | no change now; revisit with the machines audit | – |

#### C. Whole-file store and writes

| # | file:line | what it does | why it is a patch / does not scale | replacement | step |
|---|---|---|---|---|---|
| 25 | `engine/engine-state.ts:145-152` | `save()`: `briefs.write` (walks all tasks), `cold.save` (walks all tasks), `writeJson('tasks.json', …, null, 2)` of all hot tasks, then `emit('changed')`. 46 call sites in the engine | measured on this machine: 561 tasks, **678,648 bytes** per save, 0.6 ms to stringify, 0.8 ms to write and rename. Time is not the problem, write volume is: 135 settles/min (finding 4) plus reports (`report()` saves on every `lineclear status`) and `save()` after each `launch` = ~200 saves/min x 680 KB = **136 MB/min, ~190 GB/day** rewritten for a file that changes a few bytes at a time. `indent 2` adds ~30 % bytes | one append-only log of task changes (the `ColdLog` shape, already in the repo), compacted by size; or SQLite (`task-ids.sqlite` is already used by `task-ids.ts`); saves coalesced to one per tick | L520 |
| 26 | `server/server/store.ts:19-27` (`readJson`), used by `engine/engine-state.ts:55-64` | a parse error returns the fallback `{ next: {}, tasks: [] }` | **a swallowed catch that loses data**: one truncated `tasks.json` starts the server with no tasks and `next: {}`; the next `save()` overwrites the real file with the empty one, and task ids are issued again from 1 (`next` reset) | corrupt file: move to `tasks.json.bad-<ts>`, refuse to start with a line that names it (L172 expects `doctor` to report an unreadable store) | L520 |
| 27 | `server/server/store.ts:31-37` | write to `.tmp`, `renameSync`; no `fsync` of the file or the folder | after a power cut a renamed but unflushed file can be empty (L172 is the test of this) | `fsync` file, rename, `fsync` dir, in the one writer | L520 |
| 28 | `engine/cold.ts:18-27` | reading `tasks-cold.jsonl`: a line that fails `JSON.parse` is skipped silently | a half-written last line (crash during `appendFileSync`) silently drops a task; also `compact` rewrites the whole log when lines > 2 x tasks + 1000 | log a skipped line to `decisions.jsonl` and `doctor`; keep it in `.bad` | L520 |
| 29 | `engine/briefs.ts:28-36` | a missing brief file is replaced by `''` (catch with no log) | the task keeps running with an empty brief; nobody is told | task goes to phase `lost` with a line naming the file | L520 |
| 30 | `engine/briefs.ts:42-52`, `engine/retire.ts:21-38` | `write()` per task per save does a `Map.get` + `Buffer.byteLength` for each of 561 tasks even when nothing changed | O(tasks) work per save (small, ~0.1 ms) | dirty flag per task set by the transition | L520 |

#### D. Swallowed errors in the engine

28 empty or silent `catch` blocks and 52 `.catch(() => undefined)` in the files of this area (counted by `grep`; per file:
`worktrees.ts` 14, `engine-merge.ts` 9, `merge.ts` 6, `engine-tidy.ts` 5, `engine-handoff.ts` 3, `engine-launch.ts` 3,
`engine.ts` 3, `stalls.ts` 1, `engine-state.ts` 1, `github.ts` 1, `lane-watch.ts` 1). The ones that decide something:

| # | file:line | what it does | why it is a patch | replacement | step |
|---|---|---|---|---|---|
| 31 | `engine/engine-launch.ts:148`, `:168`, `:242`, `engine/engine-handoff.ts:218`, `engine/stalls.ts:72`, `engine/engine-state.ts:485`, `engine/merge.ts:28`, `:435` | `agents.send(…).catch(() => undefined)`: a go, a queue line, a nudge, a review note | the send is the only way the agent learns a task is released, queued or ready; a failure leaves `going` set (re-sent after a restart by `resumeQueue`), or nothing at all for a nudge (`readyNudged` is already set, so it is never retried) | send returns a delivery result; failure sets `trouble` on the task and posts a card; no flag is set before delivery | L522, L523, L525 |
| 32 | `engine/engine-merge.ts:46`, `:48`, `:98`, `:112`, `:135`, `:142`, `:153` | `hub(p).catch(() => null)`, `watchPr(...).catch(() => undefined)`, `watchMain(p).catch(() => undefined)` | `hub()` throws "gh can't reach GitHub now" (`engine-handoff.ts:271`) so that a merge never falls back to a local merge; here the throw is turned into "no GitHub" (`null`) and the PR watch silently stops for that repo | one repo watch with a state (`ok`, `down since`, `unauthenticated`) the owner sees | L524 |
| 33 | `engine/engine-merge.ts:228`, `engine/engine-tidy.ts:47-48`, `:188`, `:255`, `:259` | `cleanup(...).catch`, `stopTask(...).catch`, `tell(...).catch`, `agents.finish(...).catch` | clean-up failure is dropped; `cleaned` stays false and the hourly sweep (finding 13) retries it forever, at 3,600 s | phase `cleaning` with a recorded error and a bounded number of tries, then a card | L521, L522 |
| 34 | `engine/worktrees.ts:69-318` | 14 `.catch(() => undefined/null/[])` on herdr RPCs (`workspaces`, `closePane`, `closeWorkspace`, `worktreeRemove`, `paneIdle`) | "herdr did not answer" and "there is no such workspace" look the same, so `putAway` keeps a worktree (`busy: true`) when herdr merely timed out and the next sweep tries again | herdr errors typed (`HerdrError` has `timeout`/…): not-found is success, timeout is retried by the caller with the result `busy` | L527 |
| 35 | `engine/engine-handoff.ts:329-335` (`onGitHub`) | any throw becomes `{ ok: false, text }` | turns programming errors into a user line | catch `HerdrError`/`GhDown` only | L524 |
| 36 | `engine/github.ts:42-56`, `:122-145`, `:171`, `:224`, `:263` | `try { JSON.parse(r.out) } catch { return null/[] }` | a malformed answer from `gh` is "no PR" / "no runs" / "no checks": `findPr` returning null opens a **second PR** for the branch | `gh … --json` through one typed reader that throws `GhDown` on a parse error | L524 |

#### E. Regex on another tool's output, and text rules

| # | file:line | what it does | why it is a patch | replacement | step |
|---|---|---|---|---|---|
| 37 | `engine/status-line.ts:30-33`, `engine/status.ts:47-48` | `ASKS` regex over the last sentences of the agent's last reply decides `need` (a question) vs `silent` | status from prose. L430 already removes the Inbox effect; the regex stays as the only judge of "asks something" | L430 (open card or `lineclear wait owner` only); delete `askOf` | L430 |
| 38 | `engine/merge.ts:237`, `:397-400`, `:388` | `/conflict/i` on `git merge` output; `/conflict|not mergeable/i` and `/merge queue\|automatically merged\|auto-merge/i` on `gh pr merge` text | decides whether to start a rebase from English text of two tools; a localized `git` (LANG) or a changed `gh` message skips the rebase and sends the owner a failure | git: exit code of `git merge-tree --write-tree` (1 = conflicts) or `git rebase` status; GitHub: `mergeStateStatus` and `autoMergeRequest` from `gh pr view --json` | L525, L524 |
| 39 | `engine/merge.ts:278` | `/^fix\b/i.test(t.title)` makes a task bypass the red-main hold | **a title decides a safety gate**: a task named "Fix typo" merges into a red main | only `t.by === 'main-green'` (already there) or a stored `fixes` field set by the Fix-task maker | L525 |
| 40 | `engine/github.ts:14`, `:21`, `:101`, `:137`, `:336` | `/not logged in/`, `/invalid\|fail\|error\|timeout/`, `/not accessible by personal access token/`, `/no checks reported/`, `/unknown flag/` on `gh` text | five message matches; the last one chooses between two `gh` API shapes by an error string | `gh auth status --json`-style exit codes and `gh api` only; feature-detect once by version | L524 |
| 41 | `engine/engine-launch.ts:410-412` | `/^Install failed/.test(msg)` on an `Error` thrown by `worktrees.ts` | a regex on our own message to tell two failures apart | throw a typed `InstallFailed` | L527 |
| 42 | `engine/engine-helpers.ts:129-137` | `loginGone`: regex for Claude Code's API error text | a CLI that scope.md drops (L472: pi only) | delete with L472; pi's own `agent_end` carries the error | L522 |
| 43 | `engine/git.ts:82-83`, `:195-201`, `:311` | remote URL regex, a glob built into a `RegExp`, `/^(.*):\d+: leftover conflict marker/` over the output of `git diff --check` | parsing porcelain text; the glob is a second matcher beside git's own | `git ls-remote --get-url` + URL parser; `git check-ignore`/`git ls-files -o`; `git diff --check -z` or `grep -n` on the file list with an exit code | L528 |
| 44 | `quiet.ts:10` | regex over the text of a message to learn whether it is "news" or "health" | the caller already knows the kind (`hidden(text, 'news')`); the machine re-reads it from the string it just built | `Agents.send(key, text, { kind })`, no parsing | L522 |

#### F. Blocking and second ways

| # | file:line | what it does | why it is a patch | replacement | step |
|---|---|---|---|---|---|
| 45 | `engine/machine.ts:32-50` | sync `readdirSync` + `readFileSync` on every `/proc/<pid>/stat` | 2.1 ms (measured, 475 processes) blocking the event loop per head per minute; at 10 heads 21 ms/min: not a bottleneck. Goes with finding 21 | removed with 21 | L525 |
| 46 | `engine/engine-state.ts:145` + `engine/cold.ts:60`, `:94`, `:102` | `appendFileSync`, `writeFileSync`, `renameSync`, `existsSync` on the event loop | 0.8 ms per save now; grows with the file; a slow disk blocks every agent's status update | async writer, one queue | L520 |
| 47 | `engine/worktrees.ts:130`, `:148`, `:214`, `:232`, `:273`, `:281` (`spaceOf`) | each calls `h.workspaces()` (all spaces) to find one by path or label | 3 to 5 whole-list RPCs per `putAway`, with 45+ spaces each returns 45+ records; `cleanup` runs per finished task | keep the herdr `workspace_id` on the task (set at create) and use `workspace.get`; or keep a map fed by the event stream | L527 |
| 48 | `engine/engine-state.ts:158-186`, `engine/engine.ts:11` (class chain) | `Engine → EngineTidy → EngineMerge → EngineLand → EngineHandoff → EngineLaunch → EngineStalls → EngineStatus → EngineState`: nine classes in one inheritance line | this is "a file split only to stay under 600 lines": `engine-handoff.ts` (520), `engine-state.ts` (512), `engine-launch.ts` (468) sit near the cap and each `protected` member is visible to every layer. A change to one phase touches six files | modules with one job each, composed (`phase.ts`, `landing.ts`, `queue.ts`, `stall-deadlines.ts`) | L529 |
| 49 | `restart.ts:19-33` | `fitHarness` and `launchHarness` both normalize model and effort | two ways to do one job (minor) | one function | L521 |
| 50 | `engine/engine-launch.ts:129-143`, `engine/engine-state.ts:229-250` | `recheck()` and `settleOne()` call each other through `settle()`; guarded by `this.checking`, `this.releasing` booleans | re-entrancy guards instead of an ordered transition | transition function takes the event and returns effects, applied after | L521 |

#### Not a finding (looked at, fine)

- `engine/cold.ts` `ColdLog` (append, compact at 2x): the right shape; findings 28 and 46 are about its edges.
- `engine/retire.ts`: a month file append + rename of chat logs; runs hourly, not per save.
- `engine/lane.ts`, `engine/result.ts`, `engine/status-line.ts` (except the `ASKS` regex), `restart.ts` other than finding 49.
- `recovery.ts` `LinkBackoff`: bounded backoff on a real socket.

## Steps

The open steps of this file are in [ROADMAP.md](../ROADMAP.md).

## Outside this area

Seen on the way, left to the other audits: `source.ts:94` polls chats every 1 s and `source.ts:96` calls `fresh()` for every agent every 5 s
(45 agents = 9 calls/s); `source.ts:12` drains requested news every 1 s; `source.ts:27` adopts every 3 s;
`agents-delivery.ts` (12 retries, 9 timers).
