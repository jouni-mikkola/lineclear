# Numbers

Numbers from `lineclear measure`, without project names.

## Health

`lineclear measure lineclear --since 2026-10-25 --health`, until 2026-11-01 15:27 UTC.
Stalls count from L112, when the rule loop began to record them. A step that makes one of these worse fails its review.

| Measure | Value | Goal |
| --- | --- | --- |
| share of task time waiting on the system | 0.0 % | near 0, lower is better |
| stalls per day | 0.0 | lower is better |
| minutes from a stall to its remedy (median) | - | lower is better |
| merges per day | 11.5 | higher is better |
| tokens per merged step | 5488897 | lower is better |

## L57: goals on real work

`lineclear measure lineclear --since 2026-10-24`, run on 2026-11-04 19:04 UTC over the work already done, with no wait for new days. It counts this machine and every machine in Settings over SSH (`lineclear measure` runs itself there with `--raw --local` and adds their tasks, asks and sessions). Days before 2026-11-01 have no recorded task, so they show nothing.

What this run could and could not read:

- Tasks come from the task store and, for work whose record is not in it, from pi's session files (one per working folder `work-<n>-<step>-...`, started at its first session line). The 396 working folders of this machine are counted this way.
- Asks come from the Inbox files; the cards of the board's chat logs that wait for you are not on this machine, so the asks are a lower bound.
- The only other machine in Settings, `laptop`, failed its install (SSH host key not accepted), so it was not counted.

| Goal (idea.md) | Measured | Met |
| --- | --- | --- |
| under 3 asks a day | 0, 0, 0 and 3 on the four days with work (2026-11-01 to 11-04) | no, 3 on 2026-11-04 |
| median wait from ready to start under 5 min | 112.7, 185.0 and 928.8 min on the three days that have a wait (8, 15 and 18 tasks) | no |
| cost per merged step at least 15 % below the pilot's before Lineclear ($1.39, 90 steps, 2026-10-30, so $1.18 or less) | $2.07 per step over 49 steps ($1.50, $2.40 and $1.89 by day) | no |

The three unmet goals are one plan, raised once with `lineclear plan` (task LIN-793).

### Done means, line by line

A line is met when every step it names is done.

| Line | Steps | State |
| --- | --- | --- |
| Every step is done or dropped | all | not met, 71 left |
| Release 0.1 goes out | R3, U43 | not met, R3 at work, U43 waiting |
| Every machine runs on Lineclear | L42 | met |
| One server and one task store | L91 to L96 | not met, L92 to L96 open |
| Nothing runs on Shepherdr 2.0 | L43 | not met, L43 ready |
| One product, one name | L68 to L76, U57 to U60 | not met, L69, L71, L74 and L75 open |
| Held steps and heavy suites | L44, L45 | met |
| A full subscription hands work on | L46 | met |
| A new Inbox item reaches your phone | L47, L48 | not met, L47 ready |
| Someone new installs it | L49 | met |
| A reboot, a killed service, a full disk | L50 | met |
| Measured token savings, on by default | L51 to L56 | met |
| A go from a fresh model of another company | L61, L62, L65 | met |
| The goals hold on the work measured | L57 | not met, see the first table |
| The code stays clean by rule | L77 to L90 | not met, L89 and L90 open |
| No task sits waiting for you with no question | L140 to L146 | met |
| The running Lineclear is a released build | L128 to L138 | not met, L134 ready |
| No single task stops the merge line | L119 to L127 | not met, L121 and L127 open |
| Every way a task stops moving has a class | L112 to L117 | not met, L114 to L117 open |

The open steps are already on the roadmap, so only the three measured goals needed a new plan.

## L239

Cost per step by cause: `lineclear measure` prints a `cost cause` line for each kind of token a step is paid for (fresh input, output, cache read, cache write), in dollars per merged step and as a share. The four parts come from the same session files and prices as the cost per merged step and sum to it; `test/measure.test.ts` checks this on a fixture counted by hand (three steps, $1.50 each, within 1 %).

The L57 days (2026-11-01 to 11-04), read straight from pi's session files of this machine's 309 `lineclear` working folders of numbered steps, every message priced:

| Cause | Dollars | Share |
| --- | --- | --- |
| Cache write | 38.05 | 43.9 % |
| Cache read | 25.73 | 29.7 % |
| Output | 22.00 | 25.4 % |
| Fresh input | 0.97 | 1.1 % |
| All | 86.75 | 100 % |

The two largest are cache write (43.9 %) and cache read (29.7 %): together 73.6 % of the cost. The total is below the L57 run's $2.07 times 49 steps because that run's task store is not on this machine and these folders are counted by session date, not by merged step. These shares cover every session dated in the window, merged or not, so they approximate the merged-step cohort; `lineclear measure` prints the exact split over merged steps where the project is set up. Saving on the context a session rewrites and rereads comes before any saving on output.

## L243

`lineclear asks --days 1`, run over the Inbox and every board's chat files of this machine, as of midnight UTC after 2026-11-04, the newest L57 day with asks. It has three asks, all Inbox items with no card in a chat:

| Time (UTC) | Task | Kind | The ask |
| --- | --- | --- | --- |
| 16:35 | LINE-352 | outward | Record a real power cut of the laptop. |
| 16:48 | LINE-354 | outward | Do one real power cut of a machine with lingering on, at a time the owner chooses. |
| 16:50 | LINE-355 | outward | Reboot this machine now, to record the boot. |

One cause: L50 needs a real power cut, which an agent cannot do alone. Each was filed as outward, but none sends anything off the machine, and no rule answers it today.

## L234: each wait names its cause

`lineclear measure <project> --since <date>` prints, for each step whose wait it counts, the minutes of the wait by cause: `lock` (a named lock held), `part` (a part or a file of one held), `slot` (the space has no free task slot), `machine load`, `quota` (no worker model has room, or every account is ahead of its pace), `other cause` and `no cause recorded`. A skip line of the rule loop's decision log holds its cause from its time until the step's next line; minutes no skip line covers are `no cause recorded`. `test/wait-causes.test.ts` checks the split on three steps held by a lock and a slot, a load, and a part and a quota, against minutes counted by hand.

The causes of the L57 days (2026-11-01 to 11-04), largest first:

| Cause | Share of the wait |
| --- | --- |
| no cause recorded | all of it |

The decision log of this machine holds 1039 lines from 2026-11-01 20:54 to 2026-11-04 22:16 UTC: housekeeping wakes, stalls and 4 plan skips. None names a project or a ready step held by a lock, a slot, load or quota, because the tasks of these days were started from the board, not by the rule loop. So the waits of L57 have no recorded cause, and no fix can be aimed yet. The next step is that every start path records why a ready step waits; the lock and slot files hold only the present state, so they cannot explain a past wait.

## L238

- 2026-11-05: median 369.1 min; waits per day: 2026-11-03 24, 2026-11-04 28, 2026-11-05 8

## L116: writes stay small

`tasks.json` and `agents.json` were written whole on each change. Now tasks that ended over a day ago, and finished
agents that started over a day ago, go to `tasks-cold.jsonl` and `agents-cold.jsonl`: a change to one of them is
one appended line. Measured on one board's real files (421 tasks, 26 open), each save timed 20 times; the 10,000
task case is the same file copied 24 times as tasks ended a week before.

| Case | Before: written per save | After: written per save |
| --- | --- | --- |
| tasks.json, 421 tasks | 2.32 MB, 25 ms | 0.79 MB (154 tasks), 12 ms |
| tasks.json, 10,104 tasks | 55.6 MB, 1000 ms | 0.79 MB (154 tasks), 47 ms |
| agents.json, 418 records | 1.19 MB | 0.54 MB (155 records) |

What stays in the whole file is the open tasks and those ended in the last day, so it does not grow with the
board's age. Worktrees: 7.6 GB under the herdr worktree folder before; after, a done task keeps only its branch
when its work is committed, so its folder and installed packages go at the next sweep.

## L16: the merge lane

`lineclear measure` has a fourth column: the median minutes from a task's ready report (its review passed) to its
merge, for the tasks merged that day. It reads the times Shepherdr keeps on each task, so it needs no new file.

Before the lane (merges by Shepherdr 2.0, which merges a branch behind main as it is and runs no check of its own),
`lineclear measure <project> --since 2026-10-28`, 2026-10-31, two projects:

```
date        ready to merged (median min)
2026-10-29  0.2 (1 task)
2026-10-30  0.2 (91 tasks)
2026-10-31  0.2 (69 tasks)    one project
2026-10-31  0.2 (32 tasks)    the other
```

After, 2026-11-05: the same column, from the newest task store on this machine (the copy of the pilot's store under
`laptop-data`, 332 tasks, the same reading as `lineclear measure`: ready report to merge, merged tasks, by UTC day of the merge):

```
date        ready to merged (median min)
2026-10-29  0.3 (20 tasks)
2026-10-30  0.2 (111 tasks)
2026-10-31  0.2 (132 tasks)
2026-11-01  0.3 (11 tasks)
```

The store on this machine's own board holds no merged task yet, so no day of merges through the lane is measured here.
Every day above is still a merge with no check of its own, so the column stays near 0.2 min. When the lane has merged a
day, `lineclear measure` prints the median; a merge whose files main touched should then read as the length of the project's check.

## Red merge checks (L218)

Goal: under 15 % of merge-tier runs red. Before L218: 47 % red, and 288 of 420 red runs named no failure.
Every red run in `check-runs.jsonl` now carries `causes`, never empty: `gate: <step>: <line>`, `test: <name>`,
`timeout: <line>`, or `exit <code>: <last line>` when the output names nothing. `lineclear measure` prints
`red merge checks (goal under 15 %): <red> of <all>, <share> %; by cause: gate <step> n, test n, timeout n, exit n`
(a run logged before L218 is sorted by its failed gate or tests; `unnamed` only where it logged neither). Runs from before L218 are not rewritten; the share by cause fills as new runs land.
`test/red-causes.test.ts` fails a gate, a test and a timeout in turn and finds each named.

## Merge line

`lineclear measure <project> --since <day>` prints one line per UTC day from the check run log: merges to main (the last merge-tier
group of each branch whose runs all passed), merges per hour (the day's merges over 24 hours) and the longest wait of a turn. The log has no
queue entry, so a turn's wait runs from the end of the branch's last earlier run, of any tier, to the start of its merge check.
That includes time the agent spent before asking, so it is an upper bound on the line's own wait.

Before L120, measured from main (`git log --first-parent` up to the commit before L120, 1 to 3 Nov UTC, a day's merges over its 24 hours as the log's number is):

```
what                                  before
merges to main per hour               2.88, 1.21 and 3.00 on 1, 2 and 3 Nov (69, 29 and 72 merges over 24 h)
longest lane wait                     489.7, 1583.5 and 472.1 min on 1, 2 and 3 Nov (the longest ready report to merge of the day, from the task store)
lane wait, median ready to merged     0.7, 205.7 and 20.6 min on 1, 2 and 3 Nov (42, 25 and 42 tasks; the task store's ready report to merge)
longest wait of the lane, a stand-in  377.0, 215.9 and 121.3 min between two merges to main on 1, 2 and 3 Nov (up to the commit before L120)
```

The check run log did not exist before L120, so the longest lane wait is taken from the task store: the ready report of a task to its merge, the same 42, 25 and 42 tasks as the median. A second figure is the longest gap between two
merges to main on a day, from `git log --first-parent`. It also holds idle time with no branch ready, so it is an upper bound.
`lineclear measure` prints the longest ready-to-merged time per day beside the median from the task store.

After: add here once a day of merges has gone through the lane and `lineclear measure` prints both numbers from the log.

## L33: reports are not asks

A report card has no question. Counted as asks, it made a day look worse than it was. `lineclear asks` now counts
reports apart, `lineclear measure` leaves them out of the asks, and a rule closes the report of a task that is done.

The needs-you cards of the pilot's last 7 days, `lineclear asks` (2026-10-31), before and after the change:

```
date        cards (before)  asks (after)
2026-10-29  13              12
2026-10-30   4               1
2026-10-31  32              10
```

Over the week: 49 cards before, 23 asks and 26 reports after; 24 of the reports were already closed by their task
being done. This is the same week counted two ways. The 7 days after the brief template change (reports with no
question, notices in the report) are not in yet: add them here once they have passed.

## L32: counts as L4 says

`lineclear measure` had two faults. A merged step with no task counted as $0, so the cost per step read too low. The
Inbox was not in the asks. Now a step with no task is left out of the cost and named, with how many there were, and
asks count the Inbox items as well as the needs-you cards, a question that is both counted once.

The pilot's numbers, counted again with the fix (`lineclear measure <pilot> --since 2026-10-24`, 2026-10-31):

```
date        asks  wait (median min)  cost ($ per merged step)
2026-10-30     1  143.3 (7 tasks)    1.39 (90 steps)
2026-10-31    28  1.1 (25 tasks)     2.13 (35 steps)
45 merged steps had no task, not counted
```

The earlier count of the same days, taken when the rules started, was `2026-10-30  1  143.3  1.39 (90 steps)` and
`2026-10-31  2  296.5 (1 tasks)  0.16 (48 steps)`. The first day is unchanged. The second moved because 45 steps
that counted as $0 are out of the cost, the Inbox is in the asks, and the day went on after the first count.

## L38: the planner, one real plan

It worked: one roadmap change came through `lineclear plan` and was approved in the Inbox view, which merged it. The
planner added four steps, one per listed gap. It stalled once: the project's commit hook needed a Node version that
was not on the planner's PATH, so it asked instead of committing. Keep: the brief template now names `lineclear plan`
for roadmap changes.

## L8 pilot

Project: the pilot project. Why: it has a real roadmap that the earlier steps were measured on (134 done steps in its step
list when the pilot was picked, 138 once its done set was imported) and steady work.

Rules started driving it at 2026-10-31 02:03 UTC. The owner ended the pilot at about 14:00 UTC the same day (no time trials), after about 12 hours. The project stays on the rules.

### Setup

- The project's roadmap was converted with `lineclear roadmap import` and merged to its main with a `Step: <id>` line
  for each of its 138 done steps. `lineclear roadmap status` shows the same done set as its own step list.
- Its coordinator was set to regular (`shepherdr mode <space> regular`). Its standing checklist was replaced by one
  note that rules run the project, so no standing request is left.
- Proof, run again on the project's machine: `lineclear mode lineclear regular` prints `lineclear: Coordinator timer off.`, and
  `lineclear heartbeat lineclear` prints the one-line note as its HEARTBEAT.md. The coordinator reads that note at each
  wake, so it is told there that rules run the project. The CLI has no command that posts a line into a coordinator's chat.
- `lineclear run` runs as the `lineclear.service` systemd user service.
- Read again on 2026-11-05 on the server (`lineclear mode lineclear regular`, `lineclear heartbeat lineclear`): both print
  as above, and the heartbeat reads "coordinator timer off; heartbeat: Every 30 minutes". Its HEARTBEAT.md is the one note
  "Lineclear rules now run this project: they start its tasks. Do not start or tell a task." That note is the coordinator's
  only standing request and its way of being told.
- Read again from the project's own server on 2026-11-05 (LIN-1029): `lineclear mode lineclear regular` printed
  `lineclear: coordinator timer off.` and `lineclear heartbeat` printed the note above. `lineclear task tell lineclear "..."` is refused
  ("No task lineclear"): a coordinator's chat takes no line from the CLI, so the HEARTBEAT.md note is its only way of
  being told. Anyone can check the state with those two commands.

- Read again on 2026-11-05 (LIN-1046), the exact output of `lineclear mode lineclear regular`: the mode line saying the rules run it.
  `lineclear heartbeat` for the project prints that the mode is off and the heartbeat is every 30 minutes, and a HEARTBEAT.md of the one
  note: "Lineclear rules now run this project: they start its tasks. Do not start or tell a task. Reply
  <no-reply>rules run it</no-reply>." The coordinator gets that note with every heartbeat and answers it with no reply, so
  it is told in its chat on each wake and has no other standing request. Why the checker kept the item false: it reads
  tracked files only and no command posts a line into a coordinator's chat, so the note is the proof there is. A
  chat line sent by hand is not proven.

### Before (`lineclear measure <pilot> --since 2026-10-24`, rules not yet running)

```
date        asks  wait (median min)  cost ($ per merged step)
2026-10-24     0  -                  -
2026-10-25     0  -                  -
2026-10-26     0  -                  -
2026-10-27     0  -                  -
2026-10-28     0  -                  -
2026-10-29     0  -                  -
2026-10-30     1  143.3 (7 tasks)    1.39 (90 steps)
2026-10-31     2  296.5 (1 tasks)    0.16 (48 steps)   (first count, see L32 above)
```

### Things that went wrong during the pilot

- Around 04:20 EET on 2026-10-31 the links `~/.local/bin/lineclear` and `~/.pi/agent/extensions/lineclear.ts` were
  removed. They were put back at 04:22. Until then agents in the pilot project could not run `lineclear wait`, and one task
  asked with `shepherdr ask` instead. Asks counted before 04:25 may be off.
  The cause is not proven. `install.sh` removes nothing but its own temp files, and every install test runs with its
  own `HOME`, so only a `lineclear uninstall` against the real home explains it. Nothing in the session logs shows who
  ran it. The service kept running because it runs from `~/.local/share/lineclear`.
- The brief of one task was pasted into its pane but never submitted while pi was still starting. Shepherdr showed
  "waits for your reply". The loop now has a rule for it: an agent that is idle and has never answered gets Enter
  after 60 s, then its brief nudge as a message after 60 s more, and each push is in the decisions log.

### After (about 12 hours of rules, until 2026-10-31 13:58 UTC)

From `decisions.jsonl` and `lineclear measure <pilot> --since 2026-10-30`, counted with the L32 fix:

- Task starts by a rule: 37, each a different step. The two setup tasks (the roadmap import and the `Step:` lines)
  were started by hand before the loop ran. Every other start in that time came from the loop.
- Tasks merged in the pilot project since the loop started: 38 commits on its main (roadmap steps and a few fixes).
- Waits for a free slot: 0 decisions say "no free slot". The median wait from ready to start on 2026-10-31 is 1.3
  min over 27 tasks, against 143.3 min on 2026-10-30. The decisions log does not record when a step became ready,
  so "no step waited more than 5 min" is shown by the median and not by a per-step time.
- Asks on 2026-10-31: 33, against 1 on 2026-10-30. That day counts the Inbox items, which the first count did not
  (see L32), and it includes the faults below. The goal of under 3 a day was not met.
- Cost per merged step on 2026-10-31: $2.20 (37 steps), against $1.39 on 2026-10-30 (90 steps). The goal of 15 %
  below the before number was not met in these 12 hours. The 45 steps without a task are not in either figure.
- The coordinator's runs: its session file holds 69 user turns since the loop started (heartbeats and news).
  It made no `task add`, `task tell` or `task stop` call. Its cost is $8.39, 265 model turns from 02:03 to 13:58 UTC:
  the bridge reports no price (the session file says $0), so the tokens of those turns are priced from pi's model data
  for claude-opus-5-5 per million tokens (input 4, output 20, cache read 0.2, cache write 5): 530 input, 64,831 output,
  28,229,023 cache read and 289,952 cache write. That is the equivalent price, not an invoice. For scale, it is $0.23
  a merged step over the 37 steps of the pilot, and the coordinator started no work in those turns.
- Faults found and fixed on the way: the service unit had no PATH (LIN-27), the reviewer came from a per-task
  setting and a brief could sit unsent (LIN-33), a task could not wait for another task (LIN-38).

Result: the loop started the work and the coordinator started nothing, with the median wait under 2 min. It did not
move asks or cost in 12 hours, and those numbers are the owner's to judge.

## L34 Lineclear runs its own roadmap

Rules were switched on for this repo's own project at 2026-10-31 14:34 UTC.

- `lineclear project add` made it a project, and `lineclear project list` shows it. Its coordinator is regular
  (`shepherdr mode <space> regular`) and its standing heartbeat list is one note that rules run it.
- A real run of `lineclear wait until <time> "<reason>"` from one of its tasks answered `LIN-66 waits until <time>:
  <reason>`, `lineclear status` showed it, and `lineclear resume` ended it (`LIN-66 runs again`).
- Home links its roadmap view (`/lineclear/roadmap`).
- The 48 h run from the first `start` decision for `lineclear` in `decisions.jsonl`. Not yet seen: the first rule
  start waits for a free slot. Every task start after it must be a `start` decision there.

## Browsers view is fast

The Agent browsers view waited on `playwright-cli` for everything: the list of sessions (a `list` call, about 1 s) on
each poll, and a full screenshot (a `run-code` call, 1 to 2 s, two at a time) for each card on each tick. Now the list
and every picture are kept in memory and served at once; a stale one is read again in the background, and a card asks
for a small thumbnail (480 px wide JPEG) instead of the page at full size. Only the very first answer waits.

Measured with `bun scripts/browsers-speed.ts` (API, through the server's handler) and in the page with 10 sessions
(a stand-in `playwright-cli` that takes 1 s per call, as the real one does), on a busy machine, 2026-10-31:

```
                                          before              after
list, first ask                           1015 ms             1012 ms (read at server start, so warm in use)
list, every later ask                     1005-1009 ms        0-1 ms
first thumbnail of 10 sessions, asked     2.0 s ... 6.1 s     1.0 s ... 4.1 s (3 reads at once, not 2)
  together, answered at
thumbnail, second ask                     2.0-6.1 s           1-2 ms
one full picture                          2.0 s               1.0 s first, then 0 ms
card picture size, real browser           30.5 KB (390 px)    26 KB at 390 px, 3.2 KB at 480 px from 1280 px
                                                              (12.2 KB the full 1280 px picture)
page, first paint (in the browser)        48 ms               32-40 ms
page, list in the page (cards drawn)      1.5 s               25 ms after the page starts
page, pictures in the page                3.4 s ... 5.4 s     150 ms after the page starts (kept)
polls                                     list every 3 s, a picture every 5 s per card (unchanged)
```

One real session, same script: list 1091 ms before, 8 ms after the first; a repeat thumbnail 2777 ms before, 1 ms
after. The first thumbnail of a session no one has asked for yet still costs one `playwright-cli` run (1 to 2 s);
the list starts it as soon as it names the session.

## README story

Every number in the README, and where it comes from. They sit in its "What works today" details; the film's are repeated
under "README film" below, and the roles chart shows none. Each was read again from the pilot project (see L8 above) at about 15:20 UTC on 2026-10-31.

```
number    in the README                                 source
37 of 39  task starts made by rules                     37 `start` decisions in decisions.jsonl until 13:58 UTC,
                                                        each a different step; the 2 setup tasks were started
                                                        by hand (L8 above)
1.3 min   median wait from ready to start               lineclear measure <pilot> --since 2026-10-30, run again
                                                        for the README: 1.3 min over 27 tasks on 2026-10-31
143.3 min the same wait the day before, without rules   the same run: 143.3 min over 7 tasks on 2026-10-30
38        merges to main in about 12 hours              git log --first-parent of the pilot's main, 02:03 to
                                                        13:58 UTC on 2026-10-31 (roadmap steps and a few fixes)
about 12  hours of the pilot                            L8 above: rules from 02:03 UTC, ended at about 14:00 UTC
$2.15     cost per merged step (38 steps)               the same lineclear measure run, 2026-10-31
$1.39     the same cost the day before (90 steps)       the same run, 2026-10-30
```

L32 above gives 1.1 min over 25 tasks for the same day. That count was taken earlier in the day; the run for the
README counts the 27 tasks of the day so far, as L8 does.

The cost per merged step went up, and the README says so. It leaves out the asks: the same run counts 19 asks on
2026-10-31 against 0 on 2026-10-30. These differ from L8 and L32 above because L33 has
since taken reports out of the asks and the day went on; none of the counts met the goals of L8.

## README film

Every number in `docs/readme/line.svg` (three beats, 14.6 s), and where it comes from. The film shows no other number.
Each is the one measured for "README story" above, on the pilot project of L8, read on 2026-10-31.

```
number      beat            source
143.3 min   1 the problem   median wait from ready to start on 2026-10-30, before rules: lineclear measure <pilot>
                            --since 2026-10-30, 143.3 min over 7 tasks
1.3 min     3 the result    median wait from ready to start with rules running: the same measure run, 1.3 min over
                            27 tasks on 2026-10-31
```

`test/readme-film.test.ts` fails when the film shows a number that is not in this list. The film's size, 63.2 kB, and
its length, 14.6 s, are held by the same test (under 150 kB, 12 to 15 s).

## U18: clear in one minute

The README film now tells three beats in 14.6 s (it was nine scenes, 56 s): the problem, how it works and the result,
in the signal colours on dark graphite with the orange accent. Its alt text tells the same three beats. The README has
a "How it works" list of eight lines (You, Roadmap, Rules, Dispatcher, Planner, Worker, Reviewer, Inbox) and
`docs/idea.md` names the same roles.

Proof: the film's three beats were drawn in Chromium at 1.0 s before each beat ends (3.8, 9.2 and 13.6 s) and read at
680 px width. Not proven: GitHub's own render at 390 and 1440 px. Agents do not push, so no pull request on GitHub
exists to show; the README's own images would be checked there after the merge. The README is still about 84 lines, not
30: the install, first steps, store and removal sections stay, since L30 and L31 need them.

## U20: the line with 30 tasks

The Home line with 30 tasks, as one task glides from in line to at work (`task-start`), in a Chromium performance trace
at 1440 px. The test is in `ui/test/views.pw.ts` ("the line with 30 tasks"); it prints the figures.

```
CPU                       fps  worst frame  long tasks
this machine              61   23 ms        none
4x slowdown (mid laptop)  63   18 ms        none
```

A 4x CPU slowdown stands in for a mid laptop. The glide reads no layout: every place on the line comes from its
width, so a change costs one React render and no forced layout. Measuring each token with the browser instead cost
one long task of about 150 ms at the 4x slowdown, so the line does not measure.

The machine was busy with other work during the runs (load about 10 on 8 cores), so a quiet laptop has headroom.

## U9: the project line on a phone

The line under a project (`ui/kit/parts.tsx`, `WhereLine`), counted in rows of text on the design page's projects.
The test is "the line under a project wraps to at most three lines" in `ui/test/views.pw.ts`; it prints the rows.

```
width    state   rows per project
1440 px  long    2, 2, 2
390 px   long    3, 2, 1
```

At 390 px the project with a blocker and a long step title takes exactly three rows (the test asserts it) and nothing
is cut. Its picture, `ui/test/screens/where-blocker-long-390.png` and `-1440.png`, shows the blocker as a link to
the Inbox. The long sample has the longest title a step shows (72 characters) beside a blocker. A phone shows the
phase by its number and the finish as a bare date, so the line holds three rows.

## L41: one sentence to steps on the roadmap

One real run on this machine, with two projects set up: `lineclear` (this repo) and `webshop` (a Finnish IT lab
guide). The Dispatcher ran as a headless pi on `claude-opus-5-5`, with the brief in `templates/dispatcher.md` and
this branch's `lineclear` first on its path.

- Written, with no project named: "Let the command line tool print its version and commit with --version."
- It ran `lineclear dispatcher projects` and chose `lineclear`, "since it's the only project with a command line
  tool". It did not ask: only one project fit.
- It ran `lineclear plan lineclear "<the sentence>"`, which started the planning task LIN-85, and answered with
  `[See the steps live](/lineclear/roadmap?plan=LIN-85)`.
- The planner sent one step to the Inbox: L58 The CLI says its version (locks: cli, after: none). The owner
  approved it there, and LIN-85 merged the step into `docs/ROADMAP.md` on main.
- Merged so far: the plan. L58 itself had not started when this branch merged: it was ready, and the space had no
  free slot (4 of 11 tasks at work). `lineclear status --plan LIN-85` says where it stands:

```
LIN-85  lineclear  "Let the command line tool print its version and commit with --version.": approved, the steps are in the roadmap. Live: /lineclear/roadmap?plan=LIN-85
  L58 The CLI says its version  ready to start
```

## L49: someone new installs it

The run on a clean machine by the README alone, from the install to a merged step with a project its runner did not
write: `bun run cold-start` (`scripts/cold-start.ts`). It makes a fresh HOME (an empty folder, a clean PATH, its own
ports, no sudo), installs from the repo with the README's command, logs pi in, copies
[is-number](https://github.com/jonschlinkert/is-number) to a local bare remote and into `~/code`, adds it on Home and
waits. is-number has no `docs/ROADMAP.md`, so Home's first day had to plan it. The model is a Claude subscription
through the public pi package [pi-claude-bridge](https://www.npmjs.com/package/pi-claude-bridge).

On an 8-core laptop that also ran other work, so tasks were let start under a load of 3x the cores
(`COLD_START_LOAD`), 2026-11-01:

| stage | seconds |
|---|---|
| install.sh | 50 |
| Lineclear answers | 9 |
| pi login and doctor | 27 |
| their repo in ~/code | 1 |
| project added on Home | 8 |
| first roadmap on main (7 steps, written from the README and code) | 100 |
| a step merged: R1, tests for the edge cases the tests skipped | 280 |
| total | 475 |

The step was merged and pushed to the remote with no hand on it; the next step (R2) started and merged after it.

Places where the README or the UI was not enough, each fixed, found over twelve runs:

- `install.sh` needed sudo for `unzip`, which Bun's installer wants. It now unzips with busybox or python3.
- On a machine without systemd user services the board never started. `lineclear run --board <port>` starts it, and
  the README says so.
- The board's agents defaulted to Claude Code, which someone new may not have. Lineclear sets pi for every role.
- `lineclear doctor` called the service FAILED where there is no systemd user bus. It now says how to start it.
- The plan's title, and later each task's, was cut mid-word. A plan is titled by its goal's head, a title is cut at a
  word's end.
- An idle pi agent was restarted again and again as "runs on outdated settings": pi names its own process, which hides
  its arguments. A pi with none to read is no longer taken for stale.
- A limit message ("resets 1am") read just after 1am was taken for the next day's, and the plan task was stopped for
  24 hours. A reset is read from when its card was posted, and a reset already past stops nothing.
- `lineclear plan submit` and the loop looked only for a branch named `main`; is-number's is `master`. Lineclear reads
  a repo's main branch by its name.
- A merge into a remote that is not GitHub stayed local, so the loop, which reads main from origin, never saw it. A
  merge pushes main to any origin.
- A repo with no roadmap was reported as "roadmap is broken". It now says "no roadmap yet".

`lineclear doctor` also failed on the size of `/tmp`, which this machine's other work had filled; a fresh machine
does not have that.

Done before the run:

- The README now says how to install from a readable copy (`LINECLEAR_REPO`, `LINECLEAR_REF`) and lists the two
  blocks on a public install: a private repo and no license. Each was raised once in the Inbox as an outward ask.
- The install from a readable copy is shown by the fresh machine test of L31 (`.github/workflows/install.yml`, with
  `LINECLEAR_REPO` set to the checked-out copy), and by `test/install.test.ts`.

Before that, the "Install" section said only that the one-line install was coming and named neither variable.

## L31: the install test

The last runs of [`install`](https://github.com/jouni-mikkola/lineclear/actions/workflows/install.yml) on main
(2026-11-04) failed, five in a row, in both jobs:

- The test installed a commit, but a user installs a release. The doctor named `stable build` and `installed paths`
  because the service and the command ran from a checkout, not from `builds/current`. The test now tags the commit
  `v0.0.1` in its own copy and installs that, then installs `v0.0.2` and expects it to wait as a candidate.
- `machine add` ran `bin/lineclear` of the checkout against the stable folders, which it refuses. The job now sets
  folders and a port of its own, and installs the tag.
- The doctor also named `agent kit`: the installer takes the newest pi, `pi/kit.json` pins an older one. The test
  ignores that one row; the kit task owns it.

The README's status badge links to the workflow. Not proven here: a passing run on main. This branch could not run
the workflow (agents do not push); the first run after the merge is the proof, and a red one files a fix task.

## L30: README tells the truth

The README now has a Status section: what works (rules, waits, the stall ladder, the Inbox, the web views) and what
does not yet (the own fork, the merge lane). Its next steps after the install are `lineclear project add <repo>`
(second) and opening `http://127.0.0.1:7420/` (third, after the pi login). The install command is unchanged: it
fetches `install.sh` with `gh`, which works for anyone who can read the repo.

## L45: heavy suites take a check slot

Six tasks start a heavy suite at once, with N at 2 (`lineclear slot`, which the pi extension puts in front of a
heavy command). A suite here is 4 busy processes for 20 s, on a machine with 8 cores. Counted once a second
(2026-10-31):

```
                 suites at once  busy processes (peak)  wall time  failed suites
no slot          6               49                     21 s       0
with check slot  2               17                     61 s       0
```

The busy-process count includes each suite's wrappers, so read it as a ratio: a third of the load for three times
the wall time, and the suites that wait do so as `checks` waits.

Not shown by this run: the machine's load average stayed near 30 the whole time from other work, so it cannot show
a run staying under the load limit, and a synthetic suite has no browser to close. Add a run of real browser suites
here once the machine is quiet.

## Merges pass on a busy machine

Every merge runs the full check, so a test that holds a wall-clock limit can fail a merge for reasons outside its
change. Before the fix, on a machine with 8 cores, 13 tasks at work and the load average at 25 to 50:

```
                 tests   failed  wall time
plain main root  415     11      306 s
plain main srv   1127    5       309 s
```

The failures were 5 s test limits (true status, `/api/home`, restarts, day counts), sleeps that waited a fixed time
for another process, and tests that asked the real Shepherdr (10 to 15 s an answer under that load, 0.3 s refused).
The fix:

- No pass or fail depends on speed. Tests wait for the event (`until`), with hang guards of 60 to 120 s. `bun run
  test` points `LINECLEAR_URL` at a closed port, so no test asks the real server. `scripts/check.ts` prints its time
  and never fails on it. Engine test worlds stop their timers after each test, so an earlier test's sweep cannot run
  into a later one.
- How fast the parts are lives in `bun scripts/measure-speed.ts`. At load 22 on 8 cores: roadmap check of 400 steps
  137 ms, spend over 500 session files 163 ms on the first read and 26 ms warm.
- One full check at a time per repo: `lineclear check` and the merge lane wait in the repo's own line
  (`<config>/check-queue/<repo>`), first come first served, shown as "Waits for the check slot · N ahead". Two repos
  never wait for each other's line. The machine's limit stays the check slots, shared by every line and every
  `lineclear slot` run, with the load in mind. A head with no CPU use in its processes for 15 minutes shows as stuck in
  `lineclear status` and on Home, with the lock or process it waits for when the kernel tells. A project script must
  not keep its own global lock: it blocks everyone outside the line. It wraps the heavy part in `lineclear slot`.
  The merge lane rebases only once its turn has come, so the check runs on main as it is then.
- Every other heavy run takes a check slot (`lineclear slot`, 2 at once): the project's `heavy` commands (detected
  from package.json when a project has none), and a browser suite, a build, a linter or a whole `bun test` run
  straight. One test file stays free.
- Tasks at work default to cores minus 2 (`machine.maxTasks`), and the load limit is per core (`loadPerCore` in
  `machine.json`, 1 by default), not one number for every machine. Cores minus 2 is a starting rule, not a measured
  best: two cores stay for the checks, the merges and the server. The table above shows that 13 tasks on 8 cores
  is too many.

`bun scripts/under-load.ts [runs]` runs `bun run check` in a row and adds busy loops (at nice 19) only for the
cores the machine leaves free, so on a busy machine its real load is the test. Results:

```
run 1 of 3: passed in 852 s, load 41.1 on 8 cores, 0 busy loops
run 2 of 3: passed in 725 s, load 21.5 on 8 cores, 0 busy loops
run 3 of 3: passed in 434 s, load 18.5 on 8 cores, 0 busy loops
```

## L42: every machine moves to Lineclear

Not yet a real run: the build machine reaches no second machine over SSH (`ssh localhost` fails its host key check, and
no other machine is added in Settings), so a real move of two machines is still to do. Run this on the main machine
with each other machine added, and paste the output here:

```
lineclear migrate --all --dry-run
lineclear migrate --all
lineclear status
```

What a test shows: `test/all-machines.test.ts` moves this machine and a second one reached through a stand-in `ssh`
(its own HOME, its own Shepherdr 2.0 folder and its own Lineclear folders). `--dry-run` lists the spaces and open
tasks of each and copies nothing. The real run moves both, and one Home, one Inbox and one `lineclear status` show the
work of both, read over SSH from each machine's own `lineclear export` and never from a Shepherdr file.

## U50: Home leads with decisions

The board's Home frames (`home-d`, `home-p`, `home-clear`, `home-many`, `chat-d`, `st-load`, `st-stale`, `st-long`) draw
what waits for you only as a count on the Inbox tab: the rail carries it in amber (`Inbox 2`) and the bottom bar as a
badge. `test/board-home.test.ts` reads those frames from the board's own script and passes: every headline starts "Line
clear.", no frame has "wait for you", an ask card or an answer button, and the Inbox tab shows its count in the rail
(1440 px) and the bar (390 px). The Inbox tab exists in the board's rail and bar; the later Home design (U62) moves the
asks into a strip on Home and is its own step.

## U24: Home, cold

A fresh model that had never seen Lineclear looked at one screenshot of Home (`ui/test/screens/home-filled-1440.png`,
the sample state) and was asked "What is going on here? What is running right now, what waits for me, and what is
done?". It ran as a headless pi on `claude-sonnet-5` with no tools and no other context, on the screenshot of the
merged branch. Its answer, word for word but for its dashes made colons:

> This is a Lineclear dashboard: a tool that runs multiple software projects through an automated pipeline (Dispatcher → Planner → Worker → Reviewer), only pinging you for real decisions.
>
> **Waiting on you (3):**
> - `C3` in **web-shop**: "Pay with a saved card" needs your input
> - A question in **mail-queue** about "Retry with backoff" (Q2): no estimate yet, nothing can start until you answer
> - One more decision (3rd item: likely also tied to web-shop/mail-queue per the "3 to decide" count; the panel only lists two by name, so check the Inbox for the full list)
>
> **Running right now (5 at work):**
> - `C4` web-shop: "Search that forgives typos"
> - `b1` billing-api
> - `M7` mobile-app: "Offline mode for saved lists"
> - plus 2 more workers building steps
>
> **In review / nearly done:**
> - `C5` web-shop: "Order history page" is in review
> - `Retry failed webhooks` (billing-api) is ready to merge
> - `docs-site`: fully done, 9/9 steps merged
>
> **Stalled:** billing-api's "Invoices in more currencies" shows "no sign of life": worth a look.
>
> **Cost:** $7.35 today, $73.05 over 14 days; most of today's usage (58%) came from the work-subscription.
>
> Want me to open the Inbox to see exactly what the 3rd pending decision is?

It names what runs (5 at work, which ones, the review and the merge in line), what waits for you (3, and which two
the page names) and what is done (docs-site whole), and it finds the stalled task. Nothing in it is wrong.

## L46: a full subscription hands work on

A task whose model call fails with a full session or week is moved to the role's next model in the same tick, and
the account is marked full until the reset time its error names.

The reset time is read from the errors pi's own session files hold. Run over the quota errors of the pilot's last
week (2026-10-31), `readLimit` gave, for the error time and the error text:

```
error at (UTC)        limit    full until (UTC)      error text ends
2026-10-23 18:21      week     2026-10-25 14:00      resets Oct 25, 4pm (Europe/Helsinki)
2026-10-25 17:25      session  2026-10-25 17:30      resets 7:30pm (Europe/Helsinki)
2026-10-25 21:36      session  2026-10-25 22:30      resets 12:30am (Europe/Helsinki), the night the clocks went back
2026-10-27 09:48      week     2026-10-29 21:00      resets Oct 29, 11pm (Europe/Helsinki)
2026-10-29 14:30      session  2026-10-29 18:00      resets 8pm (Europe/Helsinki)
```

A live handover, 2026-11-01, of two running tasks on the full account `claude-bridge-c`. In `decisions.jsonl` (what
`lineclear` keeps of each decision), the tick that found the account full:

```
2026-11-01T19:36:43Z  stall  claude-bridge-c is full until 2026-11-01T23:00:00.000Z: LIN-178 hit its session limit
2026-11-01T19:36:43Z  stall  rung 3: closed LIN-175 (the account of claude-bridge-c/claude-sonnet-5-5 is out) and started U34 again on claude-bridge-b/claude-sonnet-5-5, from work/175-u34-an-error-keeps-what-you-sa
2026-11-01T19:36:43Z  stall  rung 3: closed LIN-176 (the account of claude-bridge-c/claude-sonnet-5-5 is out) and started U42 again on claude-bridge-b/claude-sonnet-5-5, from work/176-u42-real-screenshots-by-one-co
```

Their lines in `moves.jsonl`, both in the same second as the full mark:

```
2026-11-01T19:36:44Z  LIN-175  U34  claude-bridge-c/claude-sonnet-5-5 -> claude-bridge-b/claude-sonnet-5-5  the account of claude-bridge-c/claude-sonnet-5-5 is out
2026-11-01T19:36:44Z  LIN-176  U42  claude-bridge-c/claude-sonnet-5-5 -> claude-bridge-b/claude-sonnet-5-5  the account of claude-bridge-c/claude-sonnet-5-5 is out
```

The mark ran to 23:00 UTC, the reset time the error named. The tasks restarted from their branches and notes, since
the session could not go on with another account's model.

## Steps run on a second machine

A project lists extra machines in its `settings.json` (`"machines": ["desktop"]`). When this machine has no room
(its Shepherdr slots, load or check slots), `lineclear run` starts a ready step whose locks are free on the first listed
machine that has room: its `maxTasks` not reached, its load under its limit, a check slot free. The repo is cloned there
once from the same origin, as `~/code/<space>`, and the task is made through that machine's own Shepherdr. Locks and
`after` are read over every machine's tasks, so no step runs twice. A machine that cannot be reached is skipped and
noted as a `machine:<host>` decision, and never blocks the rest.

One real start, 2026-11-01, on a second machine (12 cores, 14 GB, reached with `ssh`, the Shepherdr helper) from a trial
project with a one-step roadmap whose step only reports `hostname` and `nproc`. The start decision line, `lineclear run
--once`:

```
trial  Z1  start  ready, locks free, slot free on desktop; worker claude-bridge-c/claude-sonnet-5-5, reviewer claude-bridge/claude-opus-5-5
```

The clone was `~/code/lineclear`, the space `lineclear` was added there, and its Shepherdr listed the task as `LIN-2
Z1 Say where you run`, which ran to done ("Nothing to merge"). Here the step showed as `LIN-2@desktop` with the text
"on desktop" in the roadmap view, the same way a local task does.

Not yet recorded: a day of the live loop with the machine enabled for Lineclear itself.

## L44: work goes where there is room

The start on a machine with room is the one under "Steps run on a second machine": a ready step with no slot or no
load room here starts on the first listed machine that has the repo, a slot and a load under its limit, and the
decision line says why. Added for L44: before the start, the project's secrets go to that machine over SSH on stdin,
into the same file outside every repo (mode 600), and only when a step starts there. `test/second-machine.test.ts`
covers the secrets, a start on the other machine, and no start without room.

Added for LIN-167: a task made by hand that waits for a slot here ("Waiting for a free slot") starts on the first
machine of its project with room, with the same title and brief, and is closed here. `"local": false` in a project's
`settings.json` keeps it off this machine, so it starts only on its `machines`. Every remote command sets its own PATH
(`~/.local/bin`, `~/.bun/bin`) and calls the helper at `~/.lineclear/helper/bin/shepherdr`, never the remote shell's
PATH or the old `~/.shepherdr` folder. `lineclear machine add` runs `doctor --fix --here` there, then clones each
project's repo the machine lacks from the origin the server uses; a repo that fails to clone leaves the machine
failed. `test/machine-add.test.ts` adds a machine with a bare PATH and no repos, and `test/second-machine.test.ts`
covers the held task and `local: false`.

Tasks started on a second machine get that machine's own id series (its space's prefix, such as `LINE-1`), not this
machine's. The roadmap view shows them with `@host`.

A real run, from `decisions.jsonl` of the rule loop on a two-machine setup (laptop, 8 cores, load limit 8, and
desktop, 12 cores, load limit 12), 2026-11-01. A step held here for load started on desktop in the next tick, and
the line before it names what desktop lacked:

```
21:43:11  L88  skip   load average is above the limit of 8, no new task starts; desktop: load average 14.1 is above its limit of 12
21:43:41  L88  start  ready, locks free, slot free on desktop; worker claude-bridge-b/claude-sonnet-5-5, reviewer opencode-go/glm-5.3
22:12:41  L90  skip   load average is above the limit of 8, no new task starts; desktop: load average 13.0 is above its limit of 12
22:13:11  L90  start  ready, locks free, slot free on desktop; ...
```

Times are UTC. Both held steps waited while desktop was over its limit (14.1 and 13.0 against 12) and started 30 s
later, when it had dropped under it. Laptop was over its limit of 8 in the line before each start; its exact load was
not logged then. The log has 49 starts on desktop. From this change the start line itself carries both loads, in the
form `slot free on desktop (load <there> of <limit> there, <here> of <limit> here)`; `test/second-machine.test.ts`
checks the shape, and the first live start after the update gives the figures. The skip lines of a project that is kept
off laptop (`local: false`) show the other side: with desktop at `15 of 12 working` the steps stayed held.

## L50: recovery with no manual step

Four faults, each run once by `test/recovery.test.ts` on a test machine (Linux 7.0, Bun 1.4.4, 2026-11-01), with real
processes and real state files in a temp folder. Before each fault (and the lost network) the project had a wait, an Inbox item and a decision
line on disk. Each run checks that all three are the same after the fault and that the next ready step starts.

| fault | how it was made | what came back | result |
|---|---|---|---|
| killed service | `lineclear run` stopped with SIGKILL, a step became ready while it was down, a new `lineclear run` started (systemd does this with `Restart=always`) | wait, item and decision unchanged; step started once | pass, 2.2 s |
| reboot | as above, plus what a power cut leaves: a half-written `.tmp` file and a lock file of a dead process | the same; the stale files were ignored | pass, 1.9 s |
| full disk | the write of a temporary file made to fail with ENOSPC half way (a state file and a wait), then a free-space limit above the real free space | the old files stayed whole and no `.tmp` was left; wait, item and decision unchanged; with space back the step started; Home showed "disk full" once with what to do, and the entry was gone once the limit was met | pass, 0.4 s |
| lost network | the network check pointed at a local listener that was stopped, with the fake `shepherdr` failing | Home showed "network lost" once; no step started, nothing lost; with the listener back the entry cleared and the step started | pass, 3.6 s |

Not the same as the real thing: the reboot is a SIGKILL plus the files a power cut leaves, not a power cycle, and the
full disk is a failing write, not a filled filesystem (a small tmpfs needs root), and no agent was at work during the lost network. `install.sh` turns on lingering
(`test/install.test.ts` runs it with a stub `loginctl`), which is what makes the service start at a real boot.

A real reboot of a machine with lingering on, from its journal (laptop, boot of 2026-10-31): the old boot shut down in order
at 19:18:25 and the new one began at 19:18:44. At 19:18:48 the user's systemd started a session of the kind lingering
makes, and `lineclear.service` started at 19:18:49 with no login: the first `tty` session came a second later, at 19:18:50.
`loginctl` still shows `Linger=yes` and the service has had no restart (`NRestarts=0`) since. This is a real boot, not a
cut of the power: an orderly shutdown, which does not test the half-written file case (the SIGKILL row above does).

A power cut (the plug pulled) of a machine with lingering on is its own step, L172, at the end of the roadmap. It would
end the work of every task on that machine, so it runs when the owner chooses.

## Dispatcher eval

`bun run dispatcher:eval` asks the Dispatcher's model each of the 58 requests in `test/dispatcher-eval/cases.ts`
(30 Finnish, 28 English; casual and with typos; status, inbox, plans, moves, two-project and no-project asks, and
refusals such as answering the Inbox or merging). The model is the Dispatcher space's `coordinator.model`
(`claude-bridge/claude-opus-5-5`), run as a headless pi with the brief in `templates/dispatcher.md`. Stand-ins for
`lineclear` and `shepherdr` record each call and answer with fixed text; the stand-in resolves a project or step name
with the real resolver. An answer is right when it makes the expected calls and no other change. Goal 100 %, never
below 95 %. It spends tokens, so `bun run check` leaves it out: run it before each release and in U43.

Runs, 2026-11-01, with the final stand-ins and tools, 4 to 6 answers at once:

```
brief          words  right            tokens per answer (all turns, with cache)  written
before         513    94.8 %           14200                                      404
after          467    100 %, 100 %     12900 and 13300                            324 and 331
```

The before brief missed three: it took "a command that lists all projects" for a command to run, did not know that
"U41 before U40" means U40 comes after U41, and wandered off on "u41 starts only when u39 and u40 are done". Each run
is one sample of a model that varies, so a single miss is not a trend.

What the eval found while the brief was written, all fixed:

- A wish that sounded like a command ("a command that lists all projects") was read as a command to run.
- "U41 before U40" was not known to mean U40 comes after U41, and `--after none` was not in the brief.
- A request with two parts for one project was split in two plans.
- A project written in Finnish ("budjetti") was passed as written and refused. The brief now sends the model to
  `lineclear dispatcher projects` for a word that is not the name; the tool reads case, a Finnish ending
  ("webshopan"), the repo's folder name and a typo of two letters.

Wrong ones listed per run are printed by the command itself, with the request and the call made.

Run for Release 0.1 (R3), 2026-11-03, on main plus the R3 branch:

```
brief                                       right            tokens per answer
main as it was (LIN-148 wording)            87.9 % (51/58)   16900
with the wording fixed                      100 % (58/58)    17100
```

Release 0.1 needs at least 95 %, so the first run stopped it. Six status asks and "start step U41 now" ran
`lineclear roadmap status` as an extra call, because the "Naming steps" line of the brief named it as a command that
prints the result line. The line now names `lineclear status` and `lineclear status --plan`, which the brief lists above it.

## Token pack

The pack (`pi/pack.ts`, one file per saving in `pi/parts/`) is in with the parts in the table. A part joins only with a row
here: tokens and $ per merged step with the part on and with it off, and the measurement it comes from. Each session
records which parts were on, and `lineclear measure` prints the split ("token pack <part>: on ..., off ...").
`test/pack.test.ts` covers the install of the pack, the switches, the record in the session and the split.

| part | tokens per merged step, before to after | $ per merged step, before to after | measurement |
|---|---|---|---|
| `compaction` | not yet measured per step | not yet measured per step | Modelled, not measured: of the 99 models pi lists on the build machine, 90 have a window above 150 k (median 500 k, largest 1.05 M) and none has an unknown one. Without the part a session of such a model compacts only near the end of that window, so the context sent on each turn can grow to the window; with it, the context stays under about 150 k, a cap of 70 % for the median model and 86 % for the largest. The per-step figure follows from 20 merged steps with the part on and 20 off (`lineclear measure`). |
| `cut-output` | not yet measured | not yet measured | no merged step has recorded it yet; per-result numbers below |
| `batched-reads` | not yet measured | not yet measured | 0 of 20 merged steps on, 0 of 20 off |
| `small-briefs` | no before figure (see below) | no before figure (see below) | With the small brief: 12 merged steps, median 2.19 M tokens and $0.77, mean 3.08 M and $0.97 per merged step. Without: no merged step left on this machine, so no saving is claimed. Details under "Small briefs (L56)". |
| `no-sleep` | not yet measured | not yet measured | 0 of 20 merged steps on, 0 of 20 off |
| `compaction-point` | not yet measured per step | not yet measured per step | Not measured: compacts a worker at 80 k, a reviewer and a coordinator at 70 k and the Dispatcher at 60 k (before L216: 100 k, 100 k, 80 k, none), the first try from the band table. Kept only if tokens and $ per merged step drop and merge rate, review findings and re-reads after a compaction do not get worse over 20 merged steps each side; see "Compaction by band (L216)" below and docs/kit.md. |
| `stub-results` | not yet measured per step | not yet measured per step | Not measured: a plain tool result of 3000 characters or more is replaced by a stub 8 turns after it was made. Kept only on the same rule; see "Compaction by band (L216)". |
| `compaction-notes` | not yet measured per step | not yet measured per step | Modelled, not measured; see "Notes before a compaction (L54)" below. |

`batched-reads` and `no-sleep` (L55) are in the pack and on, so that steps record them. Each needs at least 20 merged
steps with it on and 20 with it off (`lineclear pack off <part>`; `lineclear measure` prints "token pack <part>: on
..., off ..."). A part that saves nothing measurable then leaves `pi/parts/`.

Not yet recorded: a per-step figure for `compaction` and for `compaction-notes`, and the numbers of the two parts above.

### Compaction by band (L216)

`lineclear measure` prints "cost per call, context <band>: N calls, $X per call, Y % of the cost" for six bands of
prompt tokens (input, cache reads and cache writes of one call): 0-20k, 20-50k, 50-80k, 80-120k, 120-150k, 150k+. Only
calls of merged steps counted in the day table are in it, priced like the rest. The band table is what the compaction
points rest on: a point is set where a call starts to cost more than the work it adds. `test/measure-bands.test.ts`
covers the bands.

First try, set from that table and not yet confirmed: the points of `compaction-point` (80 k worker, 70 k reviewer and
coordinator, 60 k Dispatcher; the Dispatcher is found by `LINECLEAR_ROLE=dispatcher`, its rotation is L219) and the part
`stub-results` (`pi/parts/stub-results.ts`). The stub replaces a plain text result of 3000 characters or more with its
tool, its size and its first line, 8 turns after it was made, or after `{"stub": {"after": N}}` in `pack.json`. It is
never done to writes, edits, errors, images, the chat with the owner or the state file of the notes (L54), which keep
their place in the context and so survive a compaction. A stub changes the prompt from that result on, so the cache is
written again once; the small-result limit keeps that cheaper than the calls saved. Each is kept only when, over at
least 20 merged steps on and 20 off (`lineclear pack off compaction-point`, `lineclear pack off stub-results`), tokens
and $ per merged step both fall and merge rate, review findings and re-reads do not get worse; a part that fails this
leaves the pack. Before and after: not yet measured, no merged step has recorded the new values.
`test/stub-results.test.ts` covers the stub and a number of your own in `pack.json` that stays.

### Notes before a compaction (L54)

Near 90 % of the compaction point (the model's window less its reserve in pi's settings, 150 k with the `compaction` part, the role's point when that is lower: 100 k for a worker), on a turn that goes on, the part asks the agent once for a state file with five
headings (`## Done`, `## In progress`, `## Next`, `## Decisions`, `## Open`, under 6000 characters). At the compaction the
summary is the task, the owner's messages word for word, the files changed and that file, built with no model call.
A file up to 600 characters over is still used; a file still missing three turns after the ask, or one that cannot be
used, is asked for once more with the reason. A missing, old (written before the ask), too long or incomplete file then
falls back to pi's own summary. Coordinators, the Dispatcher and your own sessions get the same ask, with the owner's
messages in their summary. Every owner statement in a coordinator's or the Dispatcher's chat is added word for word to
the owner direction log (`~/.lineclear/owner-direction.md`, one line each with its line breaks shown as ` / `, newest
last), and after any compaction, pi's
own too, the latest 40 lines go back (a line over 1000 characters cut there, kept whole in the log) to coordinators, the Dispatcher and your own sessions. A task's agent keeps the owner's
messages in its summary instead. Where control-center's older `state-file` extension is still installed, the part turns
it off with its own settings switch, so no session is asked twice; it stays off when the part is turned off. `test/compaction-planted.test.ts` plants a long
session with a tell early on and checks that after the compaction the agent still reads its done-when, the latest tell,
its next step and the early tell. Home's Compaction card shows the compactions of the last 14 days, how many fell back,
and every session's tokens per task merged in them (coordinators included, so not the per-step cost `lineclear measure`
gives). The log
(`~/.local/state/lineclear/pack/compaction-notes.jsonl`) holds one `used` or `fallback` line, with the reason, per
compaction; `notesStats` in `pi/parts/compaction-notes.ts` gives the share that fell back. `test/compaction-notes.test.ts`
covers a good file, a missing one, one too long and the fallback.

Saving, modelled, not measured. pi's own summary is one model call over the messages before the kept tail (the tail
is 20 k tokens; pi cuts tool results to 2000 characters for it), so its input is a good part of the history, not all of
it. The notes cost one extra model request, the turn that writes the file: it resends the whole context (about the
size of the compaction point) and writes at most 6000 characters (about 1.5 k tokens). So on input the notes do not
save tokens: they trade pi's summary call for the notes turn, and the saving is the summary call's output, the
time it takes, and a summary that keeps the agent's own state. Whether the trade is a gain in tokens and $ per merged step
is not known until it is measured: 20 merged steps with the part on and 20 with it off, as for `batched-reads`
(`lineclear pack off compaction-notes`; `lineclear measure` prints "token pack compaction-notes: on ..., off ...").
`lineclear measure` also prints "token pack compaction notes: N of M compactions fell back to pi's own summary" from
the log. Recorded so far: 59 of 63 compactions used the notes and 4 fell back.

### Small briefs (L56)

A step's brief holds its why and done-when, the files it names or its `after` steps changed (at most 25), and the
project's `AGENTS.md`, under 12000 characters (`BRIEF_MAX` in `src/brief.ts`; the rules are cut first, then the file
list). It tells the worker to run `lineclear roadmap show <id>` instead of reading `docs/ROADMAP.md`.
`lineclear measure` prints "token pack small briefs: whole roadmap read before N of M sessions, after N of M
sessions". A session is "after" when its brief contains `lineclear roadmap show`. Only worker sessions count (the first message holds "Build step"). A session read the whole roadmap when it
read `docs/ROADMAP.md` with no offset or limit, or ran `cat` on it. `test/briefs.test.ts` covers the size, the
files, `roadmap show` and this count.

Measured 2026-11-01, `lineclear measure lineclear --since 2026-10-01`:

```
before the small brief   6 of 70 worker sessions read the whole roadmap
after the small brief    0 of 1 worker sessions (too few: the small brief starts with this step)
```

Measured 2026-11-04 over every worker session of this machine's lineclear worktrees (a script over pi's session files,
`roadmapReads` and `costOf`; `lineclear measure` itself found no lineclear project here):

```
before the small brief   1 worker task, 0 read the whole roadmap; 38.5 k tokens, $0.04
after the small brief    96 worker tasks, 0 read the whole roadmap; median 196 k tokens and $0.09, mean 2.12 M and $0.62
```

These are per worker task (all its sessions, merged or not), not per merged step, and the "before" side is one task, so
no before-to-after saving can be read from them. The roadmap read whole was already rare here; the figure that matters,
tokens and $ per merged step on and off, needs `lineclear measure` run where the lineclear project is registered.

Measured 2026-11-04 per merged step: the 12 steps merged on main whose worktrees (and pi sessions) are still on this machine, all
built with the small brief (a script over `worktreeUsage` and `costOf`; tokens are input, output and cache together):

```
with the small brief     12 merged steps; median 2.19 M tokens and $0.77, mean 3.08 M tokens and $0.97 per merged step
without the small brief  no merged step left on this machine (its one earlier task never merged)
```

There is no "without" figure, so no saving is claimed. `lineclear measure` cannot print the split here: this machine's
tasks live in another server's store, so no project is registered. The per-task figures above stay as measured.

### A browser opens at once (LIN-151)

Opening a session used to wait for its first full picture: a playwright-cli run, about two seconds of node start-up.
Now a card's thumbnail request also starts the full picture in the server, and the page keeps the last blob it read per
address. Opening a session shows the card's thumbnail in the same frame and swaps in the full picture behind it (the
first full read comes at the next 300 ms tick, then the usual second).

Measured 2026-11-01 by `ui/test/browsers.pw.ts` ("a click shows a picture within 100 ms and the live one within 1 s"),
in the page from the click event, at 1440 px, against the fake playwright-cli:

```
no delay in playwright-cli   picture 20 ms, live 330 ms
1 s per playwright-cli run   picture 45 ms, live 367 ms
```

The test fails above 100 ms and 1 s. Not measured here: a real playwright-cli on the live service.

## L-fast: the fast loop, the full check once

Workers run `lineclear check --changed` (types of the changed package with a cached incremental build, only the root and
server tests that reach a changed file, dashes of the changed files, the gates). The full check runs once per task, in the
merge lane, after the rebase, for every merge (before, only when main had touched the branch's files). The full UI suite
(`bun run ui:test`) joins that check only for the specs of the changed `ui/` files, and the whole suite runs in the full check; workers run `bun run ui:changed` (the specs of the views they
changed). Reviewers read the diff and the `--changed` result.

Before, from the agent logs of 31 Oct 19:25 to 1 Nov 19:25 (36 h) on the busy build machine:

```
what                                      before
bun run check, median / p90 / max         223 s / 328 s / 852 s (goal 190 s on an idle machine)
full checks per task                      about 3
failed runs that were tests               106 test, 85 server test (mostly load)
```

One probe on the same machine at load 10 to 20: `tsc --noEmit` took 77 s cold and 10 s on the second run with
`--incremental`; the server's takes 46 s cold.

After: add here once a day of merges has gone through the lane (full checks per task, minutes from ready to merged with
`lineclear measure`, load). The target is one full check per task and a `--changed` run under 30 s when the change
reaches few tests; a change to a file most tests import (`src/cli.ts`) still selects most of them.

## The check and flaky tests

A test that fails in the check and passes when run again alone is a flake. The check records it in `decisions.jsonl`
(stall class `flaky test`, with file and test name) and goes on. A test that fails again alone fails the check. The
second flake of one test within 24 hours files a fix task, once. The merge is not failed by a flake, so these records
are where to look for a test that depends on the machine's load or on a folder shared between runs.

## The merge check's budget

The merge check (`bun run check`) is 180 s on a machine that is not busy. It runs what the branch's change reaches and the
independent steps side by side; the full set (`bun scripts/check.ts --full`) runs on the newest main only, in the release loop,
and before a release is promoted.

Time of each step of the old check on main, one run at a time, on an 8-core machine at load 17 (so slower than idle):

```
step                      seconds
types                          64
root tests (629, 84 files)    456
dashes, words, shots, direction, roadmap, parts, media   under 2 each
gates                          19
server types                   79
server tests                  166
browser suite (ui)       over 900, stopped
the whole, in a row     over 25 min
```

The same on the branch's lane, load factor 1.0 (the check prints this table at its end and keeps it in `check-steps.jsonl`):

```
what the change reaches                   check time
src/ and server/ change, tests sharded    3 min 18 s before the shards were balanced by recorded time
docs only                                 the doc checks, a few seconds
```

What decides the scope:

- Tests: those whose imports reach a changed file (`scripts/changed.ts`), in up to 4 runs balanced by each file's last time.
- `server/` changed (not its docs): the server's types and tests; else neither runs.
- `ui/` changed: the specs of the changed views (one worker); the whole suite only in the full check.
- Docs only: dashes, words, shots, direction, roadmap, parts.

Limits, each failing the check by name, slowest first:

- A new unit test file over 5 s, or a spec over 20 s, fails (a file within 30 % over its limit is timing noise). Files already over are in
  `scripts/gates/baseline/slow.json` and may grow to three times that; fixing one lowers it: `bun scripts/check.ts --full --lower-slow` (`--add-slow` takes a new file in).
- A check over 180 s fails, with its slowest steps named.
- Both are measured as seconds divided by the machine's load when the run began (load per core, at least 1): a busy machine
  fails nothing for being busy.

The full set is the release loop (`lineclear release`, every 2 min): it takes main's newest commit only, never starts while a
run is going, and skips the full check for a commit whose full check already passed. A red run files one fix task.

Each lane run adds a line per step to `check-steps.jsonl` in the config folder: step, seconds, commit, mode, load factor.

## Cold look

`bun run ui:cold` gives fresh models the eight pictures of a first run (`docs/cold/`) and no docs, and asks who does
what, what happens and what waits for the user (12 questions each). Goal: 90 % right, three companies. A wrong answer
becomes a fix to the picture, never added text.

Measured 2026-11-02, eight pictures, 12 questions each (the parts and what each does, which part is lit in three
frames, what waits for the user, how the run ends):

```
Anthropic  claude-sonnet-5-5   12 of 12
Google     gemini-4-argon      12 of 12
OpenAI     gpt-6-sol           no answer: usage limit reached
```

Two of the three companies answered, 100 % right, so this is not yet a pass: the OpenAI run is open until its limit
resets. No picture fix came from a wrong answer yet.

## Idle cost (L153)

Step: L153, first part: a call to another machine's herdr no longer makes its own ssh connection.

| What | Connections made by calls | Measured by |
| --- | --- | --- |
| Before | one full ssh handshake per call (`ControlPath=none`), about 10 a second on a busy worker | a live reading of one worker's process list, before this change |
| After | none: each call is an ssh client over the one kept connection (`ControlMaster=auto`, `ControlPersist=600`) | `server/test/machine-recovery.test.ts`, "every call over the kept connection": fails when a call's ssh command has `ControlPath=none` |

herdr ends a bridge after one answer, so a call is still an ssh client process; it is a cheap one, with no key
exchange or login. The event subscription keeps one connection of its own, and the tunnel makes one per
(re)connection. The live cost after the change is not measured yet: it needs a worker running this commit.

Calls to the other machine run at most 6 at once, since sshd refuses a kept connection's sessions past `MaxSessions`
(10 by default). A kept connection that hangs stalls the calls on it until ssh's keepalive ends it (15 s, 4 misses, so
up to 60 s); each call still gives up after its own timeout.

## No Control Center left (L154)

Read on 2026-11-04 over SSH, each machine's `systemctl --user list-units 'cc-*' --all`, `list-unit-files` and process list.

| Machine | Units loaded or enabled | Processes |
| --- | --- | --- |
| laptop (this one) | only `cc-machine-backup-secrets.path` and its instance, which `docs/control-center.md` keeps | none |
| desktop | the same kept path; `cc-control-center`, `cc-playwright-dashboard`, `cc-tick.timer` and `cc-tailnet@` are disabled and not running | none of the servers or scripts; one `verify` run of the control-center repo's own gate, which is no unit |

`test/doctor.test.ts` plants a running unit and process and checks the doctor names them and `--fix` ends them. A machine
whose doctor names one is listed as left (`leftLines`) when it is added or updated.

## Step check

Not yet recorded: the side-by-side of the steps planned before the check with the steps planned with it (L65). This section holds no counted numbers for the steps before, only how they are counted.

The step check (L62) has a fresh model from another company read each new or changed step and say go or no-go before a plan
applies. It is kept only if it saves more than it costs. `lineclear measure <project> --since <day>` counts it per merged
step, with no AI, and splits the steps by whether a check answer exists for them:

- no-gos: answers of the check that said no-go;
- rework rounds: review rounds with a critical or major finding in the task's ready report, merge-tier check runs that failed
  on the task's branch (refused merges), and reverts on main that name the step;
- owner questions: need cards and Inbox items of the step's tasks;
- the check's tokens and dollars: the checking model's tokens in and out, priced from pi's model data.

Counting rules. A refused merge is a failed merge-tier check run on the task's branch; the log does not tell the merge lane's
runs from a task's own `lineclear check`, so both count as rework. Review rounds are read from the round numbers in the ready
report, so they are a count of what the report says. The check's tokens are the estimate the check keeps (a quarter of the
characters), so its dollars are an estimate too.

Review rounds per merged step (L241): `lineclear measure` prints the median and the most of the highest round number a step's
tasks name in their ready reports, and how many steps went past the project's review round limit. A clean first round
names round 1 only.

Before the check: no check answers exist for a step planned before it, so it has no no-gos and no check cost. The repo has had
no revert on main (`git log main --format=%s | grep -ci '^revert'` is 0). Its rework rounds and owner questions per step come
from Shepherdr's task files and the check-run log, which stay on the machine that ran the steps: `lineclear measure <project>
--since <day>` prints them as "step check, planned before the check", and "planned with the check" for the steps the check
read.

The verdict (L65). `lineclear measure` ends the step check lines with one verdict line. It waits until 20 steps planned with
the check have merged. Then the check stays on only when both hold:

- the check's dollars are below the dollars of the rework it saved: the drop in rework rounds per step against the steps
  before, times the steps planned with the check, times the price of one round. A round is priced as the mean merged step of
  the run, since a round redoes about that much work. This is an assumption, not a measured price;
- owner questions per step did not rise.

Otherwise `lineclear project set <name> --step-check off` turns the model call off. The form rule (`stepFormProblems`) stays
on, since it calls no model. `--step-check on` brings the call back.

State: waiting. Only 2 plans have a check record on this machine, so fewer than 20 steps planned with the check have merged,
and the two groups cannot be put side by side yet. The check stays on until the verdict line says off; when it does, this
section gets the numbers and the reason.

## U38

Fast on a phone. The limits are in `scripts/budgets.json`; `bun run check` runs `scripts/budget.ts` when a change reaches the views or the server's answers, and fails on any number over its limit.

How it is measured: a phone-sized browser (390 px, touch) on the demo with a roadmap of 319 steps, the network throttled to 100 ms round trip, 10 Mbit/s down and 5 up. The first view is the Home page's headline in the page. The layout shift is of the second visit, because Home keeps the height of each section from the first. The idle numbers are one minute of Home and of the roadmap open side by side. CPU and memory are the server process, from `/proc`.

The network profile is assumed, not measured on a phone: no phone was reachable from this machine. What was measured: `tailscale ping` to a machine on the tailnet takes 2 ms direct and 14 ms through the relay in Helsinki, so 100 ms and 10 Mbit/s is a slow 4G leg on top of it, as the step names. The demo server listens on 127.0.0.1 only, so this run is not against the Tailscale address; serving it there would open a demo to the tailnet, which is left for the owner to decide.

| number | before | after | limit |
|---|---|---|---|
| first view (headline shown) | 3.3 s | 0.65 s | 1 s |
| largest paint | not recorded | 1.18 s | 1.5 s |
| layout shift | 0.134 | 0.00005 | 0.01 |
| first view's JavaScript, compressed | 145 kB | 175.7 kB | 182 kB |
| idle Home, per minute | polled every 3 s | 0.16 kB | 50 kB |
| idle roadmap of 319 steps, per minute | 3.4 MB in 30 s | 0.16 kB | 100 kB |
| `/api/home` answer | not recorded | 15 ms | 200 ms |
| idle server CPU over 60 s | not recorded | 0.93 % of a core | 1 % |
| idle server memory | not recorded | 60 MB | 300 MB |

The JavaScript got bigger, not smaller: the 145 kB was the first view before the stream, the stream client and the lazy split are in the 175.7 kB. The step asked for 100 kB at most; React and react-dom alone are about 60 kB compressed and the stack is fixed in idea.md, so the budget holds the measured number and the gap stays open.

The views read one stream (`/api/live`): the server compares each watched answer every 6 s and sends only the changed values; a test (`test/live.test.ts`) changes one task and finds one patch of one value and no new read of `/api/home`. Every answer is gzip compressed.

Tokens per merged step: `lineclear measure` prints them in the day table next to the cost per merged step, and `test/measure.test.ts` checks the line on fixed data. The L57 section below holds the cost per merged step against the goal; the Health table above holds the whole-run token figure.

The check's time limit in `scripts/check-speed.ts` is 180 s plus 100 s, the measured time of the budget run, which runs only when a change reaches the views or the server's answers.

## U32

Settings lists each machine as a 52 px row: its host, "this machine" and Remove. A machine's state, doctor and load
are on Home; the Settings spec checks that no `[data-machine]` card and no load meter is on the page.

## U1: Home pictured three ways

The chosen Home (The line) is the app's own Home, so the prototype's bars are held on the app. `playwright test ui/test/home.pw.ts ui/test/views.pw.ts --project 1440` passed 24 of 24: Home in every state (empty, loading, error, long text, 200 items) at 1440 px, and for `task-start` and `task-finish` a 60 fps performance trace with no long task and a click during the motion that acts at once. The recordings are `docs/design/motion/home-task-start.webm` and `home-task-finish.webm`. The three direction pictures are drawings, as `docs/brand.md` says.

## Changed check: precise tests

`check --changed` took the tests a change reaches by imports, plus every test that names `bin/lineclear` once the change reaches the CLI. Now a full-suite run records, with a bun preload (`test/load-map-preload.ts`, on only when the check sets `LINECLEAR_LOAD_MAP`), the repo files each test loads, its own process and the bun processes it spawns included. The map is saved per commit under `~/.cache/lineclear/load-map/` (`scripts/load-map.ts`). `testsFor` uses the newest map whose commit the repo knows; files changed since that commit count as changed, a file the map does not know and a test it does not list go by the old rule, and the merge lane still runs the whole suite.

Tests selected for one changed file, before (measured on main, 125 test files):

| changed file | before | after |
|---|---|---|
| `src/limits.ts` | 93 | same until a map is recorded |
| `src/rules.ts` | 93 | same |
| `src/brief.ts` | 93 | same |
| `src/release.ts` | 93 | same |
| `src/secrets.ts` | 95 | same |

The "after" is not measured: it needs one full run on main to record the map, and this change ran only the tests it touches. What the map will show is bounded by what a test really loads, and `test/helpers.ts` imports `src/cli.ts`, which imports every command: any test that uses the helpers, and every CLI child, loads all of `src/`. So the selection stays near 90 until the CLI loads a command only when it runs it; that is the next step, in `docs/backlog.md`.

## Web never waits on the tick

The web server read the projects (`shepherdr` and `git` through `Bun.spawnSync`) on its own thread, so each read held up every request, `/favicon.ico` included. Now `src/projects-feed.ts` reads them in a worker thread of its own, once a second, and publishes a snapshot; a request takes the last snapshot and never waits on a read. (The rule tick already runs in its own process.) `test/web-never-waits.test.ts` holds that: with the feed's thread blocked in a 5 s read, `/api/home` and a static file answer within 200 ms.

`/api/home` over 20 s, polled every 20 ms from a separate process, while a read blocks 1.5 s of every 2 s (in the server's thread before, in the feed's after). The block is simulated, not the real tick:

| | requests | p50 | p95 | max |
|---|---|---|---|---|
| before | 243 | 0.8 ms | 2.4 ms | 1501 ms |
| after | 963 | 0.6 ms | 0.9 ms | 4 ms |

The p95 before hides the stall because a blocked server takes no requests at all: the max is the stall a page saw.

Slowest `/api/home` over 10 minutes of the live service (`bun scripts/home-latency.ts 10`, one request a second, ticks and the feed running, other agents' tests on the same machine): 563 answers, slowest 431 ms. That is above the 200 ms of the test, which uses an idle fake. The tick runs in its own process (`tickAway` in `src/rules.ts`) and the feed in a worker thread, so no read blocks the server; the gap is machine load, not measured further.

## Red merge checks

| number | before | after |
|---|---|---|
| merge checks red, in 24 h | 163 of 379 (43 %) | measured after the first full day on this change |
| red with no test named (a fast gate failed) | 119 of 163 | the same gates now run when the agent reports ready |

The budget run (`scripts/budget.ts`) scales its time limits (first view, largest paint, `/api/home`) by the run's load per core, never below 1; CPU, memory, size and layout shift stay absolute.

`check-runs.jsonl` names the failing gate and its first line (`gate`) and the tests red outside the change (`outside`); each of those tests gets one Fix task, once. Seven tests failed 11 to 19 times a day under load; their causes were an explicit timeout that overrode the check's, shared fixed temp folders and the machine's own config. The "after" figure is filled in from `lineclear check` runs, not estimated.

## U37

Every tap works: `ui/test/every-*.pw.ts` open Home, the roadmap, Usage, Chat and Settings at 390 and 1440 px, tap every link and button, compare each number with `lineclear export`, change the data under an open page, and open each view under a lost connection, a stopped service, a slow API, a malformed roadmap file and a roadmap of 1000 steps. They run in `bun run ui:test`. A new Inbox item took 5.3 s to reach an open page, because the server read its views only every 6 s; the server now reads the watched views again within about 1 s of a change in the Inbox folder, and the test holds it to 3 s.

Screenshots before and after the step, at 390 and 1440 px, for Home, the roadmap, Usage and Settings, are in `docs/u37/` (`before-<view>-<width>.png`, `after-<view>-<width>.png`) and on the pull request.

## U39

The fresh look: every view and state at 390, 768, 1440 and 2560 px next to its board frame, in `docs/u39/review.html`, with each finding tagged and marked fixed or raised. `U39=1 bunx playwright test ui/test/u39.pw.ts --project 1440` takes the pictures and `docs/u39/measure.json`; `scripts/budget.ts` gives the headline time. The pictures are the demo's `?state=` samples of 9 views in 6 states: Home, Roadmap, a roadmap step, a task, Inbox, Chat, Usage, Browsers and Settings. `/inbox`, `/chat`, `/usage` and `/browsers` open Home by decision (U62), so their rows show Home with its sheet or panel. The board has no frame for a task or a step, and none at 768 or 2560; those rows are judged against the design bar. The budget run was on a machine with a load of about 8.

| number | before | after | limit |
|---|---|---|---|
| headline time (first view, 390 px, throttled) | 0.90 s | 0.90 s | 1 s |
| largest paint | 1.08 s | 1.08 s | 1.5 s |
| layout shift, cold load, worst of Home, Inbox, Chat, Usage, Browsers (empty state at 1440 px) | 0.0148 | 0.0029 (worst of all 216 view, state and width rows) | 0.01 |
| layout shift, Roadmap, a step, a task and Settings | 0 | 0 | 0.01 |
| targets under 48 px at 390 px (distinct, all 54 view-state rows) | 1 | 0 | 0 |
| type sizes off the scale (12, 14, 16, 18, 22, 32, 48) | 0 | 0 | 0 |
| dead links (a link with no address, a malformed one, or a path no route draws; not a request to each destination) | 0 | 0 | 0 |
| first view's JavaScript, compressed | 182.8 kB | 182.8 kB | 182 kB |
| idle server CPU over 60 s | 1.10 % | not rerun | 1 % |

The JavaScript and CPU numbers were already over their limits on this machine's load before the step and are not changed by it. At 768 px (a touch tablet) buttons and rows are 44 px high; design.md holds 48 only at 390 px, so that is a minor finding, not counted above.

### Cold look at Home

A model from another company than the author (openai-codex/gpt-6.1-sol, no tools but reading the picture, no repo files) got only `home-filled-1440.png` and was asked "what is going on here?". Its answer, word for word:

> Five tasks are running, five queued, and one in review. Web-shop has merged 14/30 steps; billing-api, 41/52 tasks. Webhook retries are ready to merge; a checkout fix was added to the roadmap. Four items await you, including choosing a payment provider. One review failed checks, and a billing task shows no activity.

At 390 px (`home-filled-390.png`) it said: "Five projects are tracked. Web-shop is 14/30 steps through checkout; billing-api 41/52, mail-queue 3/10, mobile-app 6/15, and docs-site complete at 9/9. A task to fix the checkout terms-box placement was added, extending the schedule one day. Four items await you, including choosing a payment provider for saved-card payments."

It read what runs, how far, what is done and that decisions wait, but not that they wait in the Inbox: the link said only "4 wait for you". The step simplified again for that: the Dispatcher's link now reads "4 wait in the Inbox" (finding F7 in `docs/u39/review.html`). The pictures in `docs/u39/` were retaken after it; the answers above are of the picture before it.

## U21: unclear labels fixed

Settings and Home as they are on main, read by `ui/test/settings.pw.ts`, `ui/test/contrast.pw.ts` and `ui/test/home-line.pw.ts` at 390 and 1440 px (run 2026-11-05).

- Settings has the four sections Models, Projects, Machines to add and Secrets (test "Settings has four sections and no status"), not the four cards first named. U32 holds that shape; the Usage numbers live on Usage.
- Home has no line under a project: its rows are the line's tokens and the Inbox strip.
- Grey text reads at 4.5:1 or more on Home, Settings and the Roadmap (`contrast.pw.ts`, 3 of 3 pass at 1440 px).
- `value-change` is a named motion of `ui/kit/motion.ts` at 300 ms or less; numbers count and bars grow in it.
- Of the settings spec, the machine-add motion tests and "a model moves up" timed out at 60 s on a loaded machine in this run; this step changes no code, so they are not tied to it.

## Waste watch

The rule loop looks every 10 minutes (`src/waste-watch.ts`). A passed limit files one Fix task and shows "Waste: <what>, <number>" on Home. Each limit and its reason is in `LIMITS` in `src/waste.ts`.

| Class | Limit | Value on the first look |
| --- | --- | --- |
| Starts of one step in 24 h | 2 | 85 |
| Tasks ended without a merge in 24 h | 20 % | 84 % (334 of 399) |
| Skips of one lock in 1 h | 60 | 19 |
| Ready step skipped 10 times in 1 h with a slot free | 10 | 8 (20 slots free) |
| Merge checks red in 24 h | 30 % | 51 % (102 of 199) |
| Red merge checks naming no test in 24 h | 2 | 64 |
| Forks per second | 100 | needs two looks |
| Board API p95 | 3000 ms | needs 3 minutes of data |
| Tokens per merged step | 15 M | 162 M |
| Docs-only change checked for | 120 s | 762 s |

## L19: the real week of asks

`lineclear asks --days 7`, run on 2026-11-04 over this machine's chat files (`~/.lineclear/chatlog`):

```
44 asks: question 25, allowance 14, plan 2, merge-chat 1, login 1, permission 1
159 reports, not asks (154 closed, their task is done)
```

The three most frequent kinds a rule can answer (question, allowance, plan) have rules 5, 1 and 6. The counts are in
`docs/asks.md`. Only the permission prompt reaches the Inbox among the kinds seen.

## L73: old folders on every machine

Run on 2026-11-05 on the build machine: `lineclear doctor --here` shows `ok old folders archived` and `ok old folder free`; neither `~/.shepherdr` nor `~/.herdr-projects` exists.

The other machine in Settings, `laptop`, cannot be read from here: `ssh laptop` fails with `Host key verification failed`, and `lineclear doctor` prints `FAILED machine laptop`. So its folders are not proven absent.

What a test shows: `test/all-machines.test.ts` ("doctor names a machine that still has the old folders") reaches a second machine through a stand-in `ssh` with its own HOME. `lineclear doctor` names it (`box: old folders archived`), `lineclear doctor --fix` packs both folders there to `~/archive/<name>-<date>.tgz` and removes them.

To close the step, with `laptop` reachable, run `lineclear doctor` and `lineclear doctor --fix` on this machine and paste what they print for `laptop` here.

## L20: old server faults

Run on 2026-11-05. `ebb17d5` is Shepherdr 2.0 (https://github.com/eliasstravik/herdr-projects). Its first copy in this repo (`646c02f6`, names changed only) was checked out apart, and the test files below were copied into its `server/test/` and run with `bun test`. The same files on the fork pass.

| Fault | Test file | On the base | On the fork |
| --- | --- | --- | --- |
| Restarted agent misses its first message | `known-faults.test.ts` (from commit `0939faf1`) | 5 of 6 fail (the 6th is a case that already held) | all pass |
| Machine news wakes an AI | `old-faults.test.ts` | fails | passes |
| Tests leave folders in /tmp | `old-faults.test.ts` | fails | passes |

The tests named in `docs/known-faults.md` for the five faults of the step, run the same way (a fork-era test also fails on the base where it tests a feature the base never had, so the table lists only the tests of the faults):

| Fault | Test (file, name starts) | On the base |
| --- | --- | --- |
| `ready` without an id crashes | `source-*.test.ts`, "ready with no id is the task of the agent that says it" | fails |
| A task keeps waiting for a merged task | `engine-queue.test.ts`, "a task it waited for is merged and then deleted" | fails |
| A pull request merged by hand | `source-*.test.ts`, "known faults of the base > a pull request merged on GitHub by hand" | fails |
| Conflict markers reach main | `source-*.test.ts`, "known faults of the base > a branch with conflict markers" | fails |
| A brief typed while pi starts | `source-*.test.ts`, "the first message to an agent just started waits until herdr takes input" | fails |
| Machine news wakes an AI | `quiet.test.ts` (module `quiet.ts` does not exist on the base) | fails to load |
| The tests of `shepherdr-faults.test.ts` (quota, wake-up, resume, stale ready, panes, brief again, news, aborted) | the file imports `agent-start.ts`, which the base lacks | fails to load, so every test in it fails |

Two rows of the list were not Shepherdr 2.0 faults but faults of Lineclear's own rules and were removed. Not proven: the tests of the heavy-suite row and the remote-socket row were not run on the base.

## L83: a coverage floor per module

`bun run coverage` (root tests, 1001 tests, 295 s with coverage) gives each module of `docs/architecture.md` a floor.
A source file no test loads now counts as found lines with none hit, and `bin/lineclear` has an in-process test, so
`bin`, `kit` and `web` have floors too.

| Module | Floor % | | Module | Floor % |
| --- | --- | --- | --- | --- |
| bin | 75 | | scripts | 93.1 |
| brand | 99.2 | | server | 72.8 |
| check-line | 83.6 | | server-scripts, server-tests, plugins, screen, helper | 0 |
| cli | 89.9 | | shared | 32.8 |
| gates | 63 | | tests | 94.6 |
| kit | 23.2 | | ui-test | 94 |
| pi | 97.1 | | web | 56.7 |

The release runs the nightly tier after the full check (`scripts/release-tag.ts`, test "a failing nightly check
refuses"), and that tier includes `bun run coverage`. A module under its floor fails: `test/coverage-floor.test.ts`.
The server-side modules have floor 0 because the root tests do not reach them; the server's own tests do.

## L220: a task's brief is stored once

The brief of a task is a file, `tasks/<id>/brief.md`, written when it changes. `tasks.json` and the cold log keep its
path and size. `server/test/engine-briefs.test.ts` migrates a store of 100 tasks with 3.3 KB briefs inside the records
and checks every brief comes back unchanged.

| tasks.json, 100 tasks | Size |
| --- | --- |
| Brief inside the record | 301,839 bytes |
| Brief in its own file | 24,950 bytes (8.3 %) |
## U41: app and film move alike

Recordings of the four key motions of U24 in the app, before U41 (curves written by hand) and after (curves from `KEY` in `ui/brand/rail.ts`), in `docs/design/motion/alike/`, 1280 x 720, each pressed three times on the design page by `bun run ui:record`:

| Motion | Before | After | Frames beside the board |
| --- | --- | --- | --- |
| train | `before-train.webm` | `after-train.webm` | `train.png` |
| lamp | `before-lamp.webm` | `after-lamp.webm` | `lamp.png` |
| view change | `before-view.webm` | `after-view.webm` | `view.png` |
| track laid | `before-lay.webm` | `after-lay.webm` | `lay.png` |

The before files are recorded from the commit before U41 with the same record tests. The side-by-side frames (app left, board right, at the start, every 50 ms and the end) are in the same folder and pass `bun run ui:test` against the 5 % threshold of `docs/design.md`.


## U35: the view change, before and after

One frame of going from a project's roadmap to Home, 140 ms into the move, at 390 and 1440 px (`docs/u35/`). `U35=before|after bunx playwright test ui/test/u35-shots.pw.ts` holds the view's own animation at 140 ms and takes the picture. Before is the commit ahead of U35 (the 200 ms fade, so the view is already whole); after is this branch (the view is still 24 px off its place and fading in over 280 ms). The recordings of the view change and the Chat panel are `docs/design/motion/view-change.webm` and `chat-open.webm`.

| width | before | after |
| --- | --- | --- |
| 390 px | `docs/u35/before-390.png` | `docs/u35/after-390.png` |
| 1440 px | `docs/u35/before-1440.png` | `docs/u35/after-1440.png` |
## U57: the old UI list confirmed

The list in `docs/design.md` ("The old UI's views") went to the owner once with `lineclear ask` (Inbox item 58, kind outward, choices "Confirm" and "Change it") on 2026-11-05. The Dispatcher answered for the owner with the approval it holds and took "Confirm": the list stands as written. Moves: task chat, reactions, terminal, artifacts, worktree, keyboard and search. Goes: voice, autopilot. Lineclear has it: places, coordinators, tasks, browser, settings, health, alerts.


## U60: the task tabs and the search move

Picking a task's tab (Terminal, Artifacts, Changes) fades its content in, and `/` fades the search box in, both as the `part-change` motion (160 ms, opacity only, none under reduced motion). `docs/design/motion/task-tabs-search.webm` records them (`bun run ui:record`): keys `2`, `3`, `4`, `1` pick each tab in turn, then `/` opens the search and "cart" finds its three results. `ui/test/task-live.pw.ts` passed 9 of 9 at 1440 px: the screenshots of every state of each tab, and a test that `part-change` plays on a tab pick and on the search box and nothing plays under reduced motion.

## U26: the frame, before and after

The frame at 390 and 1440 px on the Settings view, before (the committed picture ahead of this branch) and after (`docs/u26/`). The bottom bar under 1024 px holds Home only, Settings is the gear at the top right, and no tab carries an Inbox count. `ui/test/frame.pw.ts` takes every view (Home, Settings, a roadmap, a step) at 390, 768, 1440 and 2560 px into `ui/test/screens/`, checks the rail, the 1128 px content width and its centring, and opens each address cold and after a reload.

| width | before | after |
| --- | --- | --- |
| 390 px | `docs/u26/before-390.png` | `docs/u26/after-390.png` |
| 1440 px | `docs/u26/before-1440.png` | `docs/u26/after-1440.png` |

## L15: a real move of an old install

Run with the real binary (not a stand-in) on the files of a real Shepherdr 2.0 board: `spaces.json`, `settings.json` and
`tasks.json` (332 tasks, 1.8 MB), copied to a scratch HOME as `~/.shepherdr`. This build machine has no live
`~/.shepherdr`, and its archive holds only the helper. The board has no chats or artifacts, so those counts are 0.
Output, trimmed to the lines that matter:

```
lineclear migrate --dry-run
4 spaces, with their settings
332 tasks, 7 open
0 task chats, 0 space chats
0 artifacts, 0 versions, 0 files
Files: spaces.json, settings.json, tasks.json
Dry run: nothing copied.
lineclear migrate
Copied. <HOME>/.shepherdr is unchanged, so the old install can start again.
lineclear migrate --check
ok     mainRed: 0 before on the old install, 0 on Lineclear
ok     needsYou: 0 before on the old install, 0 on Lineclear
ok     stalls: 0 before on the old install, 0 on Lineclear
```

`sha256sum` over every file of `.shepherdr` (3 files), before and after, gave the same digest.

Not shown: a task that starts, waits and merges on the fork after the move, so `--check` compared two empty runs; the
tests with stand-ins cover that part. Not shown either: a move with chats and artifacts on a real board.

## U56: the Inbox chat link opens

The chat address setting was removed on purpose by U58: the Inbox chat link is now the relative `/task/<id>`, so it opens at whatever address the page was reached at and no port is guessed. `ui/test/views.pw.ts` ("a waiting task's chat link opens its chat in this UI, never another port") checks the href is `/task/WEB-3`, follows it and sees the task view. `lineclear doctor` still names the published address when it does not answer (`test/doctor.test.ts`, "doctor fails when the published address of the web pages does not answer"). Not proven: a run behind a real Tailscale Serve proxy.

## L164 Every link opens the new UI

`test/notify.test.ts` sends four kinds of Inbox item through the server's own push code and fails unless each payload opens `/inbox`, and on the old port, `?place=`, `focus=`, `./` or `#/`. `test/contracts/inbox.test.ts` holds the three Inbox hrefs and the published address. The server's task, `?tab=` and browsers links (`/task/<id>`, `?tab=terminal|artifacts|changes`, `/browsers`) are held by `server/test/alerts.test.ts`. A push for an Inbox item used to open Home; it now opens the Inbox. Not proven: emails (the server sends none) and the old UI's own pages, which stay as they are.


## L86: one way for each job

The copy baseline (`scripts/gates/baseline/copies.json`) is empty, so under half of what it was. Time wording now has one keeper per tree:

| Tree | Keeper | Callers that had their own helper |
| --- | --- | --- |
| UI kit | `ui/kit/format.ts` (`ago`, `clock`, `exact`, `when`) | `ui/kit/notice.tsx` |
| Server and its screen | `server/shared/time.ts` (`age`, `ago`, `clock`, `clockWithDay`) | `engine-helpers.ts`, `source-helpers.ts`, `machines-helpers.ts`, `Settings-Pages.tsx`, `src/main.tsx`, `tasks-lists.tsx`, `chat-messages.tsx` |

## L161: lock-held stalls in the decisions log

`decisions.jsonl` from the merge (2026-11-04 12:26 UTC) to 2026-11-05 05:20 UTC: 0 lock-held stalls, so none is left without a remedy line or a "waits for the owner" reason. The remedy by holder status is proven by the planted test in `test/stall-class.test.ts`, not by a live stall. Read before the day after the merge ended.

## L157: no-sign-of-life stalls after one server per data folder

`decisions.jsonl` from the merge (2026-11-04 16:44 UTC) to 2026-11-05 06:30 UTC: 14 no-sign-of-life stalls of tasks, and in every one the last sign (`since`) lay at least 20 minutes before the stall card, so none is for a task that reported its status or wrote its log in the 20 minutes before it. The lines of step L13 are the merged-unproven kind, not a task's stall. Read 14 hours into the day, before the day after the merge ended.

## U14: Settings and Browsers add up

Each proof runs on sample data (`ui/test/u14.pw.ts`, `test/browser-sessions.test.ts`):

| Claim | Test |
| --- | --- |
| A machine over its load limit reads "busy", never "ready", and its overflow bar is grey, not amber | `a machine over its load limit reads busy and its overflow is grey` (the `/design` machine at 4.6 of 4) |
| The Browsers view has no headline count and no badge of its own, so there is nothing to disagree. Its one count, "Other sessions (N)", is the sessions no task holds, and task browsers plus those are all the open sessions | `the sample sessions split into task browsers and Other sessions, and the two add up to all of them` |
| A card shows its task's title and the page's host, not the page title | `a browser card shows its task's title and the page's host`, `a card names its task and the page's host` |
| A browser has a placeholder until its first picture comes | `a task's browser has a placeholder ... until its first picture comes` |

## L39: Home shows what the doctor finds

Run on 2026-11-05: `ui/test/add-project.pw.ts` starts `lineclear run` on an empty config. Home lists each problem `lineclear doctor` finds with its fix command (`[data-doctor]`), and the test checks that the first fix shown is a `fix:` line of `lineclear doctor --here` on the same config. The same file adds a project from the page, and `lineclear project list` shows it. Both pass at 1440 px.

## Release 0.1

Dispatcher eval for the release, 2026-11-05, on main: 58 of 58 right (100 %, goal 100 %, never below 95 %), 16830 tokens per answer, model `claude-bridge/claude-opus-5-5`.

Merges to main per day, from `git log origin/main` (the first commit is 2026-10-31):

```
2026-10-31  105
2026-11-01   77
2026-11-02   27
2026-11-03   92
2026-11-04  112 (so far)
```

The target (ROADMAP, "In the cut") was a release within 5 hours of the cut's start. Not reached on 2026-11-05: `bun run release 0.1.0` refuses because the full check is red on this build machine. Its UI step failed 73 of 481 specs: motion traces under load (60 fps, long tasks), and page-height screenshot diffs such as 9384 px expected and 9344 px received. The date reached is filled in when the tag exists.

## U15: the same type with other system fonts

The pictures of `/design` (`ui/test/design.pw.ts`, 1440 and 390 px, every state) and `ui/test/font.pw.ts` (every letter
drawn in Geist) were run on one commit twice, with the same Playwright Chromium, against one set of pictures.

| System fonts | `sans-serif` and `system-ui` fall back to | Result |
|---|---|---|
| This machine: DejaVu, Liberation, Nimbus, Free, Noto | DejaVu Sans | 7 passed |
| Another set (`FONTCONFIG_FILE`): only URW and Free fonts | URW Gothic, `monospace` is FreeMono | 7 passed |

The second set has no font in common with the first one's fallback, so a letter that fell back would change the picture.
A real second computer was not reachable (the one in `machines.json` fails its SSH host key); the font set is what
differs between machines, so this stands for it. The pictures were stale against the page (40 px of height), and were
written again from this run before the two comparisons.

## U59: recordings of the terminal and artifact motions

`LINECLEAR_UI_PORT=<port> RECORD=1 playwright test ui/test/record.pw.ts --project 1440 -g "task terminal|task artifacts"` passed 2 of 2. The recordings are `docs/design/motion/task-terminal.webm` (the tab fades in, a line is typed and sent, a key is sent) and `docs/design/motion/task-artifacts.webm` (the tab fades in, a card opens full screen and closes).

## L274

`lineclear measure lineclear --refiles` on the build machine, run on 5 Nov (the last 7 days). The live store holds only the fix tasks since a failed update wiped it on 3 Nov, so the history of L8, L101, L107, L108 and L109 is gone. In what is left, 7 steps have two fix tasks in one 24 hours and none has more. The 5 with the most, all tied at 2 in a day, largest first:

| Step | Most in 24 hours | Causes |
| --- | --- | --- |
| L0 | 2 | first, ended merged |
| L149 | 2 | first, ended unmerged |
| L156 | 2 | first, ended merged |
| L2 | 2 | first, ended unmerged |
| L3 | 2 | first, ended merged |

L76 and L8 are also at 2 (both first, then ended merged). No refile was a `missed open` or `open elsewhere`: each fix task was filed after the one before it had ended.

## Server loop

L307. The board is `bun server/test/loop-board.ts [seconds]`: 400 tasks, 10 agents at work, 4 UI sockets, a change of the board every 100 ms and a read of `/api/snapshot` every 250 ms. It prints the lag and CPU figures that `lineclear measure --server` prints (the same `measureLoop`). Goals: p95 lag under 50 ms, main-thread CPU under 15 %.

The profile (`/api/loop-profile`) put nearly all loop time in building the snapshot, then pushing it. Top paths and what was done:

- The next runs of each timer rule, worked out with rrule on every snapshot (`nextWords`): cached for the minute they were worked out in.
- Clock times worded with `toLocaleTimeString`, which builds a formatter on each call (`clock`): one shared formatter.
- The model lists of the registry rebuilt for every settings row (`fromRegistry`): worked out once per read of the registry.
- One snapshot push stringified once for all UI clients, not once for each, and not at all when none is open.
- `nvidia-smi` (a synchronous spawn in the health tick) and `ps` for a worker's command (`running`) moved off the loop: the first is asked beside it, the second reads `/proc`.

`server/test/loop-hot.test.ts` fails when a request or a change on that board spawns synchronously or reads a file over 100 KB.

| | p50 | p95 | max | main-thread CPU |
| --- | --- | --- | --- | --- |
| before | 43.9 ms | 130.5 ms | 227.9 ms | 44.1 % |
| after (3 runs, a shared machine) | 0.1 to 0.5 ms | 3.6 to 15.8 ms | 37 to 80 ms | 8.6 to 12.4 % |

Not done: the macOS fallback of the background-job reader still runs `ps` on the loop (Linux reads `/proc`); no test board reaches it.
