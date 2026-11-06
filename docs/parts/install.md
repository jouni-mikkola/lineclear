# install

Getting Lineclear onto a machine and keeping it healthy there: `install.sh`, `lineclear doctor`, `uninstall`, `migrate`, adding a project, more machines over SSH, secrets, login codes, backups, the service and the promotion of next to stable.

## Invariants

- One command installs everything, and a second run changes nothing that works. `doctor` names the command that fixes each problem it finds, and tells a machine ahead of this one from one behind by git ancestry. A secret's value is never printed, logged or passed on a command line. `uninstall` removes only what install added, unless `--all` says so; going back to herdr-projects 2.0 is one command. The service runs stable, a build that passed next's smoke check, canary and stable's format check; never main untested. The server's own heal changes no mode: a coordinator timer it finds shows in the Inbox, and only `doctor --fix` turns it off. A release lives in `builds/<version>`, `builds/current` points at it and `builds/previous` at the build before; `doctor` fails a service or `lineclear` run from a checkout.

## Interface

`install.sh`, `lineclear doctor`, `uninstall`, `migrate`, `machine`, `project`, `secrets`, `totp`, `backup`, `release`, `serve`, `export`, and these names:

- `src/secrets.ts`: `secretNames`, `secrets`, `totp`, `secretsText`, `loadableTotps`, `storedLogin`, `storedLoginAdvice`, `totpAdvice`, `totpAnswers`
- `src/backup.ts`: `backupMain`, `startBackupIfDue`
- `src/machine-alerts.ts`: `watchMachine`
- `src/store-copies.ts`: `storeMain`
- `src/candidate-check.ts`: `candidateMain`
- `src/release.ts`: `releaseMain`, `releaseTry`, `startReleaseIfDue`, `readRelease`, `ReleaseState`
- `src/promote-cmd.ts`: `promoteMain`
- `src/promote-step.ts`: `startPromoteIfDue`
- `src/doctor.ts`: `doctor`, `realProbe`, `herdrVersions`, `testedHerdr`
- `src/retire.ts`: `fixAll`, `fixRetired`, `remoteLeft`
- `src/export.ts`: `exportMain`, `inboxAll`, `statusAll` (a local-only flag keeps a forwarded call to one hop)
- `src/machines.ts`: `machineMain`, `installMachine`, `machinesView`, `MachineView`, `removeMachine`
- `src/machine-list.ts`: `readMachines`, `HOST`
- `src/project-cli.ts`: `project`
- `src/migrate.ts`: `migrateAll`, `migrateMain`
- `src/update.ts`: `updateMain`
- `src/serve.ts`: `serveMain`, `boardMain`, `isBoardJob`
- `src/board.ts`: `startBoard`
- `src/uninstall.ts`: `realRemover`, `uninstall`
- `src/add-project.ts`: `detectProject`, `saveProject`, `findRepos`
- `src/track.ts`: `trackMain`
- `src/ssh.ts`: `remoteLineclear`, `remoteLineclearSync`, `quote`, `REMOTE_PATH`, `sshArgs`

`machineMain` takes an optional fix filer: `machine update` rolls back the first machine that fails, stops there and files one fix.
## Files
- code: `install.sh`, `src/project-cli.ts`, `src/machine-list.ts`, `src/old-install.ts`, `src/old-paths.ts`, `src/old-archive.ts`, `.github/`, `src/doctor.ts`, `src/builds.ts`, `src/rollback.ts`, `src/promote.ts`, `src/promote-step.ts`, `src/promote-cmd.ts`, `src/install-paths.ts`, `src/uninstall.ts`, `src/migrate.ts`, `src/update.ts`, `src/machines.ts`, `src/ssh.ts`, `src/helper.ts`, `src/add-project.ts`, `src/secrets.ts`, `src/totp.ts`, `src/backup.ts`, `src/machine-alerts.ts`, `docs/control-center-units.md`, `src/store-copies.ts`, `src/export.ts`, `src/retire.ts`, `src/leftovers.ts`, `src/serve.ts`, `src/release.ts`, `src/candidate-check.ts`, `scripts/smoke.ts`, `scripts/canary.ts`, `scripts/formats.ts`, `server/scripts/store-formats.ts`, `src/track.ts`, `src/board.ts`, `scripts/release-tag.ts`, `docs/stable-and-next.md`, `src/try-instance.ts`, `src/published.ts`
- tests: `test/contracts/install.test.ts`, `test/canary.test.ts`, `test/board.test.ts`, `test/export.test.ts`, `test/rollback.test.ts`, `test/promote.test.ts`, `test/uninstall.test.ts`, `test/script-parts.test.ts`, `test/all-machines.test.ts`, `test/old-install.test.ts`, `test/old-paths.test.ts`, `test/old-archive.test.ts`, `test/doctor.test.ts`, `test/leftovers.test.ts`, `test/install.test.ts`, `test/update.test.ts`, `test/machine-add.test.ts`, `test/machines.test.ts`, `test/migrate.test.ts`, `test/secrets.test.ts`, `test/backup.test.ts`, `test/store-copies.test.ts`, `test/release.test.ts`, `test/release-formats.test.ts`, `test/candidate-check.test.ts`, `test/serve.test.ts`, `test/track.test.ts`, `test/add-project.test.ts`, `test/release-tag.test.ts`, `test/try-instance.test.ts`, `test/fixtures/stable-store/`, `test/fixtures/third-company/`

## Tests
- `test/contracts/install.test.ts`, `test/add-project.test.ts`, `test/all-machines.test.ts`, `test/doctor.test.ts`, `test/leftovers.test.ts`, `test/install.test.ts`, `test/machine-add.test.ts`, `test/machines.test.ts`, `test/migrate.test.ts`, `test/update.test.ts`, `test/secrets.test.ts`, `test/backup.test.ts`, `test/release.test.ts`, `test/release-formats.test.ts`, `test/try-instance.test.ts`, `test/serve.test.ts`, `test/release-tag.test.ts`

## Debts
- None.
