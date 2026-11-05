# Dispatcher flow: owner, Dispatcher, workers

Goal: the owner's message is answered within seconds, the Dispatcher is never stuck in work, nothing is dropped and no
token is spent waiting.

## 1. Measured today

Source: the Dispatcher's pi session `~/.pi/agent/sessions/--home-user-project--/2026-11-02T02-31-50...jsonl`
(2 418 messages, 63.5 h from 2 Nov to 4 Nov, model claude-opus-5-5). Script: a throwaway parse of the jsonl, not kept.

| Measure | Value |
| --- | --- |
| Owner messages | 139 |
| To the first assistant output (usually a tool call) | median 7 s, p90 14 s, max 26 s |
| To the first real text reply | median 98 s, p90 778 s (13 min), max 1 873 s (31 min) |
| Owner messages whose first reply took over 20 s / over 60 s | 125 of 139 (90 %) / 92 of 139 (66 %) |
| Assistant turns | 1 186: 1 076 (91 %) with a tool call, 110 (9 %) text only |
| Time inside tool calls | 13.0 h of 63.5 h (20 %); 174 calls over 60 s took 11.0 h of it |
| Output tokens | 601 k |
| Context read per turn | median 102 k tokens; 115.5 M cache-read and 2.6 M cache-write in all |
| Compactions | 11 (one per ~6 h) |

Time in tool calls by kind (seconds, count, median, longest):

| Kind | Calls | Total | Median | Max |
| --- | --- | --- | --- | --- |
| `grep`, `cat`, `ls`, `head` (reading) | 517 | 19 500 | 1 s | 600 s |
| `git` | 122 | 7 200 | 3 s | 583 s |
| `tail` of a log (waiting on a worker) | 70 | 4 500 | 12 s | 757 s |
| `sleep` (polling) | 30 | 3 300 | 34 s | 582 s |
| `ssh` to another machine | 100 | 1 800 | 1 s | 541 s |
| `lineclear run` / `release` / `track` | 8 | 1 650 | 150 to 220 s | 400 s |
| `lineclear move` / `now` / `check` | 4 | 1 300 | 250 to 440 s | 500 s |
| `shepherdr merge` | 5 | 580 | 53 s | 260 s |
| `shepherdr task add`, `status`, `plan` | 30 | 800 | 9 to 70 s | 132 s |

The fast kinds have long tails: a `grep` or `ssh` that hung ran 9 to 10 min. Counts of a kind include some mis-sorted
calls (the match is by first word), so read the table as orders of magnitude.

What the numbers say:

1. The Dispatcher mostly operates, it does not answer: 9 of 10 turns are tool calls. `AGENTS.md` says it never builds, yet
   it ran merges, releases, ssh and log tails itself.
2. A pi turn is serial. A message typed during a 2 to 10 min call is delivered only when the turn ends, so the reply
   latency is the length of the call in progress. (The session log stamps a message when it is delivered, so the
   queued wait is hidden in these numbers: the real wait is longer than the 98 s median.)
3. Waiting costs tokens: each turn resends about 100 k context. 488 turns ran a `sleep` or a `tail` (some of them
   `| tail` that only trims output, so this is an upper bound) and read 50 M context tokens, about 43 % of all.
   Reads were slow too: `lineclear status` and `lineclear inbox` took 10 to 80 s a call, so even an answer from
   status is not instant today.
4. Nothing was dropped in the log, but the owner re-asked: 18 messages are just `status`, plus `nyt`, `eteneekö`,
   `nyt?`. Each is a sign the owner got no answer in time.

## 2. Patterns from other systems

Not fetched in this run: the web tools were enabled but never appeared in this agent's tool list, so these are from
prior knowledge. Each URL is the page to check; a reviewer should open them before a step relies on a detail.

- Erlang/OTP: a supervisor only starts and restarts children; a `gen_server` answers `call` at once and does long work
  in a spawned process, or replies later (`noreply` then `gen_server:reply`). Link: <https://www.erlang.org/doc/system/design_principles.html>.
  Take: the talking process owns no long work, and a worker's death is a message to it.
- Akka: an actor handles one message at a time, so blocking in a handler stalls the mailbox; blocking work goes to a
  separate dispatcher or a Future and its result comes back as a message. Link: <https://doc.akka.io/libraries/akka-core/current/typed/dispatchers.html>.
  Take: exactly the Dispatcher's fault today.
- Kubernetes: `kubectl apply` returns once the spec is stored; a controller reconciles and writes status; clients
  `watch` events. Link: <https://kubernetes.io/docs/concepts/architecture/controller/>. Take: a command returns a
  handle (task id), status lives in one place, events are pushed.
- Temporal: a signal is an async message into a running workflow; a query reads state and never changes it; an update
  waits for a result. Link: <https://docs.temporal.io/encyclopedia/workflow-message-passing>. Take: three kinds of
  call: fire (signal), read (query), wait (update), and only the read must always be instant.
- Claude Code: subagents run in their own context and return one summary; bash and agents can run in the
  background and the main loop is told when they end. Links: <https://docs.claude.com/en/docs/claude-code/sub-agents>,
  <https://docs.claude.com/en/docs/claude-code/hooks>. Take: results come back as one short message, never as a log.
- OpenAI Agents SDK: a handoff moves the whole conversation to another agent; an agent as a tool keeps the manager
  in charge and returns its output. Link: <https://openai.github.io/openai-agents-python/handoffs/>. Take: the
  Dispatcher keeps the owner, so workers are tools, not handoffs.
- LangGraph supervisor: one supervisor routes to worker agents and collects results; its docs warn that the supervisor
  context grows with every worker message. Link: <https://github.com/langchain-ai/langgraph-supervisor-py>. Take: pass
  workers' results up as one line.
- OpenHands, Devin, Codex cloud: the user's chat is separate from the sandbox that runs the long job; the job posts
  progress and a final result, and the user can message while it runs. Links: <https://docs.all-hands.dev/>,
  <https://docs.devin.ai/>, <https://developers.openai.com/codex/cloud>. Take: chat and execution are different
  processes.
- Slack bots: a slash command must be acknowledged within 3 s; the real result is posted later to a response URL or
  by message. Link: <https://api.slack.com/interactivity/slash-commands>. Take: "on it, id X" at once, result as a
  separate message.
- Events or polling: a push feed with a cursor (SSE, `watch`) costs nothing while idle, and polling costs a turn each
  tick. Link: <https://kubernetes.io/docs/reference/using-api/api-concepts/#efficient-detection-of-changes>.

## 3. Target flow

Roles:

- Dispatcher: one pi agent, owns the owner chat. Reads and answers from `lineclear status` and `lineclear inbox`
  (each under 2 s), and files work. Runs nothing that takes more than 5 s. Never merges, pushes or edits.
- Operator: a new role, a short-lived worker the Dispatcher starts for a long command (merge, release, `task add`, plan,
  promote, ssh). It runs the command, waits inside it, and posts one summary line. It needs no chat with the owner.
- Workers: task agents in their worktrees, as today.
- Checker: the step checker and reviewer, as today, reporting to the task.
- Event feed: `lineclear events` (append-only, a cursor per reader). The board's changes write it; nobody polls.

Sequence for "merge LIN-12":

1. Owner writes. The Dispatcher answers within seconds (a read, or "ok, merging LIN-12").
2. The Dispatcher runs `lineclear op start merge LIN-12`, which returns at once with an id `op-41` and queues an
   Operator. Instant.
3. The Operator runs the merge. The owner can write meanwhile and the Dispatcher answers from `lineclear op show op-41`
   (instant, a read).
4. The Operator ends and writes one event: `op-41 merge LIN-12: merged, main 3f2a9c1`. The event wakes the Dispatcher,
   which posts that line to the owner chat, or says nothing when the owner already saw it on the board.
5. A failed Operator writes `op-41 ... failed: <reason in one line>` and the full log path. The Dispatcher offers a retry
   or a fix task. Nothing is lost: an op that has no end event after its time limit becomes a `stalled` event.

Instant calls (under 2 s, which `status` and `inbox` do not meet today, see L190): status, inbox, `op show`, `op start`, reads of a file. Never instant: merge, release, promote, plan,
`task add`, ssh, any `run`. Those are Operator work, with a hard limit on one Dispatcher call of 5 s (a tool policy
refuses a longer one).

Where results show: the owner chat (one line), the board (the op as a card in its project), the Inbox when the owner
must decide. The log lives in a file; no log goes into the Dispatcher's context.

## 4. What stays cheap in tokens

- No polling. A worker or an Operator ends with an event; the Dispatcher wakes on it. No `sleep`, no `tail -f`.
- One summary line per event, at most 200 characters, with a path to the detail. A turn on an event reads that line and
  nothing else.
- The Dispatcher's context stays small: it keeps no logs and no diffs. Reads return summaries (`status` already does).
- Several events inside 2 s are handed over in one turn, not one turn each.
- The Operator is started with a fresh, short context of its own (the command and the id), not a copy of the
  Dispatcher's 100 k. A cheap model is enough: it runs one command.
- Expected: the polling turns (up to 50 M context tokens) go to zero, and the Dispatcher's compactions drop because its
  tool output shrinks.

## 5. Roadmap steps

Merged into the plan already filed: the plan "Dispatcher must always answer" could not be found in
`lineclear status --plan` at the time of writing (it lists LIN-728, LIN-707, OMAT-2, LT-10, LIN-644), so the steps
below are added once, at the end of `docs/ROADMAP.md`, as L190 to L195. If that plan appears and holds the same work,
its planner should fold these in rather than add a second set.

- L190 Reads are instant: `lineclear status` and `lineclear inbox` answer in under 2 s from a cache. Done when a test
  with 20 projects gets both in under 2 s.
- L191 Operations have ids: `lineclear op start <kind> <args>` returns an id in under 1 s and runs the command in a
  detached process; `op show` reads it. Done when a test starts a 10 s command and gets its id in under 1 s, and `op
  show` reads running, then done, with its last line.
- L192 Op events: ops write one line of at most 200 characters to the existing event stream (`src/events.ts`, kept by
  L169 or replaced by its reader) and a task's end does too. Done when a test ends an op and finds one line.
- L193 The Dispatcher wakes on an event: the board sends the Dispatcher an event batch (one turn per 2 s window), so
  `AGENTS.md`'s "no news reaches you" goes. Done when a test ends an op and the Dispatcher's session gets one turn.
- L194 The Dispatcher never waits: the pi extension refuses a Dispatcher bash call that runs past 5 s and names `op
  start`; `lineclear plan` is an op kind. Done when a 6 s command is refused, `op start` accepted, and
  `bun run dispatcher:eval` stays at or above 95 %.
- L195 Reply time is measured: `lineclear dispatcher latency` prints, per owner message, the time from the board
  receiving it (not the session's delivery stamp) to the first reply. Done when it prints a median and p90 for a
  recorded fixture; the live goal (median under 10 s, p90 under 30 s) is checked by the nightly job and written to
  `docs/numbers.md`.

## 6. Not decided here

- Whether the Operator is a pi run or plain code. A plain script with no model is cheapest for merge and release, and a
  model is needed only to read a failure.
- Whether the Dispatcher wakes per event or on a 2 s batch. The batch is the default above.
