# Stable and next

Work lands on main, but the service runs stable: stable is the latest release, the last build of main that proved
itself. Next is main. A merge that breaks never reaches the machine your agents run on.

## How a build becomes stable

Every 2 minutes the rule loop looks at main (`lineclear release run`, in a unit of its own, so a restart does not stop
it). When main moved and no promotion ran in the last 30 minutes, it:

1. Builds next at main's newest commit in `~/.cache/lineclear/next`.
2. Runs next's smoke check and canary (`scripts/canary.ts`) on two spare ports, with next's own server, a herdr
   session of its own, a scratch store and a copy of this machine's settings. The canary starts a task, briefs it,
   makes a change, waits for the check to report ready, and closes the task.
3. Lets stable's code read what next wrote (`scripts/formats.ts`, with the server's readers in
   `server/scripts/store-formats.ts`): the roadmap, the settings, the spaces, the modes, the tasks, the chats (the Inbox is their need cards) and the task id
   database. A setting or mode stable would drop fails the test, since a rollback puts stable back on these files.
   Then next's code reads a copy of this machine's own store, the one it takes over: there only a file it cannot read
   fails, since a value next drops is one of its own upgrades.
4. Installs that commit as stable with `install.sh`, which restarts the service, runs the smoke check and puts the
   previous version back when it fails. Then the other machines are updated to the same commit.

At most one promotion each 30 minutes, so merges ship in batches.

## When next fails

Stable stays. The failed commit is not tested again, and one fix task is filed in Lineclear's own space with what
failed. The fix lands on main and ships in the next promotion.

## Where to see it

`lineclear release` and `lineclear doctor` show the stable build, the next build, the last promotion and why next is
held. `/api/home` gives the same as `release`, and `<config>/release.json` holds it.

`lineclear release try [<version>]` builds that release into `builds/<version>` and starts a test instance: its own port, config, data folder and herdr session, with a copy of the real data (tasks, chats, Inbox, settings, spaces, each project's settings). With no version it builds a candidate from main's newest green commit, at most one each 30 minutes. The instance works on clones of the projects whose remote is a bare copy beside them. It has no GitHub token, no SSH and only stub agents, and its pushes refuse any remote outside its own folder. It writes nothing of stable and takes neither its port nor its service. `lineclear release try --stop` ends it and removes its folders. `lineclear release` and `lineclear doctor` show its version, port and state.

`lineclear release check <version>` checks a candidate on its own: the project's `bun run check` at the tag's commit, then the smoke check on its test instance, the canary, and the store check both ways. It stops at the first failure and keeps the version, the commit and each check's outcome in `<config>/release.json`, which `lineclear release` shows. A failed candidate files one `Fix candidate <version>` task.

`lineclear release rollback` points `current` at `previous`, restarts the service (running work lives in herdr and goes on), runs the smoke check and logs the rollback in `decisions.jsonl`. The rolled-back build stays in its folder; install.sh does not offer it again until a newer version is installed. `lineclear doctor` names the current, previous and candidate builds.

## By hand

- `install.sh` with no `LINECLEAR_REF` installs the machine's stable build: on a machine that follows another, the
  build that one gave it last; on a fresh machine, main.
- `lineclear machine add` and `lineclear machine update` give a machine the stable build too. That machine follows this
  one (`<config>/release-follows`): it promotes nothing of its own and gets each new stable build from this machine's
  promotion.
- `LINECLEAR_RELEASE=off` stops the promotions. `install.sh` rewrites the service's unit, so set it in a drop-in that
  survives an update: `systemctl --user edit lineclear` with `[Service]` and `Environment=LINECLEAR_RELEASE=off`.

## Before a merge

`test/release.test.ts` also writes a store with this tree, reads it back as a rolled-back build would and counts its tasks, chats and Inbox items, and a planted format change with no migration fails it. It has the installed stable build read the tree's roadmap and a store the tree's own server wrote
(`server/scripts/store-formats.ts write`), so a format change that stable cannot read fails before it merges. It runs
where Lineclear is installed. A stable build from before `scripts/formats.ts` reads the roadmap only.
