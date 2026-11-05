# Truth audit 7: L108, L109, L115

Checked on origin/main at 7e69ea3f. Result: every item of the three steps is true, so the commit carries
`Step: L108`, `Step: L109` and `Step: L115`.

Tests named below were run alone: `bun test ./test/secrets.test.ts` (13 pass; the pattern also matched
`server/test/secrets.test.ts`, which cannot load in a fresh worktree without `server/generated/`, so it was not counted),
`bun test ./test/backup.test.ts` (6 pass), `bun test ./test/measure.test.ts` (11 pass).

## L108 One secrets store, with codes

| Item | True | Proof |
| --- | --- | --- |
| `secrets set`, `list`, `env` use the vault; `env` gives the chain, most specific first; `set --all` sets Everywhere | yes | `src/secrets.ts:20` vault file, `:115` `chainOf` (spaces, machine, `all`), `:124` `valuesOf` lets the most specific win, `:268` `--all`. Tests "env follows the chain: the space, then this machine, then Everywhere..." and "set keeps the value in the server's vault, mode 600..." |
| `totp NAME` prints the code of `NAME_TOTP` from the chain (RFC 6238, base32 or `otpauth://`), nothing else; a bad key names the variable, not the value | yes | `src/totp.ts:32` `parseTotpKey`, `:47` `totpCode`; `src/secrets.ts:343` `totp`. Tests "totp prints the RFC 6238 code of NAME_TOTP and nothing else", "totp names a missing or broken key, never its value" |
| Masking, the pi extension's refusals, the Settings view and the copy to another machine read the vault | yes | masking `src/secrets.ts:236` (reads `readVaultQuietly`); refusals `:225` `forbidden`, used by `pi/extension.ts:33` (`secrets deny`); Settings `server/server/live/secrets.ts:118` `secretPages`; copy `src/spread.ts:195` `secretsText`. Tests "an agent in alpha: owner-only and other projects' names...", "on another machine the project's sent copy is read too, below the vault" |
| Tests cover each level, order, the RFC 6238 vector, missing or broken key | yes | the tests above; the vector is 94287082 / 287082 at t=59 s |

## L109 Lineclear keeps a backup

| Item | True | Proof |
| --- | --- | --- |
| The command saves both folders and extra paths to each restic repository, password `LINECLEAR_BACKUP_PASSWORD` from owner-only secrets, skips what can be made again | yes | `src/backup.ts:62-75` paths and excludes (browser, helper, temp), `:41` password name, `:8` `ownerSecret`. Tests "a backup to a local repository restores the same files, without what can be made again", "without the password it names the secret and how to set it" |
| The rule loop runs it hourly, keeps hourly for two days and daily for a month, doctor warns after a day | yes | `src/rules.ts:156` `startBackupIfDue`; `src/backup.ts:44` `KEEP` (`--keep-hourly 48 --keep-daily 30`), `:163` `backupDue`, `:186` `backupProblem` with `STALE_MS` of a day, `src/doctor.ts:124,545`. Tests "an hour after a run the next one is due; a day without a good copy is a doctor problem", "it keeps hourly copies for two days and daily ones for a month..." |
| The `restore <dir>` and `status` subcommands | yes | `src/backup.ts:213` `restore`, `:196` `status`, `:234-237` routing |
| Tests save locally, read the copy back, find the same files, cover the schedule | yes | the tests above (restic is installed at `~/.local/bin/restic`) |

## L115 Health in numbers

| Item | True | Proof |
| --- | --- | --- |
| `lineclear measure` prints the five health measures | yes | `src/health-numbers.ts:69` `healthRows`, printed by `src/measure-main.ts:282`. Test "--health writes the five measures..." checks the output line |
| `measure --health` writes them to `docs/numbers.md` under "Health" | yes | `src/measure-main.ts:228` `writeHealth`; `docs/numbers.md:5` holds the section; same test checks the section, its place and that a second run changes nothing |
| A review fails a step that makes one worse | yes | `templates/brief.md:33` tells the reviewer: it fails a change that makes a Health number of docs/numbers.md worse; `docs/numbers.md:8` states the rule |
