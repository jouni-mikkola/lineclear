# Truth audit 5: done steps

Each `done when` item of 32 done steps, checked on origin/main. Verdicts: true, partly, false. The specs in `ui/test/*.pw.ts` were read, not run (they need a build). A step with a partly or false item has a `Reopened:` line in `docs/ROADMAP.md`,.

| Step | Item | Verdict | Proof |
|---|---|---|---|
| L77 | gates run, baselines, `--lower` | true | `test/gates.test.ts` 23 pass; `scripts/gates/run.ts` GATES; `biome.json` |
| L78 | dead code gate on root and server | true | `knip.jsonc`; test "dead code fails on an unused export" |
| L79 | copy gate, baseline lowered | true | `scripts/gates/copies.ts` MIN_TOKENS=50; baseline 53 pairs, now 29 |
| L80 | module table, borders and cycles | true | `docs/architecture.md`; borders and cycles tests pass |
| L81 | file and function size | true | no ts file over 600 lines; `size.json` is `{}`; biome 80 lines |
| L82 | comment rules | true | `scripts/gates/comments.ts` test; `AGENTS.md:51-52` |
| L83 | floors for every module | partly | `coverage.json` has brand, cli, gates, pi, scripts, tests, ui-test; none for bin, kit, web |
| L83 | release runs coverage | partly | `release-tag.ts` runs only `check --full`; `nightly.ts` runs coverage |
| L84 | smoke gate before merge | true | `server/server/live/engine/lane.ts:165-176`, `merge.ts:151`; `test/smoke-branch.test.ts` 4 pass |
| L85 | severity words in the agent skill | true | `server/skill/shepherdr-agent/SKILL.md:53` |
| L86 | one atomic write helper | true | `pi/atomic.ts` |
| L86 | one helper per job | partly | time formatting in `ui/kit/format.ts:13`, `ui/kit/notice.tsx:21`, `engine-helpers.ts:267`, `Settings-Pages.tsx:205` |
| L87 | limits outside server | true | no non-server ts over 600; `lint.json` |
| L88 | size baseline empty | true | `size.json` is `{}` |
| U63 | film from motion.json, media check | true | `media.test.ts` 9 pass, `script-parts.test.ts` pass, `bun scripts/media.ts check` ok |
| U64 | README film, stills, roles, social | true | `docs/readme/` files; `media.json` hashes; social.png 1280x640 |
| U41 | motions share curves, alike tests | true | `scripts/film/motion.json`; `ui/test/alike.pw.ts`, `alike-parts.pw.ts`; `docs/design.md:460-470` |
| U41 | recordings before and after on the PR | partly | PR #345 has 8 png/webm files, no before/after |
| U42 | demo mode, shots, list, check | true | `shots.test.ts` 4 pass, `shots-check` ok, `docs/shots/list.md` |
| U42 | every view shot | partly | `src/shots.ts` SHOT_VIEWS: home, roadmap, browsers, chat, usage, settings; no task page, no Inbox |
| L59 | idea.md describes the step's life | true | `docs/idea.md:150-181,206` |
| L60 | `files` field | true | `src/roadmap.ts` FIELDS; `briefs.test.ts:120,135` |
| L61 | form rule | true | `src/autoplan.ts` stepFormProblems; `plan.test.ts:118` |
| L62 | step check by another company | true | `stepcheck.test.ts`, `plan.test.ts:205-271` |
| L63 | planner and brief templates | true | `templates/plan.md:8-11`, `brief.md:15`, `briefs.test.ts:144` |
| U55 | check shown on card and page | true | `docs/design.md:66-77`; `step-check.pw.ts` (read); PR #346 pictures at 390 and 1440 |
| L64 | measure counts before and with the check | true | `measure.test.ts:234,327` pass |
| L64 | numbers recorded for steps before | partly | `docs/numbers.md:852-890` has method only, no counts |
| L65 | verdict recorded | false | `docs/numbers.md:886` "State: waiting. Only 2 plans have a check record" |
| L65 | off switch | true | `project set --step-check`; `measure.test.ts:337` |
| L66 | helper socket fault fixed, doctor names it | true | `docs/known-faults.md:29`; `doctor.ts:374-390`; `all-machines.test.ts:182,202,224` pass |
| U57 | list of 15 parts with a verdict | true | `docs/design.md:333-352` |
| U57 | owner confirmed | partly | no record on main or in PR #140 |
| U58 | task chat page, states, shots | true | `ui/web/task.tsx`; `task-chat.pw.ts`; `ui/test/screens/task-chat-*` |
| U58 | links open the task page | true | `inbox-strip.tsx:71`, `inbox-card.tsx:167`, `line-parts.tsx:302` |
| U59 | live terminal and artifacts | true | `ui/web/task-live.tsx`; `task-live.pw.ts:28,41` |
| U59 | states shot at both widths | true | `ui/test/screens/task-terminal-*`, `task-artifacts-*` |
| U59 | recording of each motion | partly | `docs/design/motion/` has no terminal or artifact recording |
| U60 | each "moves" row built | true | `task-changes.tsx`, `search.tsx`, `task-live.pw.ts:51,60,75` |
| U60 | list says where each lives | true | `docs/design.md:333-352` |
| U60 | same bar as U59 | partly | screens exist, no recordings |
| L164 | test over all links | partly | `test/contracts/inbox.test.ts:27` checks three hrefs and the published address, not server links, push payloads or emails |
| L164 | task, artifact, terminal, browser links | true | `/task/<id>` links in `ui/web`, `/browsers` in `home-data.ts` |
| L164 | old UI pages untouched | true | no such change found in `server/` |
| L72 | helpers under `~/.lineclear/helper` | true | `all-machines.test.ts:182,224` pass |
| L72 | no code uses old folders | true | `old-install.ts` and `migrate.ts` only; `no-old-folder.test.ts` passes |
| L72 | doctor rewrites old paths | true | `old-paths.test.ts:32` passes |
| L73 | doctor names and archives, never while in use | true | `old-archive.test.ts:57,78` pass |
| L73 | hard links stay whole | true | `old-archive.test.ts:16` passes |
| L73 | no machine has the folders | partly | absent on this machine (`ls`); other machines not reachable from here |

Notes: `all-machines.test.ts` "migrate --all moves both machines..." timed out at 5 s on this run; `machines.test.ts` fails here for a missing generated file (`server/generated/server-plugins.ts`). Neither is a done-when item above.
