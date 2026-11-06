# core

The command line's frame and what every other part leans on: the `lineclear` entry, the data folders, a project's
settings, writing a file safely, matching a loose name, and the repo's own rules and map.

## Invariants

- An unknown command prints one line and exits 2; a command that throws prints one line, never a stack trace.
- Every file Lineclear writes for itself goes through `writeAtomic` or `createAtomic`: a crash leaves the old file or the new one.
- Every path comes from `paths.ts` and the XDG and pi folder variables, so a test can move them all. `Paths.builds` is the release builds folder, where a release install links the command and the pi extension.
- `Paths.builds` is the release builds folder: a release install links the command and the pi extension into its `current`, so uninstall treats a link there as its own.
- A project's settings are read and written by `project.ts` only. Check tiers are `inner`, `merge` and `heavy`; the heavy tier runs after a merge, never by the clock, and a settings file that still says `nightly` is read as `heavy`.
- A project's `stepCheck` setting, false, turns the step check's model call off; the form rule has no setting.
- A project's `release.promote` setting, `ask`, makes a checked build wait for the owner's tap instead of promoting by itself.
- A project's `pace` setting, `spend` (the default) or `even`: `spend` never holds a step for the weekly pace, only for a full account.

## Interface

The `lineclear` command and its `--help`, and these names:
- `src/paths.ts`: `dataDir`, `codeCommit`, `piDir`, `pathsFor`, `serverBin`, `lockFile`, `extensionFile`, `cacheEnvFile`, `INSTALL_URL`, `Paths`, `SERVICE`, `OLD_PLUGIN_ID`
- `src/project.ts`: `Settings`, `Ask`, `roles`, `askBeforeKeys`, `NAME`, `setProject`, `removeProject`, `fail`, `addProject`, `detectCheck`, `detectSpace`, `listProjectNames`, `readSettings`, `projectsDir`, `askBefore`, `Settings`, `Role`, `AskBefore`, `changeSettings`, `detectHeavy`, `tiersOf`, `proposeTiers`, `tierNames`, `setupRoles`, `readSetup`, `Setup`
- `src/resolve.ts`: `looseNote`, `resolveProject`, `resolveStep`, `nearest`
- `src/tmpdirs.ts`: `removeFolders` (returns the pids it ended), `staleFolders`, `compileCacheDir`, `cacheDir`, `diskTmpRoot`, `trimCache`, `ramUsedBytes`, `TMP_STALL_BYTES`, `sweepOldTemp`
- `src/lineclear-client.ts`: `lineclearServer`, `readSnapshot`, `watchSocket`, `postAction`, `keepLinks`, `taskChatKey`
- `src/herdr.ts`: `herdrArgv`, `herdrSessionArgv`, `herdrSocketOf`, `HERDR_SOCKET_ENV`, `KEPT_ENV`, `herdrVersionOf`
- `src/company.ts`: `company`, `currentModelFile`
- `src/zone.ts`: `zonedInstant`, `zoneOffset`
- `src/kept-read.ts`: `readTasksKept`, `keptBy`, `readJsonKept`, `refsKey`, `TaskLine`
- `src/models.ts`: `harnesses`, `readRegistry`, `readModelFile`, `companyOfModel`, `describeOne`, `ModelFile`, `tierRank`
- `src/worktree.ts`: `commitsAhead`, `ownerWrote`, `pushBranch`, `taskWorktree`, `worktreeClean`
- `src/main-branch.ts`: `mainBranch`, `mainRefs`, `mainRef`
- `src/setup.ts`: `setupView`, `saveOffered`, `SetupView`

## Files

- code: `bin/`, `src/prose.ts`, `scripts/prose-check.ts`, `src/cli.ts`, `src/paths.ts`, `src/project.ts`, `src/resolve.ts`, `src/tmpdirs.ts`, `src/worktree.ts`, `src/zone.ts`, `src/kept-read.ts`, `src/main-branch.ts`, `src/models.ts`, `src/company.ts`, `src/setup.ts`, `templates/models.json`, `src/lineclear-client.ts`, `src/herdr.ts`
- repo: `package.json`, `bun.lock`, `tsconfig.json`, `bunfig.toml`, `.gitignore`, `LICENSE`, `AGENTS.md`, `CONTRIBUTING.md`
- docs: `docs/idea.md`, `docs/public.md`, `docs/public-roadmap.md`, `docs/backlog.md`, `docs/architecture.md`
- tests: `test/cli.test.ts`, `test/lineclear-client.test.ts`, `test/stack.test.ts`, `test/no-old-folder.test.ts`, `test/project.test.ts`, `test/resolve.test.ts`, `test/tmpdirs.test.ts`, `test/helpers.ts`, `test/fakes.ts`, `test/tmp-scope.ts`, `test/chat-client.ts`, `test/demo-world.ts`, `test/smoke-branch.test.ts`, `test/board-frames.ts`, `test/kept-read.test.ts`, `test/main-branch.test.ts`, `test/models.test.ts`, `test/setup.test.ts`

## Tests
- `test/contracts/core.test.ts`, `test/cli.test.ts`, `test/project.test.ts`, `test/resolve.test.ts`

## Debts

- `src/cli.ts` imports every command, so a slow import slows every command.
