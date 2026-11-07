# Plan v0.2: agents and machines

How an agent runs, one control plane over 3 machines, one step claim, budgets per agent, and a task end that leaves
nothing behind. This file replaces the open steps L502, L506, L508, L510 (agents) and L580 to L583, L586, L588 to L591,
L593 (machines). In flight and planned around: L503 (agent files), L504 (herdr link), L585 (link socket), L587 (one
ssh), L592 (install.sh). L503 is already running, so its `after: L502` ends when the lead removes L502. Ids end at
L757; L758 and L759 are free. Rank: P1 core loop, P2 simple, P3 tokens, P4 any project, P5 web (see [release.md](../release.md)).

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

Each step is in [ROADMAP.md](../ROADMAP.md), or dropped with the step that does its job.

- L730 A step is claimed by one row: dropped, L583 does it (ROADMAP.md).
- L731 Closing a task closes its PR: dropped, L793 does it (ROADMAP.md).
- L732 Worktrees by git alone: dropped, L506 did it (merged).
- L733 Agents resume after a restart: in ROADMAP.md.
- L734 Place by free CPU and memory: dropped, L581 does it (ROADMAP.md).
- L735 Each agent has a memory cap: in ROADMAP.md.
- L736 A token budget per session: dropped, L798 does it (ROADMAP.md).

- L737 Idle chat panes close: in ROADMAP.md.
- L738 One agent host per machine: in ROADMAP.md.
- L739 Doctor counts leftovers: in ROADMAP.md.
- L740 Remote agents are RPC: in ROADMAP.md.
- L741 Prompts go in by RPC: dropped, L510 did it (merged in #409).
- L742 A start is one spawn: dropped, L502 does it (ROADMAP.md).
- L743 Waiting agents leave memory: dropped, L797 does it (ROADMAP.md).
- L744 The room comes from the host: dropped, L580 did it (merged).
- L745 Claim and place in one call: dropped, L583 does it (ROADMAP.md).

- L746 The loop starts by the plane: in ROADMAP.md.
- L747 Claims end by lease: dropped, L583 does it (ROADMAP.md).
- L748 No worker server per machine: dropped, L586 does it (ROADMAP.md).
- L749 The host carries the agents' CLI: dropped, L589 does it (ROADMAP.md).
- L750 A task end leaves nothing: in ROADMAP.md; the session sweep is L805's.

- L751 Budgets are set per role: in ROADMAP.md, after L798 and L502 in place of L736 and L742.
- L752 Any repo gets an agent: in ROADMAP.md, on `engine/install.ts` where `storePath` is, with no `after` (L506, which replaced L732, is merged).

- L753 The helper goes in atomically: dropped, L590 did it (merged).
- L754 Updates drain a machine: dropped, L591 does it (ROADMAP.md).
- L755 Machine actions are kept: dropped, L593 does it (ROADMAP.md).

- L756 Settings show each machine: dropped, W123 of the web plan shows each machine on Home, and W116 keeps machine findings out of Settings.

- L757 45 agents on 3 machines: in ROADMAP.md.
