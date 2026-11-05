# Control Center folds in

Control Center was the builder's own setup around the old board: systemd user units, scripts and pi extensions on
the builder's machines. Lineclear now runs the work, so each part of Control Center gets one verdict here:

- **in Lineclear**: Lineclear already does the job; the place is named.
- **moves**: Lineclear takes the job over; the step is named (Phase 21 of the roadmap).
- **stays**: personal machine setup, kept in a small private dotfiles folder, not a Lineclear project.
- **goes**: no one needs it once Lineclear runs; the reason is given.

A part stops only once what replaces it works. `lineclear doctor` names every unit and process of a "goes" or "in Lineclear" part that still runs or is enabled, and `lineclear doctor --fix` stops and disables it on every machine.

## Units

| Unit | What it did | Verdict | Why |
| --- | --- | --- | --- |
| `cc-control-center` | Web UI on port 8799: Secrets, Agents' browsers, usage, machines, roles and models | goes | Each page has a home in Lineclear: Secrets in Settings and `lineclear secrets` (L108), browsers in the Browsers view (U8, U33), usage on Usage (U27), machines and models in Settings |
| `cc-playwright-dashboard` | The `playwright-cli` dashboard on port 9323 | goes | The Browsers view drives `playwright-cli` itself: a live picture, take-over, and the Inbox item of a login (U8, U33) |
| `cc-tailnet@8787` | The old board's port, on the tailnet address | goes | Nothing listens on that port any more |
| `cc-tailnet@8799` | Control Center's port, on the tailnet address | goes | Goes with Control Center. Lineclear listens on 127.0.0.1 and is reached through Tailscale Serve, with its name in `LINECLEAR_HOSTS` (L48, README) |
| `cc-tick.timer`, `cc-tick.service` | Starts every job below, once a minute | goes | Each job has its own verdict below; the rule loop (`lineclear run`) starts what Lineclear does on a schedule |
| `cc-machine-backup-secrets.path` | Backs the secrets up as soon as they change | moves | Lineclear backs up its data and secrets (L109) |
| `cc-compaction-check` | Checks each model's compaction threshold (failed) | goes | The token pack sets compaction near 150 k for every model, and `lineclear doctor` names an unknown window (L52) |
| `cc-failure@` | An alert when a `cc-*` unit fails | goes | Goes with the units |
| `cc-.service.d` | The drop-in every `cc-*` unit shares | goes | Goes with the units |
| `cc-context` | Measures each pi session's context size and files read over and over | goes | The token pack's compaction and batched reads (L52, L55) replace the measure; Usage (U27) shows the cost |
| `cc-machine-backup@` | Encrypted backup of a path set to its targets | moves | `lineclear backup` (L109) |
| `cc-machine-backup-check` | `restic check` of the backup targets | moves | `lineclear backup` checks its repository (L109) |
| `cc-restore-drill` | Restores the backup when due, to prove it | moves | The restore drill belongs to `lineclear backup` (L109) |
| `cc-secrets-check` | Verifies every secret is as recorded and restores lost files | moves | One vault and its backup (L108, L109); `lineclear doctor` compares names across machines |
| `cc-backup` | Pulls one app's production databases over SSH into restic | stays | One owner's production data, the `backup` script below |
| `cc-notify-bank`, `cc-notify-health`, `cc-notify-probe`, `cc-notify-releases`, `cc-notify-watch` | Read-only checks of the production apps, heartbeat, releases, and alert judging | goes | The `notify` script below: Inbox (L47), Home (L50) and each project's health command in the rule loop |
| `cc-status-sample`, `cc-status-space`, `cc-status-cleanup` | Machine load, disk use and `/tmp` cleanup | in Lineclear | The `machine-status` script below: Usage (U27), Home (L50), `src/tmpdirs.ts` |
| `cc-agent-names` | Gives a nameless herdr agent its name back | in Lineclear | The `agent-names` script below |
| `cc-data-sync` | Copies logs and sessions to the other machine | goes | The `data-sync` script below |
| `cc-deploy` | Moves a machine to the newest Control Center commit | goes | The `deploy` script below |
| `cc-quota-resume` | Wakes a chat stopped for want of allowance | in Lineclear | The `quota-resume` script below |

## The login secrets folder

`~/.config/control-center/secrets` is the same on every machine. `lineclear machine add` and `update` copy it over
SSH with rsync (files 0600, folders 0700, the newer file wins, nothing is deleted, nothing is printed), and the web
server copies it again within 30 s of a change. `lineclear doctor` fails for a machine that lacks a secret NAME this
one has; it compares names only, never values.

## Scripts

| Script | What it did | Verdict | Why |
| --- | --- | --- | --- |
| `secrets` | The secrets store, its web form and its file per repo | moves | One store: Settings > Secrets, `lineclear secrets` and `shepherdr secret` all use Lineclear's vault (L108) |
| `totp` (`cc-totp`) | Prints the code of a stored login's `NAME_TOTP` | moves | `lineclear totp NAME` (L108) |
| `secrets-watch` | Alerts when the secrets files change outside its form | goes | One writer keeps the vault, and Lineclear's tests run in a folder of their own, never on the real one; the backup (L109) keeps old copies |
| `secret-guard` | Was a sandbox and redaction (removed earlier); now only the run gate's shims | goes | Lineclear masks stored values in what it prints and its pi extension refuses other projects' secrets (L9); heavy commands take a check slot (L45) |
| `backup` | Pulls the production databases of one app's server each night | stays | It backs up one owner's production data, not Lineclear's: the dotfiles folder keeps it, with a timer of its own |
| `machine-backup` | Encrypted restic backup of secrets, keys and logins, each machine to the other | moves | `lineclear backup` keeps Lineclear's data and secrets, and the extra paths you name (keys, logins), in restic (L109) |
| `data-sync` | Copies the usage log and the pi sessions to the other machine every minute | goes | Lineclear reads other machines over SSH when it needs them (`lineclear export`, L42) |
| `cloudflare-export` | Only compiled leftovers, no source | goes | Nothing runs it |
| `deploy` | Moves each machine to the newest Control Center commit every 2 minutes | goes | Control Center itself goes; Lineclear updates with `lineclear machine update` and rolls back an update that breaks |
| `notify` | Phone alerts through ntfy: machines, disks, jobs, production health | goes | The Inbox reaches the phone (L47), a full disk shows on Home (L50), and a project's health command runs in the rule loop. No phone was subscribed to the ntfy topic |
| `usage` | Checks the usage ledger for gaps | goes | Lineclear reads pi's own session files (L27) and shows Usage (U27); the ledger is not needed |
| `quota-resume` | Wakes a chat stopped for want of allowance once a subscription has room | in Lineclear | The server wakes a chat at its account's reset time, or moves it to an account with room first (`server/server/live/retry.ts`); the rule loop hands a step on to the next model (L46) |
| `model-control` | Only compiled leftovers, no source | goes | Models are set in Settings |
| `compaction` | The compaction check above | goes | L52 |
| `tool-output-cap` | Cuts long tool output, keeps it whole in a file | goes | The pack's `cut-output` part (L53) |
| `check-slot` | Runs a board check in a slot | in Lineclear | `lineclear check` and `lineclear slot` (L7, L45) |
| `checkguard` | Control Center's own test runner | goes | Goes with the repo |
| `gate` | Queues heavy commands, shims for `timeout` and the test tools | in Lineclear | The pi extension sends a project's heavy commands through `lineclear slot` (L45) |
| `hardcode-gate` | Finds hard-coded values in a change | goes | Each project's check is its own; Lineclear's code gates are `bun run gates` (Phase 18) |
| `clean-code` | Clean code gate for Control Center's repo | goes | Same as above |
| `language` | Finds machine-sounding text | goes | Same as above; Lineclear's dash check is in `bun run check` |
| `agent-names` | Gives a nameless herdr agent its name back | in Lineclear | The server renames an agent herdr listed without its name (`server/server/live/agents.ts`) |
| `machine-status` | Load, memory, disks and a `/tmp` cleanup | in Lineclear | Usage shows each machine's load and slots (U27); the rule loop holds starts over the load limit; old temp folders are cleaned (`src/tmpdirs.ts`) |
| `install-worker` | Installed Control Center on a second machine | goes | `lineclear machine add` installs Lineclear there in one command |
| `shepherdr-apply` | Put a changed model into chats that already ran | goes | Lineclear starts each task with its role's model and moves a running step to the next one (L46) |
| `tick` | The timer's job list | goes | With `cc-tick.timer` |
| `control-center` | The web server and its views (`scripts/control-center/`) | goes | `cc-control-center` above: each view has a home in Lineclear |
| `check`, `check.sh` | The repo's own check and its secret gate | goes | Goes with the repo; Lineclear's is `bun run check` |
| `install`, `install.sh`, `migrate-from-agentbox.sh` | Install Control Center and move it from the older setup | goes | `install.sh` of Lineclear installs; nothing is left to migrate |
| `cc-cap-report` | Reports the tool output cap: cut results, characters left out, re-reads, context per turn | goes | The cap itself goes (`tool-output-cap`, L53), so its report has nothing to measure; Usage (U27) shows the cost |
| `cc-check` | The one check before `shepherdr ready`: Control Center's gates and the tests a change reaches | goes | `lineclear check --changed` runs the project's own check (L7, L45); Control Center's gates went with the repo |
| `cc-gate` | The run gate: sends heavy commands (`pnpm`, `tsc`, `docker`, test tools) through a place in line | in Lineclear | The `gate` script above: heavy commands take a check slot through `lineclear slot` (L45) |
| `cc-run-hermetic` | Runs a test with the real home folder read-only and hidden, so it cannot touch secrets | goes | Lineclear's tests run in a folder of their own, never on the real home (see `secrets-watch`), and the pi extension refuses other projects' secrets (L9) |
| `lib` | Shared Python: board, costs, usage, machines, secrets store | goes | Lineclear has its own in `src/` and the server |

## pi extensions Control Center installed

| Extension | Verdict | Why |
| --- | --- | --- |
| `claude-bridge-b` | stays | One owner's second Claude subscription, as a pi provider |
| `claude-bridge-c` | stays | One owner's third Claude subscription, as a pi provider |
| `quota-switch` | stays | Moves a turn to the next account inside pi; Lineclear moves a step between turns (L46). It stays until that handover is measured |
| `api-guard` | stays | One owner's rule against a paid API key |
| `tool-policy` | stays | Enforces the owner's own agent rules (`~/.pi/agent/AGENTS.md`) |
| `web-tools` | stays | Loads the web tools only when an agent asks; a candidate for the token pack (backlog) |
| `usage-ledger` | goes | Lineclear reads pi's session files (L27) |
| `tool-output-cap` | goes | The pack's `cut-output` (L53) |
| `state-file` | goes | The pack's `compaction-notes` (L54) |
| `read-batch` | goes | The pack's `batched-reads` (L55) |
| `secret-guard` (the gate's shims) | goes | Heavy commands take a check slot (L45) |
| `lineclear` | in Lineclear | Lineclear's own pi extension (`pi/extension.ts`), not Control Center's |
| `quota-switch.json` | stays | The settings of `quota-switch` |
| `herdr-agent-state` | stays | Herdr writes and updates it itself; it is the engine's, not Control Center's |
| `shared` (`bridge-account`, `who-ran`) | stays | Helpers of the Claude B and C providers and `quota-switch`; they stay with them |

## Other leftovers

- The second clone of the Control Center repo and the old `herdr-projects` folder are packed to `~/archive` and
  removed.
- The repo is archived on GitHub only after the owner says yes (`lineclear ask --kind outward`).
- Its space leaves the board once its done tasks are archived and nothing is open.

## Machine settings

`config/machine/` holds `99-agents.conf`, `journald-control-center.conf`, `lid.conf` and `zram-generator.conf`
(limits, log size, lid and swap on a headless box). **stays**: these are the builder's own machine setup, kept in
the private dotfiles folder. `config/playwright/cli.config.json` stays there too: it only sets the browser for
`playwright-cli`.
