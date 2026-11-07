# Audit: agents and herdr

Read-only audit of how a task's agent is started, given its brief, watched and stopped. Area: `server/server/live/agents*.ts`,
`herdr*.ts`, `engine/engine-launch.ts`, `engine/worktrees.ts`, `agent-process.ts`, `paste-watch.ts`, `revive.ts`,
`recovery.ts`, `terminal-clock.ts`, `src/harness-pi.ts`, `pi/`. Line numbers are of main at the time of the audit.
Sizes measured on this machine: `~/.lineclear/agents.json` 423,657 bytes (131 records, 3.2 KB each), `typed.json` 169,909
bytes. A number marked "est." is computed from the code, not measured.

## The answer: can agents run as pi RPC or print-mode processes?

Yes, and it removes most of what follows. Today every task agent is a TUI in a herdr pane. Lineclear types into it
(`agent.prompt`, `pane.send_text`, `pane.send_keys`), guesses from the screen whether the text went in
(`paste-watch.ts`, `agents-state.ts:323`), and polls to learn the turn ended. Facts from the docs:

- **pi RPC** (`pi --mode rpc`, [rpc.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md),
  [rpc-commands.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc-commands.md)) is a long-lived
  child on JSONL stdin/stdout. `prompt` answers `disposition: started | queued | handled`; during a run `streamingBehavior:
  "steer" | "followUp"` queues the text inside pi, so there is no "wait until idle, then type" step. `abort` replaces the
  `esc` key. `set_model`, `set_thinking_level`, `get_state`, `compact`, `new_session`, `switch_session`, `get_commands`
  exist. Closing stdin (or SIGTERM) is an orderly stop.
- **Events** ([json.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/json.md)): `agent_start`,
  `turn_end`, `tool_execution_*`, `message_update`, `auto_retry_*`, `compaction_*`, `agent_end` (one run) and `agent_settled`
  (no automatic work left: this is "the turn is over"). A tool-call event is a sign of life; no `lineclear alive` beat is
  needed. Extension UI questions arrive as `extension_ui_request` records, so "blocked" is an explicit record, not a
  screen guess.
- **Print mode** (`--print`) and **JSON mode** (`--mode json`) are one prompt and exit, with no later input. They fit a
  reviewer or a one-shot check, not a task agent that gets follow-up messages.
- **herdr** ([agent-automation](https://herdr.dev/tui/docs/agent-automation/)) is a layout and terminal tool. Its events are
  pane events (`pane.agent_status_changed` needs a `pane_id`, so one subscription per pane). It says "herdr sends no event
  when a pane's output changes" (`terminal-clock.ts:1`) and `agent prompt` is "text plus encoded Enter". `agent wait` and
  `agent prompt --wait` block in herdr, which is still one blocking call per agent. Herdr cannot tell what pi knows.
- Pi already writes its session as JSONL and Lineclear already reads it (`readers/`), so RPC events and the log say the same
  thing twice; RPC makes the event the source and the log the record.

**Recommendation.** Task agents and reviewers run as `pi --mode rpc` children of the server of the machine they run on.
The server spawns with the agent's environment (`agentEnv`), so the route and secret capability are bound at spawn and
`route.pl --bind <pid>` (`agents-state.ts:172`) goes. A coordinator and the Dispatcher stay in herdr panes until the human
can talk to a task agent from the chat page alone (they are the ones a person types into). Trade-offs to decide in L509: the
owner can no longer type into a task agent's pane (the chat is the way; "take over" becomes a message or an `abort`),
and a server restart ends the children, so they resume from `--session-id` (the session file is on disk) instead of
surviving in herdr. Remote machines: the machine's own server spawns the child; main receives the events it already
receives for chats, so no ssh per agent.

## Findings

Tags: PATCH = hides a cause; SCALE = does not hold at 45 agents; DUP = second way to do a job.

### A. Typing into a pane (the biggest cause)

| # | file:line | what it does | why | replacement |
|---|---|---|---|---|
| A1 | `agents-state.ts:271-277` `put`, `agents-delivery.ts:437` | hands a message over with `herdr.prompt` (typed text plus Enter) | PATCH: the input channel is a screen. Whether the text arrived is unknown, so A2-A8 exist. `agent.prompt` has a 20 s timeout and a stalled prompt "does not prove no input was sent" (herdr docs) | RPC `prompt` / `steer` / `follow_up`: the response says `started | queued | handled` (L510) |
| A2 | `agents-state.ts:279-282` `untilReady` | polls `interactive_ready` every 100 ms up to 30 s | PATCH, poll where an event exists: up to 300 wakeups per starting agent; at 45 starts, 13,500 timers (est.) | RPC child is ready when `get_state` answers; no wait (L510) |
| A3 | `agents-state.ts:323-344` `submitted` | after a send, polls status every 100 ms for 5 s, up to 5 tries, reads the screen (`herdr.visible`) and presses Enter again | PATCH: guesses from the screen that Enter was swallowed. Up to 25 s and 5 screen reads and 5 Enters per agent; Enter into a menu can choose an option | remove; `prompt` response is the receipt (L510) |
| A4 | `paste-watch.ts:8-25,29-45` | regex on another tool's screen (`[paste #`, prompt marks `❯›>`) to find an unsent paste; re-reads every 5 s while fresh (120 s) | PATCH (regex on another tool's output) and SCALE: 45 fresh agents = 9 `pane.read` per second for 2 minutes (est.) | delete the file (L510) |
| A5 | `agents-state.ts:285-296` `typeIntoPane` | after `paneAfter` (10 s) types the brief into the pane with `pane.send_text` + `enter` | PATCH: a second way to send (also A1) used when the first fails; into a shell it would run the text, so it checks `paneIdle` first | none needed; RPC has one way (L510) |
| A6 | `agents-helpers.ts:109-125` `holdFrom`, `ownOldPane` | classify herdr errors by regex on the message (`not an active named agent`, `already used`) | PATCH: regex on another tool's error text; a herdr wording change silently turns a hold into a failure | RPC child has no name to clash with; errors are typed (L510, L502) |
| A7 | `agents-delivery.ts:455-456` | after each delivered item `await sleep(1500); await refresh()` "to give the CLI a moment" | PATCH + blocks: a brief of 3 items holds the delivery loop 4.5 s and does 3 whole-session reads; 45 agents = 135 s of loop time and 135 snapshots (est.) | RPC `prompt` is acknowledged; send the next at once (L510) |
| A8 | `agents-delivery.ts:466-488` `deliveryFailed`, `:34` `STARTING_RETRY_MS`, `agents-state.ts:93-97` `unreadyFor/paneAfter/briefFor/readyMs/submitMs/strandAfter/backoffMs/backoffMax` | exponential backoff, a 300 ms re-try timer, a 60 s "unready" window, a 5 min give-up for briefs, a 30 s "stranded" fail | PATCH: eight tuning knobs around "the agent may not be listening yet". 77 retry sites in the repo come from this shape | with RPC the child accepts a prompt once spawned; a failure is a process exit, handled once (L510) |
| A9 | `agents-delivery.ts:421-463` `deliver` | one loop per key; `await this.put` can block; `beforeInput` hook reads startup menus | SCALE: sequential per key, but each item costs A7's sleep | same as A7 |
| A10 | `agents-sending.ts:166-175` `keys`, `text`; `:223-226` `interrupt` | keys and text through `pane.send_keys` / `agent.send_keys` (by pane id and by name) | DUP: three ways to reach the agent's input (`prompt`, `pane.send_*`, `agent.send_keys`) | RPC `abort`; `get_commands` for slash commands (L510) |
| A11 | `agents-sending.ts:211-221` `stopTurn` | after `esc`, polls every 500 ms up to 15 s and calls `refresh()` each time | PATCH: 30 whole-session snapshots per restart; `agent_settled` says the turn ended | RPC `abort` waits "for the session to become idle before responding" (L510) |

### B. Starting an agent

| # | file:line | what it does | why | replacement |
|---|---|---|---|---|
| B1 | `agents-delivery.ts:300-322` | `for (i<=8)` loop around `herdr.start`: swallows `agent_not_ready` (breaks as success), closes the old pane on "already used", sleeps 750 ms "a new pane needs a moment before its shell is at the prompt" | PATCH: a retry and a timer around something that should not fail; up to 8 x (60 s start timeout + 750 ms) = 8 min blocked per agent; `agent_not_ready` treated as ok hides a blocked start | spawn the child: success or exit code (L502) |
| B2 | `agents-delivery.ts:338-340` | three `setTimeout`s per start: `deliver` at 250 ms, `discoverLog` at 3 s and 15 s | PATCH: guessed times for "the log file should exist by now"; 3 timers x 45 = 135 per burst | pi RPC `get_state` returns the session file path at once (L502) |
| B3 | `agents-state.ts:248-258` `discoverLog`, `agents-delivery.ts:198-211` `follow` | scan pi's session folder for a log newer than a time; `follow` re-scans at 1.5, 5, 15, 60, 180 s after a slash command | PATCH + DUP (three ways to learn the log: `learnSession`, `discoverLog`, `follow`): 5 timers and 5 directory scans per command | `get_state.sessionFile` after `new_session` / `switch_session` responses (L502) |
| B4 | `agents-state.ts:148-186` `bindRoute` | after start, `processInfo` then spawns `perl route.pl --bind <pid>` (5 s timeout), signature in a map | SCALE: one perl process per start; binds by pid because a pane's env can be stale (comment 148) | env set at spawn; capability issued with the child's pid (L509) |
| B5 | `agents-state.ts:189-215` `repairRoutes` | runs after every `take()` (every list-changing event) over all records; failed binds retried every 30 s | PATCH: an event-driven loop with a time-based retry; 131 records scanned per event | not needed after B4 (L502) |
| B6 | `agents-delivery.ts:281-293` `paneFor` | to start a coordinator: lists tabs, creates a tab, lists panes and agents, `paneIdle` per pane, closes dead tabs | SCALE: 4+N herdr calls (N panes in the space) per coordinator start | not for RPC agents; coordinators keep it (kept in L502) |
| B7 | `agents-delivery.ts:154-161` | lists unnamed agents and renames them with `herdr.rename(...).catch(() => undefined)` | PATCH: herdr lists an agent "without its name" and Lineclear gives it back; the catch hides a failed rename, so the brief waits forever | no herdr agent name for RPC agents (L502) |
| B8 | `agents-delivery.ts:236-244` `args` | builds the CLI arguments; codex and claude branches stay | DUP / dead branch: pi runs every agent (L443, L472 are open); `r.kind !== 'pi'` hidden-system-prompt path (`:325`) | one kind, pi (L502 trims; L443/L472 own the catalog) |

### C. Watching: status, screen, liveness

| # | file:line | what it does | why | replacement |
|---|---|---|---|---|
| C1 | `herdr.ts:297-303` `Subscription.set`, `:305-361` `reopen`; `agents-delivery.ts:106-111` `take` | one socket subscribes to 6 pane events plus one `pane.agent_status_changed` per agent pane (`paneEvents`, `:267`); when the pane list changes the socket is destroyed and reopened with the whole list | SCALE: 45 agents = 51 subscriptions rebuilt on every start and stop; each reopen is followed by a whole-session read; 90 reopens for a 45-start burst with the stop of the old ones (est.) | an extra connection for only the new pane (additive), or one unscoped subscription if herdr offers one; with RPC agents the list is the coordinators only (L504) |
| C2 | `agents-delivery.ts:92-126` `refresh` | `session.snapshot` of everything on open, on every `read` verdict of `listAfter`, and 2+ times per start/finish/deliver | SCALE: the snapshot carries every agent (45+ in each); est. 6 snapshots per start (pane_created, agent_detected, post-start, 3 deliveries) = 270 per 45-start burst | RPC events keep state; herdr read only on open (L504) |
| C3 | `agent-events.ts:11-12` | `pane_created`, `pane_agent_detected`, `pane_exited`, `pane_moved` return `'read'` | PATCH: events that carry no data force a whole read each time | fewer panes (C1) and use event payloads where herdr sends the pane (L504) |
| C4 | `agents-delivery.ts:49-57` | `setInterval(2000)` runs `settle()` "upkeep of what herdr does not push" | poll where an event exists: 0.5 ticks/s forever; per tick loops `byName`, `records` (131), `outbox`, `checkStranded` | settle on events (`agent_settled`, process exit) and one timer per deadline (L510) |
| C5 | `terminal-clock.ts:21-24`, `agents-state.ts:362-371` `screen` | reads each watched pane as ansi, 300 lines, every 500 ms (1500 ms on a box) and its layout every 3 s | SCALE: 45 watched panes = 90 `pane.read` a second, each up to 300 rows (est.); it exists because "herdr sends no event when a pane's output changes" | an RPC agent has no screen: the page draws `message_update` deltas; keep the clock for the 1-2 coordinator panes on screen (L504) |
| C6 | `agents-sending.ts:12-25` `wrong`, `revive.ts:15-52` | `pane.process_info` per agent per upkeep pass, plus two sha256 reads of the prompt file, to find "exited" or "stale" (flags differ) | PATCH: asks the OS what is running to learn what a `close` event would say; reads two files per check; pi renames its process, so `staleFlag` skips it (`revive.ts:46`) and compares nothing for the only agent kind that matters | child `exit` event; stale = hash of the launch spec stored in the record (L508) |
| C7 | `revive.ts:65-127` `Revivals` | grace 20 s, gaps 0/60 s/5 min, steady 10 min, loop 1 h | timers on top of C6; needed only because detection is by polling | keep a small restart-with-backoff on exit event (L508) |
| C8 | `pi/extension.ts:76-102` `beatDuringCalls` | `execFile('lineclear alive <task>')` every 4 min while a tool runs, via `setInterval` | SCALE: a process spawn per beat per busy agent (45 agents = 11 per minute, each a node/bun start, est.); "pi writes its log only when a call ends" | RPC `tool_execution_*` events are the sign of life (L507) |
| C9 | `pi/nudge.ts:4-6,14-41`, `pi/extension.ts:51-69` | regex on the model's last message (`I'll keep…`) and on bash commands (`lineclear ready|done|ask|wait`) to decide a nudge, sent as `followUp` | PATCH: regex on prose; overlaps open step L430 (server-side stall nudge) | `agent_settled` with no ask/wait recorded on the server gets one `follow_up`; delete the regex (L507, with L430) |
| C10 | `src/harness-pi.ts:23-29`, `:31-33` | reads every `.jsonl` session of a folder whole and matches a usage-limit regex | PATCH + SCALE: a long session is MBs; regex on a provider's error text; runs per check | `auto_retry_start` / error `stopReason` events carry it; read the event, not the file (L507) |
| C11 | `pi/account-fallback.ts:23-33,36-52` | `execFileSync git rev-parse` and `readFileSync` of project settings at every pi start; empty catches | blocking call at start: ~5-20 ms per start (est.), swallowed catches mean a broken settings file silently disables the fallback | the server passes `LINECLEAR_PROJECT` (already supported at `:39`); drop the git call (L507) |

### D. Storage written whole

| # | file:line | what it does | why | replacement |
|---|---|---|---|---|
| D1 | `agents-state.ts:108-111` `save` (18 callers in `agents*.ts`; 10 in `agents-delivery.ts`) | `agents.json` and `outbox.json` rewritten whole on every call (`cold.ts:119-129`, `store.ts:44-52`) | SCALE: `agents.json` is 423,657 bytes today, rewritten for every launch step and every delivery; est. 5 saves x 45 starts x 424 KB = 95 MB per burst. The server writes it while the CLI (`lineclear`) and the reaper may also read; a whole-file read-modify-write by several processes loses updates | one append log per record (the `ColdLog` already does it for cold ones) or SQLite (`bun:sqlite`) with row writes (L503) |
| D2 | `agents-state.ts:348-358` `went` | `typed.json` (170 KB) rewritten whole after every delivered item; `requested-news-receipts.json` the same | SCALE: 45 agents x 3 items x 170 KB = 23 MB (est.) to remember "what went in lately" for ten minutes | in-memory ring plus an append log (L503) |
| D3 | `engine/worktrees.ts:303-323` `closeRepoSpace`, `:328-331`, `:68-88` | `repo-spaces.json` read, changed and written whole by concurrent `putAway` calls; `forget()` re-reads | PATCH: read-modify-write race (two tasks end together: both read, one write lost, a repo space stays open) | gone when no herdr repo space is made (L506) |

### E. Worktrees and herdr spaces

| # | file:line | what it does | why | replacement |
|---|---|---|---|---|
| E1 | `engine/worktrees.ts:66-90` `opening` | tries the known workspace; on any error (`catch {}` at `:77`) falls back to the repo's folder and then lists workspaces again to find what herdr opened | PATCH: swallowed catch decides between two paths by failure, and a second `workspaces()` call finds the new space by diff | `git worktree add` directly (L506) |
| E2 | `worktrees.ts:140-158` `agentPane`, `:163-182` `idleShells` | creates a tab with the agent env, then closes "idle shells" found by `panes`, `agents`, `tabs`, and `paneIdle` per pane | SCALE: 3 + N calls per start (N panes in the space); exists because "herdr restores them one more each time" | none: an RPC agent needs no tab (L506) |
| E3 | `worktrees.ts:185-200` `busy` | any error in the herdr calls returns `true` ("busy") | PATCH: swallowed catch: a herdr outage looks like work in progress, so a done task's worktree is kept forever | with no herdr space, `busy` is "process alive" from the registry (L506) |
| E4 | `worktrees.ts:212-257` `putAway`, `:259-290` `remove`, `:294-324` | 18 `catch(() => undefined)` / `.catch(() => null)`; `closeAgent`, `closeWorkspace`, `worktreeRemove` all swallowed | PATCH: 18 swallowed errors in 332 lines; a failed `worktreeRemove` is retried by `git` (second way: `dropFolder` `:243-251`) | `git worktree remove` once, typed errors surface (L506) |
| E5 | `engine/engine-launch.ts:38-49` `settleSoon` | `setTimeout(4000)` "a turn that ends may be followed at once by the next" before telling anyone it waits | PATCH: a timer guessing what `agent_settled` states | settle on `agent_settled` (L506) |
| E6 | `engine-launch.ts:340-360` | `setTimeout(BRIEF_WAIT)` per started task to flag a brief that did not start work (`briefLate`) | PATCH: a timer for "the brief did not arrive"; the prompt response says it | `prompt` response disposition (L506) |

### F. Structure

| # | file:line | what it does | why | replacement |
|---|---|---|---|---|
| F1 | `agents-state.ts` (371 lines), `agents-delivery.ts` (516), `agents-sending.ts` (227), `agents.ts` | one class `AgentsState -> AgentsDelivery -> AgentsSending` with `protected` members across three files | "a file split only to stay under 600 lines": the three files share ~50 fields; nothing is testable alone | after L510, L502 and L503 the class is: registry (records), channel (RPC child), outbox; each its own module (L503) |
| F2 | `herdr.ts:182-199` `herdrCli` and `herdrCliSync` | two ways to run the `herdr` command (async and `spawnSync`, 3 s) | DUP + blocking call: `spawnSync` blocks the loop up to 3 s | one async (L504) |
| F3 | `herdr.ts:182-199` `catch { return undefined }`, `herdr.ts:315,342` | empty catches: herdr missing, bad frame | hides the cause (is herdr missing, or is the JSON bad?) | typed `HerdrError` for each (L504) |
| F4 | `herdr.ts:67-74` `send` | on `closed` asks once more | PATCH: retry around something that should not fail; a closed socket mid-call may repeat a non-idempotent call (`pane.send_text`) | retry only reads (`snapshot`, `list`), never sends (L504) |
| F5 | `herdr.ts:76-116`, `herdr-forward.ts:13-38` | one socket connection per call; `forwarded` spawns the `herdr` binary (and ssh) per call, 20 s timeouts | SCALE: a connect per call (local, cheap); a process per call to another machine (~50-100 ms plus ssh); 6 calls per start x 45 = 270 spawns (est.) | one held connection (local) / one `herdr --machine` event stream (L504) |
| F6 | `herdr-forward.ts:129-157` `room` | for a saved machine: opens a tab, types a `printf` line, presses Enter, polls `pane.read` 25 x 200 ms, regex on the output, closes the tab | PATCH: types a shell command into a terminal to read `/proc`; polling loop up to 5 s; 5-7 forwarded calls (each a spawn) per read; regex on terminal text | `ssh <target> cat /proc/loadavg /proc/meminfo` with the existing ControlMaster (`box.ts:65-90`): one call, no regex, no tab (L505) |
| F7 | whole area | empty or swallowed catches counted by `grep -c` in the area: 49 (worktrees 18, delivery 9, herdr 5, forward 4, sending 4, state 4, launch 3, revive 2) plus 9 in `pi/` and `src/harness-pi.ts` | PATCH inventory; the large ones are covered above | each step removes its own |
| F8 | outside this area, found while reading | `chats-logs.ts:208,224` reads a pane (`herdr.visible`) and matches `replyOnScreen` by regex | regex on a CLI's screen | belongs to the chat audit; with RPC the reply is an event |

### G. Count of the area (for the roadmap's "done when")

`grep -c` over the area files, before: empty or swallowed catches 49 (+ 9 in `pi/` and `src/harness-pi.ts`), timer calls
(`setTimeout`/`setInterval`/`Bun.sleep`) 29, herdr calls from `herdr.*(` 30 in `agents*.ts`, `spawnSync`/`readFileSync`/
`writeFileSync` 12. `agents-delivery.ts` alone: 9 timers, 9 swallowed catches, 15 herdr calls.

## Steps

The open steps of this file are in [ROADMAP.md](../ROADMAP.md).

## Order

L504 and L505 start now. L509 starts now too. After L509: L510 then L502 then L503 (one lock), and L506, L507, L508 in
parallel with them. Open steps this touches: L430 (stall nudge, lock `stall-check`) shares L507's idea and can go first;
L443 and L472 (pi only) shrink L502's `args` and branches; no file listed here is in their files.
