# Plan v0.2: agents and machines

How an agent runs, one control plane over 3 machines, one step claim, budgets per agent, and a task end that leaves
nothing behind. This file replaces the open steps L502, L506, L508, L510 (agents) and L580 to L583, L586, L588 to L591,
L593 (machines). In flight and planned around: L503 (agent files), L504 (herdr link), L585 (link socket), L587 (one
ssh), L592 (install.sh). Rank: P1 core loop, P2 simple, P3 tokens, P4 any project, P5 web (see [release.md](../release.md)).

## What is wrong today

- **Remote agents still type into panes.** L509 made a local task agent a `pi --mode rpc` child
  (`server/server/live/agent-rpc.ts`), but `agents-delivery.ts:210` gates it on `!BOX`: on a worker every agent is a TUI
  in a herdr pane, with the typing, screen reads and retries of `docs/audit/agents.md` A1-A11, B1-B8.
- **An RPC child dies with its server.** `rpcEnded` (`agents-delivery.ts:275`) drops the agent; nothing resumes it
  with its `--session-id`.
- **A step can run twice.** Two claims: a git ref on origin (`src/claims.ts`, LIN-1366) and the board's
  `engine/step-once.ts` (L493), next to per-machine task stores (`workers/<label>/tasks.json`) and the `remoteSeen` copy
  (`src/spread.ts:155-202`). 795 tasks were made for 37 steps in one hour through this gap. `SILENT_DROP_MS` holds a
  silent machine's steps 24 h (`spread.ts:34`).
- **Placement ignores memory.** `mostRoom` (`spread.ts:97-104`) scores load; memory is a 1 GiB floor and the room is
  not reserved per start, so 10 starts in a tick see the same room.
- **A task end leaves things behind.** Closing a task does not close its PR (59 duplicate PRs open; only
  `merge.ts:334` calls `closePr`). On thinkpad: 136 stale worktrees (9 GB), 162 local branches, 3,690 pi sessions
  (2.1 GB), `~/.lineclear/workers` 635 MB. On elitebook now: 10 idle `pi` panes older than 3 h hold 584 MB.
- **No budget per agent.** Nothing caps an agent's memory, CPU or tokens. Coordinator input p90 is 12.7 M tokens a session.
- **A worker is a whole second server** per machine (`machines-links.ts:243`, `worker-process.ts`, `kept.ts`), polled
  every 5 s beside its WebSocket, with its own store and tunnel heartbeat (`tunnel.ts`, `sleep 10`).

## Measured: RPC child against a pane

Same pi 1.4.0, model `claude-bridge/claude-haiku-5-5`, thinking off, one prompt "Reply with the single word OK",
3 runs each on elitebook (12 cores, load 5). RSS is every process whose cwd is the run's folder. Script:
`/tmp/le405-scripts/measure.ts` (not in the repo).

| Measure | pi `--mode rpc` child | pi TUI in a herdr pane |
| --- | --- | --- |
| Spawn to ready | 0.8, 1.7, 3.1 s (`get_state` answer) | 3.0 s every run (`herdr agent start` readiness wait) |
| Prompt receipt | 7 to 9 ms, `disposition: started` | none: typed text; `agent prompt --wait` returns the next state |
| Prompt to turn end | 1.7 to 3.1 s (`agent_settled` event) | 1.5 s to `done`; `--until idle` never matched in 120 s (3 of 3) |
| Idle memory | 169 to 173 MB | 204 to 206 MB (pi TUI plus its shell) |
| Peak in the turn | 412 to 416 MB (pi plus the claude bridge, about 240 MB) | not sampled; the same bridge child runs |
| Stop | 17 to 26 ms after stdin closes | tab close |

So: RPC is ready sooner, gives a receipt and a typed end event, and saves 35 MB per idle agent. The bridge child is
more than half of the 420 MB; an agent that is not in a turn should hold neither.

## Target design

**One plane.** The main server is the only store (`store.sqlite`, L540), the only rule loop and the only place that
claims and places. A start is one transaction: insert the claim row (unique per repo and step while a task is live),
pick the machine, insert the task, then do the slow work. A failed start deletes its claim. The git ref claim, the
per-machine stores and `remoteSeen` go.

**Placement.** Each machine's host reports cores, load, `MemAvailable` and running agents. Free agents on a machine =
`min(slots - running, floor((memAvailable - 2 GiB) / 450 MB), floor((cores - load) / 0.5))`; the planner takes the
largest and subtracts one per task placed in the same tick. 45 agents at 450 MB need 20 GiB over 3 machines.

**Agents.** Every task agent is a `pi --mode rpc` child. On the main machine the server spawns it; on another machine
one small agent host (`server/helper/agent-host.ts`, started over one ssh session) spawns the children and carries
their JSONL frames tagged by task, so 45 agents need 3 ssh sessions, not 45 (sshd's `MaxSessions` defaults to 10,
[sshd_config](https://man.openbsd.org/sshd_config#MaxSessions)). Each child runs in a systemd user scope with
`MemoryHigh` and `MemoryMax` ([systemd.resource-control](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)),
so a runaway test kills one agent, not the machine. A child whose task waits (checks, review, merge, owner) exits;
the next prompt starts it again with `--session-id` (1 to 3 s, measured above). A server restart resumes the live
ones the same way. Coordinators and the Dispatcher stay in panes and close after 20 idle minutes. The pi extension
counts the session's tokens against the role's budget: a steer at 100 %, an abort and a card at 150 %.

**Cleanup.** One `release(task)` on every end (merged, closed, retired): stop the child, close an open PR and delete
its remote branch, `git worktree remove`, `git branch -D`, record the token sum on the task row, then delete its pi
session after 7 days. A one-time sweep takes today's leftovers; `lineclear doctor` counts what is left and fails above 0.

## Steps

The first ten (L730 to L739) have `after: none` and disjoint files: they all start at once.

### L730 A step is claimed by one row
Result: A step gets one live task: the second start of the same repo and step is refused by a unique row, from any machine.
- why: P1. 795 tasks for 37 steps in an hour; two claim paths (`src/claims.ts`, `step-once.ts`) and per-machine stores let a step start twice.
- done when: a `claims` table (repo, step unique while live) is in `store.sqlite`; a test races 100 starts of one step from 4 processes and counts exactly 1 task each time; `server/test/step-once.test.ts` cases move to the table.
- locks: step-claim, file-server-server-live-engine-step-once-ts
- after: none
- files: server/server/live/engine/step-once.ts, server/server/live/engine/claims.ts, server/test/step-once.test.ts

### L731 Closing a task closes its PR
Result: A task that ends without a merge leaves no open PR and no remote branch behind.
- why: P1. 59 duplicate PRs stayed open because only `merge.ts:334` calls `closePr`.
- done when: a test retires 3 tasks with open PRs and sees 3 `gh pr close --delete-branch` calls; a merged task's PR is not touched; after one tick on a board with the 59 open duplicates, `gh pr list --state open` lists 0 of them.
- locks: task-release, file-server-server-live-engine-retire-ts
- after: none
- files: server/server/live/engine/retire.ts, server/test/engine-retire.test.ts

### L732 Worktrees by git alone
Result: A task's worktree is made and removed by git alone, also when herdr is down, and a removal error is named.
- why: P2. `worktrees.ts` still asks herdr for spaces and tabs around `git worktree` (audit agents E1-E4, old L506).
- done when: `worktrees.ts` makes 0 herdr calls for an RPC task (a test with a stand-in herdr counts them) and has 0 empty catches; a test ends a task with herdr stopped and `git worktree list` no longer shows it; `server/test/worktrees-lookup.test.ts` loses its herdr space cases.
- locks: worktrees, file-server-server-live-engine-worktrees-ts
- after: none
- files: server/server/live/engine/worktrees.ts, server/test/worktrees-lookup.test.ts

### L733 Agents resume after a restart
Result: After a server restart every live task's agent runs again within 10 s from its own session, and a cut turn gets one "continue".
- why: P1. An RPC child dies with its server and `rpcEnded` drops it (`agents-delivery.ts:275`); old L508 counted on pane exits.
- done when: a test with 5 live RPC agents restarts the server and sees 5 spawns with `--session-id` within 10 s; an agent whose last event was `agent_settled` gets 0 prompts, one cut mid-turn gets 1; 3 failed resumes in an hour stop with a card; `server/test/revive.test.ts` pane cases are deleted.
- locks: revive, file-server-server-live-revive-ts
- after: none
- files: server/server/live/revive.ts, server/server/live/agent-resume.ts, server/test/revive.test.ts

### L734 Place by free CPU and memory
Result: A pure placement picks the machine with the most free agents by slots, CPU and memory, and never overbooks in one tick.
- why: P1. `mostRoom` treats memory as a 1 GiB floor and reads the room once a tick (machines finding 7, old L581).
- done when: `placement.ts` exports `place(machines, n)`; a test with 3 machines of 10, 12 and 25 slots, 8 GiB free on the first and 45 tasks places at most `floor((8 GiB - 2 GiB) / 450 MB)` = 13 on it and passes no machine's slots; ties are stable.
- locks: placement
- after: none
- files: server/server/live/placement.ts, server/test/placement.test.ts

### L735 Each agent has a memory cap
Result: Each RPC agent runs in its own systemd user scope with a memory cap, so a runaway test ends that agent only.
- why: P1. An agent needs about 420 MB and nothing caps it; 45 agents and their test runs can exhaust a machine.
- done when: the spawn argv is `systemd-run --user --scope -p MemoryHigh=450M -p MemoryMax=700M ...` when systemd is there, plain otherwise; a test reads the argv; a test child that allocates 1 GB is killed while a second agent keeps running; `server/test/agent-rpc.test.ts` covers both argv forms.
- locks: agent-rpc, file-server-server-live-agent-rpc-ts
- after: none
- files: server/server/live/agent-scope.ts, server/server/live/agent-rpc.ts, server/test/agent-rpc.test.ts

### L736 A token budget per session
Result: An agent past its role's token budget is told to wrap up, and past 1.5 times it stops with a card instead of spending on.
- why: P3. Coordinator input p90 is 12.7 M tokens a session and agent p90 195 k against a 150 k goal, with no limit.
- done when: `pi/budget.ts` reads `LINECLEAR_TOKEN_BUDGET` and sums new input from `after_provider_response`; a test passes 100 % and sees one steer, passes 150 % and sees one abort and one `lineclear wait` card; with no budget set it does nothing.
- locks: pi-budget, file-pi-extension-ts
- after: none
- files: pi/budget.ts, pi/extension.ts, test/pi-budget.test.ts

### L737 Idle chat panes close
Result: A coordinator pane idle for 20 minutes closes and opens again on the next message with its session.
- why: P2. 10 idle `pi` panes older than 3 h hold 584 MB on one machine today.
- done when: a test with a fake clock closes a pane idle 20 min and keeps one idle 19 min; the next message to a closed chat starts it with its session id; `pgrep -c pi` of idle panes older than 1 h prints 0 on a machine one hour after the merge.
- locks: chat-idle, file-server-server-live-restart-ts
- after: none
- files: server/server/live/chat-idle.ts, server/server/live/restart.ts, server/test/chat-idle.test.ts

### L738 One agent host per machine
Result: A small host program starts pi RPC children on its machine and carries their JSONL frames, tagged by task, over one stdio.
- why: P1. Remote agents still type into panes (`!BOX` at `agents-delivery.ts:210`); one ssh per agent passes sshd's default `MaxSessions` of 10.
- done when: `server/helper/agent-host.ts` takes `spawn`, `send`, `stop` frames on stdin and writes `event`, `exit` and `room` (cores, load, MemAvailable, running) frames; a test spawns 12 stand-in pi children through one host and sees each one's events under its key and 12 exits; it imports only `shared`.
- locks: agent-host, file-server-helper-agent-host-ts
- after: none
- files: server/helper/agent-host.ts, server/test/agent-host.test.ts

### L739 Doctor counts leftovers
Result: `lineclear doctor` prints worktrees, branches, sessions and panes that belong to no live task, and fails while any is left.
- why: P2. 136 stale worktrees, 162 branches and 3,690 sessions were found by hand.
- done when: `src/doctor-leftovers.ts` prints four counts; a test plants one of each and sees 4 lines and a non-zero exit, and a clean fixture prints 0s and exits 0.
- locks: doctor-leftovers, file-src-doctor-ts
- after: none
- files: src/doctor-leftovers.ts, src/doctor.ts, test/doctor-leftovers.test.ts

### L740 Remote agents are RPC
Result: An agent on another machine runs as an RPC child of that machine's host, with no herdr pane and no typed text.
- why: P1. The pane path keeps every patch of audit agents A and B alive for 2 of 3 machines.
- done when: the `!BOX` gate is gone; a task on a stand-in remote machine starts, takes its brief and ends with 0 herdr calls and 1 ssh session for 12 agents; its first event arrives within 3 s of the spawn frame.
- locks: agent-rpc, file-server-server-live-agent-rpc-ts
- after: L735, L738, L587
- files: server/server/live/agent-link.ts, server/server/live/agent-rpc.ts, server/test/agent-link.test.ts

### L741 Prompts go in by RPC
Result: A message to a task agent is one RPC prompt with its receipt; the paste watcher and the delivery timers are gone.
- why: P1, P2. Old L510: eight tuning knobs and a 1.5 s sleep per item exist because the input was a screen.
- done when: `paste-watch.ts` is deleted with its test; `untilReady`, `submitted`, `typeIntoPane` and `deliveryFailed` are gone; a brief of 3 items is in the agent in under 1 s; a test sends while the agent works and sees `queued`.
- locks: agent-delivery, file-server-server-live-agents-delivery-ts, file-server-server-live-agents-state-ts, file-server-server-live-agents-sending-ts
- after: L503, L740
- files: server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/agents-sending.ts, server/server/live/paste-watch.ts

### L742 A start is one spawn
Result: A task agent's start is one spawn that answers or exits; no loop, no start timers, no log scan, no perl route binder.
- why: P1, P2. Old L502: an 8-try loop, a 750 ms sleep, three start timers and five log-scan timers.
- done when: `launch` has 0 loops and 0 `setTimeout`; `follow`, `discoverLog` and `repairRoutes` are gone and the session file comes from `get_state`; a start of 45 tasks in a test makes 0 herdr snapshots and 0 perl processes.
- locks: agent-delivery, file-server-server-live-agents-delivery-ts, file-server-server-live-agents-state-ts, file-server-server-live-readers
- after: L741
- files: server/server/live/agents-delivery.ts, server/server/live/agents-state.ts, server/server/live/readers/find.ts

### L743 Waiting agents leave memory
Result: An agent whose task waits for checks, review, merge or the owner exits after 2 minutes and comes back on the next prompt.
- why: P1. A resident agent holds about 420 MB; 45 resident agents need 19 GB while many only wait.
- done when: a test with a fake clock stops a settled waiting agent at 2 min and keeps a working one; the next prompt spawns it with `--session-id` and the prompt's receipt arrives; in a 45-task test with 20 waiting, at most 25 pi processes run.
- locks: agent-delivery, file-server-server-live-agents-delivery-ts
- after: L742, L733
- files: server/server/live/agent-idle.ts, server/server/live/agents-delivery.ts, server/test/agent-idle.test.ts

### L744 The room comes from the host
Result: A machine's cores, load and free memory come from its host's `room` frames, not from an ssh read per tick.
- why: P2. L505 still runs one ssh read per machine per tick; the host already runs there.
- done when: `room()` in `herdr-forward.ts` is deleted with its tests; a test with 3 stand-in hosts reads their room with 0 process starts per tick; a host that stops sending for 30 s marks its machine unreachable.
- locks: agent-host, file-server-helper-agent-host-ts, file-server-server-live-herdr-forward-ts
- after: L738
- files: server/helper/agent-host.ts, server/server/live/herdr-forward.ts, server/server/live/machine-room.ts

### L745 Claim and place in one call
Result: The server claims a step, picks its machine and adds its task in one transaction, before any slow work starts.
- why: P1. `startOn` sends secrets, clones and adds a task with no claim first (machines finding 8).
- done when: `POST /api/start-step` runs claim, `place` and the task insert in one `tx()`; a failed start deletes its claim (a test fails the clone and sees the step startable again); 10 starts in one call never overbook a machine.
- locks: step-claim, file-server-server-live-engine-step-once-ts, file-server-server-live-source-task-words-ts
- after: L730, L734
- files: server/server/live/engine/step-once.ts, server/server/live/source-task-words.ts, server/test/start-step.test.ts

### L746 The loop starts by the plane
Result: The rule loop starts a step with one call to the main server; the git ref claim and the copy of other machines' tasks are gone.
- why: P2. Three ways to know a task and two claims (`src/claims.ts`, `remoteSeen`, per-machine stores).
- done when: `src/claims.ts` and `test/claims.test.ts` are deleted; `grep -rn "remoteSeen\|machineReads\|serverJson\|SILENT_DROP_MS" src server` prints 0; a tick with 5 ready steps and 3 machines makes 1 HTTP call per start and 0 `spawnSync`.
- locks: spread, file-src-spread-ts
- after: L745, L587
- files: src/spread.ts, src/claims.ts, test/claims.test.ts, test/spread.test.ts

### L747 Claims end by lease
Result: A claim on a machine that went silent ends 30 s after its host's link closes, not after 24 hours.
- why: P1. A crashed machine holds its steps for a day; a slow one loses them mid-run.
- done when: a test closes a host's link and sees its claims released within 30 s and the steps startable on another machine; a host that comes back within 30 s keeps them.
- locks: step-claim, file-server-server-live-engine-claims-ts
- after: L745, L744
- files: server/server/live/engine/claims.ts, server/test/claims-lease.test.ts

### L748 No worker server per machine
Result: The main server talks to each machine's host directly; the second server per machine, its store and `last.json` are gone.
- why: P2. Each worker is a full Bun server with its own store and polls (old L586, L588); `~/.lineclear/workers` is 635 MB.
- done when: `worker-process.ts` and `kept.ts` are deleted with `server/test/machines-one-store.test.ts` worker cases; `pgrep -fc server/main.ts` prints 1 on the main machine with 3 machines linked; `~/.lineclear/workers` is removed by the update.
- locks: machine-link, file-server-server-live-machines-links-ts, file-server-server-main-ts
- after: L740, L744, L746, L585
- files: server/server/live/machines-links.ts, server/server/live/worker-process.ts, server/server/live/kept.ts, server/server/main.ts

### L749 The host carries the agents' CLI
Result: An agent's `lineclear` on another machine reaches the main server through its host, so the tunnel and its heartbeat go.
- why: P2. `tunnel.ts` runs `sleep 10` on every machine to keep a forward alive (old L589).
- done when: `tunnel.ts` is deleted with its tests; a test kills the host link and the agents' `lineclear` on a stand-in machine works again within 5 s of the reconnect.
- locks: agent-host, file-server-helper-agent-host-ts, file-server-helper-lineclear
- after: L748, L744
- files: server/helper/agent-host.ts, server/helper/lineclear, server/server/live/tunnel.ts

### L750 A task end leaves nothing
Result: Every task end stops its agent, removes its worktree and branch, keeps its token sum, and deletes its session after 7 days.
- why: P1, P2. 136 stale worktrees (9 GB), 162 branches and 3,690 sessions (2.1 GB) on one machine.
- done when: a test ends tasks as merged, closed and failed and sees for each: 0 live child, 0 worktree, 0 local branch, a token sum on the row; a session of a task ended 8 days ago is deleted and one of 6 days kept; `lineclear doctor` (L739) prints 0s after one sweep on a fixture of today's leftovers.
- locks: task-release, file-server-server-live-engine-retire-ts
- after: L731, L732, L739
- files: server/server/live/engine/retire.ts, server/server/live/engine/sweep.ts, server/test/engine-sweep.test.ts

### L751 Budgets are set per role
Result: Each role's token budget and memory cap are settings with measured defaults, passed to the agent at spawn.
- why: P3. L735 and L736 enforce numbers; the owner sets them in one place.
- done when: settings hold `budget.tokens` and `budget.memory` per role (agent 150 k, reviewer 80 k, coordinator 1 M); a test starts an agent and sees `LINECLEAR_TOKEN_BUDGET` and the scope's `MemoryMax` from the setting.
- locks: settings, file-server-server-live-settings-store-ts, file-server-server-live-agent-start-ts
- after: L735, L736, L742
- files: server/server/live/settings-types.ts, server/server/live/settings-store.ts, server/server/live/agent-start.ts

### L752 Any repo gets an agent
Result: A small repo with no package.json and no Lineclear setup gets a worktree, an RPC agent and a merge, like this repo.
- why: P4. The start links a `node_modules` store and assumes Bun tools; another project must get the same flow.
- done when: a test adds a 3-file repo with a shell check command, starts one step and sees worktree, brief, ready and merge with 0 errors; `storePath` runs only when a lock file exists.
- locks: any-repo, file-server-server-live-engine-git-ts
- after: L732
- files: server/server/live/engine/git.ts, server/test/any-repo-start.test.ts

### L753 The helper goes in atomically
Result: The helper and its host are unpacked into a version folder and switched by one symlink; the probe returns JSON.
- why: P1. `rm -rf bin skill; tar xf` leaves a window with no `lineclear` for a starting agent (old L590).
- done when: a test runs 50 `lineclear` calls during an update and sees 0 failures; `grep -c "match(" server/server/live/install.ts` prints 0.
- locks: helper-install, file-server-server-live-install-ts
- after: L587
- files: server/server/live/install.ts, server/test/install-helper.test.ts

### L754 Updates drain a machine
Result: A machine's host is updated only when it runs no working task, one machine at a time, and a failed list keeps every link.
- why: P1. Every machine updates in the same minute on the 15 s sync (old L591).
- done when: a test with 3 machines, one busy, updates the busy one last and never two at once; a failed `herdr machine list` keeps every link.
- locks: machine-update, file-server-server-live-machines-ts, file-server-server-live-install-ts
- after: L753, L748
- files: server/server/live/machines.ts, server/server/live/install.ts, server/test/machine-update.test.ts

### L755 Machine actions are kept
Result: An action for a machine out of reach is stored with an id and delivered once when its host is back.
- why: P1. `forward().catch(() => waiting.push(a))` retries in memory and loses the list on a restart (old L593).
- done when: a test queues 3 actions while a host is down, restarts the server, and sees each delivered exactly once; `grep -c "catch {" server/server/live/link-poll.ts` prints 0.
- locks: machine-actions, file-server-server-live-link-poll-ts, file-server-server-live-machines-actions-ts
- after: L748
- files: server/server/live/link-poll.ts, server/server/live/machines-actions.ts, server/test/machine-actions.test.ts

### L756 Settings show each machine
Result: Settings shows each machine's free agents, memory and running agents in the graphite theme, with every state designed.
- why: P5. The owner sees where 45 agents run and why a machine takes none.
- done when: the Machines section shows the `place` numbers for each machine; screenshots at 1440 and 390 px for empty, loading, error, 3 machines and an unreachable one use only `tokens.css` colours (red only for unreachable).
- locks: settings-machines, file-ui-web-settings-tsx
- after: L744
- files: ui/web/settings.tsx, ui/web/settings-machines.tsx, ui/test/settings-machines.spec.ts

### L757 45 agents on 3 machines
Result: A test runs 45 steps on 3 stand-in machines to the end: each claimed once, placed within memory, and nothing left after.
- why: P1. The proof of v0.2 for this part: nothing stalls, nothing runs twice, nothing stays behind.
- done when: with machines of 10, 12 and 25 slots and 45 ready steps, 45 tasks start within 5 simulated minutes, 0 steps have 2 tasks, no machine passes its slots or memory, and after all end there are 0 children, 0 worktrees, 0 branches and 0 claims.
- locks: e2e-machines
- after: L743, L747, L748, L750
- files: server/test/plane-45.test.ts
