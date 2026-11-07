# Fit audit: herdr, pi and Lineclear

Survey only. No code changed. Delete-only rule applies to every follow-up: remove the code, its tests, docs and callers; add nothing. Counts are `wc -l` of `.ts/.tsx/.pl/.sh` on origin/main, tests included, `node_modules` excluded.

## 1. Lineclear code that redoes pi or herdr (delete list)

| Code | Lines | Already done by | Verdict |
| --- | --- | --- | --- |
| `pi/compaction.ts`, `pi/parts/compaction.ts`, `compaction-point.ts` | ~180 | pi's `compaction.reserveTokens` / `modelOverrides` in settings.json | Delete. It only writes numbers pi reads itself. |
| `pi/parts/compaction-notes.ts`, `pi/direction-log.ts` | ~400 | pi's own compaction summary | Delete. A hand-built summary replaces pi's, unmeasured ("No A/B result yet" in `pi/kit.json`). |
| `pi/parts/stub-results.ts`, `cut-output.ts`, `batched-reads.ts`, `no-sleep.ts`, `pi/pack.ts`, `pi/kit.json` | ~700 | `~/.pi/agent/extensions` already has `tool-output-cap`, `read-batch`, `tool-policy` doing the same | Two copies of each saving. Keep one set (the machine one, it is outside the repo), delete these. |
| `src/harness-pi.ts`, `harness-claude.ts`, `harness.ts`, `models.ts` | ~310 | pi lists its own models and providers | Delete after tasks 13 (Codex/OpenCode) lands; keep only the pi launch line. |
| `src/quota.ts`, `limits.ts`, `home-spend.ts` | ~340 | pi's `quota-switch.ts` and `usage-ledger.ts` extensions | Delete: quota is read twice. |
| `src/session-text.ts` | 161 | pi session files are JSONL; `server/.../readers/pi.ts` already reads them | Merge into one reader, delete the other. |
| `src/machines.ts`, `remotes.ts`, `ssh.ts`, `machine-list.ts`, `machine-alerts.ts`; server `box.ts`, `mfs.ts`, `mirror.ts`, `machines-links.ts`, `machines-helpers.ts`, `browser-hubs.ts`, `browser-sessions.ts`, `server/helper/*.pl` | ~3,900 | herdr `--machine`, `--remote`, `herdr machine ...`; `herdr-forward.ts` already uses it | Biggest overlap. Machines and their file mirroring over SSH + perl are herdr's job. Cut to the herdr passthrough. |
| `server/.../live/herdr.ts` (586), `terminal-clock.ts` | ~640 | herdr socket API and `herdr pane/agent/notification` | Keep a thin client; most of 586 lines is stream and bridge handling. Cut by half. |
| `src/worktree.ts`, `src/herdr.ts` | ~100 | `herdr worktree` | Check callers, then delete. |
| `pi/nudge.ts`, `pi/extension.ts` idle nudge | ~310 | pi's own agent loop; Lineclear skills already say what to do | Keep the nudge, delete the rest of `extension.ts`'s duplicates after the pack goes. |
| Subagents | 0 | n/a | Nothing re-implemented. Reviewers are plain `pi -p`. |

Kept because other code uses it: `pi/atomic.ts` (state writes), `pi/config.ts`, `src/secrets.ts`/`totp.ts` (neither tool has them), `src/browsers.ts` (a thin `playwright-cli` wrapper, 354 lines, live view), the whole chat, board and task store.

## 2. pi extensions

Installed packages: `pi-claude-bridge`, `pi-web-access`. Local in `~/.pi/agent/extensions` (4,500 lines): `tool-policy` (777), `state-file` (643), `secret-guard` (~820), `tool-output-cap` (~680), `quota-switch` (352), `usage-ledger` (259), `herdr-agent-state` (261), `read-batch` (245), `web-tools`, `api-guard`, `claude-bridge-b`, `lineclear`.
- Used, all loaded by pi on every run. Unused: none found by name; `state-file` (643 lines) duplicates `compaction-notes` above and is the likelier keeper.
- Not installed: `pi-subagents`, `pi-lens`, `pi-usage` (listed in `kit.json` as "no trial yet"). `pi-usage` would replace `quota-switch`, `usage-ledger` and `src/quota.ts` (~800 lines). Nothing else well known is missing. Do not add any: the rule is delete-only.
- Machine-wide extensions are 4,500 lines to guard a board. `tool-policy` alone is larger than the three tool caps it enforces together.

## 3. Do agents use find-docs and playwright-cli?

Evidence is thin: only 15 session files exist, all from the last 8 hours (delete tasks, which need few docs or pages). In them: 262 bash calls, 30 reads; `ctx7`, `playwright-cli`, `chromium.launch`, `puppeteer` appear as text only in the system prompt (the AGENTS rule and skill list), not as calls by other agents. 58 `curl` mentions, mostly the prompt. No evidence of going around either tool, and none of using them. Cannot be judged from this sample. The tool policy blocks browser scripts, so the risk is low by construction.

## 4. Compaction

Threshold on disk: `reserveTokens: 850000` on a 1M window, so pi compacts near 150k; the pack's `compaction-point` part moves it to 80k worker, 70k reviewer/coordinator, 60k Dispatcher. Counted: 5 of 15 sessions compacted once, each at about 81k tokens; the 10 others ended under it. That is not too often. It is early on purpose: the point was set without a result ("No A/B result yet"). Verdict: not provably wrong, not proven right. Delete the per-role part and leave pi's default; `settings.json` also carries ~140 `modelOverrides` rows for models that are mostly unused, which is noise to prune by hand.

## 5. Hotfixes, workarounds, retries

- `server/helper/*.pl` (health, hook, mirror, relay, route; ~690 lines) and perl one-liners in `mfs.ts`, `folders.ts`, `browser-sessions.ts`: stat/readdir on a remote box with no Lineclear installed. Exists only for remote machines; goes with them (section 1).
- `server/.../retry.ts` (316): re-prompts an agent after a provider error at 1, 2, 4, 8 minutes. pi has its own retry; keep only if its own does not cover overload errors (check).
- `src/self-fix.ts` (340), `heal.ts` (24), `stalls.ts` (339), `scripts/flaky.ts` (129): the board files tasks about itself and repairs stuck tasks. They hide faults. Tasks 6 and 7 already cover them.
- `scripts/canary.ts` (266), `smoke.ts` (212), `release-tag.ts`: release safety nets; task 12.
- `loop-lag.ts` (122), `terminal-clock.ts` (50): polling and lag logging for a herdr gap and a slow server; keep the clock, delete lag logging.
- Timers/systemd in `uninstall.ts`, `doctor.ts`, `release.ts`, `promote-step.ts`: installer scaffolding.

## 6. Size against what a board needs

Now about 107,000 lines: `server/` 48,200 (tests 17,700), `src/` 20,800, `test/` 18,800, `ui/` 16,400 (tests 4,100), `scripts/` 2,000, `pi/` 1,500, docs 19,900 lines. A board (tasks, chat, status, merge, a browser view, secrets) needs 15,000 to 20,000 lines with tests.

Path to ~20k, order by size:
1. Machines, SSH, mirror, perl helpers, remote browser hubs: -6,000 with tests (herdr does it).
2. Server engine, `source-*`, autopilot, plugins (13 plugin folders), demo data: -12,000 (tasks 2, 8).
3. `scripts/` and release chain, canary, smoke, gates: -2,500 (tasks 5, 12).
4. `pi/` token pack and compaction: -1,500.
5. `src/` rules, self-fix, stalls, roadmap tooling, measure, autoplan, company, media: -8,000 (tasks 1, 4, 6, 7).
6. `ui/` design lab, shots, kit variants: -5,000 (task 10).
7. Tests of what goes: -22,000 follow.
8. Docs: -15,000 (task 9).

The listed tasks in flight cover most of it; items 1 and 4 and the pi overlap in section 1 are not in any task and are what this audit adds.
