# Code cut survey

Goal: about a third less code and far less complexity. Survey only: nothing here is deleted yet.

## Size now

Counted with `wc -l` on tracked files (`.ts` and `.tsx` 128,084 lines in all).

| area | lines | of it tests |
| --- | --- | --- |
| `src/` (CLI, rules, checks) | 27,300 | `test/` 24,400 |
| `server/` (fork of herdr-projects) | 28,100 | `server/test/` 18,600 |
| `ui/` | 20,300 | `ui/test/` 5,700 |
| `scripts/` | 5,400 | |
| `pi/` | 1,600 | |
| `docs/ROADMAP.md` | 5,642 | 374 steps, 312 done by commit subject, 62 open; 4,359 lines sit in done steps, 839 in open ones |

Sizes below are source plus its own tests, rounded, taken from file sizes. They are estimates: where a part is cut
down and not removed, the saving is the share named. Nobody has run the deletions, so each risk is a judgment from
the file names and `docs/parts/`, to be confirmed by the task that does it.

## Honest total

The tasks below save about 38,000 code lines (30 % of 128,000) and about 8,000 lines of docs. A full third of code
needs one more lever: the `server/` engine and `source-*` layer (9,000 lines with tests) is not in any task, because
it needs reading before it is cut. Task 13 is its survey.

## What goes, by task

Each task owns its files. No two tasks name the same file, except the shared edit points in "Shared files".

### 1. Parts keeper and sign-off docs (wave 0)

Title: `Drop the parts keeper` (21)

- Files: `src/parts.ts`, `src/parts-check.ts`, `src/part-health.ts`, `src/kit.ts`, `src/kit-cli.ts`, `docs/parts/*.md`, `docs/kit.md`, `docs/control-center-units.md`, `docs/stable-and-next.md`, `docs/public-roadmap.md`, `docs/public.md`, `docs/import.md`, `docs/asks.md`, `docs/known-faults.md`, tests `parts*`, `kit*`, `part-health*`.
- Saves: about 900 src, 670 tests, 600 docs. Phase 20 and L103, L105, L100, U61 close with it.
- Risk: low. A page per part is a second copy of what `docs/architecture.md` says. It also couples every later deletion to a doc check, so it goes first.
- Replaces: `docs/architecture.md` (module borders stay with the border gate).

### 2. Measuring suite (wave 0)

Title: `Cut measuring to one count` (26)

- Files: `src/measure*.ts`, `src/model-use.ts`, `src/health-numbers.ts`, `src/api-latency.ts`, `src/compaction-gauge.ts`, `src/cost-goal.ts`, `src/ask-goal.ts`, `src/wait-goal.ts`, `src/waste*.ts`, `src/real-world.ts`, `src/goals.ts`, `scripts/simplify-count.ts`, `scripts/measure-*.ts`, `scripts/budget.ts`, `scripts/budgets.json`, `scripts/load-map.ts`, `scripts/under-load.ts`, `scripts/home-latency.ts`, `scripts/browsers-speed.ts`, `docs/simplify.md`, `docs/numbers.md`, matching tests.
- Keep: `src/home-spend.ts` and `src/spread.ts` (Usage page reads them).
- Saves: about 4,000 src and scripts, 1,500 tests.
- Risk: medium. L57 (goals measured), L246, L305 and L115 drop. The goals in `idea.md` stay as goals, not claims. Timers and counters stay out ("no new measuring").
- Replaces: Usage page numbers from `home-spend`; the owner's own look at the board.

### 3. Media and film pipeline (wave 1)

Title: `Drop the README film` (20)

- Files: `scripts/media.ts`, `media-lib.ts`, `readme-roles.ts`, `readme-film.ts`, `svg-motion.ts`, `role-icons.ts`, `scripts/film/`, `docs/readme/`, `docs/brand/` renders, `docs/design/*.webm`, `docs/u39/`, `ui/test/media.pw.ts`, `still.pw.ts`, `record.pw.ts`, the `bun run media` and `ui:record` entries, tests that check for a stale picture.
- Saves: about 1,700 scripts, 500 tests, 300 UI test lines, plus about 300 binary files (megabytes, not lines).
- Risk: low. Closes U40, U65, U66, U68. The README keeps stills from `bun run shots`.
- Replaces: `bun run shots` (kept).

### 4. UI design lab and test zoo (wave 1)

Title: `Slim the UI lab and tests` (25)

- Files: `ui/web/design.tsx`, `design-state.ts`, `samples.ts`, `browser-samples.ts`, `chat-samples.ts`, `lazy-samples.ts`, `real-samples.ts`, `settings-samples.ts`, `ui/kit/cold-read.tsx`, `ui/test/` all `every-*.pw.ts`, `taste*`, `alike*`, `u14`, `u35-shots`, `u39`, `contrast`, `headings`, `font`, `frame`, `scripts/cold.ts`, `docs/cold/`, `docs/design/` except `board.html`.
- Keep in `ui/test/`: `home`, `chat`, `settings`, `errors`, `first-run`, `kit`, `once` and their fixtures.
- Saves: about 2,500 UI, 3,000 UI tests.
- Risk: medium. `AGENTS.md` makes the U2 bar (every state, motion, screenshots) a rule; this changes it to a short screenshot check, which is the owner's call. `roadmap-samples.ts` waits for task 8.
- Replaces: one smoke page per view and `bun run shots`.

### 5. Gates and heavy tier (wave 1)

Title: `Gates down to lint and types` (28)

- Files: `scripts/gates/{borders,comments,copies,size,old-name,code-rules,coverage,ratchet,tools}.ts` and `baseline/`, `scripts/coverage.ts`, `heavy.ts`, `one-name.ts`, `fresh-one-name.ts`, `cold-start.ts`, `dash-check.ts`, `words-check.ts`, `prose-check.ts`, `personal-*.ts`, `scales-check.ts`, `direction-check.ts`, `formats` of docs, `src/heavy-run.ts`, `src/dashes.ts`, `src/prose.ts`, `.github/workflows/heavy.yml`, tests `gates`, `heavy`, `light-checks` parts.
- Keep: Biome (lint and format), knip, `tsc`, one tiny border check on `docs/architecture.md`.
- Saves: about 1,500 scripts, 1,200 tests.
- Risk: low to medium. The "every gate empty" rule goes; copy and size faults come back unless review catches them. Closes L77 to L90 as written.
- Replaces: `bun run check` = types, tests, lint, dead code.

### 6. One-time migration and old-name code (wave 1)

Title: `Remove old setup migration` (26)

- Files: `src/migrate.ts`, `old-install.ts`, `old-paths.ts`, `old-archive.ts`, `src/store-copies.ts`, `src/backup.ts` (keep only a copy of the data folder), `src/export.ts`, `src/uninstall.ts` (shrink), `server/server/live` migration helpers, tests `migrate`, `old-*`, `backup`, `uninstall`.
- Saves: about 1,300 src, 1,000 tests.
- Risk: low before release 0.1, since no other user holds the old name. Closes L74, L75, L171, L109.
- Replaces: nothing; a machine on the old name reinstalls.

### 7. Doctor and self-heal family (wave 1)

Title: `Merge doctor and health checks` (30)

- Files: `src/doctor.ts`, `home-doctor.ts`, `herdr-health.ts`, `herdr-world.ts`, `health.ts`, `system-fault.ts`, `heal.ts`, `outside-fix.ts`, `self-fix.ts`, `leftovers.ts`, `routine.ts`, matching tests.
- Saves: about 1,900 src, 1,300 tests (keep about 600 in one `doctor.ts`).
- Risk: medium. Fewer automatic faults named; the stall ladder (task 8) must stay the only one that restarts work.
- Replaces: one `lineclear doctor` that prints faults and fixes none by itself.

### 8. Stall classes (wave 2)

Title: `One stall ladder, no classes` (28)

- Files: `src/stalls.ts`, `stall-class.ts`, `stall-ladder.ts`, `stall-close.ts`, `unstick.ts`, `waits.ts`, `waiting.ts`, `held.ts`, `start-limit.ts`, `starts.ts`, `wait-causes.ts`, `loop-guard.ts`, `docs/stalls.md`, tests.
- Saves: about 2,600 src, 1,600 tests (keep about 750 in `stalls.ts`).
- Risk: high. Phases 25 and 26 are about this. Do it after `rules.ts` is touched only here; keep the known-faults behaviours that have a test.
- Replaces: one ladder: nudge, restart, next model, Inbox question.

### 9. Release chain (wave 2)

Title: `Release by tag, not by track` (28)

- Files: `src/track.ts`, `try-instance.ts`, `candidate-check.ts`, `promote*.ts`, `builds.ts`, `rollback.ts`, `release.ts` (keep tag and install), `scripts/canary.ts`, `smoke.ts`, `release-tag.ts`, `formats.ts`, `server/scripts/store-formats.ts`, `docs/stable-and-next.md`, the `lineclear-track*` units, tests.
- Saves: about 2,300 src, 1,600 tests, 700 scripts.
- Risk: high, and the owner's call: Phase 24 built it on purpose. Without it a bad build reaches the machine. Rollback stays by reinstalling the previous tag.
- Replaces: `install.sh` from a tag; GitHub `check` is the gate. Closes L114, L283, L284.

### 10. Harness adapters (wave 1)

Title: `Keep pi and Claude only` (23)

- Files: `src/harness-codex.ts`, `harness-opencode.ts`, `server/server/live/codex-runtime.ts`, `readers/codex.ts`, matching tests.
- Saves: about 600 src, 500 tests.
- Risk: medium. The Reviewer setting names codex as one option; confirm no one runs it first.
- Replaces: pi and Claude adapters stay.

### 11. Roadmap tooling (wave 3, after task 4 and the ROADMAP cut)

Title: `Roadmap as a plain list` (23)

- Files: `src/roadmap-view.ts`, `roadmap-import.ts`, `roadmap-source.ts`, `roadmap-cli.ts`, `step-page.ts`, `autoplan.ts`, `ui/web/roadmap/`, `ui/web/roadmap-samples.ts`, `ui/test/roadmap*.pw.ts`, tests.
- Keep: `src/roadmap.ts` parser and the checker, so the rule loop still starts steps.
- Saves: about 1,500 src, 1,100 UI, 800 tests.
- Risk: medium. The roadmap page in the UI goes; `docs/ROADMAP.md` is read in an editor.

### 12. Server extras (wave 1)

Title: `Drop unused server features` (27)

- Files, each to confirm unused first: `autopilot*` (about 630 + 700 tests), `voice.ts` (170 + 240), `places.ts` (325), `push.ts` (106 + 160), `tunnel.ts` (83), `server/server/demo/` (1,958; shrink to a fixed JSON after task 4), their `server/plugins/` folders and `server/docs/`.
- Saves: about 2,500 src, 1,300 tests, 800 docs.
- Risk: medium. These came with herdr-projects 2.0; the fork owner must name any in use. Demo cut waits for task 4.

### 13. Survey of the server engine (wave 1, survey only)

Title: `Survey server engine overlap` (28)

- Look at `server/server/live/engine/` (5,200 lines, 3,700 tests) and `source-*` (4,000, 2,600 tests) against `src/retire.ts`, `src/stalls`, `src/worktree.ts`, `src/status.ts`: same jobs in two modules. Expect another 3,000 to 5,000 lines. Output: a doc, no code.

## Order and conflicts

| wave | tasks | why |
| --- | --- | --- |
| 0 | 1, 2 | They remove the doc and row checks (`test/simplify.test.ts`, parts check) that fail when later tasks delete a part |
| 1 | 3, 4, 5, 6, 7, 10, 12, 13 | Disjoint files; run in parallel |
| 2 | 8, 9 | Both edit the rule loops in `src/rules.ts` and `src/tick-project.ts`; run one after the other |
| 3 | 11 | Needs the UI lab gone (4) and the ROADMAP cut (R) |
| any | R | Touches only `docs/ROADMAP.md` and the tests that parse it |

Shared files every task may touch with a one-line edit: `src/cli.ts` (command list), `package.json` (scripts), `AGENTS.md`, `docs/architecture.md`, `knip` config. A conflict there is a rebase of lines, not logic. The task that changes a rule in `AGENTS.md` (4 and 5) is the only one allowed to edit that rule.

Each task: delete, run only the changed tests and `bun run types` locally, `lineclear check` on GitHub.

## ROADMAP.md cut (task R)

Title: `Roadmap down to open steps` (26). Today: 5,642 lines. After: about 120.

1. Keep the top "Done means" list, cut to the six lines still true, and the "How to read it" rules (about 25 lines). Drop the per-phase notes, which describe done phases.
2. Delete every done step (4,359 lines). Git history holds them; a step's id is in its commit subject.
3. Delete the "Frozen by the owner" section's long briefs (L268, L276, L219, L173 and the rest of tier 3). Move each to one line in `docs/backlog.md`: id, title, why.
4. For each open step keep the title, `result`, `after` and `files`; shorten `done when` to one line. Remove `after` ids that are done.
5. Drop steps the tasks above make moot: L77 to L90 (5), L74, L75, L171, L109 (6), L114, L283, L284 (9), L115, L246, L305 (2), U40, U65, U66, U68 (3), L100, L103, L105, U61 (1), L191 to L195 and L173 to L176 (Dispatcher, frozen), L219.

The list that stays, in the owner's tiers (62 open now; about 28 after step 5):

- Platform stability: L267 spawns no herdr, L251 a red main pauses the line, L252 pass cache, L264 no lock wait, L308 retried herdr call, L310 done tasks leave the hot store.
- One product, one store: L70 one web UI one port, L69 own names inside, L71 what no one uses is gone, L214 one status, L315 to L317 ids, store and task place, L139 settings in small files, L95 and L96 other machines, L108 secrets store, L172 power cut, L271 fix loop.
- UI: U27 Usage page, U52 Usage per agent, U28 Home shows all work, U71 table gap, L269 UI interface test, L414 composer out of chat, U43 release gate.
- Tests that hold on load: L402, L406, L409, L411, L413, L116.

Risk: low. The rule loop reads the file by ids, so `lineclear roadmap check` must pass on the cut (its tests are in `test/roadmap.test.ts`). The task runs it before merging. Do not drop the frozen steps; park them in the backlog.
