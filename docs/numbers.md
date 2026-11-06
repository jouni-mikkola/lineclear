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
