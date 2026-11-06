# What became of Control Center's units

Control Center is gone. Its 26 user units were stopped and kept in `~/backups/cc-units`. Lineclear's rule loop does the jobs that are still needed, so no unit and no new service is added. One line per old unit: keep or drop, and why.

Moved into Lineclear:

- Secrets: `eval "$(lineclear secrets env)"` and `lineclear totp NAME` replace `load.sh` and `cc-totp`. The human moves the old files once with `lineclear secrets adopt <old secrets folder>`; it prints counts, never a value.
- Backup: `lineclear backup` runs hourly from the rule loop. `lineclear backup drill` brings the latest copy back into a temporary folder and reads its secrets; the rule loop runs it weekly.
- Alerts: a failed backup, a failed drill or a nearly full disk puts one card in the Inbox, which the phone is told of. The card closes when the trouble is gone.
- Agents' browsers: the Agent browsers view shows each `playwright-cli` session.

| Old unit | Decision | Why |
| --- | --- | --- |
| `cc-.service.d` | drop | A drop-in for the units below. |
| `cc-agent-names` | drop | Lineclear names its agents itself. |
| `cc-backup` | drop | It pulled other apps' databases; each app owns its backup. |
| `cc-compaction-check` | drop | The compaction gauge is in Lineclear. |
| `cc-context` | drop | The same gauge. |
| `cc-control-center` | drop | Lineclear's web pages replace the UI. |
| `cc-data-sync` | drop | Lineclear's machines keep their own mirror. |
| `cc-deploy` | drop | `lineclear update` does it. |
| `cc-failure@` | keep, as Inbox cards | Failure alerts come from the rule loop. |
| `cc-machine-backup-check` | drop | The weekly drill proves the copy comes back, which is stronger. |
| `cc-machine-backup-secrets.path` | drop | The hourly backup holds the secrets. |
| `cc-machine-backup@` | keep, as `lineclear backup` | Encrypted copies with restic, in the rule loop. |
| `cc-notify-bank` | drop | Specific to one product, not to Lineclear. |
| `cc-notify-health` | drop | The same. |
| `cc-notify-probe` | keep, as the disk alert | The loop reads free disk space. |
| `cc-notify-releases` | drop | `lineclear release status` shows releases. |
| `cc-notify-watch` | keep, as the Inbox cards | The loop judges backup, drill and disk, raises and closes. |
| `cc-playwright-dashboard` | keep, as the Agent browsers view | Lineclear's own view replaces the tailnet port. |
| `cc-quota-resume` | drop | Lineclear's quota handling wakes agents. |
| `cc-restore-drill` | keep, as `lineclear backup drill` | A backup is only real when it comes back. |
| `cc-secrets-check` | drop | One vault file, which the backup holds. |
| `cc-status-cleanup` | drop | The loop sweeps old temp folders. |
| `cc-status-sample` | drop | The disk alert covers what mattered. |
| `cc-status-space` | drop | The same. |
| `cc-tailnet@` | drop | `lineclear serve` takes the address to listen on. |
| `cc-tick.service` | drop | The rule loop is the one tick. |
| `cc-tick.timer` | drop | The same. |
