# Audit: machines, one plane

Area: running on several machines (`server/server/live/machines*.ts`, `box.ts`, `tunnel.ts`, `install.ts`, `link-poll.ts`,
`recovery.ts`, `worker-process.ts`, `herdr-forward.ts` room read, `server/server/push.ts`, `src/spread.ts`, `src/ssh.ts`,
`install.sh`, the settings store in `src/project.ts`). Read-only: no code changed. Line numbers are of `main` at b84c7f4.

How it works today: the main machine runs the one server. For each machine saved in herdr it starts a **worker**, a second
server process (`machines-links.ts:243`) with its own `LINECLEAR_HOME` (`workers/<label>/`, own `tasks.json`) that reaches the
machine over SSH. So there is one store per machine plus the main one, and `src/spread.ts` glues them with `remoteSeen`
copies in each project's `state.json`. That is the cause behind "each machine has its own board", not a bug in one line.

What I did not check: herdr's and pi's event APIs beyond the herdr skill text (`agent wait`, `pane wait-output`, `agent
prompt --wait`) and the repo; the replacements below say "verify the call" where a step needs one. Context7 was not
queried for these two tools in this pass. Numbers are from the code (calls per tick), not from a measurement.

## Findings

Format: `file:line`, what it does, why it is a patch or does not scale, the replacement.

### A. The room read (placement by free CPU and memory)

1. `server/server/live/herdr-forward.ts:114-153` `room(machine)`: opens a herdr tab on the machine, types a shell line
   into it, presses Enter, polls `pane.read` up to 25 times with `Bun.sleep(200)` and matches `^ROOM ...$` with a regex on
   the pane text, then closes the tab. Per read: 1 `workspace.list` + `tab.create` + `send_text` + `send_keys` + up to 25
   `pane.read` + `pane.close` = up to 29 RPCs and up to 5 s, and it flashes a tab in the user's herdr. A regex on terminal
   output, a poll where a result exists. Replacement: the worker already runs on the machine's side of SSH
   (`box.ts run`): one `run(['cat','/proc/loadavg'...])` or, better, the worker reports `os.loadavg()`, `os.freemem()` and
   `availableParallelism()` itself in its snapshot (it is a Bun process with those APIs). No tab, no regex.
2. `herdr-forward.ts:116` `ROOM_LINE` awk/cut of `/proc`: Linux only (macOS machines return undefined, so `roomLack` says
   "cannot read its slots" and the machine takes no task, `spread.ts:108`). Replacement: same as 1, Node APIs work on both.
3. `herdr-forward.ts:125,151` two `catch { return undefined }`: a failed read looks like "no data", and the caller
   cannot tell an unreachable machine from a macOS one. Replacement: the worker's snapshot carries the numbers or the link
   state already says unreachable (`Link.state`).
4. `src/spread.ts:125-134` `serverJson` uses `Bun.spawnSync` (timeout 40 s) to start a whole CLI (`lineclear room <host>`),
   and `spread.ts:137-141` `readRoom` does it twice per machine (`room`, then `task list --space --json`). Per tick: 2
   blocking process starts per machine per project; with 3 machines and 4 projects = 24 blocks of up to 40 s each on the
   rule loop's thread, each parsing the full task list (45+ tasks) just to filter `t.machine === host`. Replacement: the
   rule loop asks the one server once per tick through its HTTP API (`/api/snapshot` already holds every machine's room
   and tasks), async, one request for all machines.
5. `spread.ts:155-202` `remoteSeen` / `machineReads` / `remoteMemory` / `silentMachines` / `SILENT_DROP_MS`: a second copy of
   each machine's tasks, written into every project's `state.json` each tick (`askMachines` assigns `seen[host] = r.tasks`
   whole). At 45 tasks of about 1 KB each, 45 KB rewritten per project per tick, and read back with `readFileSync` +
   `JSON.parse` per view (`spread.ts:166`, `180`). It exists only because tasks live in per-machine stores. A second way
   to know a task. Replacement: one task store (finding 11); delete the copy.
6. `spread.ts:166-170`, `180-185` two `catch` blocks (one returns "none", one says "no state yet"): a corrupt
   `state.json` is read as "no machine was ever silent", hiding the cause. Replacement: gone with 5.
7. `spread.ts:97-104` `mostRoom` scores `load / loadLimit` with a 0.05 tolerance, then `free` slots; memory enters only as a
   floor of 1 GiB (`MIN_FREE_KB`, `spread.ts:17`). It does not place by free memory or CPU in the sense of the goal: 45
   agents on a 25-slot machine with 3 GiB free pass the floor and then run out of memory. Also the numbers are read at the
   start of the tick and not reserved, so 10 starts in one tick all see the same free room (see 8). Replacement: a
   placement function over `{freeCpu, freeMemKb, slots}` that subtracts a per-agent estimate for each task placed in the
   same tick.

### B. Claims: a step done twice (L455, L443)

8. `spread.ts:232-254` `startOn`: sends secrets (SSH), clones (SSH), then adds the task by spawning the CLI
   (`task add --on`), three blocking calls, up to 5 + 5 + 1 min, with no claim taken before them. Two rule loops (two
   machines each running their own board, or the main loop and a worker's loop) that see the same ready step both reach
   `task add`. The check "step already has a task" runs on a store that the other board does not share (`remoteSeen`
   is up to one tick old, and stale for a day when a machine is silent, `SILENT_DROP_MS`, `spread.ts:34`). That is the
   mechanism of the double runs. Replacement: one store, and the claim is a single write in it: `claimStep(stepId, taskId)`
   that fails when a live task already holds the step (SQLite `INSERT ... ON CONFLICT DO NOTHING` on a unique
   `step_id WHERE status != 'done'`, or a compare-and-set in the one server process). Placement and claim happen in the
   same server call, and only then does the SSH work begin.
9. `spread.ts:57-58`, `64-66`, `71` a silent machine's open tasks still hold their locks for 24 h and then are dropped
   (`SILENT_DROP_MS`): a timer standing in for a lease. A machine that crashed holds steps for a day; one that is just slow
   releases them on the 24th hour mid-run, and a second agent starts. Replacement: a lease on the claim (the owning
   worker renews it over its open WebSocket; the claim is released when the socket closes plus a short grace), no day-long
   timer.

### C. One store per machine, and the stores written whole

10. `store.ts:31-37` `writeJson`: whole-file JSON, tmp name is the fixed `${f}.tmp`. Two processes writing the same name at
    once (main and a worker both use `LINECLEAR_SHARED_HOME`, `machines-links.ts:251`) can write into one tmp file and
    rename a torn result. Also no `fsync`: a power cut can leave the rename without the data. Replacement: one writer
    per file (the one server), or SQLite with WAL, which Bun has built in (`bun:sqlite`), for tasks, settings and push.
11. `machines-links.ts:243-257` and `machines-helpers.ts:170` each worker has its own `tasks.json` in `workers/<label>/`:
    a board per machine. Tasks cannot move, a step cannot be seen by the other boards, and every list is fanned out (see 4).
    Replacement: workers become thin executors (start a process, run a command, stream herdr events) with no task store;
    the main server owns the tasks, and every task has a `machine` field (it already does: `spread.ts:146`).
12. `src/project.ts:84-90` `readStored` swallows every error and returns `{}`; `project.ts:93-107` `writeSetup` writes the
    whole file; `readSetup` migrates on read (writes in a getter) and `saveSetup` is read-modify-write. A truncated or
    half-migrated `settings.json` reads as "no models chosen" and the next `saveSetup` writes that empty result over the real
    file, which is how a migration can drop the model lists with nothing in a log. Run on two machines (each with its own
    `LINECLEAR_HOME`) the damage is per machine and unseen. Replacement: a parse error is an error that stops (and names
    the file); the migration is a versioned step run once at startup, written to a temp file in the same folder, `fsync`ed
    and renamed, with the old file kept as `settings.json.<version>.bak`; settings live on the one plane only.
13. `server/server/push.ts:30`, `:49`, `:69`, `:103` `catch {}` in `pushContact` and `writeJson('push.json', ...)` whole file
    on every subscribe and on every dead endpoint; `attempts` / `failures` maps keep retry bookkeeping. Small (about 0.5
    KB per device) but it is a store written whole by the server and read at start by every worker that builds a `Push`.
    Replacement: workers never build `Push` (they send alerts to the main server); push subscriptions go in the one store.
14. `machines-links.ts:84-103` `keep` / `keepTimers`: each link writes `machines/<label>/last.json` (saved, probe, and every
    watched chat, whole) 5 s after any change via `setTimeout`, and `catch {}` on a full disk. At 45 agents each with
    one chat in `watching.chats`, that is the whole chat set (hundreds of KB) rewritten every 5 s per active machine. A
    timer plus a swallowed catch plus a copy of data the worker already holds. Replacement: the worker is the source (it
    restarts with its own state); on a restart the main server reads the worker's snapshot once. Delete `last.json`,
    `kept.ts` and `pendingResume`.
15. `kept.ts:20-47` migration code that moves folders and rewrites `last.json` on every start; same removal as 14.

### D. Polls and timers on the link

16. `machines.ts:28` `setInterval(pollAll, 5000)` and `link-poll.ts:71` `fetch(/api/snapshot)` with a 4 s timeout: the
    full snapshot of the machine, every 5 s, per machine, while a WebSocket to the same worker is open (`link-poll.ts:156`
    `connect`). 12 full snapshots per minute per machine; the snapshot grows with agents (about 45 chats). The
    WebSocket already delivers changes. Replacement: one WebSocket per worker; liveness is the socket (ping frames, the
    `close` event); fetch the snapshot once at connect.
17. `machines.ts:26` `setInterval(sync, 15_000)` and `install.ts:22-35` `herdrJson`: two herdr CLI process starts (`machine
    list --json`, `machine status --json`) every 15 s = 8 process starts per minute for a list that changes when a human
    adds a machine. `catch { return fallback }` makes a herdr failure look like "no machines", and `sync()` then kills
    every worker (`machines-links.ts:149-160` removes links not in the list). Replacement: read the list once at start and on
    herdr's event for machine changes (verify: herdr's socket API subscription; else on a user action in Settings →
    Machines); never treat a failed read as an empty list.
18. `machines-links.ts:256-265` `setInterval(look, 300)` for up to 60 s, waiting for the worker to write `server.json`
    with its port: a poll on a file where the child can report. Up to 200 file reads per start. Replacement: the worker
    prints its address on stdout (a pipe the parent already can own), or listens on a fixed unix socket per label; the
    parent awaits one line.
19. `machines-links.ts:75-79` `setTimeout(CONNECTING_FOR 60 s)` per link to clear "connecting": a timer that decides a
    state. Replacement: `connecting` ends on the first answer or the first failure of the WebSocket connect, both events.
20. `machines-links.ts:55` `Bun.sleep(MERGE_DEADLINE + 30_000)` raced against `w.exited`, and `link-poll.ts:125-127` a
    second `setTimeout` to `SIGKILL`: two escalation timers around a graceful stop. Replacement: one `stop(worker, deadline)`
    in `worker-process.ts` (SIGTERM, wait `exited`, SIGKILL at the deadline) used by both.
21. `worker-process.ts:91-99` `running()` makes `exited` by `setInterval(kill(pid, 0), 2000)` per adopted worker, which is a
    poll for process exit and never stops if the pid is reused by another process. Replacement: the parent should own the
    child (`Bun.spawn`, `exited` promise) and workers should not outlive it by design; if they must (to survive a restart),
    hold the worker with a pidfd/`flock` on a file the worker keeps (the lock releases when it dies), and await it with
    one blocking `flock` in a short-lived child.
22. `worker-process.ts:73-80` `commandOf` falls back to `Bun.spawnSync(['ps'...])` and `includes('server/main.ts')` is a
    string match on another tool's output; `catch` hides it. Replacement: the worker record includes a random token
    (`server.json`) the worker also exposes at `/api/id`; adopt a worker only when the token matches.
23. `recovery.ts:1-44` `LinkBackoff` and `WorkerHealth`: two hand-made backoff / restart state machines (3 s doubling to 30
    s; 180 s down then restart, cooldown doubling to 15 min). They hide that the link breaks. A restart after 3 minutes of
    a dead link is a patch for "the worker's herdr connection died and does not come back". Replacement: fix why the
    worker's herdr link does not reconnect (an event-driven reconnect in the worker with one backoff helper), and delete
    `WorkerHealth`. One backoff helper used by `Tunnel` and the worker.
24. `link-poll.ts:94` `forward(...).catch(() => l.waiting.push(a))` re-queues a failed action forever, in memory, in a
    loop: an action that can never succeed is retried at every reconnect. And actions waiting are lost when the main server
    restarts. Replacement: actions to a machine are written to the one store with an id and delivered at least once with an
    idempotency key; a failed one is shown, not retried silently.
25. `link-poll.ts:97`, `machines-links.ts:93`, `:200` empty `catch` ("the next restart or the doctor looks again"): a failure
    waits for a human to run the doctor. Replacement: record the error on the link (`Link.state`) and show it.

### E. SSH and process starts

26. `box.ts:192-210` `runSync` uses `Bun.spawnSync` with a 30 s default timeout over SSH. Each call blocks the whole
    server thread for the SSH round trip (50-300 ms on a LAN, up to 30 s unreachable). Used for "the few reads code expects
    at once": any caller in a loop (45 tasks × 1 read = 45 × 100 ms = 4.5 s frozen, the same freeze delays every
    WebSocket frame). Replacement: delete `runSync`; callers become async (`run`) or read through the snapshot.
27. `box.ts:130-157` `shared` / `writes` / `GIT_READ_SHARE_MS = 2000`: a 2 s cache of git reads keyed by argv, invalidated
    by a write counter. It exists because each read is a fresh SSH exec of `git`. The cache hides that the tick asks the
    same question many times. Replacement: the worker keeps a long-lived process on the machine (it already is one) and
    answers git reads from a watch (`git` fs events or the push event), or the tick reads once into a snapshot.
28. `box.ts:77-80` `ConnectTimeout=10`, `ServerAliveCountMax=4`, `ControlPersist=600`: fine, but every `run` is a new
    `ssh ... /bin/sh -c` with a shell-quoted script (`q`, `script()`). Quoting by hand is a second way to run a command and
    the reason for `box.ts:62` / `install.ts:61`'s sed/awk/printf. Replacement: the worker on the machine side. The only
    SSH use left is "put the worker there and keep one tunnel" (see 33).
29. `box.ts:292-294` `tellRunBy` fires `Bun.spawn(ssh ...)` with output ignored and no await on every `look()` (every
    probe) to write a file `run-by` with a shell `printf`; the result is never checked. Used only for the text in
    `noTasks()` (`box.ts:286`). Replacement: delete; the machine has no task list of its own (11), so `lineclear task list`
    there asks the main server like any client.
30. `install.ts:38-44` `onMachine` (a third place that spawns ssh, beside `box.ts runNow` and `spread.ts runScript`) with a
    `setTimeout` kill. `src/ssh.ts:5-8` is a fourth `sshArgs` (different options: no ControlMaster, no
    ServerAlive) and `box.ts:66` a fifth shape. Three `quote`/`q` copies: `box.ts:61`, `ssh.ts:6`,
    `install.sh`. Replacement: one `ssh.ts` with one argv builder and one `quote`, used by all.
31. `install.ts:57-96` `PROBE` shell script plus a regex over its `key=value` output and a nested `sed` over a login shell's
    PATH (`install.ts:61`): output scraping of a login shell. Replacement: `ssh target 'cat'` the worker bundle and run
    it; the bundle (Bun) reports `process.env.PATH`, `os.homedir()`, `Bun.which(tool)` as JSON.
32. `install.ts:141-173` `tarOf` hand-writes ustar headers; `install.ts:175-190` `installHelper` does `rm -rf $d/skill
    $d/bin; tar xf -` (not atomic: an agent starting during the 100-300 ms between sees no `lineclear`). Replacement: extract to
    `helper.<version>/`, then `ln -sfn` (atomic, same as `builds/current` in `install.sh`); use system `tar` on a real
    directory instead of hand headers, or `git archive`.
33. `tunnel.ts:21-43` `open` loop: `catch {}` plus `setTimeout(recovery.fail())`; `tunnel.ts:60-66` first `ssh rm -f sock`
    (20 s timeout), then an SSH session that runs `while [ -S sock ] && printf .; do sleep 10; done` on the machine:
    a shell poll every 10 s on every machine, kept alive as a heartbeat, and a `sudo -n chown` workaround for one provider.
    The forward is the patch for "agents call back into a server by a socket"; the agents' `lineclear` needs the plane
    only for its own task. Replacement: reverse the direction: the worker on the machine connects out to the main server
    (one WebSocket over an SSH `-L` or a plain HTTPS/WireGuard address); agents on the machine talk to the local
    worker over a unix socket it owns; no `rm -f`, no `sleep 10`, no chown.
34. `machines-links.ts:263` `Bun.spawn(process.execPath, main.ts)` of a full Bun server per machine, each with its own
    herdr client, snapshot builder, tick, and `Push`: about one extra server process per machine on the main machine (3
    machines = 3 more processes, each holding its own caches).
    only by `codeVersion()` hashing the repo's files (`worker-process.ts:57-71`: walks `server/` and `shared/` and reads every
    file, sync, at start). Replacement: the worker is a small agent-host (executor) built
    from a release directory with a version string; compare that string, not a hash of all files.

### F. Update path

35. `install.sh:302` `sleep 1` then `is-active`; `install.sh:340` `curl -m 3` health; `:447` "checking the new version (up to 2
    minutes)" loop: polls for the service to come up. Replacement: `systemd` `Type=notify` (the server sends
    `READY=1` when listening) and `systemctl restart` already blocks until ready; or one `curl --retry-connrefused`
    where the service lacks it. No sleeps.
36. `install.sh:179-190`, `:414-454` two rollback paths (`rollback_release`, `rollback`) selected by `is_release`
    (`:442`): a second way to do one job (a git checkout vs a `builds/current` symlink). Releases are the one path in the
    goal ("no `.git` in the build"). Replacement: delete the git path; the update is `builds/<version>` + atomic symlink
    + service restart, rollback is the previous symlink.
37. `install.sh:312-338` saving and putting back each project's Running/Paused settings around an update, and `:354-399`
    copying the whole task store (`cp`) before every update, keeping 10 (`tail -n +11`), with a rollback that restores it.
    These exist because an update can lose tasks and settings. Cost: the whole store copied per update on every machine;
    at 45 tasks small, but the copies are the only defence against finding 10 and 12. Replacement: make the migration
    versioned and atomic (12), keep `store-copies` as a single backup of the last version only, and test the migration
    in CI against a fixture of the previous store.
38. The update of other machines: nothing in `install.sh` updates a worker machine. It is `helperVersion()` mismatch on
    the next `look()` (`machines-links.ts:218`), i.e. whenever `sync()` or `start()` runs, and `refresh()` after a
    restart (`:49`). A machine with a different code version runs old code until the next 15 s sync finds `p.helper !==
    helperVersion()`, then `installHelper` (32) and a worker restart: all machines update in the same minute with no
    order and no check that none is mid-merge except for `MERGE_DEADLINE`. Replacement: the main server decides
    a version for the plane; each worker reports its version in the WebSocket hello; the server updates a worker only
    when it has no working task on it (drain), one machine at a time.
39. `install.sh:94-108` `curl | sh` of three installers (bun, herdr, pi) with `quiet sh -c`, output dropped, failure text
    fixed. Not scalable but it is an install, not a loop; keep, and pin versions (`BUN_VERSION`) so three machines
    do not get three versions.

## One plane

Question: one control plane that places tasks by free CPU and memory, with atomic step claims? Yes, and most of this area
is code that exists only because there is not one. Shape:

- **Main server**: the only store (SQLite in WAL: `tasks`, `claims`, `settings`, `push`), the only rule loop, the only
  placement and the only claim.
- **Claim**: `claims(step_id PRIMARY KEY, task_id, machine, lease_until)`. A start is: place (A7), `INSERT` the claim in one
  transaction, then do the SSH or worker work. A failed start deletes its claim. Two loops cannot both insert.
- **Worker per machine**: an executor with no store. It starts and stops agent processes, runs commands, reports
  `os.loadavg()`, `os.freemem()`, cores, running agent count and its version in one WebSocket, and renews leases. It has no
  rule loop, no `tasks.json`, no `Push`.
- **Placement**: `free = min(slots - running, floor((freeMem - reserve) / perAgentMem), floor((cores - load) / perAgentCpu))`;
  place on the largest `free`, subtract one per task placed in the tick.

## Steps

Ids L580 to L599. Locks are disjoint. Steps with `after: none` can run together; L585 and L586 wait for the store.

### L580 Machine room from the worker
Result: A machine's load, free memory and cores come from its worker's snapshot, with no herdr tab, no regex and no spawned CLI.
- why: `room()` costs up to 29 herdr calls and 5 s per machine per tick and flashes a tab; `readRoom` blocks the loop with 2 process starts of up to 40 s per machine per project (findings 1-4).
- done when: a test with 3 fake workers asserts a tick makes 0 `tab.create` calls and 0 `Bun.spawnSync` calls for the room, and `grep -c "ROOM" server/server/live/herdr-forward.ts` prints 0; the room of a macOS fake machine is read.
- locks: machine-room
- after: none
- files: server/server/live/herdr-forward.ts, src/spread.ts, src/real-world.ts, src/tick-project.ts

### L581 Place by CPU and memory
Result: A task goes to the machine with the most free slots, CPU and memory, and ten starts in one tick never overbook a machine.
- why: placement checks memory only as a 1 GiB floor and reads the room once per tick, so 10 starts see the same room (findings 7).
- done when: a test with machines of 10, 12 and 25 slots, 8 GiB free on the first, and 45 ready steps starts at most `floor((free - reserve) / per-agent)` on each; no machine passes its slots or memory in the test; `mostRoom` has 0 callers that do not subtract placed tasks.
- locks: placement
- after: L580
- files: src/spread.ts, src/tick-project.ts, src/rules.ts

### L582 One task store
Result: Tasks, settings and push subscriptions live in one SQLite store owned by the main server, with no per-machine `tasks.json` and no `remoteSeen` copy.
- why: 18 stores are written whole and 3 boards cause double steps; `remoteSeen` rewrites about 45 KB per project per tick and `writeJson` shares a fixed tmp name between processes (findings 5, 10, 11, 13).
- done when: `grep -rn "remoteSeen\|machineReads" src server | wc -l` prints 0; a test writes 1000 tasks from 4 concurrent callers and reads 1000 intact; `workers/*/tasks.json` is no longer created.
- locks: task-store
- after: none
- files: server/server/store.ts, server/server/push.ts, src/spread.ts, server/server/live/machines-helpers.ts

### L583 Atomic step claims
Result: A step is claimed by one insert, so two loops starting the same step get one task and one refusal, and a silent machine's claim ends by lease, not after 24 hours.
- why: `startOn` sends secrets, clones and adds a task with no claim taken first; L455 and L443 ran twice; `SILENT_DROP_MS` holds a dead machine's locks 24 h (findings 8, 9).
- done when: a test starts one step from 2 racing loops 100 times and sees 100 times exactly 1 task; a claim whose worker closed its socket is released within 30 s in a test.
- locks: step-claim
- after: L582
- files: src/spread.ts, src/starts.ts, src/task-steps.ts, src/real-world.ts

### L584 Settings never lose a model
Result: A bad or old `settings.json` stops with a message naming the file, and a migration is versioned, written atomically and keeps a backup.
- why: `readStored` returns `{}` on any error and the next `saveSetup` writes that over the file, so a migration dropped the model lists on two machines unseen (finding 12).
- done when: a test with a truncated `settings.json` sees an error naming the file and the file unchanged; a test migrating a v1 file to v2 keeps every role's model list and leaves `settings.json.v1.bak`; `lineclear doctor` prints the settings version of each machine.
- locks: settings-store
- after: none
- files: src/project.ts, src/doctor.ts

### L585 The link is one socket
Result: Each worker has one WebSocket and no 5 s snapshot poll, no file poll for its port, and no restart timer.
- why: `pollAll` fetches the full snapshot 12 times a minute per machine beside an open WebSocket, `look` reads a file every 300 ms for up to 60 s, and `WorkerHealth` restarts after 3 minutes instead of reconnecting (findings 16, 18, 19, 23).
- done when: a test with a fake worker counts 1 snapshot fetch in 60 s of idle (12 today per machine); `grep -c "setInterval" server/server/live/machines*.ts server/server/live/link-poll.ts` prints 0 apart from the sync timer; a killed link is back within 5 s in a test.
- locks: machine-link
- after: none
- files: server/server/live/machines.ts, server/server/live/machines-links.ts, server/server/live/link-poll.ts, server/server/live/recovery.ts

### L586 Workers hold no state
Result: A worker is an executor with no store, no rule loop and no `last.json`; the main server reads its state from the worker when it connects.
- why: `keep` rewrites each machine's whole chat set every 5 s, `kept.ts` migrates it on every start, and each worker is a full second server (findings 14, 15, 34).
- done when: `server/server/live/kept.ts` no longer exists; a restart of the main server shows each machine's chats after the first worker snapshot with 0 files under `machines/`; the worker's resident memory is at most 150 MB in a measured run of `bun scripts/core-baseline.ts` (record the value in `docs/numbers.md`).
- locks: worker-state
- after: L582, L585
- files: server/server/live/kept.ts, server/server/live/machines-links.ts, server/server/main.ts, server/server/live/worker-process.ts

### L587 One way to run on a machine
Result: One `ssh.ts` builds every SSH command and quotes it, and `runSync`, `tellRunBy` and the 2 s git read cache are gone.
- why: five places build an SSH command line and three copy `quote`; `runSync` freezes the server for the round trip (about 100 ms each, 4.5 s for 45); `tellRunBy` fires an unchecked ssh on every probe (findings 26-30).
- done when: `grep -rn "Bun.spawnSync" server/server/live/box.ts` prints 0; `grep -rln "sshArgs" src server | wc -l` shows one definition; a test of 45 reads of a file on a fake box blocks the loop for under 50 ms in total.
- locks: ssh-one
- after: none
- files: server/server/live/box.ts, src/ssh.ts, server/server/live/install.ts, src/spread.ts

### L588 Workers start without scraping
Result: A worker prints its address when it serves, a stopped worker is awaited as a child process, and a worker is adopted only when its token matches.
- why: `setInterval(300)` waits for a port file, `running()` polls `kill(pid, 0)` every 2 s forever, and `commandOf` matches `ps` output (findings 18, 20-22).
- done when: `grep -c "setInterval" server/server/live/worker-process.ts` prints 0; a test starts a worker and sees its address with no file read; a reused pid is not adopted.
- locks: worker-process
- after: L585
- files: server/server/live/worker-process.ts, server/server/live/machines-links.ts, server/server/main.ts

### L589 The tunnel has no heartbeat
Result: The tunnel loop has no `sleep 10` on the machine, no `rm -f` first and no `chown`; the worker connects out and the agents use a local socket.
- why: each machine runs a shell poll every 10 s only to keep a forward alive (finding 33).
- done when: `grep -c "sleep" server/server/live/tunnel.ts` prints 0; a test kills the link and the agents' `lineclear` on the fake machine reaches the main server again within 5 s.
- locks: tunnel
- after: L586
- files: server/server/live/tunnel.ts, helper/lineclear

### L590 The helper goes in atomically
Result: The helper is extracted into a folder named by its version and switched by one symlink; the probe returns JSON from a script on the machine.
- why: `rm -rf bin skill; tar xf` leaves a window with no `lineclear` for an agent starting; `PROBE` scrapes `key=value` lines and a login shell's PATH with sed and a regex (findings 31, 32).
- done when: a test starts 50 `lineclear` calls while the helper updates and sees 0 failures; `grep -c "match(" server/server/live/install.ts` prints 0.
- locks: helper-install
- after: L587
- files: server/server/live/install.ts, helper/lineclear

### L591 Updates drain a machine
Result: The plane has one version; a worker is updated only when it has no working task, one machine at a time.
- why: every machine updates in the same minute on the 15 s sync, with no check for work in flight beyond `MERGE_DEADLINE` (finding 38); `sync()` also runs 8 herdr process starts a minute and treats a failed read as an empty list (finding 17).
- done when: a test with 3 machines, one with a working task, sees the busy one updated last and never two updating at once; `herdr machine list` is started at most once per start and once per change in a 10-minute run; a failed read keeps every worker.
- locks: machine-update
- after: L585
- files: server/server/live/machines.ts, server/server/live/install.ts, server/server/live/machines-links.ts

### L592 The update has one path
Result: `install.sh` updates by a version folder and an atomic symlink only, with no sleep, one health wait that the service signals, and one rollback.
- why: `sleep 1`, a 2-minute check loop, two rollback paths and a store copy per update exist because the update can lose work (findings 35-37).
- done when: `grep -c "sleep" install.sh` prints 0; `grep -c "rollback" install.sh` shows one rollback function; the install test in CI updates from the previous release fixture and rolls back a failed one.
- locks: install-script
- after: L584
- files: install.sh, test/install.test.ts

### L593 Actions to a machine are kept
Result: An action for a machine that is out of reach is stored with an id and delivered once; a failure shows in the machine's state.
- why: `forward().catch(() => waiting.push(a))` retries forever in memory and loses the list on a restart; four empty catches wait for the doctor (findings 24, 25).
- done when: a test queues 3 actions while a worker is down, restarts the main server, and sees each delivered exactly once when the worker is back; `grep -c "catch {" server/server/live/link-poll.ts` prints 0.
- locks: machine-actions
- after: L582
- files: server/server/live/link-poll.ts, server/server/live/machines-links.ts, server/server/live/machines-actions.ts

## Order

Start together: L580, L582, L584, L585, L587 (locks machine-room, task-store, settings-store, machine-link, ssh-one). Then
L581 (after L580), L583 and L593 (after L582), L588 and L591 (after L585), L586 (after L582 and L585), L589 (after L586),
L590 (after L587), L592 (after L584). L594-L599 are free for the findings the other audits send here.
