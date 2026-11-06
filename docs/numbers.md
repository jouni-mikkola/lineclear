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

Made by `lineclear measure phases --last 30` on the last 30 tasks. CPU is 0.0 here: the server records it from L416 on, so tasks before it have none.

```
30 tasks. Input is tokens sent to the model, fresh and read from cache. Wall time is a call and the tool it ran; a reviewer's calls add tokens and no wall time.

phase       calls     input  cache writes  output  wall min  cpu min
start          33    109336        354034    6590       5.2      0.0
reading       377  10890740        562818  142295      73.7      0.0
coding          3    109611          1022    4840       0.5      0.0
tests          54   1532089         72412   13266      68.1      0.0
review         90   1957390        171412   46586      17.5      0.0
check wait      4    116587          1558     573      14.8      0.0
finishing      57   2114354         42371   15677      44.5      0.0
all           618  16830107       1205627  229827     224.2      0.0

cpu min by kind: none

task      median call  largest call    input  min to ready
LIN-1215        44396         64746   964832           1.1
LIN-1214        47461         75172  1421134           6.2
LIN-1213        23802         30557   166245           2.7
LIN-1212        27346         34901   378331           3.5
LIN-1211        31910         47015   422067           6.3
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
LIN-1187        38215         57418  1511087          31.7
LIN-1186        21746         24218   270023           7.6
```
