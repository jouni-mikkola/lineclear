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
