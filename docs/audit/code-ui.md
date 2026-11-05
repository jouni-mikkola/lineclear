# Code audit: ui/ and scripts/

Scope: `ui/` and `scripts/`, plus the API routes the pages call. knip is clean, so this looks for what a static tool
cannot see: duplicates, unread output, routes and tests nobody reaches. Proof is a search of the repo (`grep -rn`
over `ui/`, `src/`, `scripts/`, `test/`, `pi/`, `bin/`, `install.sh`, `docs/`, `server/`) and, for the live side, the
journal and `~/.pi/agent/sessions` where they could say anything. The journal of `lineclear` holds no request log, so
it cannot prove a route used or unused; routes are judged by callers in the repo.

Checked and found fine: every `scripts/*.ts` file has a caller (package.json, `check.ts`, `install.sh`, a workflow,
the release code or a test); every CSS class in `ui/kit/kit.css` is used by a `.ts`, `.tsx` or `.html` file; the
`--lc-space-*`, `--lc-row-phone` and `--lc-press-ms` tokens have no reader in code but are the documented design scale
(`docs/design.md`) and are pinned by `test/kit-tokens.test.ts`, so they stay. The old UI, `herdr-plugin.toml`,
`plugins.json` and `lineclear migrate` are left to L71, L74, L165 and L166.

| # | What | Where | Proof | Lines | Risk | Action |
|---|------|-------|-------|-------|------|--------|
| 1 | Script nobody runs: the slowest `/api/home` answer | `scripts/home-latency.ts` | No caller in package.json, scripts, tests, workflows or install.sh; only listed in the code line of `docs/parts/measure.md`. `/api/home` timing has a test (`test/web-never-waits.test.ts`) and `measure-service.ts`. | 17 | none | Deleted here, listed code line fixed. |
| 2 | Same test twice: each role's icon file matches `roles.ts` | `test/readme-film.test.ts` end, `test/role-icons.test.ts` | The two bodies are the same loop with the same assertion and message. | 6 | none | Deleted the copy in `readme-film.test.ts`; both files pass. |
| 3 | Three load factors | `scripts/budget.ts:19`, `scripts/canary.ts:117`, `scripts/check-speed.ts:26,35` | Same job (load average over cores, at least 1); they differ only in the cap (canary 8) and the source. Each has its own test (`budget.test.ts`, `canary.test.ts`, `check-speed.test.ts`). | about 15 | low | L180 |
| 4 | Two ways to call the server in the pages | `ui/web/data.ts` `findRepos`, `addProject` | Both repeat `call`/`post` of the same file (fetch, json); `addProject` also repeats the "The server answered N." text, `findRepos` returns `[]` on any failure. | 14 | low | L181. Not done here: `ui/test/add-project.pw.ts` fails 3 tests on main as well as on this branch, so no passing run proves it. |
| 5 | Screenshots written, never read | `scripts/smoke.ts` `shots`, `install.sh:495`, `<data>/ui-shots/<commit>/` | Only `smoke.ts` names `ui-shots`; no reader in `src/`, `ui/`, `scripts/`, `pi/`. 15 folders, 14 MB on this machine. `taste.pw.ts` already writes the same views to `ui/test/real-shots/` for the reviewer. | 35 | low (the doc says a reviewer looks) | L182 |
| 6 | Route with no caller in the pages | `GET /api/events`, `src/events.ts` `eventsAnswer`, `src/web-routes.ts:84` | `ui/` never fetches it (only `ui/budget/budget.pw.ts` times it); no CLI, `pi/`, `server/src` or `bin/` caller. The CLI reads the event log directly. | about 25 | medium: a live map may use it elsewhere | L169 (another audit) |
| 7 | Route with no caller in the pages | `GET /api/stalls`, `stallsReply` in `src/stall-class.ts:21`, `src/web-routes.ts:230` | `lineclear stalls` calls `stallsMain` on the decisions file, not HTTP; `ui/` never fetches it. Only `test/web.test.ts:398`, the comment at `src/web.ts:70` and docs mention it. | about 25 | low | L170 (another audit) |
| 8 | Screen pictures written on every run | `ui/test/real-shots/` (`taste.pw.ts:52-66`) | Git-ignored, nothing reads it; the reviewer reads it by hand. Kept: a reviewer agent may open it, which this audit cannot rule out. | 15 | n/a | Kept. |

Not found: a settings key, env var or rule in `ui/` or `scripts/` without a reader; a compatibility shim for a
removed state on either machine (the `scripts/` fallbacks are for a missing `playwright-cli`, herdr or restic, which
can happen on a new machine); tests of removed code beyond row 2. The `src/` and `server/` halves of the audit are
other tasks.
