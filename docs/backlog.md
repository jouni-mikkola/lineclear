# Backlog

Ideas that are not in the roadmap. Each says why it waits and what brings it back. One moves into the roadmap only
when that need is measured.

## Safety

- **A socket per task.** An agent would reach Lineclear only through its own socket, and the owner's API would
  need a token. It waits because an agent runs as you anyway. Agents already get no push rights.
  It comes back when a test shows an agent calling an owner action.
- **A clone per task.** Each task would work in its own clone, so it could not reach main's refs. It waits because it
  costs disk and a change to how worktrees are made, and agents already have no push rights. It comes back if an agent is seen
  changing main's refs.
- **Protected paths.** A change to the roadmap, agent rules, CI or check config would need your approval before it
  merges. It waits because every change already has a review, plan changes already come to the Inbox (L17), and an
  ask per such change works against "under 3 asks a day". It comes back if a merged change is found that weakened a
  check.
- **A bubblewrap sandbox** for agent commands. It waits because a heavy guard tends to block normal work such as
  reviews and checks, and needs constant fixing, while safety must never cause bugs or slow work. It comes back only
  if a real incident shows the default layers are not enough.

## Rules

- **More than one next model.** The stall ladder tries the role's next model once (L13). A longer chain comes back
  when tasks are seen reaching the Inbox after that model also stopped.
- **Automatic updates.** Running `install.sh` again updates Lineclear on every machine (L42). Updates in batches,
  one machine first, come back when an update is seen breaking a machine.
- **A database (SQLite)** instead of files. It comes back when there is a measured storage problem.
- **Other import formats.** `roadmap import` reads one documented JSON shape (L3). Others come back when a user
  needs one.
- **Recipes**: specialised workers for UI tests, security reviews, translation.
- **Project memory**: what a project's tasks learned, kept for the next ones.
- **Old folders the coordinator timer left.** The server's coordinator timer runtime folder and a machine's mirror folder
  stop growing now that the timer is off (L117), but what they hold stays on disk. A clean-up that removes them
  comes back when a user asks for the space; it deletes data, so it waits for a yes.
- **A real account switch on the test track.** The track hands its step to the next model (L114) instead of
  marking an account full, which would stop every project on it. A sandboxed account comes back when one exists.
- **One more stall class.** A check an agent runs by hand outside the shared check line. It needs the project's merge
  setting (merge on its own or ask first), which the stall detectors do not read yet (L112). A merge the agent stops
  retrying is fixed at its cause instead (L118).
- **A merge line that a flaky check blocks.** Each repo merges one step at a time, each behind a full check, so one
  check that fails on a flaky test holds every merge behind it, fixes included. The line could take a fix that
  unblocks the check first, or stop retrying a check known to flake. It moves to the roadmap if seen again.

## UI

- **More views.** U5 names what you still open Lineclear's UI for. Each such need comes back as its own view.
- **Machine status view**: CPU, memory and disk of each machine. The setup's own tools show them until a user
  needs them in Lineclear.
- **Numbers across machines** in one view. `lineclear measure` counts every machine (L57); a view of them comes
  back when a user needs it.
- **The three numbers per phase** in the roadmap view (cut from U4 to keep it light).
- **Reviews open** as a live count on the Reviewer (U24). No file holds an open review yet, so the
  panel says "count coming".
- **Lines between step cards** in the roadmap view. U4 shows waits as text and highlights instead. They come back if
  that is not clear enough in use.
- **Layout shift 0 on Settings.** Its skeleton is near the final height, not equal to it (shift under 0.2 at 390 px).
  The taste gate allows that now; the goal is 0.
- **44 px stops on the line.** The task stops on the line are 40 by 29 px: the gate leaves them out until their slot
  grows.

- The CLI loads a command's module only when it runs it (`src/cli.ts` imports them all), and `test/helpers.ts` stops importing the whole CLI. Then the load map of the changed check picks far fewer than 90 tests for a change in one command.

## Release

- Public release. L49 lists what blocks it and asks you.
- A license for the repo, decided before any public release.

## Roadmap view

- Draw the `unproven` step state in `ui/web/roadmap` (words "merged, unproven: <item>", the station look of a step still to do). The data is there (`state`, `unproven` in the roadmap view); the roadmap spec takes about four minutes, so a change in that folder alone breaks the check's time budget.

## Cost per merged step

- The nightly `cost goal` fails: the cost per merged step is above the goal, and cache write is the largest share. Find which sessions write the most cache (a prompt prefix that changes between calls rewrites it) and cut that. It needs `lineclear measure` on a machine with the project set up.
