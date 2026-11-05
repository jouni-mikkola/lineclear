# Truth audit 4: done steps

Each `done when` item of 32 done steps, checked on origin/main (c863845e). Verdicts: true, partly, false. Only reading and the named cheap commands were used. A screenshot item counts as true when the pull request's files hold both 390 and 1440 px pictures. Steps with a false or partly item are reopened in `docs/ROADMAP.md`, with one exception: `lineclear roadmap check` (`proofFaults` in `src/roadmap.ts`) refuses a `Reopened:` line when the `docs/numbers.md` section the step names has no "Not yet recorded" line for it. That holds for U38, L42, L44, L45, L46, L51, L52, L53, L54 and L55: their rows below are false or partly, yet they stay done in the roadmap. Their fix is to mark the gap in `docs/numbers.md` with "Not yet recorded" (or to record the figure), after which the roadmap line can be added.

| step | item | verdict | proof |
|---|---|---|---|
| U45 | step page with chain, waits, history | true | `src/step-page.ts`, `test/step-page.test.ts`, `ui/test/step-page.pw.ts` |
| U45 | screenshots on the PR | true | PR 282: 8 png, 4 at each width |
| U46 | chain with critical path, one tap from the line | true | `ui/web/roadmap/chain.tsx:42`, `ui/test/chain.pw.ts:7`, `src/progress.ts:168` |
| U46 | screenshots on the PR | true | PR 295: 28 png |
| U47 | since you last looked (step is dropped in the roadmap) | true | `ui/web/roadmap/since-look.tsx`, `test/roadmap-since.test.ts`, PR 151: 4 png. Remark: the drop line says Home marks it (U62), but no such code exists in Home; the code stays on the Roadmap page |
| U48 | one page of goals, A4 print, no step ids | true | `src/goals.ts`, `test/goals.test.ts:22-49`, `ui/test/roadmap.pw.ts:33,50`, `docs/design.md:150-159` |
| U49 | plain words on every Roadmap page | true | `ui/test/roadmap-words.pw.ts` (its code list is a hand list, not read from brand.md) |
| U30 | /inbox is Home, strip, Undo | true | `ui/web/app.tsx:246`, `ui/web/inbox-strip.tsx:8`, `ui/test/home.pw.ts:89,110`, PR 304: 68 png |
| U31 | chat panel 400 px, stays open from 1920 | true | `ui/web/frame.tsx:31,112,162`, `ui/test/chat-panel.pw.ts` |
| U32 | four sections, 52 px rows on a phone | true | `ui/web/settings.tsx:30`, `ui/test/settings.pw.ts:43` |
| U32 | Settings shows no status | partly | `ui/test/settings.pw.ts:107-116` expects machine state and "Load 2.50 of 4" in Settings |
| U33 | Agent browsers is Home's, done session leaves in 3 s | true | `ui/web/app.tsx:252`, `ui/test/browsers.pw.ts:85`, PR 153: 18 png |
| U34 | designed trouble states | true | `ui/kit/notice.tsx:24`, `ui/test/errors.pw.ts:38-125` |
| U35 | motion kit, named motions, 60 fps trace | true | `ui/kit/motion.ts`, `ui/test/bar.ts:213`, `docs/design/motion/*.webm` |
| U35 | screenshots on the PR | false | PR 276 has 2 webm and 0 png |
| U36 | words list and checker | true | `docs/brand.md:99-104`, `scripts/check.ts:181`, `bun scripts/words-check.ts` passes with no output |
| U37 | taps every link, numbers equal the CLI, live in 3 s, trouble states, call-outs | true | `ui/test/every-tap-*.pw.ts`, `every-numbers*.pw.ts`, `every-live.pw.ts:10-28`, `every-trouble-*.pw.ts`, `every-numbers-usage.pw.ts:28` |
| U37 | screenshots before and after on the PR | false | PR 287 has no png |
| U38 | first view 1 s, LCP, shift, CPU, memory, stream | true | `docs/numbers.md:890-918`: 0.65 s, 1.18 s, 0.00005, 0.93 %, 60 MB; `test/live.test.ts` |
| U38 | first view JavaScript at most 100 kB | false | `docs/numbers.md:911`: 175.7 kB, "the gap stays open"; budget is 183 kB |
| U38 | measured once against the Tailscale address | false | `docs/numbers.md:894`: profile assumed, demo on 127.0.0.1 |
| U38 | tokens per step next to L57's number | partly | `docs/numbers.md:914`: "L57 has no number of its own" |
| U38 | screenshots and traces on the PR | false | PR 284 has no png |
| U54 | layout shift 0 on every view, cold and after reload | true | `ui/test/still.pw.ts:157` over `/`, `/inbox/1`, `/settings`, roadmap, `/chat`, `/usage` |
| U54 | live data replaces only what changed, no blank frame | true | `ui/test/still.pw.ts:172`, frame recorder at `:121` |
| U54 | screenshots on the PR | true | PR 294: 7 png, 3 at 390 and 4 at 1440 |
| L42 | `migrate --all`, `--dry-run` | true | `src/migrate.ts:347-353`, `test/all-machines.test.ts:62,75` |
| L42 | one Home, status, Inbox of every machine | true | `test/all-machines.test.ts:75,108,117` |
| L42 | version per machine in Settings, doctor names one behind | true | `ui/kit/settings.tsx:192`, `src/doctor.ts:281`, `test/all-machines.test.ts:138` |
| L42 | a real move of two machines in numbers.md | false | `docs/numbers.md:408`: "Not yet a real run" |
| L43 | doctor names what is left, `doctor --fix` removes it | true | `test/all-machines.test.ts:165` |
| L43 | agents point to no Shepherdr 2.0 | partly | `pi/direction-log.ts:15,20,35` still name Shepherdr (as the task store); no check found |
| L43 | `migrate --back`, the README says so | partly | `test/migrate.test.ts:130` covers the round trip; `grep migrate README.md` finds nothing |
| L44 | start on another machine, secrets, tests | true | `test/second-machine.test.ts:126,159,237` |
| L44 | worktree, merge, Home shows machine | true | `docs/numbers.md:531-536` (`@host` in the roadmap view) |
| L44 | real run with the load of both machines | partly | `docs/numbers.md:538-553`: desktop's load logged, laptop's "not logged then" |
| L45 | heavy list, `project add` fills it | true | `test/heavy*.test.ts:46,140` |
| L45 | extension runs a heavy command in a slot, `checks` wait | true | `test/heavy*.test.ts:154,168` (four suites, N at 2) |
| L45 | recorded run stays under the load limit, no browser test reruns | false | `docs/numbers.md:342-360`: "Not shown by this run", load stayed near 30, no browser |
| L46 | move to next model in a tick, account marked full to reset | true | `docs/numbers.md:457-475` (live handover 2026-11-01, `readLimit` over five errors) |
| L46 | Usage shows each account free or full, and which tasks moved | false | "full until" is in Settings' model list (`ui/test/settings.pw.ts:73`), not on Usage; no moved-task list |
| L47 | manifest, icons, service worker | true | `ui/web/public/manifest.webmanifest`, `sw.js`, `icon-*.png` |
| L47 | push per new item and per red main; no `shepherdr alert` in rules | true | `test/notify.test.ts:52,76`, `src/notify.ts` |
| L47 | HTTPS on a private network, README in three lines | true | README `tailscale serve` lines (3 added in PR 124) |
| L47 | a real push shown with a screenshot on the PR | false | PR 124 has Inbox state png only, no push |
| L48 | idea.md states the decision | true | `docs/idea.md:243-245` |
| L48 | token on POST, refused host, other site, curl | true | `test/web.test.ts:185,196,224` |
| L48 | doctor warns beyond 127.0.0.1 | true | `src/doctor.ts:396-405`, `test/doctor.test.ts:80` |
| L48 | extension refuses an Inbox reply from every agent | true | `pi/extension.ts:59`, `test/dispatcher.test.ts:115-116` |
| L49 | README lists the blocks, each raised once | true | `README.md:14` (private repo); the license block is gone (MIT, `README.md:75`) |
| L49 | install from a readable copy | true | `docs/numbers.md:333-338`, `test/install.test.ts` |
| L49 | one clean run by the README, gaps listed and fixed | true | `docs/numbers.md:286-341` (475 s, 10 gaps fixed) |
| L51 | pack in `pi/`, parts on by default, Settings switch, doctor lists | true | `pi/pack.ts`, `pi/parts/`, `test/pack.test.ts:50,65` |
| L51 | a part joins only with its measured saving | false | `docs/numbers.md:625-650`: most rows say "not yet measured" |
| L51 | tests: install, switches, second install | true | `test/pack.test.ts:42-88` |
| L52 | every model near 150 k, own value stays, tests | true | `test/pack.test.ts:123,132,139,147` |
| L52 | the saving is in numbers.md | partly | `docs/numbers.md:632`: "Modelled, not measured" |
| L53 | cut, saved file, secrets, never-cut kinds | true | `test/cut-output.test.ts` |
| L53 | saving and share read again in numbers.md | false | `docs/numbers.md:633`: "not yet measured" |
| L54 | state file, summary with no model call, fallback logged | true | `test/compaction-notes.test.ts`, `docs/numbers.md:651-690` |
| L54 | saving and fallback share in numbers.md | partly | fallback share recorded (59 of 63 used); saving "modelled, not measured" |
| L55 | hint and sleep refusal, tests | true | `test/pack-reads-sleep.test.ts` |
| L55 | measured over 20 merged steps on and 20 off | false | `docs/numbers.md:632`: "0 of 20 on, 0 of 20 off" for both parts |
| L56 | brief with why, done-when, files, rules, under a size | true | `src/brief.ts` `BRIEF_MAX` 12000, `test/briefs.test.ts` |
| L56 | `roadmap show`, sessions that read the whole roadmap counted | true | `docs/numbers.md:681-700`: 6 of 70 before, after counted |
| L67 | install writes `lineclear.ts` by full path, second install no change | true | `install.sh:45,568`, `test/pack.test.ts:88` |
| L67 | doctor fails a link, uninstall removes it | true | `src/doctor.ts:173-176`, `test/uninstall.test.ts:31,44` |
| U56 | chat link uses a set address, else the page's host | partly | PR 131 added it; `ui/kit/settings.tsx` has no chat address field now and `test/chat-address.test.ts` is gone (the link opens in this UI, `ui/test/views.pw.ts:133`) |
| U56 | doctor names a set address that does not answer | false | no such check found in `src/doctor.ts` |
| U56 | UI test with an address set and none | false | only `ui/test/views.pw.ts:133`, no address case |
| L57 | `lineclear measure` counts every machine over SSH | false | no ssh in `src/measure.ts` or `src/measure-main.ts` |
| L57 | numbers.md has an "L57" section: asks a day, wait, cost, goals met | false | `docs/numbers.md:914`: "L57 has no number of its own"; no `## L57` heading |
| L57 | each "Done means" line checked, an unmet goal raised with `lineclear plan` | false | no such record found |
