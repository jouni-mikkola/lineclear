# Release v0.2

## The owner's priorities

1. **The core concept works first.** Add a step, an agent builds it, review, merge, next step, with nothing
   stalling, crashing or running twice. Nothing else ranks above it.
2. **Simple.** Fewer parts, one way per job. A step that adds a part removes more than it adds, or names the core job
   only it serves.
3. **No wasted tokens.** A budget per role and per task, measured, with a step that enforces it.
4. **Fast and agile for any project,** not only Lineclear itself: a repo with no special setup gets the same flow,
   tested on a second small repo.
5. **The theme follows the name and logo** ([brand.md](brand.md), `ui/brand/tokens.css`, [design.md](design.md)):
   one graphite theme, green clear, amber waits for you, red only broken, in every view. The web steps check it.

Order: core loop reliability, then cleanup and layout that stop collisions, then token budgets, then any project,
then web.

## v0.2 starts with

These 10 steps have disjoint files and locks and no `after` between them, so all start at once. L701's `after`,
L503, is merged. L582 keeps its machine half (no `remoteSeen`, no per-machine `tasks.json`); the
task table is L701's.

| Rank | Step | Priority | Plan |
| --- | --- | --- | --- |
| 1 | L700 The core loop has one test | 1 | [core](plan/core.md) |
| 2 | L705 Ready tasks join a merge queue | 1 | core |
| 3 | L701 Tasks are rows in the store | 1 | core |
| 4 | L702 A task has one phase | 1 | core |
| 5 | L704 Stalls run on deadlines | 1 | core |
| 6 | L703 A closed task closes its PR | 1 | core |
| 7 | L582 One task store (machine half) | 1 | ROADMAP (one brain across machines) |
| 8 | L600 Questions go to the project chat | 1 | ROADMAP (a question never stalls a task) |
| 9 | L707 One id series in the store | 2 | core |
| 10 | L706 A store copy is one file | 2 | core |

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
