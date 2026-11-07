# Lineclear: the idea

**You talk to one contact. It knows which project each request belongs to, hands the work to AI workers and
reviewers, and shows you everything live. You only make the decisions.**

It is for one developer with several projects, several AI subscriptions and one or more Linux machines. The order
of work is in [ROADMAP.md](ROADMAP.md).

## The owner's direction

Every planner, worker and reviewer of this repo reads these lines. The Dispatcher, which works for every project,
reads the general ones in `templates/direction.md` instead, so one project's lines never steer another's. A plan or a change that goes against one is a
critical finding. An id is the task that decided the line.

- Lineclear is a development system: your own software team on your machines.
- Lineclear is where all development happens from now on: the owner talks to the Dispatcher and decides in the
  Inbox. Not herdr and pi by hand, not Lineclear. herdr and pi stay only as the engine underneath, never as the
  owner's tool.
- Lineclear is our own product and stays stable: no dependence on Lineclear or its releases (LIN-147); every update
  proves itself and rolls back if broken (LIN-136); a self-update never ends running work (LIN-135).
- The UI is ours, thought through, graphic first: the Dispatcher chat as Home, the line as the live picture in the
  railway language of brand.md, roles clear at first look without explainers (LIN-139, LIN-149, LIN-150, LIN-152).
  Each fact once: no headline repeating counts, no subtitles, no slogans, no "How it works", no command for the
  owner to run (LIN-145). Motion only when something changed, calm, never decorative. Finished to the LIN-146 bar.
- Steps and tasks say their result: a title naming the result and one concrete sentence, with the agent brief behind
  it (LIN-148).
- The GitHub page and pictures share one brand source and one style.
- Plain words everywhere, no AI phrasing.
- Until the release is green and tiers 1 and 2 of the roadmap are done, nothing new is added and nothing frozen starts (LINE-637).

### Principles

Twelve rules for the whole system. Each names the machine check that holds it today, or the open task that adds one.
A rule is a goal until its check exists.

1. **What happened beats what was said.** State comes from facts: a session exists, a commit exists, a check passed,
   the merge is on main. An agent's or script's own "done" is not enough. A step is done only when its done-when proof
   exists, never "not yet recorded". Open: the proof gate (LIN-183); states read from facts (LIN-185).
2. **The running system is always a proven build.** Main never goes straight to production. A new build runs beside
   the old one, a canary checks it, then it takes over. A bad build rolls back by itself. Running work never breaks.
   Held today by: the rollback tests of the update (LIN-136, LIN-135). Open: the canary and the side-by-side build (LIN-186).
3. **Every fault fixes itself, and the same fault never returns.** A known fault becomes an automatic fix and a test
   that plants it. A hand fix is itself a fault and is counted. Every stall is detected, and a new kind files its own
   fix (LIN-158). Open: the hand-fix counter (LIN-185).
4. **Parallel is the default.** A queue exists only for a real dependency. A lock guards one real resource and lasts
   only as long as it is needed. A step waits for another only if it needs that step's code. Open: a check that a lock is real and short, and splitting the `ui` lock.
   The roadmap check only needs a `locks` line today.
5. **Everything has a box.** Every task has its own worktree, branch and lock, and every part has a keeper. Merge only on green and
   after review; agents never push. One part changes another only through its interface. Checked by: the border and
   cycle gates (`bun run gates`), the part pages check and the merge lane (LIN-168).
6. **Light by default, heavy rarely.** While working, check only what changed; the full check runs once at merge and
   the heavy ones at night. Every check names the fault it catches; one that finds nothing moves to the night run. A flaky test is quarantined, never rerun past, and tests never
   depend on machine speed (LIN-155). Quality is ratchets: lint, dead code, duplication, boundaries, size, comments
   and coverage (LIN-154). Checked by: `bun run gates`. Open: the lighter check (LIN-184).
7. **One brain, many hands.** One server, one task store, one id series. Other machines are hands driven through
   herdr: herdr runs terminals, agent state and machines, pi runs the agent, Lineclear decides. The lower layers are
   reached through one adapter, with their version pinned and tested. Open: the single server and the gate on herdr
   calls outside the adapter (L92 to L96).
8. **Models change, the system does not.** Models are settings; checks are code, not a model's opinion. The reviewer
   is from another company than the author. A model swap is to be proven by a canary and the numbers. Open: the
   canary (LIN-185).
9. **Spending is measured and even.** Tokens and cost show per merged step. The weekly quota is spent evenly, and
   routine work goes to a cheap model. Held today by: the per-account spread (LIN-166). Open: the per-step meter (LIN-185).
10. **The view tells the truth at a glance.** One command center shows the line, the running tasks, what each does
    now, for how long, at what cost and why something is stuck. Details open in place. No explainers; red means
    broken only. Checked by: the UI bar (`bun run ui:test`). Open: the command center page (LIN-139).
11. **The owner gets only a login, money beyond the budget, or something that leaves the machine.** Everything else is
    settled without them; if something still waits for them, it becomes a task (LIN-163). Held today by: the Inbox
    rules. Open: a check that fails on any other ask.
12. **The scope limit.** One server, SSH machines and a one-command install. No new services, containers or queues.
    Open: a check that fails on a new service, container or queue (LIN-167).

## What Lineclear is

Lineclear is a development system: your own software team on your machines. It is not a framework, which is a
library under your code. It orchestrates agents. Each part has one job:

- **The owner** talks to the Dispatcher and decides in the Inbox. All development happens there.
- **The planner** keeps the roadmap. Each step has its own done-when.
- **The rule loop** is plain code with no AI. It starts a ready step when its locks and a free slot allow, and it
  handles stalls. At night (22 to 7 by default; `LINECLEAR_NIGHT_WATCH=off` or a window like `23-6` changes it) it
  sends the Dispatcher a checklist every two hours, so work keeps going without you.
- **A worker** does one step in its own git worktree.
- **A reviewer** is a model from another company. It reviews the change before the merge.
- **The merge** happens only on green.

### The layers and their limits

| Layer | Owns | Does not do |
| --- | --- | --- |
| herdr | Terminals that outlive a closed laptop. Agent state (working, idle, blocked, done) as events. Worktrees. Other machines over SSH. | Plans, tasks, review, merge |
| pi | The agent itself: models and accounts, sessions, compaction, extensions with event hooks, skills and packages | Tasks, machines |
| Lineclear | Roadmap, rule loop, tasks, review, merge, Inbox, Dispatcher, UI, measuring, stall fixes, releases | A terminal or an agent of its own |

The lower layers run the work and Lineclear makes the decisions. herdr does not limit Lineclear, because Lineclear
uses only herdr's public socket API. If herdr changes, the change touches one adapter file. A second machine is a
herdr machine, not a second Lineclear server.

### What Lineclear takes from pi and herdr

From [pi](https://pi.dev) (its docs ship with it, under `docs/`):

- Extensions with events: Lineclear's extension in `pi/` hooks `session_start`, `before_agent_start`, `turn_start`,
  `turn_end`, `tool_call`, `tool_result`, `after_provider_response` and `session_before_compact`. They add the agent
  rules, and guard the tools an agent calls.
- Skills: `resources_discover` hands pi the kit's skills in `kit/`, so an agent needs no personal skill folder.
- Models: `pi --list-models` tells Home which models you are logged in to.
- Not used yet: pi packages (`pi install`), which could ship the kit and the extension as one package, and pi's RPC
  mode, which could run a headless reviewer without a terminal.

From [herdr](https://herdr.dev):

- Terminals that outlive the laptop: each agent runs in a herdr pane, which you can open and take over.
- Agent state: herdr's working, idle, blocked and done drive the board's cards and the rules.
- Remote: `herdr machine` keeps the other machines, and Lineclear runs work on them through it.
- Not used yet: herdr's notifications, which could carry an owner wait to the desktop, and `herdr update
  --handoff`, which could update herdr without stopping the agents.

## The core

**Your plan sets the order. Plain code starts each step when the one before it is done. AI writes, checks and plans
the code:** worker, reviewer, planner.

1. **No AI where a rule works.** An if-statement decides, and logs its reason in `decisions.jsonl`.
2. **Don't add.** Simple is the default. Each new part must pay for its cost; new ideas wait in the backlog.
3. **You approve only what leaves.** Agents never push. Plans, roadmap changes and step questions never wait for
   you: rules and the Dispatcher decide them, and you can undo any plan with one tap. The Inbox keeps what a human
   must do: a login code or captcha with no stored TOTP, money spent beyond the budget, and what leaves the machine
   for the public (a push to a public repo, a release, a message to another person). Each project can pre-approve
   those in Settings.
4. **No token waste.** Plain code decides what starts next, so no AI runs while nothing happens. Each worker gets
   only its step, not the whole history. Measurement is a script with no AI, and status comes from files, not from
   a model. The install gives pi a pack of token savings, each kept only with a measured saving, on by default and
   off in Settings.

## The roles

The same eight roles as the README's How it works list (the step check, which the README leaves out, guards the plan):

- **You**: say what you want, do what only a human can (a code, a release), and undo what you dislike. You never
  have to watch an agent, approve a plan or tell it what is next.
- **The Dispatcher** is an AI model, the one chat you talk to, in Lineclear's web UI or in Lineclear. It knows
  which project each request belongs to, and hands it on to the planner. If two projects fit, it asks you with a
  button for each. It shows you the steps live, answers where things stand from the live status, and decides step
  questions from the brief and the roadmap. It never builds, never merges, never answers the Inbox for you.
- **The planner** is an AI model that turns a goal into roadmap steps, each with a why and a done when. It never
  changes the roadmap before its change passes the rule checks and the step check.
- **The step check** is an AI model from another company than the planner. It gets no context but the step and the
  repo's map. It says the step back in its own words and answers go or no-go, with what is missing. It never writes
  the step and never asks you.
- **The roadmap** is a plain text file in your repo. It holds the steps, their order and what each one waits for.
  It never runs anything: it is the plan, not a program.
- **Rules** are plain code, no AI. They start each ready step, pick its worker and reviewer models, wake a stalled
  step and hold new work while a machine is busy. They never use AI and never write code.
- **A worker** is an AI model. It builds one step on its own branch, runs the project's check, has it reviewed,
  then merges it. It never picks its next step and never pushes: it asks the server to merge, and the server pushes
  (Lineclear's server today).
- **A reviewer** is an AI model from another company than the worker. It reads the change against the step's why
  and done when, and lists what to fix. It never writes the code.
- **The Inbox** is plain code. It brings you only what a human must do, as buttons on Lineclear's web page, on your phone
  or desktop, and alerts your phone once for each. It never alerts you for anything that is not a decision, and
  never answers itself. A plan, a roadmap change or a step question is never in it.

## A step's life

Plan, readiness, approve, work, review, merge.

1. **Plan.** The planner writes the step: a why, a done when, its parts, locks and `after`.
2. **Readiness.** A rule checks the form. Then the step check judges whether the step stands alone.
3. **Approve.** You approve what leaves the machine, nothing else.
4. **Work.** A worker builds the step on its own branch.
5. **Review.** A reviewer from another company than the worker reviews it.
6. **Merge.** The merge lane merges it.

It follows three principles:

- **No AI where a rule works.** The form is a rule.
- **No token waste.** One short call per new or changed step, kept only while measured to pay.
- **A reviewer from another company**, for the step check as for the code review.

## How work flows

- **Running or Paused.** In a Running project a step starts the moment every step in its `after` has merged and its
  locks are free, day and night, as many in parallel as the locks allow. Only steps that touch real shared code share
  a lock. A Paused project starts nothing new. One switch per project.
- **Done is a commit on main**, by its subject or a `Step: <id>` line. The plan is `docs/ROADMAP.md` in the
  project's repo. State lives in files and git, with no database, so it survives any restart.
- **Strict review before every merge**, by a model from another company than the worker's, against the step's why
  and done-when. A finding still open after the allowed rounds asks you. Otherwise the agent merges itself, through
  a merge lane that keeps main green: one merge at a time per repo; the branch is rebased and the project's full check
  runs once on the merged result (workers run only `lineclear check --changed`); a conflict or a failed check goes back
  to its worker with the failing test named; after two failed health commands in a row on main, the last merge is reverted and the Inbox says so.
- **Stall ladder.** A stuck task is cleared by rules: a nudge, a restart from its own notes, a handover to the next
  model. You are the last rung.
- **Declared waits** (a login, a timed wait, another task) are never nudged. Check slots and a load limit keep the
  machine usable while agents work. Every heavy test suite takes a slot, and a step that waits for room starts on
  another machine of its project that has it.
- **Planner.** It writes a roadmap the same way every time. Each step has a why, a done-when test, its parts, locks
  and `after`. A plan or a roadmap change applies by itself once the rule checks pass (form, locks, `after`, the longest
  chain to the last step not longer, every done-when kept as strict) and the step check says go. You
  see it on the Roadmap and can undo it with one tap: a revert, not an approval. Settings has `Ask me before: plans`
  for a project that wants the old way.
- **No-go.** A no-go from the step check goes back to the planner. Where a project asks before plans, the Inbox shows only plans whose every step got
  a go.
- **Step questions.** Merge now or wait, which reviewer, a flaky test: written rules answer them, else the
  Dispatcher decides from the brief and the roadmap. An agent never asks you one.
- **Dispatcher.** The one chat for all your projects. It wakes when you write, and at night for the rule loop's checklist. It reads state through a tool, and
  never starts or merges a step itself. It picks the project from a list that plain code gives it: each project's
  name, repo and the first lines of its idea or README.
- **Inbox.** The only place that asks you, with the answers as buttons and a push to your phone when something
  new waits. It holds only a login code or captcha with no stored TOTP, money beyond the budget, and what leaves
  for the public. Settings has `Ask me before: plans / releases / spending`: a new project asks before releases and
  spending only, and a release the owner pre-approved goes without a card. The goal is under 3 asks a day, and
  owner taps per merged step near 0.

## Models and accounts

- Model-agnostic: you choose the models for each role in Settings. Claude, OpenAI, Gemini and others work side by
  side through [pi](https://pi.dev), on several subscriptions at once.
- Each role (worker, reviewer, planner) has an ordered model list. When one subscription runs out, the next one
  takes over. A free or extra account running out never breaks work. A paid API key is used only with your leave.
  Reviewers can come and go: one provider ending never breaks anything.

## Machines and install

- Linux, git, [herdr](https://herdr.dev) for terminals you can take over, and pi underneath.
- Any number of machines, added over SSH from Settings; the phone sees them all through the main machine. Lineclear
  is one light process per machine, a systemd user service, and adds no load of its own.
- One command installs it from GitHub, is safe to run again and updates every machine. `lineclear doctor` names
  each problem with the one command that fixes it, and `lineclear uninstall` takes it all away. Paths and options
  are `LINECLEAR_*` env vars.
- A project tells Lineclear its check command, health command and secrets in its settings, outside every repo.
  Nothing is assumed about languages or tools. Heavy checks run on your machines, not on paid CI minutes.

## Safety, light by design

- Secrets per project. Owner-only secrets (your own logins, one-time codes) are never given to an agent. Agents cannot
  push: an agent asks the server to merge, and the server pushes.
- Logins and codes come to you with the agent's browser open live, a playwright-cli session you can take over.
- Only you answer the Inbox, and only you undo an applied plan. Decision: no device pairing. Lineclear listens on 127.0.0.1 only. Your phone reaches
  it through a private network's HTTPS proxy, such as [Tailscale Serve](https://tailscale.com/kb/1312/serve),
  whose name is in `LINECLEAR_HOSTS`. That network is the pairing. Any other name is refused. An answer is a POST
  with a token that only Lineclear's own pages hold, set when a page loads, so a plain `curl` cannot answer. `lineclear doctor` warns when the server listens beyond
  127.0.0.1.
- Safety must never cause bugs or slow work; anything heavier waits in the backlog until a real need shows. An agent
  runs as you, so these layers stop mistakes and simple prompt injections, not a determined attack.

## The UI

- English, short sentences, answers instead of headings. Graphics first (progress tracks, charts, state shapes),
  cards, details behind a click. No popups. Plain task titles, not ids. Usage in percent, spend in dollars.
- One dark graphite theme. The logo comes from the railway signal: green is line clear, amber waits for you, red is
  stop. Red shows only when something is broken.
- Views: Home shows the state of all work and never asks; only the Inbox asks. Roadmap per project (one page of goals, then the phase track,
  and a page per step with its chain, waits and history), Agent browsers, Settings
  (machines, accounts and model lists, projects). Top quality motion and graphics on a few polished parts, never
  overloaded. Every state is designed: empty, loading, error, long text, 200 items.
- Stack: TypeScript on Bun, React, Base UI, TanStack Query, Tailwind, Vite. Motion is CSS and the Web Animations
  API. A deviation needs a written decision.

## The path

- **Strangler.** Lineclear starts beside [Lineclear](https://github.com/eliasstravik/herdr-projects) 2.0, which
  keeps the tasks and their worktrees, and drives it through its `lineclear` command. Each phase takes one job from
  the AI coordinator, on one pilot project first.
- At phase 5 Lineclear forks herdr-projects 2.0 at `ebb17d5`, its first commit with the MIT license, and fixes its known
  faults. The migration moves every machine and keeps a way back in one command. Lineclear is retired at the end.
- The README stays short: one animation that shows the idea, links to these docs, and the status.

**Not in it:** a hosted service, teams, its own model runtime (that is pi), a quota cap, a database before a measured
need, Windows and macOS in v1.
