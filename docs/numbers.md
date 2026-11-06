# Numbers

Figures that the README film shows. Other measurements stay with the people who run Lineclear.

## README film

Every number in `docs/readme/line.svg` (three beats, 14.6 s), and where it comes from. The film shows no other number.
Each is measured on the pilot project of L8, read on 2026-10-31.

```
number      beat            source
143.3 min   1 the problem   median wait from ready to start on 2026-10-30, before rules: lineclear measure <pilot>
                            --since 2026-10-30, 143.3 min over 7 tasks
1.3 min     3 the result    median wait from ready to start with rules running: the same measure run, 1.3 min over
                            27 tasks on 2026-10-31
```

`test/readme-film.test.ts` fails when the film shows a number that is not in this list. The film's size, 63.2 kB, and
its length, 14.6 s, are held by the same test (under 150 kB, 12 to 15 s).

## Lock waits on another area

`decisions.jsonl` was read for the 24 hours after L263 merged (2026-11-05 07:40 UTC to 2026-11-06 07:40 UTC),
while the rule loop started this repo's open steps as usual. It has four `stall` lines of the class `lock-held`
for this repo. Each is a wait on the same area:

```
waiter  lock     holder  shared
L172    rules    L212    part rules
L302    release  L281    lock release, part install
L69     ui       U71     part ui, which L69 needs whole
L100    inbox    L47     part inbox, lock inbox
```

No line has a holder and waiter that share no lock, no file and no part.
