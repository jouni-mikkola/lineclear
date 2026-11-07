# Release v0.2

What v0.2 is, as numbers anyone can check, the owner's priorities that rank every step, the order the parts land in,
and the rule that keeps parallel steps off each other's files. The steps are in [ROADMAP.md](ROADMAP.md). A release
goes out only when every check below holds on one commit of main.

**v0.2 in one sentence.** Lineclear runs 45 or more agents on 3 machines with little memory and CPU of its own, starts
each step once, never stalls, leaves nothing behind, and a swarm of agents merges more steps per hour than one agent,
for no more tokens per merged step, on any project.

## The owner's priorities

Every step is ranked by the first priority it serves, and the roadmap orders its batches by rank. Nothing ranks above P1.

| Rank | Priority | What it asks of a step |
| --- | --- | --- |
| P1 | The core loop works | Add a step, an agent builds it, a review, a merge, the next step: nothing stalls, crashes or runs twice |
| P2 | Simple | Fewer parts, one way per job. A step that adds a part removes more lines than it adds, or names the core job of [scope.md](scope.md) only that part serves. Clean-up and the layout that stops collisions rank here |
| P3 | No wasted tokens | A budget per role and per task, measured, and a step that enforces it |
| P4 | Any project | A repo with no special setup gets the same flow, proved on a second small repo |
| P5 | The theme | One graphite theme from [brand.md](brand.md), `ui/brand/tokens.css` and [design.md](design.md): green clear, amber waits for you, red only broken, in every view. Every web step checks it |

## The first batch

v0.2 starts with batch 1, first in [ROADMAP.md](ROADMAP.md): twelve P1 steps on disjoint files, each with
`after: none`, so all start at once. L521 (one phase per task), L525 (a merge waits on events), L510 (prompts by RPC), L508 (revival from
the exit event), L506 (worktrees without herdr spaces), L561 (one tick reads facts once), L587 (one way to run on a
machine), L600 (questions go to the project chat), L602 (three Inbox kinds), L603 (the Dispatcher plans), L549 (small
stores read loud) and L546 (a store copy is one file). The other open audit steps stay open behind them, so the
machines never wait: the goal is at least 50 free steps on disjoint files at all times. With the audit steps alone,
29 open steps have `after: none`, and some share files; the plans' steps bring the count to 50. Each plan's steps are added in
batches of 10 to 20 as its file lands, and a step that collides or that v0.2 does not need is fixed or removed. The
core plan's first ten (L700, L705, L701, L702, L704, L703, L582, L600, L707, L706, ranked below) come next.

## The checks

Each check has an id (R1 to R22) and its rank. A meter that does not exist yet is built by a step of the part named in
brackets; the meters that exist are modes of `bun scripts/core-baseline.ts`. "Over a week" means the 7 days before the
release commit, on every machine.

### P1: the core loop works

| Id | Must hold | Measured by | Today |
| --- | --- | --- | --- |
| R1 | 45 or more tasks are Working at once across 3 machines for 10 minutes, no machine above its slots, and no machine's free memory under 1 GiB | `core-baseline.ts load` samples the one task list and each machine's free memory once a minute (core) | shown only with fake machines in a test (L460) |
| R2 | One agent (pi and its model bridge) uses 450 MB RSS or less at the median | `core-baseline.ts resources` reads the RSS of each agent's process tree (core) | about 420 MB |
| R3 | Lineclear's own processes use 400 MB RSS or less on the main machine and 100 MB on another, and 5 % of one core or less over 10 minutes with 45 agents working | `core-baseline.ts resources` (core) | not measured |
| R4 | Every step id has at most 1 task over a week, and 0 tasks end with "Nothing to merge" in under a minute | `core-baseline.ts twice` groups the task list by step id (core) | 795 tasks for 37 steps in one hour |
| R5 | Over a week, at most 1 pull request per step, and 0 open pull requests whose task is closed | `core-baseline.ts prs` joins `gh pr list` with the task list (flow) | 59 duplicate pull requests open |
| R6 | 2 stall lines an hour or fewer, 0 of class `unknown`, 0 owner taps for a stall over a week | `core-baseline.ts stalls` | 15.5 an hour (before L456) |
| R7 | `lineclear task add` to the agent's first tool call: 10 s or less at the median, 15 s at p90 (stricter than the 30 s of numbers.md), over 20 tasks | `core-baseline.ts start 20` | 23.5 s and 24.6 s |
| R8 | Ready to merged: 5 minutes or less at the median and 15 at p90; 0 tasks at Ready for over 30 minutes with green checks | `core-baseline.ts land` (flow) | not measured |
| R9 | 0 unplanned restarts of the board server and the rule loop over a week | `systemctl --user show lineclear -p NRestarts` on each machine, and the loop's own restart count (core) | not measured |
| R10 | At least 19 of the last 20 `check.yml` runs on main are green, and a red main is green again within 10 minutes | `core-baseline.ts gh 20`, which also prints each red spell's length (flow) | main went red 6 times in one day |
| R11 | The whole `check.yml` run: 45 s or less at the median, 60 s at p90, no job over 5 minutes | `core-baseline.ts gh 20` | 47 s and 68 s |

### P2: simple, clean, no collisions

| Id | Must hold | Measured by | Today |
| --- | --- | --- | --- |
| R12 | Worktrees: one per task that is not done; 0 bytes in worktrees of done tasks | `lineclear doctor` prints the count and fails when it is over (agents) | 136 stale worktrees, 9 GB |
| R13 | Local branches: one per task that is not done, plus main | `lineclear doctor` (agents) | 162 |
| R14 | pi session files of finished tasks are gone and the session folder is 300 MB or less; `~/.lineclear/workers` is gone or 50 MB or less; 0 herdr tabs and 0 test servers of finished tasks | `lineclear doctor` (agents) | 3,690 sessions, 2.1 GB; 635 MB |
| R15 | 5 % or fewer of merged pull requests needed a rebase for a conflict, over a week | `core-baseline.ts conflicts` reads the merge lane's rebase records (layout) | not measured; the layout plan counts it |
| R16 | 38,000 non-test lines or fewer by the count of scope.md, test lines 31,229 or fewer, and scope.md has no open delete or merge verdict | `core-baseline.ts lines` (layout) | 41,485 non-test lines |
| R17 | `bun run gates` green, no file over 600 lines, and in non-test `.ts` and `.tsx` files: swallowed errors 50 or fewer, sync spawns 0 in `server/server/`, timer calls 40 or fewer; each count is a gate that only falls | a ratchet in `scripts/gates/` with the counts below (flow) | 108 swallowed, 8 sync spawns in `server/server/` (59 in all), 75 timers |

The counts of R17 run over `git ls-files '*.ts' '*.tsx'` minus paths with a `test/` folder, `.test.` or `.pw.ts`:
swallowed errors match `\.catch\(\(\) => [^{]|catch \{ *\}`, sync spawns `spawnSync|execSync|execFileSync`, timer
calls `\b(setTimeout|setInterval)\(`.

### P3: no wasted tokens

| Id | Must hold | Measured by | Today |
| --- | --- | --- | --- |
| R18 | On one machine, the same 10 consecutive steps on disjoint files: the swarm merges at least 2 times as many steps per hour as one pi agent doing them in a row, and spends no more tokens per merged step, every role counted | step L609 (10 steps and this bar), by the method of [roles.md](roles.md) (The first measure) | about 1.5 merged steps an hour across all projects, no token count |
| R19 | New input per session at p90: a project chat (the coordinator today) 1 M tokens or less, the Dispatcher 500 k; per task agent 40 k at the median and 150 k at p90; reviewer 40 k at the median. A task or chat over its budget is compacted or stopped by a rule, not by a person | `core-baseline.ts chat-tokens 20` and `tokens 20`; the enforcing step (flow) | 12.7 M, 2.8 M, 76 k / 195 k, 73 k |

### P4: any project

| Id | Must hold | Measured by | Today |
| --- | --- | --- | --- |
| R20 | A second small repo with no Lineclear file of its own, added with `lineclear project add`, merges 5 steps in a row with 0 owner taps, and meets R7 and R8 | a run on that repo, its numbers in numbers.md (flow) | not measured |

### P5: the web UI and its theme

| Id | Must hold | Measured by |
| --- | --- | --- |
| R21 | Each role of roles.md does its job in the web UI at 1440 and 390 px: the owner states a goal in the Dispatcher chat, sees its steps on the Roadmap, opens a task (header, chat, terminal, changes), answers a login card in the chat and takes over a browser; Settings shows each role's models. The 8 views of roles.md exist and the Inbox view does not | a `playwright-cli` walk of each flow on a dev server, with its screenshots in the release pull request (web) |
| R22 | Every view draws its empty, loading, error, long text and 200 item states with no clipped text, every colour comes from `ui/brand/tokens.css`, and red shows only for something broken | the `?state=` samples walked with `playwright-cli` at both widths, and a gate that fails on a colour literal outside `ui/brand/` (web). No browser suite runs in a check (`test/light-checks.test.ts`) |

## How the release is measured

The last step, "v0.2 measured", runs every meter on main at one commit, writes the table into
[numbers.md](numbers.md) under "v0.2" and names each check that fails. A check that fails gets one step to fix it, and
the measure runs again. When all hold, `bun run release 0.2.0` tags the release; publishing it leaves the machine, so
it waits for the owner.

## The parts and their order

Five plans feed the roadmap, each with its own ids, so two planners never pick the same one:

| Part | Plan | Ids | Owns |
| --- | --- | --- | --- |
| core | `docs/plan/core.md` | L700 to L729 | the one store, the task phase, claims, placement, workers that hold no state |
| agents | `docs/plan/agents.md` | L730 to L759 | pi RPC agents, herdr only for the panes a person types into, clean-up of worktrees, branches, sessions and tabs |
| layout | `docs/plan/layout.md` | L760 to L789 | folders by domain, no hub files, the line target |
| flow | `docs/plan/flow.md` | L790 to L809 | checks, review, merge, pull requests, token budgets, the swarm measure |
| web | `docs/plan/web.md` | W100 to W129 | the views of roles.md, their states and the theme |

The batches follow the ranks: the core loop (P1), then clean-up and the layout that stops collisions (P2), then token
budgets (P3), then any project (P4), then the web (P5). Two rules hold inside that order:

- **A module moves once.** A layout step moves a module after the last v0.2 step that rewrites it, never between a
  rewrite and its follow-ups. Splitting a hub file is not a move and goes early. Code a step deletes is never moved.
- **A reader waits for its writer.** A step that reads a new field names the step that writes it in `after`.

A step already merged or being built is not written again; a follow-up is a new step with it in `after`. Out of v0.2:
the steps frozen by the owner (L95, L172, U43) stay in their section, and no new feature, role or view is added.

## The file rule: one step per file at a time

Main went red 6 times in one day because parallel steps edited the same files. These rules keep two running steps off
one file. The lead checks them when a batch is merged, until `lineclear roadmap check` checks them (a layout step).

1. **The files line is the lock.** `files` lists every path a step changes, adds, deletes or moves, tests included. A
   path that ends in `/` claims the whole folder. `locks` is `none`: the rule loop then holds the step's files while
   it runs and starts no other step whose files overlap them (`fileClash` in `src/parts.ts`). A named lock turns that
   off for its step, so every step in ROADMAP.md has `locks: none`.
2. **`after` for code, files for timing.** A step that needs another step's code names it in `after`. Two steps that
   list one path but do not need each other's code get no `after`: the file lock runs them one at a time.
3. **Small.** A step changes one module of [architecture.md](architecture.md), or one folder, in 8 paths or fewer. A
   change that crosses a border is two steps: the writer of a field first, its reader after it.
4. **Hub files have one owner at a time.** These files are listed by at most one open step, and only when changing
   them is that step's job: `docs/ROADMAP.md`, `docs/scope.md`, `docs/numbers.md`, `docs/architecture.md`,
   `package.json`, `bun.lock`, `.github/workflows/check.yml`, `biome.json`, `knip.jsonc`, `src/cli.ts`,
   `ui/web/routes.ts`, `server/server/live/prompts.ts`. Only the measuring steps (L609, "v0.2 measured") write
   numbers.md, and only the recount writes scope.md.
5. **Tests go with their module.** A step lists the test files it adds, changes, moves or deletes. A step that deletes
   code deletes the tests of that code and names them. A step that moves a module moves its tests in the same commit.
6. **A move changes nothing else.** A step that moves files holds the old and the new folder and changes no behaviour.
7. **A new file goes in its module's folder.** No new top-level folder or module without a layout step that adds it to
   architecture.md.

## Core steps by rank

| Rank | Step | Priority | After |
| --- | --- | --- | --- |
| 1 | L700 The core loop has one test | 1 | none |
| 2 | L705 Ready tasks join a merge queue | 1 | none |
| 3 | L701 Tasks are rows in the store | 1 | L503 |
| 4 | L702 A task has one phase | 1 | none |
| 5 | L704 Stalls run on deadlines | 1 | none |
| 6 | L703 A closed task closes its PR | 1 | none |
| 7 | L712 The queue checks the real head | 1 | L705 |
| 8 | L708 A step is claimed by a row | 1 | L701 |
| 9 | L709 The phase is stored | 1 | L701, L702 |
| 10 | L710 The start waits for pi's word | 1 | L703, L709 |
| 11 | L711 Turns end by pi's word | 1 | L705, L710 |
| 12 | L716 Leftovers are swept | 2 | L703 |
| 13 | L707 One id series in the store | 2 | none |
| 14 | L706 A store copy is one file | 2 | none |
| 15 | L719 Old record fixes are gone | 2 | L701, L705 |
| 16 | L715 Merge has one setting | 2 | L712 |
| 17 | L714 A merge step can be stopped | 2 | L712 |
| 18 | L720 The engine is composed | 2 | most core steps |
| 19 | L717 A task stops at its budget | 3 | L704, L709 |
| 20 | L718 Any repo runs the loop | 4 | L700, L712 |
| 21 | L713 The queue lands in trains | 4 | L712 |

The agents, machines and web plans add their own rows here.

## Web steps by rank

Web comes last in the order; inside it, steps rank by the priority they serve. Plan: [web](plan/web.md).

| Rank | Step | Priority | After |
| --- | --- | --- | --- |
| 1 | W106 Roadmap counts match Home | 1 | none |
| 2 | W108 No Terminal tab on a task | 2 | none |
| 3 | W109 No terminal route | 2 | W108 |
| 4 | W124 Pages update one way | 2 | none |
| 5 | W125 The server sends on change | 2 | L701, W109 |
| 6 | W115 Setup is a Settings tab | 2 | L603, L605 |
| 7 | W117 Usage is a view in the frame | 2 | L605 |
| 8 | W118 Usage shows tokens per step | 3 | W117, L609, L717 |
| 9 | W110 The task header says what it is | 3 | W108 |
| 10 | W103 One project key in links | 4 | none |
| 11 | W105 A repo with no roadmap works | 4 | none |
| 12 | W104 The step page names its project | 4 | L567, W103 |
| 13 | W100 Theme gate for every view | 5 | none |
| 14 | W101 Working trains are white | 5 | none |
| 15 | W102 Chat and box marks not orange | 5 | none |
| 16 | W112 Rail and bar after the Inbox | 5 | L605, W103 |
| 17 | W123 Home shows each machine | 5 | L580, L606 |
| 18 | W120 Home rows say the result | 5 | L606 |
| 19 | W121 Tables draw a window | 5 | none |
| 20 | W122 The line never cuts a project | 5 | none |
| 21 | W114 Chat folds repeats, windows 200 | 5 | none |
| 22 | W113 Browsers has its own empty state | 5 | none |
| 23 | W116 Settings draws every state | 5 | W115, W123 |
| 24 | W111 Changes tab draws every state | 5 | none |
| 25 | W107 Roadmap opens short | 5 | W106 |
| 26 | W126 State changes have named motion | 5 | W112, W117 |
| 27 | W127 The web passes the UI bar | 5 | the other web steps |
