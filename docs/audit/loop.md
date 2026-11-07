# Audit: the CLI and the rule loop

Read-only audit of `src/tick-project.ts`, `rules.ts`, `plan.ts`, `autoplan.ts`, `chat.ts`, `asks.ts`, `home-data.ts`,
`night-watch.ts`, `company.ts`, `real-world.ts`, `doneproof*.ts`, `decision-dedupe.ts`, `notify.ts` (3,470 lines),
and what they call on every tick (`world.ts`, `task-read.ts`, `inbox.ts`, `waits.ts`, `measure.ts`, `kept-read.ts`).
Line numbers are of this branch, cut from main. No code changed.

**How numbers are marked.** "Measured" was run on this machine (one board, 236 commits on main, 123 KB of task list).
"Counted" comes from reading the code. "Grows" is a number that rises with commits, tasks or inbox items and has no cap
in the code. Nothing here is a claim about the other two machines.

## The question: what runs per tick, and how long it blocks

`lineclear serve` calls `runMain` (`rules.ts:212`). Every `TICK_MS` = 30 s (`rules.ts:25`, interval at `:246`) it
spawns a new process, `lineclear run --once` (`tickAway`, `rules.ts:192`), which runs `tick` (`rules.ts:128`) and exits.
That is 2,880 process starts a day. A bare `bin/lineclear run --once --dry-run` takes 0.18 s here (measured), before
any project work. All memos of the loop die with that process.

Inside one tick, in order, with who blocks (all synchronous: `Bun.spawnSync`, `readFileSync`):

| # | Work | Where | Blocks (counted) |
|---|------|-------|------------------|
| 1 | `copyStoreQuietly`, `settlePlans`, `closeSettledUpdates`, `sweepOldTemp` (before any project, no lock) | `rules.ts:133-141` | `settlePlans` can run a readiness model (`askModel`, 300 s timeout, `autoplan.ts:141`) and a `lineclear merge` with no timeout (`autoplan.ts:179`): up to 5 min plus the merge line, with every project waiting |
| 2 | per project: `tick.lock` pid file, `readState` | `rules.ts:147-155` | ms |
| 3 | `routeAsks`: parse every chat file of the space, including `archive/chatlog` | `asks.ts:412` | one `JSON.parse` per chat file, all of them, every tick |
| 4 | `closeOver`: `readItems` (every Inbox file) and `readWaits` (every wait file) | `rules.ts:101-121` | one read per file |
| 5 | `serviceWaits`, then `tickProject` (re-reads waits, `loadLimit`) | `rules.ts:165-166` | ms |
| 6 | `readProject`: `git fetch` (gated 2 min), `git show ROADMAP.md`, `git log` of all of main, `git rev-parse HEAD`, `mainRefs` (2 to 5 gits), `lineclear task list --json` | `tick-project.ts:38-62`, `real-world.ts:62-99` | about 8 to 11 processes; the task list is 123 KB and 0.10 s (measured) |
| 7 | `checkHealth`: runs the project's health command (`sh -c`) after each main move | `tick-project.ts:98-117` | up to 600 s (`HEALTH_TIMEOUT_MS`, `real-world.ts:16`) |
| 8 | `askMachines`: `lineclear room <host>` and `task list` per other machine | `tick-project.ts:444`, `spread.ts:137` | 2 ssh round trips per machine per project |
| 9 | stall ladder, service accounts, `pi --list-models` when needed | `tick-project.ts:453-454`, `real-world.ts:208` | 1.36 s of CPU (measured) per call, and the 10 min TTL never holds (finding F1) |
| 10 | `capacityOf`: `lineclear show --space` (text) | `real-world.ts:159` | 1 process |
| 11 | per ready step: `whyStale` re-reads fetch, main, task list, rooms; then `lineclear task add` | `tick-project.ts:289-318, 347-355` | 5 to 8 processes per start, and `change()` clears the 3 s read memo so the next start re-reads the task list |
| 12 | `writeAtomic(state.json)`, `appendFileSync(decisions.jsonl)` | `rules.ts:173-176` | one 7.4 KB pretty-printed write per project (measured) |
| 13 | `nightWatch` | `rules.ts:223` | one JSON read |

Projects run one after the other (`rules.ts:143`). A project whose health command or readiness model takes minutes
holds every project behind it. With 45 agents on 3 machines the tick does more of items 3, 4, 6, 8 and 11 and none of
them is bounded by an event: all of them are re-read whether anything changed or not.

**Verdict.** The loop is level-triggered: it re-reads the world every 30 s and notes what it sees. pi and herdr both
give events, so most reads can wait for one:

- pi, in RPC mode (`pi --mode rpc`), streams JSONL events (`agent_end`, `agent_settled`, message and tool events) and
  answers `get_available_models` and `get_state` ([rpc.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md),
  [rpc-commands.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc-commands.md)). A
  long-lived client replaces `pi --list-models` text parsing and a log scan for "the turn ended".
- herdr has `herdr agent wait` (waits until an agent reaches a state), `herdr pane wait-output` and an API socket
  (`herdr api snapshot`, `herdr api schema`), checked with `herdr agent --help` and `herdr pane --help` on this machine.
  Agent state comes from herdr's own detection, not from `agent read` text. The herdr call sites are the audit of
  `agents-delivery.ts` and `starts.ts`, not of this area.
- The board server already holds a WebSocket (`watchSocket`, used by `chat.ts:349`) and a folder stamp
  (`watchInboxFolder`, `web.ts:149`). Inbox, task and chat changes can ride those.

## Findings

Severity: **critical** blocks or corrupts the loop at 45 agents, **major** wastes a number that grows or hides a cause,
**minor** is small or local, **trivial** needs no step. "Step" is the step of the next section that removes it.

### The tick process and its blocking

**F1 major. A new process per tick throws every memo away.** `rules.ts:192-205` (`tickAway`), `:246`.
It does: spawns `bun bin/lineclear run --once` every 30 s. Why it is a patch: the reason is "its commands never hold up
the web server" (comment at `:191`); the cause is that the commands are `spawnSync`. The cost: 2,880 starts a day at
0.18 s each is 8.6 min of CPU a day with no project work; `OFFERED_TTL_MS` (`real-world.ts:17`, 10 min),
`FETCH_EVERY_MS` (`:18`, kept on disk, fine), `KEEP_MS` 3 s (`task-read.ts:11`) and `mainRefs` memo (`real-world.ts:228`)
live in a process that exists for one tick, so `pi --list-models` (1.36 s, measured) runs every tick that needs it,
not every 10 min. Replacement: run the loop in one long-lived process (`lineclear run`), and keep the tick off the web
server by running it as its own service, not as a child per tick. Step L560.

**F2 critical. A synchronous call with a 10 minute timeout is the default for every command.** `real-world.ts:35-41`
(`run`), `HEALTH_TIMEOUT_MS` at `:16`. It does: every git, `lineclear` and `pi` call is `Bun.spawnSync(..., timeout: 600 s)`.
Why it does not scale: a read of main should take ms; if one hangs (ssh, a credential helper after `git fetch`, a
locked repo) the whole loop stops for 10 minutes and every other project with it (projects are sequential,
`rules.ts:143`). Same at `task-read.ts:23` (10 s, correct) vs `real-world.ts:37` (600 s, wrong for reads).
Replacement: reads get a 10 s timeout and a typed "timed out" result; only the one long job (merge) is detached and
event-reported. Step L562.

**F3 critical. The loop runs the project's tests on the owner's machine.** `tick-project.ts:98-117` (`checkHealth`),
`:125-131` (`proveClosed`), `real-world.ts:103-106` (`health`: `sh -c <command>`). It does: after each main move runs
`settings.health` (up to 600 s, `:16`), and for each step closed with nothing to merge runs `bun test <file>` taken from
the step's text by a regex (`doneproof.ts:133-139`, `testOf`). Why it is a patch: AGENTS.md says checks run on GitHub,
never on an owner's machine, and the board already marks main red (`red` in `tasks.json`, read at
`home-data.ts:234, 373`); `tick-project.ts` keeps a second red detector with its own counters (`healthFailures`,
`firstFailed`, `healthHead`, `stopped` in `state.json`). Two ways to know "main is red". Cost: a 3 min test run blocks
the tick 3 min every time main moves (about 430 merges an hour is the order of magnitude in L469; even 10 an hour is
30 min of blocking). Replacement: read the board's red mark for the head (one field), stop new starts while it is set,
delete `world.health`, `healthFailures`, `firstFailed`, `healthHead`, `proveClosed`. Steps L561 (tick side) and L562
(world side).

**F4 major. `settlePlans` runs a model and a merge inside the tick, before the project lock.** `rules.ts:136`,
`autoplan.ts:246-257` (`settlePlans`), `:141` (`askModel`), `:179` (merge `spawnSync`, no timeout). The code
says why: "the readiness model can take minutes: one plan a tick, so the rule loop is not held"
(`autoplan.ts:247`). A comment that explains how a block is limited is the patch. Why it is a second way to a job:
`plan.ts:143,201` (`autoApply`) already runs the same readiness check and the same merge when a plan is submitted;
`settlePlans` repeats it for plans waiting from before the project allowed auto plans. Cost: up to 300 s + merge wait per
tick for each project holding a plan, with 0 projects ticking meanwhile. Replacement: run the same function once when
the setting flips or the item is created (the Inbox folder stamp is the event), and delete the sweep. Step L564.

### The way state is read

**F5 major. `whyStale` re-reads the world before every start, and checks one fact twice.** `tick-project.ts:289-318`.
It does: `world.fetch`, `world.main` (the whole `git log`, `real-world.ts:62-73`), `world.tasks` (123 KB, `task list`
re-spawned because `change()` cleared the memo after the previous `task add`, `real-world.ts:50-54`), and `world.room`
per other machine (2 ssh calls each). The `pendingStarts` test is written twice (`:297-298` and `:313-314`). Why it is a
patch: the step must not start twice (L493, "A step is claimed once", is the cause: the board should refuse a second
task for a step). Cost at 45 agents with free slots: a burst of N starts costs N x (about 4 processes + 2 ssh per
machine). Replacement: the board claims a step atomically when `task add` is given the step id (L493), then
`whyStale` is deleted. Step L561 (after L493).

**F6 major. `git log` of all of main, every tick, per project.** `real-world.ts:62-73`. It does: `git log origin/main
-z --format=%H%x01%s%x01%b` for the whole history, then splits the output. Measured here: 236 commits, 65,660 bytes,
6 ms. Grows: about 280 bytes a commit; 5,000 commits is 1.4 MB per project per tick, and `whyStale` repeats it per start.
`kept-read.ts:refsKey` (a stat of four ref files and the roadmap) already exists for Home and is not used by the loop.
Replacement: skip the read while `refsKey` is unchanged, and read `last-head..head` when it moved. The roadmap text
(`real-world.ts:84`, `git show`) keeps by the blob id. Step L562.

**F7 major. A regex on another tool's text output decides slots and reviewer.** `real-world.ts:159-167`
(`maxTasks`, `reviewerSetting`: `/^machine\.maxTasks\s+(\d+)/m` on `lineclear show` output), `:152-153` and `real-world.ts:25`
(`taskStatus`: `JSON.parse` in a `catch` that returns undefined), `:208-224` (`offeredModels`: split `pi --list-models`
on whitespace, `slice(1)` to skip a header). Why it is a patch: a column change in either tool silently empties
the set, `undefined` means "all models offered" at `tick-project.ts:211` (`set === undefined || ...`), so a format change
turns a model filter off without a message. Replacement: `lineclear show --json` (or the snapshot the server already
serves), and pi's RPC `get_available_models` (rpc-commands.md) from one long-lived client. Step L562.

**F8 minor. One extra process before each `tell` and `stop`.** `real-world.ts:152-153` (`doneTask`): `lineclear task show
<id> --json` is spawned only to refuse a send to a Done task. Cost: 2 processes per nudge. Replacement: the board's
`task tell` refuses a Done task and says so; delete `doneTask`. Step L562 (the server side is named, not done).

**F9 minor. A detached `lineclear merge` process whose outcome is read from a text field.** `real-world.ts:173-183`.
`Bun.spawn(..., timeout 10 min).unref()` hides every error (`stdout/stderr: "ignore"`), and the result is "its merge
stopped text". The board has the merge line; ask it by its API and read the task's `merge` field. Step L562.

**F10 major. Several readers parse every Inbox file; the Inbox only grows.** `inbox.ts:102-114` (`readItems`: `readdirSync`
+ `JSON.parse` of every `inbox/*.json`, "answered items stay", numbers never repeat), called by `rules.ts:101`
(`closeOver`), `autoplan.ts:248` (`settlePlans`), `plan.ts:121,123`, and **every 2 s** by `notify.ts:64`
(`watchInbox`, `:93`). Grows: with I items of about 1 KB the push watcher alone parses I KB x 0.5/s: 1,000 items is
0.5 MB/s, 43 GB a day of parsing. The server already watches the folder with one `stat` a second
(`web.ts:149-170`, `watchInboxFolder`), so `notify.ts` polls a folder a second time. Also `inbox.ts:109` swallows a
parse error ("a half-written file is read again next time") although files are written by `writeAtomic`, so the
catch can only hide a real corruption. Replacement: `notifyNew` runs from `watchInboxFolder`'s change callback, closed
items move to `inbox/closed/` so `readItems` reads only open ones, a corrupt file is reported once. Step L565.

**F11 major. `routeAsks` parses all chat history of the space, including the archive, every tick.** `asks.ts:412`
(`chatFiles`, `measure.ts:65-75`, uses `readJson` with no cache) and `:95-106` (`coordinatorLogs`, `:275`). Home reads
the same files with `readJsonKept` (`home-data.ts:249`, `kept-read.ts:34`: a `stat` per file). Two readers, one job
(L473 and L484 cover other pairs). Grows: one file per task chat, retired ones in `archive/chatlog`; each
holds every posted card and message. 45 live chats parsed 2,880 times a day per project is 130,000 parses a day before
any archive. Replacement: read through `readJsonKept`, and never read `archive/chatlog` (an archived task asks nothing).
Step L565.

**F12 major. `asks-routed.json`: a set of every answered card id, rewritten whole every tick.** `asks.ts:205-211`
(`readRouted`), `:431-434` (`writeAtomic(... JSON.stringify([...done], null, 2))`, unconditional when `done.size > 0`).
Measured: 3,554 bytes now. Grows: only `nudge:` keys are pruned (`:430`); card ids, `told:` ids and closed-report ids
are kept for good. At 10,000 ids of 30 bytes that is 300 KB rewritten per project per tick, 860 MB a day, to record
what each card could say itself (`answers[q.id]` already exists in the chat file, `asks.ts:121`). Replacement: the
answer is stored with the card (one append to the chat file the board owns); no routed set. Step L565.

**F13 critical. A corrupt state file is read as "nothing happened".** `rules.ts:82-88` (`readState`: `catch { return
emptyState() }`), `asks.ts:205-211` (`readRouted`: `catch { return [] }`), `asks.ts:101-106` and `:162-166`,
`doneproof.ts:31-37`, `night-watch.ts:36-43`, `spread.ts:166,180` (outside the area). Why it is the worst patch of the
set: `state.json` holds `closedSteps` ("kept for good, so archiving the task does not start the step again",
`rules.ts:71`), `starts`, `stalls`, `healthFailures`. One truncated or edited file resets all of them, and the loop
starts every closed step again; a lost `asks-routed.json` answers every old card again and sends every agent the same
nudge a second time. `writeAtomic` makes a half-written file unlikely, so the catch fires only on a real fault, the case
that must be loud. Replacement: a missing file is empty; an unreadable one stops the tick of that project with one
Inbox item that names the file. Step L560.

**F14 minor. State and ticks are pretty-printed whole files.** `rules.ts:173` writes `state.json` (7,427 bytes,
measured, two-space indent) per project per tick: 21 MB a day per project. It has one writer under `tick.lock`
(`rules.ts:147`), so it is not the multi-writer store of the brief, but `remoteSeen` holds each other machine's
whole task list inside it (`rules.ts:67`): that grows with machines x tasks. Replacement: write only when the JSON
differs (compare to the text read), no indent, and keep `remoteSeen` in `memory` only for the silence time stamp.
Step L560.

### Timers, retries and swallowed errors

**F15 major. The loop survives every error.** `rules.ts:253-260`: `uncaughtException` and `unhandledRejection` are
handled with "still running", `SIGHUP` is ignored, `beforeExit` prints "this is a bug". `rules.ts:231-241` also catches
every tick error. Why it is a patch: a process in an unknown state keeps ticking and acting on agents. With the tick
in a process that lives one tick (today) a crash costs nothing; once F1 is fixed it must crash and restart.
Replacement: no survive handlers; one `catch` per tick that records a `stall` of class `command-failed` and exits
non-zero for the supervisor. Step L560.

**F16 minor. A pid file lock with three swallowed catches.** `starts.ts:110-133` (`holdProjectTick`), used at
`rules.ts:147`. Two attempts, `process.kill(pid, 0)` as a liveness probe (a reused pid keeps the lock forever), an empty
`unlinkSync` catch. It exists because two ticks can overlap (`run --once` by hand and the loop). With one loop process
(F1) the `ticking` variable at `rules.ts:226-241` is the lock and a manual `--once` talks to it. Step L560
(`starts.ts` is under L451/L461; the deletion of the call is in `rules.ts`, the function goes in L561's follow-up).

**F17 minor. `fetch` is a timer in disguise.** `real-world.ts:87-99`: `statSync(FETCH_HEAD).mtimeMs` against
`FETCH_EVERY_MS` (2 min), empty `catch {}` at `:94`, and `whyStale` calls it again per start (`tick-project.ts:292`).
Main moves when the board merges (an event it knows) or the owner pushes. Replacement: the board's merge event triggers
one `fetch`; a slow safety fetch stays (10 min, one constant, not per start). Step L562.

**F18 major. Decision lines are made from text and deduplicated by regex.** `decision-dedupe.ts:3-9`
(`skipHead` splits on `"; "`, `sameSaid` replaces every number by `#`), `tick-project.ts:409`
(`why?.startsWith("lock '")` decides what the loop does next from the text it wrote itself), `rules.ts:168`
(`freshDecisions` with `state.last`). Why it is a patch: every tick regenerates "skip: no slot" and the writer removes
repeats afterwards; L469 shrinks the log with the same trick. Cause: a skip is a level, not an event. Replacement:
`Decision` gets a `code` (`no-slot`, `lock-held`, `no-worker`, ...) and `params`; the loop writes a line when the code
changes for a step and one when it ends; control flow reads `code`. The text is made when a view draws it. Step L563.

**F19 minor. Retry and timer sites in the area (counted).** `rules.ts:246` (loop interval, 1), `notify.ts:93` (2 s poll,
F10), `chat.ts:326` (fixed 3 s reconnect), `chat.ts:~492` (5 s SSE beat per client), `night-watch.ts:13,15`
(2 h and 15 min constants), `real-world.ts:17-18` (two TTLs), `starts.ts:111` (attempt loop). Each is named in its own
finding; none is acceptable as a loop.

**F20 major. The chat link reconnects on a fixed timer and re-reads the whole board each time.** `chat.ts:320-327`
(`down` schedules `setTimeout(connect, retryMs)` while anyone listens, `retryMs` = 3000, `:254`), `:332-338`
(`connect` calls `readSnapshot`, the whole board snapshot, to find a chat key), `:359-361` (`ensure` retries on any
`view()` after 1 s). While the board is down and one page is open: 20 snapshot reads a minute, at about 120 KB each
(the task list alone is 123 KB, measured) is 2.4 MB a minute, until the board returns. Replacement: back off
(1, 2, 4 ... 30 s with jitter), and cache the chat key by space so a reconnect reads nothing. Step L568.

**F21 minor. Swallowed catches of `chat.ts`.** `:52` (decode check: legitimate), `:88` and `:100`
(`realpath` and root checks: legitimate, return 404), `:273` and `:283` (turn any fetch error into "the board server is
not running", which hides a 500 and a timeout alike), `:487-505` (closed stream: legitimate). Replacement for `:273,:283`:
keep the cause (`AbortError` vs `ECONNREFUSED` vs status) in the reason. Step L568.

**F22 minor. Reactions and a second chat view.** `chat.ts:160-172` (`messageBase` reactions), `:252-365`: the module
re-maps the board's chat to its own `ChatView`, and a reaction is parsed and sent (`react`, `:419`). D3 and L471 drop
reactions. Not this audit's step; named so it is not lost: L471 owns it.

**F23 minor. Night watch asks a model what the rules already know.** `night-watch.ts:25-33`, `:56-75`. At night,
every 2 h, it sends the Dispatcher "any open step ready that did not start, any stalled or silent task, any task waiting
on a check or a merge?" for each project; those three facts are decisions the loop wrote in the last 30 s. Cost: up to 4
Dispatcher turns a night per owner with a model reading `decisions.jsonl` back. Replacement: send only when the loop
wrote a `stall` or an owner-blocking `skip` since the last send (an event), with the lines in the message; no send for
a quiet night. `inNight` parses `LINECLEAR_NIGHT_WATCH` with a regex (`:19`): keep, it is the owner's own setting.
The `catch` at `:40` is acceptable (a missing file means "never sent"). Step L569.

### Plan commands

**F24 minor. A whole task list to ask whether the server is up.** `plan.ts:25-28` (`serverIsDown`: `task list --json`, 123 KB
and 0.10 s, measured) and the same string test at `:73`. Two ways, with a regex-like `startsWith` on another tool's
stderr text. Replacement: exit code 2 of the real call is the answer (it is already tested at `:73`); delete
`serverIsDown`. Step L564.

**F25 minor. A regex on the server's stdout to find the new task id.** `plan.ts:75` (`/\bAdded ([A-Z]...)/`).
Replacement: `task add --json` prints the task. Step L564.

**F26 minor. Per-commit `git log` in a loop, and `spawnSync` with no timeout.** `autoplan.ts:178-186` (`mergeTask`: one
`git log -1` per commit between base and merge, `:184`), `:179` (merge, no timeout), `plan.ts:169` (`task close`),
`plan.ts:26,51` (no timeout). With a merge that lands 40 commits meanwhile this is 40 git processes. Replacement: one
`git log --format=%H%x01%s base..commit`, one timeout constant. Step L564.

### Home and its readers

**F27 major. Task rows are guessed from words.** `home-data.ts:141` (`/\breview/i` on the agent's last status line decides
the stage "review"), `:171` and `:376` (`IDLE_CARD`, `IDLE_TEXT` string equality decide "quiet"), `:131` (`stepOf` regex on the
title: a second way to link a task to a step, next to `state.taskSteps` in `starts.ts` and `whyStale`'s
`title.startsWith(step.id + " ")`, `tick-project.ts:307`), `:485-493` (`laneNote` parses the lane's own sentence "Your
merge hung in ..., so the merge lane released it"). Why it is a patch: a change of wording in the agent prompt, the
server or a brief changes what Home shows with no error. Replacement: the task record carries `stage`, `step`
and `laneReleased` as fields written where the event happens (the server's engine). The server side is the server audit's;
this step reads the fields. Step L566.

**F28 major. "Since when" resets at every restart.** `home-data.ts:146-154` (`stageSince`): a process-wide `Map` of the
first read that saw each task at its stage; with no eviction (one entry per task ever shown) and no persistence, so
after a restart every working task reads "since now". Grows: one entry per task id per process life. Replacement:
read the stage start from the task record (`stageAt`), written at the transition. Step L566.

**F29 minor. 496 lines, `any` for the whole store, a dev `main`.** `home-data.ts:17` (`type Raw = any`, used 15 times
for tasks, spaces, chat files), `:470` (`if (import.meta.main) console.log(...)`, a second entry point). AGENTS.md says
avoid `any`. L484 already cuts the lines; this step adds the types and removes `:470`. Step L566.

**F30 minor. Session logs are scanned per working task every 30 s.** `home-data.ts:324-331` (`liveStatus`, bucketed
`now / 30,000`) calls `worktreeInput` (`measure.ts:135`), which reads and parses every pi session file of the worktree
(`readSessions`, `sessionUsage`). 45 working tasks is 45 session-folder scans every 30 s per open page set, and a
session file is megabytes by the end of a task. pi writes usage into its session entries; the server's engine sees
every turn end (`agent_end` in the event stream) and can add the usage to the task record. Replacement: the task record
holds `inputTokens`, updated at turn end. Step L566 reads it; writer named, not done.

### The unwired proof checker and the other modules

**F31 major. `doneproof-run.ts` has no caller outside tests, and its reader runs everywhere.** `grep -rn proveStep` finds
`src/doneproof-run.ts:113` and `test/` only. Yet `task-steps.ts:86` calls `unprovenOf` -> `readProofs`
(`doneproof.ts:31-37`: `JSON.parse`, `catch -> {}`) on every `stepInputs`, which means every tick and every Home read of
every project, for a file nothing writes in production. `doneproof-run.ts` is 156 lines of patches: regex on markdown to
guess commands (`doneproof.ts:91-120`, `commandsFor`, `tagsOf`), a regex on model output (`ITEM n: TRUE|FALSE`,
`doneproof-run.ts:80`), a regex for file names and `[a-z]{5,}` words to pick file excerpts (`:46-47`), two model calls with
a 300 s synchronous timeout each (`ask-model.ts:50-67`, `:135`). scope.md keeps it for "a step is done only when its
done-when proof passes" (idea.md, LIN-183); the gate is not built. Decision: the proof is the reviewer's job
(`review-call.ts` already asks a fresh model about the diff and runs on a task, not in the tick). Replacement: delete
`doneproof-run.ts`, `readProofs`, `saveProof`, `unprovenOf`, `commandsFor`, `readOnly`, `testOf`, the `unproven`
plumbing, `Work = "doneproof"`; move `doneItems` (used by `owner-steps.ts:1`) to `roadmap.ts`. If the owner wants the
gate, it is one new step with a caller. Step L567.

**F32 trivial. `company.ts`.** `company.ts:9-16`: `existsSync` + `statSync` per call (2 syscalls) for a 3 line lookup used
once or twice per start. Kept; scope.md folds it into `models.ts` (L463's files). No step.

**F33 trivial. `decision-dedupe.ts` and `company.ts` are 25 and 21 line modules.** They exist for module borders, not to
get under 600 lines. `decision-dedupe.ts` goes with F18 (L563); `company.ts` stays. No further step.

**F34 trivial. Commit subject regex for a task's own merge.** `tick-project.ts:75` (`/^[A-Za-z][A-Za-z0-9]*-\d+: /`)
reads a convention the repo's own rules (`ROADMAP.md`, "How to read it") define. It stays; the contract is written once.
No step.

## Counts of the brief, in this area

| Count | In the area | Where |
|-------|-------------|-------|
| Swallowed or empty catch (returns a default or nothing) | 18 | `rules.ts:85`; `asks.ts:103,164,208`; `night-watch.ts:40`; `real-world.ts:27,39,94`; `doneproof.ts:35`; `notify.ts:47`; `chat.ts:52,88,100,273,283,487,495,505`. Five reset real state (F13); eight are legitimate expected failures (`chat.ts`) |
| `execSync` / `spawnSync` | 17 call sites | `real-world.ts:37`; `plan.ts:26,51,169`; `autoplan.ts:179`; `doneproof-run.ts:10`; `ask-model.ts:50,51` (via `autoplan.ts:141`); and `task-read.ts:23`, `spread.ts` through `serverJson` |
| `setTimeout` / `setInterval` | 4 | `rules.ts:246`, `notify.ts:93`, `chat.ts:326`, `chat.ts:492` |
| Retry or fixed-wait constants | 7 | F19 |
| JSON stores written whole | 6 | `state.json` (`rules.ts:173`), `asks-routed.json` (`asks.ts:433`), `night-watch.json`, `push-mark`, `proofs-*.json`, item files of the Inbox |
| herdr references | 0 | none in this area; the herdr calls sit in `starts.ts` and `stalls.ts` through `world.started`, `nudge` and `lastError` (`real-world.ts:196-202`) |

## Modules of the area against idea.md

| Module | Core job (idea.md, scope.md) | Verdict |
|--------|------------------------------|---------|
| `rules.ts`, `tick-project.ts`, `real-world.ts` | the rule loop | kept; reshape per F1 to F9, F13 to F18 |
| `asks.ts`, `notify.ts` | Inbox: a rule or the owner answers; a push | kept; read by change (F10 to F12) |
| `plan.ts`, `autoplan.ts` | Plan | kept; one apply path (F4, F24 to F26) |
| `chat.ts` | the Dispatcher chat on the web | kept; backs off, reads no board snapshot per retry (F20) |
| `home-data.ts` | Home | kept; reads fields, not words (F27 to F30) |
| `night-watch.ts` | the Dispatcher wakes at night | kept; event not clock (F23) |
| `company.ts`, `decision-dedupe.ts` | reviewer from another company; one line per reason | kept, small (F32, F33, F18) |
| `doneproof.ts`, `doneproof-run.ts` | done-when proof | the core job is real; the code is unwired and its reader runs on every read. Delete, the proof is the reviewer's (F31) |
| the health command in `tick-project.ts` | main is never red | duplicates the board's red mark and runs tests locally. Delete (F3) |

## Steps

The ids are L560 to L569. Locks are disjoint inside each parallel group; steps that share a file or a lock with an
open step of ROADMAP.md name it in `after`. The groups that run at once:

- A, in a chain: L560, L561, L562, L563, L564, L567.
- B: L565. C: L566. D: L568. E: L569.

### L560 One loop process, no survivors
Result: The rule loop runs in one process that crashes loudly, and a corrupt state file stops its project with a line that names it.
- why: `tickAway` starts a process every 30 s and throws every memo away, `readState` reads a corrupt file as an empty one (`closedSteps` lost, every closed step starts again), and the loop survives every error it should not.
- done when: Ticks 2 to 20 of a 20 tick run start 0 new `bun` processes (20 today, a test counts `lineclear run --once` spawns); `grep -c "uncaughtException\|unhandledRejection\|SIGHUP" src/rules.ts` prints 0 (3 today); a test writes `{` into `state.json` and sees the tick of that project stop with an Inbox item that names the file, and `closedSteps` unchanged; a test with `state.json` unchanged between two ticks sees 0 writes of it (1 per tick today).
- locks: slots
- after: L460
- files: src/rules.ts, src/serve.ts

### L561 One tick reads facts once
Result: A tick reads main and the tasks once, never runs the project's tests, and a step never starts twice for want of a second look.
- why: `whyStale` re-reads fetch, main, the task list and two ssh calls per machine before every start and tests one fact twice, `checkHealth` and `proveClosed` run tests on the owner's machine next to the board's own red mark, and `startsWith("lock '")` steers the loop by its own sentence.
- done when: A test with 5 ready steps and 1 other machine counts the spawned commands of one tick and sees 15 or fewer (about 45 today); `grep -n "health\|proveClosed\|whyStale\|startsWith(\"lock" src/tick-project.ts` lists nothing; a test with main marked red by the board sees new starts stop and 0 health commands run; `wc -l src/tick-project.ts` prints 340 or less (468 today).
- locks: slots
- after: L460, L493, L560
- files: src/tick-project.ts

### L562 The world's reads are exact
Result: Every read of the world is bounded, typed and cached by what changed, and no tool's text output is parsed with a regex.
- why: `run` waits 600 s for every command, `git log` reads all of main every tick, `maxTasks`, `reviewerSetting` and the model list are cut from text, and an unreadable list means "every model is offered".
- done when: `grep -c "HEALTH_TIMEOUT_MS" src/real-world.ts` prints 2 (the constant and the detached merge only; 3 today); a test with a `git` that never answers sees the tick end its read in 10 s or less and note a timeout; a test with refs unchanged between ticks counts 0 `git log` spawns on the second tick (1 per tick today); `grep -n 'machine\.maxTasks\|reviewer\.model' src/real-world.ts` lists nothing; `pi --list-models` runs 0 times in a 20 tick test with a pi RPC double that answers `get_available_models`.
- locks: world
- after: L497, L561
- files: src/world.ts, src/real-world.ts, src/task-read.ts

### L563 Decisions carry a code
Result: A skip is one line when it starts and one when it ends, written from a code, with no text parsing on the way.
- why: every tick rewrites the same skip text and `freshDecisions` removes repeats by replacing numbers; the loop also reads its own sentence to decide what to do.
- done when: `Decision` has a `code` (a union of at most 12) and `freshDecisions` compares codes: `grep -c "replace(/" src/decision-dedupe.ts` prints 0 (1 today); a 100 tick test of one blocked step writes 2 lines (start and end of the skip), the same as today's output; `grep -c 'startsWith("skip:")' src/decision-dedupe.ts` prints 0 (1 today).
- locks: decision-log, slots
- after: L469, L560, L561
- files: src/decision-dedupe.ts, src/rules.ts

### L564 Plans settle on events
Result: A plan applies once, at the moment its project allows it, and `lineclear plan` never reads the whole task list to learn the board is up.
- why: `settlePlans` runs a model and a merge inside the tick before any project's lock, a second path to what `autoApply` already does; `plan.ts` spawns a 123 KB task list as a ping.
- done when: `settlePlans` is deleted and a test with a waiting plan sees the tick make 0 model calls (1 today); `grep -c "serverIsDown\|startsWith(\"Cannot" src/plan.ts` prints 0 (4 today); `mergeTask` spawns 3 git processes or fewer for a 40 commit merge (42 today); `grep -n "Bun.spawnSync" src/plan.ts src/autoplan.ts` lists only calls with a `timeout`.
- locks: autoplan, slots
- after: L496, L560, L563
- files: src/autoplan.ts, src/plan.ts, src/rules.ts

### L565 The Inbox is read by change
Result: Pushes, asks and the tick read only the Inbox items and chats that changed, and an answered card is recorded on the card.
- why: the push watcher parses every Inbox file every 2 s next to a server that stats the folder each second, `routeAsks` parses all chat history of a space every tick, and `asks-routed.json` is rewritten whole to hold what each card could say.
- done when: with 1,000 closed Inbox items a test counts 0 file reads by `notifyNew` when nothing changed (1,000 per 2 s today); `readItems` reads 0 files under `inbox/closed/`; a test with 200 archived chat files sees `routeAsks` read 0 of them (200 per tick today) and parse an unchanged live chat 0 times; `src/asks.ts` has no `asks-routed.json` and `wc -l src/asks.ts src/notify.ts` prints 420 or less in all (531 today).
- locks: inbox-path
- after: L485
- files: src/asks.ts, src/notify.ts, src/inbox.ts, src/web.ts

### L566 Home reads fields, not words
Result: Home shows a task's stage, step, merge release and start time from the task record, and these survive a restart.
- why: Home guesses the stage from a status line, the step from a title, the lane from a sentence and "since" from the first read of this process, so a restart or a changed wording changes what the owner sees.
- done when: `grep -c '/\breview/i\|Your merge hung\|const seen = new Map' src/home-data.ts` prints 0 (3 today); a test restarts the reader and sees every working task keep its `since`; `grep -c ": Raw\|<Raw>\|Raw\[\]" src/home-data.ts` prints 0 (15 today); `import.meta.main` is gone from the file.
- locks: home-read
- after: L484
- files: src/home-data.ts

### L567 The dead proof checker is gone
Result: No code reads or writes a proof file nobody makes, and the done-when proof is the reviewer's, named in scope.md.
- why: `proveStep` has no caller outside tests, while `unprovenOf` parses a proof file on every tick and every Home read.
- done when: `git ls-files src/doneproof-run.ts` prints nothing and `git grep -n "unprovenOf\|readProofs\|saveProof\|commandsFor\|testOf" src` lists nothing; `doneItems` lives in `roadmap.ts`; `wc -l` of the deleted files (295 in scope.md) is gone from `bun run gates` knip's list; the GitHub check is green.
- locks: doneproof, one-start
- after: L461, L561, L562
- files: src/doneproof.ts, src/doneproof-run.ts, src/task-steps.ts, src/owner-steps.ts, src/task-work.ts, src/roadmap.ts, src/brief.ts, docs/scope.md

### L568 The chat link backs off
Result: When the board is down, an open chat page waits longer between tries and shows why, instead of reading the whole board three times a second.
- why: `chat.ts` retries every 3 s and each try reads the whole board snapshot (about 120 KB) to find a chat key it already knew.
- done when: a test with the board down for 60 s sees 8 or fewer connect attempts (20 today) and at most 1 snapshot read after the first; a test with a refused connection and a 500 shows two different reasons (one today); `grep -c "retryMs" src/chat.ts` prints 0 (6 today).
- locks: chat-context
- after: L458
- files: src/chat.ts

### L569 Night watch speaks on change
Result: At night the Dispatcher hears only about what the rules found, and a quiet night sends nothing.
- why: the watch asks a model every 2 hours what the loop wrote 30 seconds ago.
- done when: a test with a quiet night of 9 hours (no `stall`, no owner-blocking `skip`) sends 0 messages (5 today); a test with one `stall` at 02:10 sends 1 message that holds its line; `WATCH_EVERY_MS` is gone.
- locks: night-watch
- after: none
- files: src/night-watch.ts

## Not proven, and named for others

- Server-side fields (`stage`, `stageAt`, `step`, `laneReleased`, `inputTokens`, a Done refusal in `task tell`, a claim by step in `task add`) are needed by L561, L562 and L566. L493 covers the claim; the rest are the server audit's. This audit did not read `server/`.
- `agents-delivery.ts`, `starts.ts`, `stalls.ts` (herdr calls, `holdProjectTick`, the revert push in `revertLast`) are another area.
- No load number of the other two machines was taken; the 45 agent costs above are counted from code and the measured sizes of this board.
