# Numbers

## Lock waits on another area

`decisions.jsonl` was read from the first L263 start (2026-11-05 05:51 UTC, before L263 merged) to 2026-11-06 07:40 UTC,
a window wider than the 24 hours after the merge, while the rule loop started this repo's open steps as usual. It has
four `stall` lines of the class `lock-held` for this repo, none between 04:11 and 12:35 UTC on 2026-11-05.
Each is a wait on the same area:

```
waiter  lock     holder  shared
L172    rules    L212    part rules
L302    release  L281    lock release, part install
L69     ui       U71     part ui, which L69 needs whole
L100    inbox    L47     part inbox, lock inbox
```

No line has a holder and waiter that share no lock, no file and no part.

## Cost per phase

Made by `lineclear measure phases --last 30` on the last 30 tasks. CPU is 0.0 until the server has recorded it, and a task on another machine has none.

```
29 tasks. Input is tokens sent to the model, fresh and read from cache. Wall time is a call and the tool it ran; a reviewer's calls add tokens and no wall time.

phase       calls     input  cache writes  output  wall min  cpu min
start          31     93916        340438    6150       4.9      0.0
reading       333   9615072        510745   85651      62.6      0.0
coding         65   2699991         92576   72644      28.8      0.0
tests          61   1964012         80988   16164      99.0      0.0
review        144   3314577        288590   76729      20.9      0.0
check wait      3     69614          1384     455       5.5      0.0
finishing      62   2400518         47734   17443      59.7      0.0
all           699  20157700       1362455  275236     281.4      0.0

cpu min by kind: none

task      median call  largest call    input  min to ready
LIN-1216         7892         13902    15784           0.2
LIN-1215        43442         74178  2344746           1.1
LIN-1214        35193         79077  2884244          24.1
LIN-1213        25093         39726   684516          22.9
LIN-1212        38944         61195  1436134          23.9
LIN-1211        33319         53058  1095888          23.8
LIN-1210        21944         24402   125484           0.4
LIN-1209        30937         36227   437885           2.5
LIN-1208        21883         24935   255296           0.8
LIN-1207        29444         42189   981214           7.0
LIN-1206        19785         22978   121421           0.9
LIN-1205        20261         33850   606238           4.8
LIN-1204        19700         22932   276887           3.5
LIN-1203        25689         30904   369988           2.4
LIN-1202        29837         35441   480883           4.7
LIN-1201        23438         26219   248776           6.6
LIN-1200        24789         28987   165775           0.5
LIN-1199        19099         23341    98655           0.5
LIN-1198        23059         43234   764730           7.1
LIN-1197        21012         26010   344459          11.3
LIN-1196        20993         26882   198988           0.9
LIN-1195        29965         37012   658961          14.8
LIN-1194        36484         49873  1460176          10.9
LIN-1193        22161         24792   192743           5.8
LIN-1192        26591         32566   475070           6.5
LIN-1191        22534         30645   536423           8.7
LIN-1190        28503         33593   427312          12.7
LIN-1189        18869         29113   577106          19.4
LIN-1188        33252         60167  1891918          26.1
```

## Check failures

Read with `lineclear measure checks --days 2` on 2026-11-07. Cancelled runs are ones a newer push replaced. A test is flaky when it failed and passed on the same commit, or on main when the next main run passed with no `fix` commit between.

| | runs | green | red | cancelled | flaky test | real break | gate | setup | time limit |
|---|---|---|---|---|---|---|---|---|---|
| main | 66 | 15 | 31 | 20 | 1 | 30 | 0 | 0 | 0 |
| pull requests | 118 | 84 | 32 | 2 | 0 | 13 | 19 | 0 | 0 |

| failing test | runs | cause | longest |
|---|---|---|---|
| a task's question on its needs-you card in its space's chat > answered in the task chat instead: the card follows, and says where | 25 | flaky test | 60.3 s |
| a head released twice in a row has its agent restarted | 18 | real break | 0.4 s |
| a read that began while a write ran is not shared once the write is done | 8 | real break | 0.1 s |
| doctor names a problem and its fix, and exits 1 | 6 | real break | 1.6 s |
| install replaces the link an older install made, and doctor fails a link | 6 | real break | 1.7 s |
| where lingering needs root, install prints the one command and doctor names it | 6 | real break | 2.9 s |
| a head in "Rebasing on main" with no git process for 15 minutes is released, the task behind it lands, the head is told why | 5 | real break | 60.3 s |
| a task's CLI, model and effort > Settings' for tasks, unless the coordinator chose others for this one; only on its first start | 5 | real break | 60.5 s |
| Queued after other tasks > refused: a task that is not there, itself, a circle; those done already are not waited for | 5 | real break | 0.4 s |
| Queued after other tasks > task queue: queues a task at work (its agent is told to hold on), changes what it waits for, and clears it | 5 | real break | 60.2 s |
| a string done_when and an object with steps work | 4 | real break | 0.1 s |
| a turn the provider cut off > the backup agent takes over once, in the same worktree, with the brief and what was done so far | 4 | real break | 0.1 s |
| every state imports, checks, and done survives in the commit | 4 | real break | 0.1 s |
| making a new project > a new folder gets git on main and a first commit | 4 | real break | 0.0 s |
| making a new project > an existing folder keeps its files, uncommitted | 4 | real break | 0.0 s |
| on GitHub: a pull request per task > main moved on GitHub without a conflict: merged as it is, its passed checks kept, no new push | 4 | real break | 1.5 s |
| on GitHub: a pull request per task > merge opens the pull request itself when the agent never did, and merges it at the commit here | 4 | real break | 0.6 s |
| Queued from the command > task add --after queues it; task queue changes or clears it; what is not there, or a circle, is refused | 4 | real break | 0.3 s |
| the example in docs/import.md imports | 4 | real break | 0.1 s |
| a coordinator's alert about a task > says what the task needs, then the why, in place of the task's own alert | 3 | real break | 4.4 s |
| a task's own progress (lineclear status) > its agent reports a line, % done and time left; the task shows it while it works, frozen while it waits on you, gone once done | 3 | real break | 60.1 s |
| every process, timer, store, loop and gate has a row | 3 | real break | 0.0 s |
| starts here and on another machine share the cap | 2 | real break | 0.1 s |
| (unnamed) | 1 | real break | 0.1 s |
| a task's question on its needs-you card in its space's chat > a choice card answered on the card: it goes to the task, both copies say where, the coordinator hears it | 1 | real break | 4.2 s |
| every subcommand that the code, skills and templates call is a lineclear command | 1 | real break | 0.0 s |
| machine link recovery > failed SSH/name lookup recovers inside the same worker, every call over the one shared bridge | 1 | real break | 0.3 s |
| no source file writes a state file in place | 1 | real break | 0.0 s |
| the start caps read LIMITS.starts.limit, so the rules and the waste watch hold one number | 1 | real break | 0.0 s |
| three checks with two slots still run one at a time, and the two after the first declare checks waits | 1 | real break | 0.3 s |
