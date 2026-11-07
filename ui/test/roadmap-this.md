# Roadmap

What Lineclear has to do is in [idea.md](idea.md). This file says when each step can start and when it counts as
done. The rules will read it, so it follows its own format.

**How to read it.**

- A step starts as soon as every step in its `after` is done and its locks are free. There is no other order.
- Each step is `### <id> <title>` with four lines: `why`, `done when`, `locks` and `after`. The `after` line lists
  ids or says `none`. A step that is no longer wanted gets a fifth line `dropped: <reason>`. It then counts as done
  for the steps after it.
- A step is done when a commit on main has a subject `<TASK>: <id> ...`, or a line `Step: <id>` in its message.
- A step that needs you asks once and waits: `lineclear ask` until L7, then `lineclear ask`.
- A trial (24 h, 48 h, a week) is waited with `lineclear wait until <time>` (L7). The task merges when it passes.
- From phase 2 on, each phase is measured before and after with `lineclear measure` (L4). The numbers go to
  `docs/numbers.md` without project names.
- New ideas go to [backlog.md](backlog.md), never into this file.

**Time.** Estimates come from `lineclear measure` once L4 is done.

## Phase 0: Base

Why: every later step needs a repo, a check, and an install that anyone can run.

### L0 Repo skeleton
- result: One command checks types, tests and dashes and passes in under a minute.
- why: every later step needs a place to land and one check that keeps the repo clean.
- done when:
  - The stack in idea.md is set up: TypeScript strict on Bun, with `src/`, `test/` and `bin/lineclear`.
  - `bin/lineclear --help` lists its commands. An unknown command prints one line and exits 2.
  - `bun run check` runs the types, the tests and the dash check, and passes in under 60 s.
  - The dash check fails on an en dash or an em dash in any tracked file, and names the file and the line. A test
    shows it on a fixture with each dash, made in a temporary folder so that no tracked file holds a dash.
- locks: repo
- after: none

### L1 Install, doctor, uninstall
- result: You install Lineclear with one command, and a broken setup tells you how to fix itself.
- why: every pilot installs with one command, and a broken setup says how to fix itself.
- done when:
  - `curl -fsSL <repo>/raw/main/install.sh | sh` first installs the missing tools among git, Bun, herdr and pi. Then it adds herdr-projects 2.0 as a herdr plugin held at `v2.0.0` until the migration (L15) replaces
    it. It installs Lineclear from its own repo, so nothing is redistributed. Last it adds Lineclear with its pi
    extension and its systemd user service. It uses curl because `bunx` needs Bun first.
  - Until later steps fill them, the service runs a `lineclear run` that stays up and does nothing, and the pi
    extension is empty. L6 and L9 fill them.
  - `install.sh` takes an optional ref in `LINECLEAR_REF`, so a test can install a branch.
  - It asks nothing it can detect. It asks for sudo only to add system packages. It prints one plain line per step.
  - `lineclear doctor` checks each part. For each problem it prints one line and one command that fixes it. It exits
    0 only when all is well.
  - `lineclear uninstall` removes what install added. It keeps project settings and secrets unless given `--all`.
  - Running `install.sh` again updates Lineclear to the newest version on main.
  - A test in `.github/workflows/install.yml` on a fresh Ubuntu virtual machine with systemd. It installs, and then
    doctor passes. A second install changes no file. An install of the branch's parent commit followed by an install
    of the branch updates it. Uninstall leaves
    none of Lineclear's files.
- locks: install
- after: L0

## Phase 1: Read the plan

Why: the rules and the numbers can only work from a plan they read without guessing.

### L2 Roadmap check and status
- result: `lineclear roadmap status` shows how far a project is, from the roadmap file alone.
- why: the rules must read the plan without guessing, and progress must survive any restart without a file edit.
- done when:
  - `lineclear roadmap check <repo>` reads `docs/ROADMAP.md` in the format at the top of this file. It names the
    line of each of these errors:
    - a missing or unknown field
    - a duplicate id
    - an `after` that is unknown or circular
  - `lineclear roadmap status <repo> --space <name> [--json]` gives each step one of five states. Done comes from
    the commits on origin/main as the format says. Dropped comes from the `dropped` line. In work means an open task
    in that Lineclear space whose title starts with the id and a space, so `L1` never matches `L10`. Ready means
    every step in its `after` is done. Waiting is all the rest. L6 passes the space from L5's settings.
  - Tests: a test repo covers every state and every error kind, and this file passes. A generated roadmap of 400
    steps over 12 phases is checked in under 1 s.
- locks: roadmap
- after: L0

### L3 Import a roadmap file
- result: A project with its plan in another file imports it without redoing its done steps.
- why: a project with its plan in another file must not start over, or redo its done steps.
- done when:
  - `lineclear roadmap import <file.json> <repo>` writes `docs/ROADMAP.md` from a JSON list of steps. Each step
    has this file's four lines as fields, plus `id`, `title`, `phase` and `state`.
  - The `state` is `open`, `done` or `dropped`. A dropped step may have a `reason`. Without one it gets "imported as
    dropped".
  - `docs/import.md` documents the shape with an example.
  - The import commit has a line `Step: <id>` for each step whose state is done, so `roadmap status` shows the same
    done set as the file, also after a squash merge.
  - A field it cannot place stops the import with the step id and the field, and nothing is written.
  - Tests: a fixture with every state, and one with an error.
- locks: roadmap
- after: L2

### L4 Measure the three numbers
- result: `lineclear measure` shows your asks a day, the wait before a start and the cost of a merged step.
- why: the before and after of every phase.
- done when:
  - `lineclear measure <project> --since <date> [--json]` prints, for each day:
    - asks: needs-you cards in Lineclear's chat files, and Inbox items once the Inbox exists
    - wait: the median minutes from the merge that made a step ready (its last `after`) to the start of its task
    - cost: the equivalent $ per merged step. It is the tokens in its tasks' pi session files at the price of the
      same model in pi's model data. A model with no price there is named, not guessed. A task with no session
      file found is named too, and is not counted as $0.
  - It uses no AI, and reads only files and git.
  - A fixture of two days, counted by hand, gives the same numbers.
- locks: measure
- after: L2, L5

### L5 Project settings
- result: Each project has its own settings, such as its check, its space and its models.
- why: the rules need to know each project's settings, and none of them may be guessed.
- done when:
  - `lineclear project add <repo>` writes `~/.config/lineclear/projects/<name>/settings.json` with these fields:
    - the repo path and its Lineclear space
    - the check command, and an optional health command for main
    - an ordered model list for each of the three roles in idea.md
  - It fills in what it can detect: the space from `lineclear space list`, the check command from a `check` script
    in `package.json` or a `check` target in a `Makefile`. It asks only for what is still missing.
  - `lineclear project list`, `lineclear project remove <name>` and `lineclear project check <name>` work. The check
    says whether the repo exists and its check command runs.
  - Tests cover each field and a missing repo.
- locks: settings
- after: L0

## Phase 2: Rules instead of the AI coordinator

Why: an AI coordinator that wakes on a timer spends tokens when nothing changed. A rule does the same for free.

### L6 The rule loop
- result: Ready steps start by themselves, with no AI coordinator watching the clock.
- why: this step replaces the AI coordinator.
- done when:
  - `lineclear run` ticks every 30 s as the user service from L1. `lineclear run --once --dry-run` prints the
    decisions of one tick and changes nothing.
  - Each tick, for each project: a ready step whose locks are free starts with
    `lineclear task add "<id> <title>" --brief <brief> --space <space>` when the space has a free slot. The brief is
    made from `templates/brief.md` with the step's why, its done-when and the project's check command.
  - The brief asks for a review before the merge by the first model in L5's reviewer list that comes from another
    company than the worker's model, and tells the agent to merge once that review passes. The reviewer reads the
    change against the step's why and done-when. Critical and major findings are fixed, for at most the project's
    review rounds (2 if unset). A finding still open after them makes the step ask you. A reviewer model that pi
    no longer offers is skipped for the next one in the list.
  - Steps start day and night, as many at once as their locks and the space's slots allow.
  - A broken roadmap starts nothing, and shows in `lineclear status`.
  - When the project's health command fails after a merge, it starts one fix task with the command's output in its
    brief. A second failure in a row stops new starts in that project, and shows in `lineclear status`.
  - Each start, and each reason a ready step did not start, goes to `decisions.jsonl` once, with its reason.
  - Tests with a fake `lineclear` cover locks, after, a full space, a broken roadmap, a failing health command and
    a reviewer from the worker's company being skipped.
- locks: rules
- after: L1, L2, L5

### L7 Declared waits and check slots
- result: An agent that waits is not nudged, and checks take turns so one machine is not overloaded.
- why: an agent that waits must not be nudged, and checks must not overload the machine.
- done when:
  - `lineclear wait <owner|login|checks|browser> "<reason>"`, `lineclear wait until <time> "<reason>"`,
    `lineclear ask "<question>" --choice <a> --choice <b>` and `lineclear resume` work from inside a task. They find
    the task from its worktree. Each wait and its reason show in `lineclear status`.
  - An `until` wait holds no slot. The rule loop stops the task with `lineclear task stop`. At the time it wakes the
    task with `lineclear task tell`, which resumes its agent. Until the Inbox (L12) `lineclear ask` posts the
    question as a `lineclear ask` card.
  - `lineclear check` runs the project's check command. At most N checks run at once on a machine (a machine
    setting, 2 if unset). A check that waits for its turn is a `checks` wait.
  - A load limit (a machine setting, the number of CPU cores if unset): while the machine's load average is above
    it, the rule loop starts no new task, and says so once in `decisions.jsonl`.
  - The brief template tells workers to use `lineclear check`, `lineclear wait` and `lineclear ask`.
  - Tests cover each wait kind, a timed wake, three checks with N set to 2, and no start above the load limit.
- locks: rules
- after: L6

### L8 Pilot
- result: A real project runs on the rules for a week and its numbers are written down.
- why: the proof that rules can replace the AI coordinator.
- done when:
  - You pick one project (asked once). Its coordinator is set to regular (`lineclear mode <space> regular`). It is
    told in its chat that rules now run the project, and its standing requests are cleared. Then `lineclear
    run` drives the project for 48 h.
  - The decisions log for those 48 h shows that no ready step waited more than 5 min for a free slot, and that at
    least five steps merged.
  - Every task start in the project came from a rule. The coordinator's runs in those 48 h and their cost are in
    `docs/numbers.md`, and none of them started or told a task anything.
  - The project's numbers before and after are in `docs/numbers.md`.
- locks: pilot
- after: L3, L4, L7

## Phase 3: Safety

Why: an agent should hold only what its task needs, and nothing should leave without you. This does not depend on
the rules, so it runs beside phase 2.

### L9 Secrets per project, no push
- result: An agent holds only the secrets its task needs, and nothing is pushed without you.
- why: an agent holds only what its task needs, and nothing leaves without you.
- done when:
  - `lineclear secrets set <project> <NAME>` reads the value from stdin. `lineclear secrets list <project>` prints
    names only. Each project's secrets are in `~/.config/lineclear/projects/<name>/secrets.env`, mode 600.
  - Owner-only secrets are in `~/.config/lineclear/owner.env`, which nothing in Lineclear loads for an agent.
  - `eval "$(lineclear secrets env)"` in a task gives only that task's project's values.
  - Lineclear's pi extension refuses an agent's `git push`. It also refuses a command that names a secret the task
    may not see or a login file. Those are `owner.env`, the other projects' secrets, `~/.ssh`, and the git and gh
    login files. Each refusal is one line that says what and why.
  - Tests as an agent: every owner-only name and every other project's name is missing, `git push` is refused, and
    the project's check and a reviewer started with `pi -p` still work.
- locks: secrets
- after: L1, L5

## Phase 4: Inbox and stalls

Why: you are asked only for real decisions, and stalls are cleared without you.

### L12 Inbox
- result: One place asks you, and you answer with a button.
- why: one place asks you, with its answers as buttons.
- done when:
  - `lineclear inbox` lists the open items. There are five kinds:
    - a plan to approve
    - a step that needs you
    - a login or a code, with the name of the agent's live playwright-cli browser session to take over
    - an outward action
    - a task stuck after every automatic try
  - `lineclear inbox answer <n> <choice>` answers one. The answer reaches the task with `lineclear task tell`.
  - `lineclear ask` adds an item to the Inbox instead of a `lineclear ask` card.
  - Each new item reaches the phone once, with `lineclear alert`. Nothing else from Lineclear alerts you.
  - The brief template tells workers to raise an outward action with `lineclear ask`.
  - Tests cover each of the five kinds and an answer that reaches its task.
- locks: inbox
- after: L7

### L13 Stall ladder
- result: A stalled agent is nudged and restarted by a rule before it ever asks you.
- why: a stall is cleared by a rule, not by you.
- done when:
  - Lineclear's `checkStalls` posts a "may be stuck" card after 20 min with no sign of life. Each such card moves its
    task to the next rung, unless the task has a declared wait. The rungs in order:
    1. a reminder with `lineclear task tell`
    2. a restart that resumes its session: `lineclear task stop`, then `lineclear task tell`
    3. its role's next model from L5's list: the task is closed with `lineclear task close`, which keeps a branch
       with unmerged work, and the step starts again with `lineclear task add ... --model <next>`. Its brief names
       the old branch to go on from. Rung 3 runs inside the rule loop's tick, so the loop never starts the step a
       second time. A test shows one start.
    4. an Inbox item
  - Lineclear itself handles a task that is out of allowance, signed out or without its provider: its backup agent
    takes over once when it is another CLI (Lineclear `server/live/engine/engine.ts:1158-1164`). When Lineclear
    leaves such a task waiting for you, it goes straight to rung 3.
  - Accounts: a task whose subscription is full, or whose free or extra account ran out, goes straight to rung 3
    with no wait. A model on a paid API key is used only after you allowed it in the Inbox, once per key.
  - Each rung goes to `decisions.jsonl`. Tests use a fake clock and a fake `lineclear`, and cover a full
    subscription, an ended free account and a paid key that is not yet allowed.
- locks: rules
- after: L12

### L19 Rules for common asks
- result: Routine questions from agents are answered by a rule and never reach you.
- why: an ask that a rule can answer should never reach you.
- done when:
  - The needs-you cards of the last week in Lineclear's chat files are sorted into kinds in `docs/asks.md`, each
    with its count.
  - The three most frequent kinds that a rule can answer each get that rule and a test, and no longer reach you.
  - The other kinds are listed in `docs/asks.md` with the Inbox kind they become.
- locks: inbox
- after: L12

## Phase 5: Own fork

Why: a merge lane with its own rules, and fixes for Lineclear's known faults, need changes inside Lineclear.

### L14 Fork herdr-projects 2.0
- result: Lineclear changes its own server code instead of waiting on herdr-projects 2.0.
- why: from here on, Lineclear changes the server itself.
- done when:
  - herdr-projects 2.0 at `ebb17d5` (MIT) is in `server/`, with its LICENSE and a NOTICE that names it.
  - Only names change. Env vars become `LINECLEAR_*` and the data folder becomes `~/.lineclear`. The command is
    `lineclear serve`. The one other change is that each en or em dash in its files becomes a plain mark, so L0's
    dash check passes.
  - Its own tests and type check pass inside `bun run check`. L0's time limit grows by the measured time of the
    server's own check, and the new limit is written in the check.
  - `lineclear serve --port <free port>` starts beside a running herdr-projects 2.0 and shows an empty board.
- locks: server
- after: L8

### L20 Fix Lineclear's known faults
- result: The known faults of herdr-projects 2.0 are gone, so no workaround is left to run.
- why: a fork that keeps its base's faults keeps their workarounds too, and each workaround is one more part to run.
- done when:
  - `docs/known-faults.md` lists every fault seen in herdr-projects 2.0 before the fork, each with how it shows and the
    workaround people use for it. It includes at least: an agent loses its herdr name right after start, so its
    brief never arrives and its merge is blocked by messages it never read; `lineclear ready` without an id crashes;
    a task keeps waiting for a task that is already merged; a merge can land conflict markers on main; a brief typed while pi is still starting is never sent, and the task shows as waiting for you.
  - Each fault has a test that fails on `ebb17d5` and passes on the fork.
  - Each workaround in the list is no longer needed, and the list says so per line.
  - A fault that cannot be fixed without a large rewrite is named with its reason and moved to backlog.md.
- locks: server
- after: L14

### L15 Migrate from herdr-projects 2.0
- result: Your work moves to Lineclear with nothing lost, and one command takes you back.
- why: your work moves over without loss, and you can go back.
- done when:
  - `lineclear migrate --dry-run` lists what it copies from the old data folder. That is every space with its settings,
    and the open tasks with their chats and artifacts. `lineclear migrate` copies them to `~/.lineclear` and never
    changes the old data folder, so herdr-projects 2.0 can start again.
  - The rule loop, the waits and the Inbox talk to the fork instead of herdr-projects 2.0.
  - Every project runs on the fork for 24 h. Its main-red, needs-you and stall cards are no more than in the 24 h
    before on herdr-projects 2.0.
  - herdr-projects 2.0 is stopped, and `lineclear doctor` says so. `install.sh` no longer adds it, and `lineclear
    doctor` no longer checks for it.
- locks: server
- after: L20

### L16 Merge lane
- result: Each merge lands by a rule and main stays green.
- why: with the coordinator gone, a rule decides how each merge lands, and main stays green.
- done when:
  - A task's agent merges its own task once its review passed, and every merge goes through the lane.
  - A branch is merged as it is when no commit on main since its base touches its files (herdr-projects 2.0 already
    merges a branch behind main as it is). Otherwise the project's check runs on the merged result first.
  - A conflict goes back to its worker with the conflicting files.
  - After two failed health commands in a row on main, the last merge is reverted, and an Inbox item says so.
  - `lineclear measure` gains a fourth number, the median minutes from review passed to merged. It is in
    `docs/numbers.md` before and after.
- locks: server
- after: L15

## Phase 6: Planner and Dispatcher

Why: a new project or a change of plan takes one conversation and one approval.

### L17 Planner task
- result: A planner writes the roadmap change the same way every time, and you approve it once.
- why: a roadmap is written the same way every time, and you approve it once.
- done when:
  - `lineclear plan <project> "<goal>"` starts a planning task with a brief from `templates/plan.md`.
  - Its result is a change to `docs/ROADMAP.md` that passes `roadmap check`. It comes to the Inbox as one approval
    with the diff. Approving merges it. Rejecting it with a note sends it back once.
  - A test with a fake planner covers both answers.
- locks: planner
- after: L12

### L18 Dispatcher
- result: You ask and steer every project in one chat with the Dispatcher.
- why: one chat to ask and steer across projects, with no coordinator per project.
- done when:
  - The Dispatcher is the coordinator chat of its own space in regular mode, with pi as its agent. That space has
    no tasks and is not the home space, so no news reaches it (Lineclear `README.md:371-376`). Its prompt is
    `templates/dispatcher.md`.
  - Its tools are the commands `lineclear status`, `lineclear plan`, `lineclear move` and `lineclear inbox`.
    `lineclear move <project> <step> --after <ids>` sends a plan change to the Inbox for approval. Its status comes
    from `lineclear status`, not from memory.
  - Its status answer for all projects stays under 2000 tokens.
  - Lineclear's pi extension refuses `lineclear inbox answer` and any merge from the Dispatcher. Tests show both
    refusals, and that a task event in a project does not wake it.
- locks: dispatcher
- after: L17

## UI track

Why: Lineclear is used every day, so it must be clear at a glance and pleasant to use. It is built once, on one
brand.

### U0 Logo and theme
- result: Lineclear has a mark and a theme where green means clear, amber means it waits for you and red means broken.
- why: every view is built on one mark and one meaning of colour, taken from the railway signal behind the name.
- done when:
  - Three options are made. Each has one SVG mark that reads at 16 px (as a favicon) and at 512 px, a one-colour
    version and the wordmark, shown in one picture on the dark base.
  - There is one theme only, the dark graphite one. There is no light variant.
  - The colour tokens have one meaning each:
    - green means line clear (on main and all good)
    - amber means caution (it waits for you in the Inbox)
    - red means stop (broken and needs action)
  - Green starts from `#5fa883` and amber from `#e7b25a` as in the Home mockup. Red is new. The accent `#d97757`
    and the graphite base `#0b0b0c` stay. The accent marks the brand and actions but never a state.
  - The builder judges the three options against `idea.md` and picks one, with one line of why in
    `docs/brand.md`. Its files are in `ui/brand/`: `mark.svg`, `mark-mono.svg`, `wordmark.svg` and
    `tokens.css`.
- locks: ui
- after: none

### U1 Three Home directions
- result: You see three finished Home designs and pick the look.
- why: choose the look from finished pictures, not from sketches.
- done when:
  - Three finished Home pictures are made at 1440 px with real data from Lineclear's files, in the stack and the
    one dark graphite theme of idea.md, on U0's tokens. Nothing is asked.
  - Each is graphic first: project progress as tracks, usage and spend as charts, task states as shapes. Text says
    only what a graphic cannot. Each shows answers instead of headings, and the state colours only with their
    meaning.
  - The builder judges them against `idea.md` and picks the one of top quality, with one line of why in
    `docs/brand.md`. Only that one gets pictures at 1440 and 390 px of each state: empty, loading, error, long text
    and 200 items.
  - The chosen one gets a clickable prototype of a task starting and finishing, with a short recording of each
    motion. In a browser performance trace both run at 60 fps, a click during a motion acts at once, and with
    prefers-reduced-motion both are instant.
- locks: ui
- after: U0

### U2 Design system
- result: Every view is built from the same parts, and each part meets the same quality bar.
- why: every view is built from the same parts, so each part is built once and meets one bar.
- done when:
  - The chosen direction is written as tokens and as components in the stack of idea.md. The tokens add sizes for
    type and spacing to U0's colours. There is one theme, the dark graphite one.
  - The motion spec names an animation for every state change, and no others: a task starts, moves or finishes, an
    Inbox item arrives, the view changes, and a part goes between empty, loading, error and filled. Each is under
    300 ms.
  - The UI bar, which every view step tests:
    - every component is designed in each state: empty, loading, error, long text and 200 items
    - screenshot tests at 1440 and 390 px of each state
    - each motion runs at 60 fps in a browser performance trace, with no long task over 50 ms while it runs
    - no motion blocks input: a click during a motion acts at once
    - with prefers-reduced-motion, every state change is instant
    - a short recording of each motion
  - `lineclear run` serves Lineclear's web pages, and a test page there shows every component and every motion,
    and passes the UI bar.
- locks: ui
- after: U1, L6

### U3 Home and Inbox views
- result: You run your day from Home and the Inbox in the browser.
- why: these two views replace Lineclear's UI for daily use.
- done when:
  - Lineclear serves Home at `/` and the Inbox at `/inbox`, built only from U2's parts.
  - Home answers "is all clear?" first, with each project as a progress track and each task as a state shape with
    its plain title, not its id. Usage is in percent and spend in dollars, as charts. Red shows only what is broken.
  - The Inbox shows each item as a card with its answers as buttons. There are no popups, and details open with
    one click.
  - Both pass the UI bar of U2, with motion for a task starting, moving and finishing and an Inbox item arriving.
- locks: ui
- after: U2, L12

### U4 Roadmap view, one per project
- result: Each project has a page that shows where it is and what comes next.
- why: the roadmap is the boss, so its view is the one you read to know where a project is and what comes next.
- done when:
  - The page `/<project>/roadmap` is built only from U2's parts. It reads `lineclear roadmap status` (L2) and the
    tasks of the rule loop (L6). It shows:
    - a headline that answers: which phase, and what starts next
    - a phase track: each phase as a segment that fills with its share done
    - each step as a card. The card shows the step's id and title. It shows its state and locks too, and its waits
      as text such as "after L4". Focusing a card highlights the cards it waits for and the cards that wait for
      it. No lines are drawn between cards.
    - one click on a card opens its why, done-when, task, review rounds and commits
    - done phases fold to one line, and the page opens on the first phase with open steps
    - a history: the project's recent merges, newest first, each with its step and time
  - Motion: a step whose task starts glows once, and a merged step slides to done while its segment fills. Nothing
    loops.
  - It passes the UI bar of U2. The screenshots include this file, and a generated roadmap of 400 steps over 12
    phases in which one step waits for 250 others.
- locks: ui
- after: U2, L6

### U8 Agent browsers view
- result: You open an agent's own browser live to sign in or enter a code.
- why: a login or a code needs you in the agent's own browser, live, without hunting for it.
- done when:
  - The page `/browsers` shows each agent's open playwright-cli session as a card with its task's plain title and
    a live picture. One click opens it to watch, and one more takes it over.
  - An Inbox item for a login or a code (L12) links straight to its session.
  - It passes the UI bar of U2, with motion for a session opening and closing.
- locks: ui
- after: U2, L12

### U7 Settings view
- result: You set up machines, accounts and projects in one page without editing files.
- why: machines, accounts and projects are set up in one place, without editing files.
- done when:
  - The page `/settings` has three parts, built only from U2's parts:
    - machines: add one by its SSH host. Lineclear runs `install.sh` there over SSH and shows its doctor result.
      Each machine shows its state and its load against the load limit (L7).
    - accounts: each subscription with its usage in percent, and the ordered model list of each role (L5), which
      can be reordered
    - projects: each project's check command, health command and secret names, never their values (L5, L9)
  - A change is saved where the CLI saves it, so `lineclear project list` shows the same.
  - It passes the UI bar of U2. A test adds a machine on a fresh virtual machine over SSH, and doctor passes there.
- locks: ui
- after: U2, L1, L5, L9

### U5 A week on the new UI
- result: The new views replace the old UI only after you have judged them.
- why: the new views replace Lineclear's UI only when daily use shows that nothing is missing.
- done when: you use Home, the Inbox, the roadmap view, the agent browsers and Settings for a week, and are asked
  once what you still opened Lineclear's UI for. Each thing you name goes to `backlog.md`, or becomes a step
  through the planner.
- locks: trial
- after: U3, U4, U7, U8

### U6 README front page
- result: The GitHub front page shows the idea at a glance.
- why: the GitHub front page is the first thing anyone sees, so it must show the idea at a glance.
- done when: `README.md` shows the logo and wordmark from U0, the one-sentence idea, one animated SVG of the core
  idea, three short lines (roadmap is the boss, rules are the manager, AI does the work), the install command marked
  "coming", links to the docs and the status. The SVG loops about 12 s on the dark theme only, honours reduced motion,
  uses no external fonts, is under 40 KB, and renders and animates on GitHub.
- locks: readme
- after: U0
