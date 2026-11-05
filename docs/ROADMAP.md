# Roadmap

This file says when each step can start and when it counts as done. The rules read it, so it follows its own format.

## Release 0.1

Why: a release must ship as soon as possible, and the rest of this file is weeks of work. Release 0.1 is what is
on main now, with the web UI as it is, in the repository as it is: private, for those who have access. It holds
only what someone new with that access needs to install it and what keeps it honest: main green, no Shepherdr name a user can see, a cold install by the README alone, a README, license and
changelog that say what is true, and a tag.

Target date: Monday 2 November 2026, in the morning. Measured speed: 145 merges to main in the 42 hours from the
first merge on 31 October to 1 November 20:00, 73 of them in the last 24 hours, about 3 an hour. The cut is 5
merges: two tasks already at work and the three steps below. L76 and R2 run side by side and R3 after both. Of the last 50 tasks on this board, 9 in
10 took under 2 hours 20 minutes from start to done, so the two in a row take under 5 hours, and the target holds
if the work starts tonight. L76 moves here from Phase 17 with no `after`: what a user sees needs no rename inside
`server/` or the docs, which stay in L75.
R3 records the date reached in `docs/numbers.md` under "Release 0.1".

In the cut, already at work as tasks:

- Main green on an idle machine: `bun run check` on main passes twice in a row on an idle machine, hermetic tests
  only (LINE-10).
- The cold install by the README: the install part of LINE-4. A fresh HOME with a clean PATH installs from the repo
  by the README alone and its doctor passes; the run and every place the README was not enough are recorded in
  `docs/numbers.md` under "L49", and each is fixed. The rest of LINE-4 (first day without commands, the agent kit,
  the proof gate that reopens L49 and L44) moves after 0.1.

Already on main and part of 0.1: agents decide (LIN-163), worktrees ready to check (LIN-164), the rollback of an
update that breaks (LIN-136), `lineclear machine add` in one command (LIN-167), lint and dead code in the check
(L77, L78).

The owner set this cut and its order. Moved after 0.1, in this order of priority, each with why a stranger does not need it on day one:

1. Home is the Dispatcher (LIN-139) and every UI redesign (Phase 13, LIN-145, LIN-146, LIN-148, LIN-151, LIN-159):
   the UI as it is installs and runs a project; a better Home is the first thing of 0.2.
2. The flagship line (LIN-149, LIN-150, LIN-152): it makes the work worth watching; using Lineclear does not need
   it.
3. The Blender film and the finished look (LIN-153, Phase 15): a still serves the README for 0.1.
4. Code gates beyond lint and dead code (LIN-154, L83 to L90): coverage floors, splits and the nightly check keep
   the code clean over months; the check already runs lint and dead code.
5. Parts with keepers (LIN-168): quality over long work, not what a stranger meets.
6. Stall classes (LIN-158): a loop that finds new kinds of stall matters once Lineclear runs long without a human.
7. Control Center folds in (LIN-169): it is one builder's setup, which a stranger never has.
8. Pacing the week (LIN-166): a first day does not reach a weekly allowance.
9. The rest keeps its phase and order: merges on a busy machine (LIN-155), a step with nothing to merge (LIN-156),
   temp files off the RAM disk (LIN-165), no path to the old folder (LINE-1), the fast loop and check tiers (LINE-2,
   LINE-3), machines through herdr (LIN-173), fresh eyes before work (Phase 16), the rest of Lineclear only
   (Phase 17, with L75) and of clean code (Phase 18). Each is a fix for long or heavy use, or for the builder's own
   machines, not for a first install.

Ready steps, not counting the 6 at work, are those whose `after` is done: 14 before this change and 20 after it.
A plan that applies by itself may not drop a lock, so the coarse locks stay until the owner approves a split.

A task in the cut finishes only the part named here. A task outside it goes on beside the cut and merges in the
smallest part that stands on its own; none is lost.

### L76 A clean install shows one name
Result: A new install shows only the Lineclear name, with no trace of the old one.
- why: someone new must get Lineclear with no trace of the old name.
- done when:
  - The fresh machine test of L31 installs with `install.sh` and finds no Shepherdr name in what a user sees: the
    CLI's help and output, the web pages, the service names and the files it installed. `scripts/fresh-one-name.ts`
    installs into an empty HOME and runs `scripts/one-name.ts` there, and `.github/workflows/install.yml` runs it.
  - `bun run check` and `bun run ui:test` pass.
- parts: install, core
- locks: words
- after: none

### R2 README, license, changelog
Result: A stranger reads a true README, a license and a changelog before installing 0.1.
- why: a stranger decides from the README whether to install, and a claim that is not true breaks trust in the rest.
- done when:
  - `README.md` is short: what Lineclear is, what it needs, the one-line install, the first project, and how to
    remove it. The install works for someone with access to the private repository: it signs in with
    `gh auth login` and fetches the repository over https with `gh`, since a plain download of a private file
    fails. Every claim in it is checked against main and the cold install of LINE-4; a picture is a still from
    the UI as it is, no film.
  - `LICENSE` is MIT, and the README names `server/NOTICE`, which keeps the MIT notice of Shepherdr 2.0.
  - `CHANGELOG.md` has a 0.1.0 entry: what works, what is known not to, and that Lineclear began as a fork of
    Shepherdr 2.0, with its link.
  - `bun run check` passes.
- parts: ui
- locks: docs
- after: none

### R3 Release 0.1 tagged
Result: Release 0.1 is a tag you can install again the same way, after its checks pass.
- why: a release that is not tagged and checked from its tag can not be installed again the same way.
- done when:
  - Main green on an idle machine (LINE-10) and the cold install of LINE-4 are on main. These are tasks, not steps,
    on another machine's board, so its task reads `git log origin/main` for them and, until both have merged,
    waits with `lineclear wait until <time>` and reads again.
  - `bun run release 0.1.0` refuses on a dirty tree or a red `bun run check`. Otherwise it sets the version to
    0.1.0, makes the tag `v0.1.0` here, installs from that tag into a fresh HOME with `LINECLEAR_REF=v0.1.0` and
    runs its doctor. It never pushes. A test covers the refusal and the tag.
  - `bun run dispatcher:eval` calls at least 95 % right on main, recorded under "Dispatcher eval".
  - `docs/numbers.md` has "Release 0.1": the release command's output, the merges per day, and the date reached
    against the target above.
  - Once the rest is true, its task pushes the tag `v0.1.0` and makes the GitHub release in the same private
    repository with `gh release create v0.1.0`, its notes the 0.1.0 entry of `CHANGELOG.md`. The owner has
    approved this release, so it needs no ask. The repository stays private.
  - Reopened: no tag `v0.1.0` and no GitHub release exist, and `docs/numbers.md` has no "Release 0.1" section.
- parts: install
- locks: release
- after: L76, R2

