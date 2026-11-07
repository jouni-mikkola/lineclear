# Audit: stores and settings

Read-only audit of every file Lineclear keeps its state in (task VEL-561). No code changed. Scope: the JSON, JSONL and
SQLite files, `src/project.ts`, `src/store-copies.ts`, `server/server/live/settings-store.ts`, `tasks.json`,
`agents-cold.jsonl`, `decisions.jsonl`, and the size of the data folders.

How the numbers were got: sizes and counts are read from the owner's machine (`ls`, `du`, `wc`, `bun -e`), on the
main checkout of 2026-11-07. Write rates were sampled by `stat` every 0.1 s for 30 s with about 9 agents at work. The
45-agent figures are those samples multiplied by 5, so they are estimates; the per-write sizes are exact.

## The answer to the question

**One store with transactions: yes, `bun:sqlite`.** It is already in the repo: `server/server/live/task-ids.ts:83-84`
opens `task-ids.sqlite` with WAL, `busy_timeout=5000` and `.transaction(...).immediate()`, so no new dependency and no
new tool. Everything below that is "a whole file rewritten by one or several processes" becomes a row write.

What is written per tick today, measured here with 9 agents at work (30 s window):

| File | Size | Writes in 30 s | Bytes in 30 s | Per day at this load | At 45 agents (x5) |
|---|---|---|---|---|---|
| `tasks.json` | 678 KB (561 tasks) | 10 | 6.8 MB | 19 GB | about 100 GB a day, 1.1 MB/s |
| `agents.json` | 424 KB (131 records, 9 live) | 1+ | 0.4 MB | 1+ GB | 5+ GB |
| `outbox.json` | 0.3 KB | 1 | tiny | tiny | tiny |
| `typed.json` | 170 KB (200 items) | 0 (one per delivered message) | 170 KB each | | 170 KB per message |
| `chatlog/<key>.json` | 1.9 MB in 421 files, 4.5 KB mean | one per post or answer | the chat's whole log | | |

One `lineclear status` from an agent (`engine-handoff.ts:111-117`) is one 678 KB write of every task, though it changes
about 200 bytes. A JSON store written whole has two more faults that rows do not: a second writer loses the first's
change (last rename wins), and a reader sees only the snapshot of the moment.

## Findings

Each finding: file:line, what it does, why it is a patch or does not scale, the replacement. `S` ids are used by the
steps further down.

### The whole-file stores

**S1. `tasks.json` is written whole on every change.** `server/server/live/engine/engine-state.ts:145-151` (`save`),
called from 70 sites (`engine-handoff.ts` 11, `engine-launch.ts` 9, `engine-state.ts` 8, `engine-tidy.ts` 7,
`engine-merge.ts` 4, `stalls.ts` 3, `merge.ts` 3 and others). It stringifies all hot tasks with 2-space indent and
renames the file over the old one (`store.ts:31-37`). 10 writes in 30 s, 678 KB each, 6.8 MB per 30 s, and the file
grows 1.2 KB per task with no ceiling inside a day (561 tasks in 24 h here, none cold yet because `COLD_AFTER` is one
day, `cold.ts:9`). At 45 agents about 1.1 MB/s of writes and one `JSON.stringify` of the whole list per status line.
Replacement: a `tasks` table, one `UPDATE` of the changed row inside a transaction (about 1 KB written). See L541.

**S2. `agents.json` and `outbox.json` are rewritten on every `save()` of the agent state.**
`server/server/live/agents-state.ts:108-111`, called from 15 sites (`agents-delivery.ts` 10, `agents-state.ts` 5,
`agents-sending.ts` 2). `cold.ts:125-128` writes 131 records (424 KB) to move one line. Same cost as S1. Replacement:
`agents` and `outbox` tables, a row per change. See L542.

**S3. `typed.json` is rewritten for every message that goes into a pane.** `agents-state.ts:348-358`. It keeps the last
200 items (170 KB) and writes them all each time, and `requested-news-receipts.json` the same way (`:353-356`). One
delivered message is one 170 KB write; at 45 agents with a message each a minute that is 7.6 MB/min for a list the
process already holds in memory. Replacement: a `typed` table with a delete of rows older than 10 minutes. See L542.

**S4. A chat's log is written whole on every post.** `server/server/live/chats-logs.ts:45-47` (`saveLog`), called from
`post` (`:64`), `answer` and 3 other sites. A long task's log of 100 cards is rewritten for each new one. 421 files
now; `readJson` per chat at first use (`:39`). Replacement: a `chatlog(chat, id, json)` table, one insert per post.
See L543.

**S5. Names, emojis and spaces are three more whole files, and spaces are mirrored from SQLite.**
`server/server/live/places.ts:117-132` writes `names.json`, `emojis.json`, `spaces.json`; `engine/worktrees.ts:85` and
`:303` write `spaces.json` again through a read-merge-write (`{ ...readJson(SPACES), [repo]: id }`), a lost-update
race with `places.ts:131`. `task-ids.ts:104` says "SQLite is authoritative after migration, including a crash before
spaces.json was mirrored": the prefix lives in two places by design, which is a second way to do a job. Replacement:
`spaces`, `names` tables in the one store, the prefix only in `sequences`. See L544.

**S6. Settings sit in two files of the same name, read two ways.** `~/.lineclear/settings.json`
(`settings-store.ts:88-90`, written whole with `writeJson` for any change, three call sites) and
`~/.config/lineclear/settings.json` (`src/project.ts:78`, `writeSetup` `:92-95`, the role models). The server reads one
through `Settings`, the CLI the other through `readSetup`. `src/serve.ts:22` reads a third path. The constructor
migrates old shapes on every start (`settings-store.ts:44-76`, `moveModels` `:80-86`) and compares
`JSON.stringify(this.d) !== JSON.stringify(raw)` to decide whether to write back; that migration code runs forever for
files that were migrated once. Replacement: one `settings(level, key, value)` table; the migration runs once at the
import step and is deleted. See L544 and L545.

**S7. `project.ts` reads and migrates on every call.** `src/project.ts:98-106`: `readSetup` calls `existsSync` for the
legacy `setup.json` on every call, parses on every call, and rewrites + deletes the legacy file when it finds one. 42
call sites of `readSetup`/`readSettings`. Replacement: a table read; the legacy path is a one-time import (L545).

**S8. `readJson` turns a broken file into an empty store, and the next save writes the empty one.**
`server/server/store.ts:20-27`: `catch { return fallback }`. For `tasks.json` the fallback is `{ next: {}, tasks: [] }`
(`engine-state.ts:52-55`), so a torn or half-copied file starts the board with no tasks and the first `save()` replaces
the file. `secrets.ts:47-56` does it right (it throws "nothing was changed"). The patch around the fault is
`store-copies.ts:111`, which refuses an hourly copy of an emptied store so "a wiped store cannot push the last good
copies out". Replacement: a transactional store cannot be half-written; a store that cannot open stops the board with a
named cause. See L540.

**S9. `health.json` compares two stringified objects on every tick.** `server/server/live/health.ts:340`
(`JSON.stringify(next) !== JSON.stringify(was)`) then `store.write` (`source-state.ts:45`). Small file; the compare is a
change-detector standing in for "write only what changed". Replacement: a `health` row updated when a limit's state
changes. See L544.

**S10. `machines/<label>/last.json` has a debounce timer and a swallowed catch.**
`server/server/live/machines-links.ts:101-108` (`keepTimers`, `try { writeJson } catch { /* a full disk */ }`) and the
legacy rewrite in `machines-helpers.ts:150-160` (`delete k.snap` then write again at every start). A full disk that is
swallowed means the board runs on while it keeps nothing. Replacement: a `machines` table row written on change; a
failed write is an error the board reports. See L549.

### Append logs and per-item files

**S11. `decisions.jsonl` is one file with four writers and whole-file readers.** Writers: the rule loop
(`src/rules.ts:186`), `plan.ts:179,185`, `task-work.ts:42` (every `lineclear` call of every agent), the server
(`engine/lane-watch.ts:66`). 6,468 lines, 939 KB. Readers parse the whole file or its tail
(`stall-class.ts:222-258`, `status.ts:45`, `home-waits.ts:58`, `start-failures.ts:48`, `cli.ts:198`) with swallowed
catches (`stall-class.ts:238`, `:272`). Rotation (`stall-class.ts:261-288`) rewrites the file once a day through a "day
of the last cut" marker file (`cutDecisionsDaily`, `rules.ts:179`) and an archive of monthly files; the comment says the
archive "is written first: a stop in between keeps a line twice". `recordWork` keeps a `lastWritten` Map and a 30-minute
window to avoid writing the same fact again (`task-work.ts:30-42`), a per-process dedupe of an append log. Replacement:
a `decisions(time, project, step, kind, reason)` table with an index on time; "since" is a `WHERE`, the dedupe is a
`UNIQUE` on the hour bucket, the rotation is a `DELETE`. See L547.

**S12. Inbox, waits, requests: one JSON file per item, listed and parsed in full on every read.**
`src/inbox.ts:101-113` (`readItems`: `readdirSync` + `readFileSync` + `JSON.parse` per item, swallowed catch "a
half-written file is read again next time"), `addItem` loops from `max(n)+1` and retries on `EEXIST` (`inbox.ts:115-125`,
a retry that stands in for an auto-increment key), `src/waits.ts:51`, `src/requests.ts:52`. `readItems` has 23 callers
and `readWaits` 12; the rule loop calls `readItems` once per project per tick (`rules.ts:96`). The files are small and
written atomically by `createAtomic` (fsync file and directory, `pi/atomic.ts:41-57`), so they are correct but cost two
fsyncs per write and N file reads per call. Replacement: `inbox`, `waits`, `requests` tables; `INTEGER PRIMARY KEY
AUTOINCREMENT` replaces the `EEXIST` loop. See L548.

**S13. The cold logs exist to patch S1 and S2.** `server/server/live/engine/cold.ts:38-129` (`ColdLog`, `ColdAgents`)
and `engine-state.ts:148` split `tasks.json` into a hot part rewritten whole and a cold append log that compacts when
`lines > 2 * tasks + 1000` (`:92`). They are a hand-made database: an id key, tombstones (`{gone: id}`), compaction,
`same()` row compare. The readers have to know both files: `src/kept-read.ts:64-65`, `store-copies.ts:20-45`,
`doctor-task-ids.ts:26-30`, `measure.ts:55`. Neither file exists on this machine yet, because nothing is a day old.
The logic is untested at scale for exactly that reason. Replacement: delete with the tables; one `WHERE finished`
query is the "cold" read. See L541, L542.

**S14. Briefs are a file per task, written with tmp + rename on every change, and read back whole at start.**
`engine/briefs.ts:43-55` (561 files, 11 MB of directory blocks for the real content of about 1.2 MB). 561 `readFileSync`
at start (`:24-35`) with a swallowed catch ("a lost file stays lost"). Replacement: a `brief` column on the task row,
so a task and its brief commit together. See L541.

**S15. Retirement moves files and keeps a counter file.** `engine/retire.ts:22-40`: `appendFileSync` per task to a
monthly `archive/tasks-<month>.jsonl`, then a read-modify-write of `archive/counts.json`, then a `renameSync` of each
chat file. A stop between the three steps leaves the task in two places ("keeps it twice, never loses it" is the
comment, i.e. the state is repaired by readers). `home-data.ts:262` and `measure.ts:82` read the archive files back.
Replacement: `UPDATE tasks SET retired = 1` in one transaction; the count is `SELECT count(*)`. See L541.

### Copies and disk use

**S16. `store-copies.ts` copies files while another process writes them.** `src/store-copies.ts:104-125`:
`copyFileSync` of every top-level file of the data folder (`:95-98`, `:118`) plus every brief (`copyBriefs`, `:78-88`,
561 files) into a `.part` folder, then a `renameSync`. A copy of `tasks.json` and `agents.json` taken a few
milliseconds apart is not a point in time (the board writes both at 0.3 writes/s); the copy of `task-ids.sqlite` without
its `-wal` file (`:97` takes `-shm`/`-wal` as files too, but not atomically with the main file) can restore to a state
the database never had. 56 copies take 1,068 MB, 31 to 34 MB for each of the newest; at 48 hourly + 10 update kept that
is the cost of a copy nobody has restored from. `copyStoreQuietly` (`:179-186`) swallows every error so the copy "must
not stop the tick; doctor names a stale one" (a swallowed catch with a second check behind it). Replacement:
`VACUUM INTO 'copy.sqlite'` (one consistent file, about 2 MB here) or `db.serialize()`; restore is one file copy.
Secrets and push keys stay outside the copy (see S19). See L546.

**S17. Data folders grow with no owner.** `~/.lineclear` is 303 MB here: `deps` 292 MB, `tasks` 11 MB (561 directories
for 561 briefs), `chatlog` 1.9 MB, the JSON stores 1.3 MB. The 2.9 GB `autopilot-runtime` of the brief is not on this
machine now, and `store-copies` (1.07 GB, in `~/.local/share/lineclear/`) is the biggest folder of data that Lineclear
writes. `store-copies.ts` and `retire.ts` are in step L491; the numbers of S14 and S16 shrink that step's work.

### Other stores

**S18. `trust.ts` rewrites another tool's config with a read-modify-write.** `server/server/live/trust.ts:46-70`
parses `~/.claude.json` (a file that Claude itself writes while it runs) and replaces it with tmp + rename. Two writers
and no lock: the later rename wins. The catch logs a warning and carries on (`:66-68`). Not Lineclear's store; named
for the race. Not in a step: it goes with the removal of non-pi agents (L443).

**S19. `secrets.json`, `vapid.json`, `push.json`: right as files, one fault.** They are 0600 (`store.ts:29`), written
by one process, and `secrets.read()` throws on a corrupt file (`secrets.ts:47-56`), the pattern S8 wants everywhere.
The fault: `secrets.read()` parses the file on every call (`:47`, called by `pick`, `visible`, `has`, `put`), and
`push.json` is written whole on subscribe and on every failed delivery clean-up (`push.ts:69,103`). Both are tiny and
rare. `store-copies.ts:95-98` copies them into 56 copy folders because it takes every top-level file. Keep them as
files, out of the copy, read once and cached by mtime. See L549.

**S20. `requested-news.ts` is a file per item with a read of all agents.** `server/server/live/requested-news.ts:29,40`
reads `agents.json` from disk (a second reader of a file the process holds in memory) and writes
`requested-news/<id>.json` per item. Replacement: the `outbox` table of L542.

**S21. `project.ts` shells out to another command and parses its columns.** `src/project.ts:127-135`
(`detectSpace`): `Bun.spawnSync([serverBin, "space", "list"])` then `listing.split("\n")` and `/\s{2,}/` over the
columns. It blocks the process for the whole start of a `lineclear` process (about 100 ms for a Bun start) to ask the
server something that is in `spaces`. A regex on the output of Lineclear's own CLI. Replacement: read the `spaces` table
directly. See L545.

**S22. `project.ts` detects the check command by regex over `Makefile` and `package.json`.** `src/project.ts:145-230`
(`detectCheck`, `detectHeavy`, `HEAVY_SCRIPT`, `ENDLESS`, `toolRun`): a guess recorded once when a project is added.
It is a heuristic over other tools' files, with 6 swallowed catches in the file. It runs once per `project add`, so the
cost is small; the fault is that a wrong guess is stored as if known. Replacement: leave as the first guess but store
it as a suggestion the owner confirms (already asked in setup); no step, listed for the 600-line rule: the file is 579
lines, and splitting it to stay under 600 would be the patch to avoid.

### What is fine

`tasks/<id>/brief.md` content, the per-item atomic writes of `createAtomic` for a single writer, the `secrets` throw
on a corrupt file, `server.json`/`server.lock`/`run-by` (one writer, tens of bytes), and `task-ids.sqlite` itself
(WAL, immediate transactions) stay as the model for the rest.

## Where pi and herdr come in

Not this area's files. The stores here are Lineclear's own; none of them polls herdr or pi to learn something that
an event could tell. One note for the other audits: `agents-state.ts:335-342` retries a pane's Enter up to 5 times
and `agents-state.ts:88-92` runs a terminal clock at 500 ms or 1500 ms; the store layer cannot make those events,
but a SQLite `outbox` row with a status gives them one place to record "taken" instead of the polling check.

## The design: one store

`~/.lineclear/store.sqlite`, WAL, `synchronous=NORMAL` (the board's own crash needs no fsync per write; only a power
cut can lose the last write, and `FULL` stays for ids), `busy_timeout=5000`, opened by every process that writes (the
server, the CLI of each agent, the rule loop's `run --once`). Tables: `tasks`, `agents`, `outbox`, `typed`,
`chatlog`, `decisions`, `inbox`, `waits`, `requests`, `settings`, `spaces`, `names`, `health`, `machines`,
`sequences`, `prefixes`. Each change is one statement or one `db.transaction(...)` (bun:sqlite supports transactions as
functions with `.immediate()`, as `task-ids.ts:98-112` already does). A backup is `VACUUM INTO`.

This also moves the CLI's `~/.config/lineclear` state (inbox, waits, decisions, projects, requests) and the board's
`~/.lineclear` state into one file: today the same fact (a project's settings, a task) can be read from two data
folders, and `dataDir`/`configDir` are chosen by environment (`src/paths.ts`).

What it costs: rows are not human-editable with a text editor (`sqlite3` is), and an older board cannot read a store
that a newer one wrote (the import step keeps the JSON files as `*.imported` for one release).

Expected numbers after the steps: bytes written per status line from 678 KB to under 2 KB (340 times fewer); per
day at 45 agents from about 100 GB to under 300 MB; store file about 3 MB for 561 tasks; a copy 3 MB, not 34 MB.

## Steps

Ids L540 to L549. L540 comes first; L541 to L549 then run in parallel on disjoint locks, except where `after` says
otherwise (they share files with L443 and L491).

### L540 One store file with transactions
Result: Lineclear keeps its state in one `store.sqlite` with transactions, and a store that cannot open stops the board with a named cause.
- why: S1-S8, S13: 18 stores are written whole or appended by several processes, and a broken one is read as empty.
- done when: `server/server/store.ts` opens `store.sqlite` (WAL, `busy_timeout=5000`) and exposes `db` and `tx()`; `readJson` and `writeJson` are deleted from it; an import step turns each old JSON file into rows once and renames it `*.imported`; a test corrupts the file and sees the board refuse to start with the file's path in the line, not an empty store.
- locks: store-core
- after: none
- files: server/server/store.ts, server/server/main.ts, server/server/live/task-ids.ts, src/paths.ts

### L541 Tasks are rows, not a whole file
Result: A task's change is one row written, so a status line writes under 2 KB instead of the 678 KB of `tasks.json`.
- why: S1, S13, S14, S15: `save()` rewrites every hot task 10 times in 30 s with 9 agents, about 1.1 MB/s at 45.
- done when: `tasks` rows hold tasks, briefs and retired marks; `cold.ts` (the task part) and `briefs.ts` are deleted; a test with 45 tasks reporting 100 status lines counts 100 row updates and under 200 KB of writes (`wc -c` of the WAL), against 67 MB today; `retire.ts` marks rows in one transaction.
- locks: store-tasks
- after: L540
- files: server/server/live/engine/engine-state.ts, server/server/live/engine/cold.ts, server/server/live/engine/briefs.ts, server/server/live/engine/retire.ts, server/server/live/engine/engine-tidy.ts, server/server/live/task-ids.ts, src/kept-read.ts, src/doctor-task-ids.ts

### L542 Agents and outbox are rows
Result: A message to an agent and a change of its record write one row each, not the 424 KB of `agents.json` and the 170 KB of `typed.json`.
- why: S2, S3, S20: 15 save sites rewrite 131 agent records, and each delivered message rewrites 200 sent items.
- done when: `agents`, `outbox` and `typed` are tables; `ColdAgents` is deleted; `requested-news.ts` reads the table, not `agents.json`; a test delivers 100 messages and sees under 300 KB written (about 17 MB today).
- locks: store-agents
- after: L541
- files: server/server/live/agents-state.ts, server/server/live/agents-delivery.ts, server/server/live/agents-sending.ts, server/server/live/requested-news.ts

### L543 Chat logs are rows
Result: A card or an answer in a chat is one row inserted, not the whole log of that chat written again.
- why: S4: 421 chat files, each rewritten whole on every post or answer.
- done when: `chatlog` is a table; `saveLog` and the `chatlog/` folder are gone; a test posts 100 cards to one chat and sees under 100 KB written (about 2.5 MB when each rewrite grows to 50 KB).
- locks: store-chats
- after: L541
- files: server/server/live/chats-logs.ts, server/server/live/chats.ts, src/task-detail.ts, src/measure.ts

### L544 Settings and places in the store
Result: Settings, spaces, names and health live in the store, and the migrations of old settings shapes are gone.
- why: S5, S6, S9: three whole files for places, two `settings.json` of the same name, and a migration that runs at every start.
- done when: `settings`, `spaces`, `names` and `health` are tables; `settings-store.ts` is under 120 lines (about 250 today, `wc -l`); `worktrees.ts` no longer reads and writes `spaces.json`; a test sets a value from two processes at once and sees both.
- locks: settings
- after: L443, L540
- files: server/server/live/settings-store.ts, server/server/live/places.ts, server/server/live/engine/worktrees.ts, server/server/live/source-state.ts, server/server/live/health.ts

### L545 One settings reader
Result: The CLI reads the project settings and models from the store, not from a second `settings.json` and a spawned `lineclear space list`.
- why: S6, S7, S21: `readSetup` parses a file and checks a legacy path on each of 42 calls, and `detectSpace` blocks about 100 ms on a child process.
- done when: `project.ts` has no `spawnSync` and no `setup.json` path (`grep` prints 0); `src/serve.ts` reads the same table; a test counts 0 child processes started by `project add`.
- locks: cli-settings
- after: L544
- files: src/project.ts, src/serve.ts, src/wait-service.ts, src/requests.ts

### L546 A copy is one file
Result: A store copy is one consistent `VACUUM INTO` file of 3 MB, so a restore returns the store as it was at one moment.
- why: S16, S17: 56 copies take 1,068 MB, and copying files one by one is not a point in time.
- done when: `copyStore` writes one file with `VACUUM INTO` and holds under 5 MB per copy (34 MB today); `restoreCopy` puts one file back; secrets and push keys are not in the copy; the copy error is not swallowed (a test breaks the folder and sees the line in `doctor`).
- locks: disk-use
- after: L491, L540
- files: src/store-copies.ts, src/rules.ts

### L547 Decisions in the store
Result: The decisions log is a table with an index on time, written by one statement from the server, the rule loop and every agent's CLI.
- why: S11: four writers append to one 939 KB file, readers parse all of it, and a daily cut moves lines between files.
- done when: `decisions` is a table; `cutDecisionsDaily`, `rotateDecisions`, `readDecisionsSince` file reads and the `lastWritten` dedupe are deleted; `lineclear status` reads one `WHERE time >` query in under 10 ms with 100,000 rows (a test measures it).
- locks: decisions
- after: L540
- files: src/stall-class.ts, src/task-work.ts, src/plan.ts, server/server/live/engine/lane-watch.ts, src/status.ts, src/start-failures.ts, src/home-waits.ts

### L548 Inbox and waits in the store
Result: Inbox items, waits and requests are rows, so the rule loop reads them with one query and a new item needs no retry on a taken number.
- why: S12: `readItems` lists and parses every item file on each of 23 calls, and `addItem` loops on `EEXIST`.
- done when: `inbox`, `waits` and `requests` are tables; `createAtomic` is used by 0 callers and deleted from `pi/atomic.ts` if nothing else uses it; `addItem` has no loop (a test adds 50 items from 5 processes and sees 50 distinct numbers).
- locks: cli-items
- after: L540
- files: src/inbox.ts, src/waits.ts, src/requests.ts, src/inbox-answer.ts, pi/atomic.ts

### L549 Small stores read loud
Result: Machine caches, secrets and push keys are written on change only, read once, and a failed write is an error, not a swallowed catch.
- why: S10, S19: `last.json` hides a full disk, `secrets.read()` parses on every call, and `push.json` is rewritten whole.
- done when: `machines-links.ts` and `machines-helpers.ts` hold 0 empty catches (`grep` prints 0, 2 today); `secrets.read()` parses the file once per change of its mtime (a test counts 1 read for 100 calls); a full disk makes the next write fail with the path named.
- locks: small-stores
- after: L540
- files: server/server/live/machines-links.ts, server/server/live/machines-helpers.ts, server/server/live/secrets.ts, server/server/push.ts

## Not proven

- The 45-agent write rates are the 30 s sample at 9 agents times 5; the board was in normal use, not a controlled run.
- The 4.3 GB and the 2.9 GB `autopilot-runtime` are the brief's figures; on this machine `~/.lineclear` is 303 MB and `autopilot-runtime` is not there.
- `bun:sqlite` row-write sizes (2 KB per status line) are from the row sizes, not a benchmark; L541's test measures them.
- `tasks-cold.jsonl` and `agents-cold.jsonl` do not exist here (nothing is a day old), so their compaction code was read, not observed.
