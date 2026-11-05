# Code audit: live

Audited on 4 Nov 2026, scope `server/server` (the board server and its live engine). knip is clean, so this looks for
what static tools cannot see: features no one calls, the same job done twice, shims for states that no longer exist,
tests of removed code. Proof of use or non-use comes from callers in the repo, `~/.pi/agent/sessions/*.jsonl` (765
sessions: what agents really ran) and the store on the machine the audit ran on. What the roadmap already deletes is left
out: the old UI (`server/src`, `server/public`, `server/index.html`, plugins' client parts: L165/L166),
`server/herdr-plugin.toml` and `plugins.json` (L71), `lineclear migrate` (L74).

Lines saved are lines of the repo. Risk is what breaks if the proof is wrong.

## Deleted in this change

| What | Where | Proof | Lines saved | Risk |
| --- | --- | --- | --- | --- |
| `artifacts.migratePages`, `chats.repostPage`, the call at start | `live/artifacts.ts`, `live/chats-logs.ts`, `live/source.ts` | It moves `pages.json` and `pages/` (Shepherdr's pre-artifact pages) into artifacts. Nothing in `src/`, `scripts/`, `server/` or `lineclear migrate` writes either file; this machine has neither; the call deletes them after one run | 50 with its test | none: a store with `pages.json` would keep it unread |
| `render` and `preview` commands that only say "is gone" | `live/source-cli.ts`, test in `test/source-f.test.ts` | 0 calls in 765 sessions; no caller in the repo; the unknown-command error still answers | 13 | none |
| `artifact remove` and `artifact delete` aliases of `artifact rm` | `live/source-subcommands.ts` | `rm` is used 10 times in sessions, the aliases 0 times; no doc or skill names them | 2 | none |

Tests run: `server/test/artifacts.test.ts`, `server/test/source-f.test.ts` (30 pass).

## Found, not deleted (roadmap steps added)

| What | Where | Proof | Lines saved | Risk | Step |
| --- | --- | --- | --- | --- | --- |
| Spaces migration: coordinators `all` and `m:*` to home spaces, `projects.json` to `spaces.json`, `settings.projects` to `spaces` | `live/migrate.ts` (147), `live/places.ts:92`, `settings-store.ts:79`, `engine/worktrees.ts` comment, `test/migrate.test.ts` (123) | Here `spaces.json` is a list, there is no `projects.json`, no `all.json` or `m_*` chat log, no `heartbeat/` folder and no `projects` key in `settings.json`: the migration returns on its first line. A fresh store runs it once to write `spaces.json`, so the file must be created elsewhere first | about 300 | any other machine must be migrated; the check is one file | L230 |
| Old settings words: `heartbeat.every`/`quiet`, `brief.review` as "N rounds", `brief.waitChecks`, `OLD_VALUES` ("by itself", "after your yes") and `heartbeats()` | `live/settings-catalog.ts:200-216,474-488`, `settings-store.ts` | `settings.json` here holds none of these keys or values; `Settings` rewrites the file without them on its first start | about 45 | a machine that never started since; settings would fall back to defaults | L231 |
| Take-over of a machine with Shepherdr installed (`old=1` probe, `takeOver`) | `live/machines-links.ts:210,275`, `live/install.ts:86,114`, `machines-helpers.ts:131`, `test/take-over.test.ts` | `old=1` is true only when `~/.lineclear/config.json` has `"main"`, which only the herdr-plugin install (L71) wrote; both machines run one install now | about 60 | a third machine added with the plugin still on it | L232 |
| Two `shepherdr` command clients: `server/cli.ts` (bun) and `helper/shepherdr` (perl, for machines without bun). Both repeat the merge wait/retry and secret masking | `server/cli.ts`, `server/helper/shepherdr` | The perl file says so in its comments ("as server/cli.ts"); `LINECLEAR_MERGE_WAIT` and `LINECLEAR_MERGE_TOTAL` are read in both | about 100 | the perl one is the only client on a machine with no bun; merging needs a decision on the remote install | L233 |
| `/api/waiting` | `app.ts:208` | Only caller is `server/public/sw.js`, which L165/L166 delete | 3 | none after L165/L166 | with L165/L166 |
| `/api/drain`, `/api/version` | `app.ts:137`, `app.ts` | Callers are `server/scripts/supervise.ts` and `plugin.ts`, the herdr-plugin supervisor (L71) | 15 | none after L71 | with L71 |

## Checked and kept

| What | Why it stays |
| --- | --- |
| `shepherdr done` (old name of `ready`) | 67 sessions ran it in the last weeks; agents still say it |
| `LINECLEAR_CANARY`, `LINECLEAR_SCRATCH`, `LINECLEAR_SOURCE`, `LINECLEAR_DEMO_BROWSER`, `LINECLEAR_COORDINATOR_TIMER`, `LINECLEAR_MERGE_*` | set by `scripts/canary.ts`, `scripts/smoke.ts`, `package.json` demo script, tests |
| `WEBHOOK_SECRET` | only inside demo fixture text, not read |
| `/api/upload`, `/api/file`, `/api/snapshot`, `/api/push/*`, `/api/cli` | called by `src/chat.ts`, `src/board.ts`, `ui/web/alerts.tsx` and the helper |
| `/api/worktree`, `/api/activity`, `/api/voice`, `/api/browser`, `/api/folders`, `/api/spaces` | peers call them over the tunnel and the old UI calls them; revisit after L165/L166 |
