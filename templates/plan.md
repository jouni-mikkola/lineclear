Plan {{id}} for the project {{project}}. Goal: {{goal}}

You, the Dispatcher, write this plan yourself: no task starts. Make a git worktree of {{repo}} on a new branch
(`git -C {{repo}} worktree add <folder> -b plan/{{id}}`) and change `docs/ROADMAP.md` there so that it carries this goal to
main. Read AGENTS.md and docs/idea.md of the project first.

{{direction}}

A plan that goes against a line above is a critical finding; the readiness check refuses it.

Each step is read by a fresh model that knows only the step and the repo's map (AGENTS.md and the list of tracked
files). It says the step back in its own words and answers go or no-go. A no-go comes back as the output of `plan submit` with
what is missing: fix the step before anything reaches the owner.

Keep the steps that exist; add, reorder or drop steps only as the goal needs.

Every step has the same shape:

    ### <id> <title: the result, at most 32 characters>
    Result: <one sentence, at most 140 characters: what the owner or a user can see or do once it lands>
    - why: <one reason that holds for anyone>
    - done when:
      - <a test or a fact that anyone can check>
    - locks: <the real areas it changes, so steps on other areas run beside it; none if it touches no shared code>
    - after: <ids that must be merged first, or none>
    - files: <paths or folders it is likely to touch, at least one>

Rules: one small step does one thing. Two steps that touch the same code share a lock. A step with no `after` can
start at once, so give each step the ids it really needs. New ideas that are not part of the goal do not go in.

Do not run `git push` and do not merge. When the file is ready:

1. Run `lineclear roadmap check .` until it passes, then commit the change.
2. In the worktree run `LINECLEAR_TASK={{id}} lineclear plan submit`. It runs the rule checks (form, locks, `after`, the longest chain to U43 not
   longer, every done-when kept as strict) and a fresh-eyes readiness check. A model from another company reads each new or changed step too and
   may send it back as unclear: make the step say what it needs. Three rounds with a no-go end this plan. When both pass, the plan merges by itself and the
   owner can undo it with one tap. If one refuses, it prints why: fix that, commit and run it again. Make no commit after it passes.
3. A project that asks before plans puts the diff in the owner's Inbox instead. Tell the owner it waits there and end
   your turn. If the owner rejects with a note, change the roadmap as the note says, commit, run `plan submit` once
   more. A second rejection ends this plan.
