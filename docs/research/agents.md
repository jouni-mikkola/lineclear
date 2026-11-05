# Research: parallel coding-agent orchestrators

How popular orchestrators isolate work, run and restart agents, detect stalls, swap models and harnesses, and track
quota and cost, compared with what Lineclear does today. Read from READMEs, docs and key source files.
Lineclear's side is from `docs/idea.md`, `docs/architecture.md`, `docs/stalls.md`, `docs/parts/measure.md` and
`src/measure.ts`.

## What Lineclear does today

- Isolation: one git worktree, branch and part lock per task; machines are herdr machines. No containers (principle 12).
- Start and stop: the rule loop starts a ready step when locks and a slot allow. It stops and tells through the
  server's `task stop` and `task tell`.
- Stalls: time-based. A "quiet for 20 min" card moves a task one rung: reminder, restart, next model, Inbox
  (`docs/stalls.md`). Quiet turns get up to three nudges an hour.
- Duplicate work: part and step locks from the roadmap, and a clash check on each step's `files` line
  (`fileClash`, `src/parts.ts`). Nothing looks at what the running tasks really edit.
- Models: a worker list per role, ordered by room per day against each account's weekly pace (`src/pace.ts`).
  `accounts.json` marks a provider `out` when a call fails with a full session or
  week, with `resetAt`; the task moves to the next model. Prices come from pi's `models-store.json`; a model with no
  price is "not counted".
- First run: `install.sh`, `lineclear doctor`, `bun run cold-start` (README only, nightly).

## Projects

**Claude Squad** (Go, tmux + worktrees). Each session is a tmux pane in its own worktree and branch. It decides
"did the agent do anything" by hashing the pane text every tick (`HasUpdated`) and spots a permission prompt by its
text ("No, and tell Claude what to do differently"), then auto-answers it with `--autoyes`. Pause removes the
worktree and keeps the branch; resume re-creates it. The program is any command (`-p "aider --model ..."`), so the
harness is a string.
[tmux.go](https://github.com/smtg-ai/claude-squad/blob/main/session/tmux/tmux.go),
[instance.go](https://github.com/smtg-ai/claude-squad/blob/main/session/instance.go)

**Vibe Kanban** (Rust + web, npx). Kanban issue becomes a workspace: branch, terminal, dev server, inline diff
comments sent back to the agent. Switches between 10+ harnesses (Claude Code, Codex, Gemini, Amp, Cursor, opencode,
Qwen). It needs the user to be logged in to each agent first. bloop shut down on 10 Apr 2026 (free users, no business
model); the project lives on community-run and local only.
[README](https://github.com/BloopAI/vibe-kanban),
[shutdown](https://www.vibekanban.com/blog/shutdown)

**Conductor** (Mac app, Melty Labs). Runs Claude Code, Codex, Cursor and opencode in parallel; each workspace has a
branch, files, terminal, diff and review path. It separates four layers: Conductor, harness, session, model. A session
picks a harness, the harness exposes models, billing stays with the provider account (Conductor resells nothing).
Bundles the harness binaries so install needs no other tool. Docs say when to split work across workspaces (lands
independently) or share one (same branch and context).
[harnesses](https://docs.conductor.build/reference/harnesses),
[parallel agents](https://docs.conductor.build/concepts/parallel-agents)

**Sculptor** (Imbue). Every agent runs in its own container, so dependencies are not reinstalled and the host stays
safe. "Pairing mode" syncs one agent's container into the local repo for testing in the IDE. Claude Code only at the
time of the post.
[post](https://www.imbue.com/sculptor/)

**OpenHands** (Python SDK + server). The agent runs in a sandbox: Docker (default), process (unsafe, fast) or remote,
one provider switch (`RUNTIME`). Its `StuckDetector` reads the event log, not the clock: same action and observation
4 times, same action and error 3 times, 3 agent monologues in a row, or an alternating A-B pattern 6 times, then it
nudges or stops. Context-window errors are a class of their own.
[sandbox docs](https://docs.all-hands.dev/openhands/usage/runtimes/overview),
[stuck_detector.py](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/stuck_detector.py),
[types.py](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/types.py)

**Aider.** One agent, one repo. Models through LiteLLM, per-model settings files (edit format, context, weak model
for commit messages and summaries). The "weak model" split is the cheap-routine-work idea in its simplest form.
[llms docs](https://aider.chat/docs/llms.html)

**Goose** (Block, now Linux Foundation AAIF; Rust). 15+ providers by API key, or an existing Claude, ChatGPT or Gemini
subscription through ACP (Agent Client Protocol) providers. MCP extensions. Hard limits as env settings: turn limit,
subagent turn limit, auto-compaction token limit, context-limit override for proxies.
[README](https://github.com/block/goose),
[env vars](https://github.com/block/goose/blob/main/documentation/docs/guides/environment-variables.md)

**opencode.** Uses the Vercel AI SDK and models.dev to reach 75+ providers; `/connect` stores a credential and the
model list fills from the registry; per-agent model and "variants" (reasoning effort presets) in config.
[models](https://opencode.ai/docs/models/), [providers](https://opencode.ai/docs/providers/),
[agents](https://opencode.ai/docs/agents/)

**Cline and Roo Code** (VS Code task runners). Checkpoints snapshot the workspace per step so a bad step is undone
without git. Roo's Boomerang tasks: an orchestrator mode hands a subtask, with scope, to another mode and gets a
summary back; API configuration profiles bind a model to a mode. Cline now ships a Kanban and a CLI/ACP mode.
[Roo boomerang](https://docs.roocode.com/features/boomerang-tasks),
[Cline checkpoints](https://docs.cline.bot/features/checkpoints)

**LiteLLM** (proxy and Router). One OpenAI-style call over 100+ providers. Router: several deployments under one
alias, `fallbacks` per alias, retries with backoff, a cooldown on a deployment after repeated failures, per-deployment
rpm and tpm. Proxy budgets per key, team and user. Budgets need Postgres: with no database the global budget "fails
open" and serves past the limit.
[routing](https://docs.litellm.ai/docs/routing),
[reliability](https://docs.litellm.ai/docs/proxy/reliability),
[budgets](https://docs.litellm.ai/docs/proxy/users)

**models.dev** (registry used by opencode). `https://models.dev/api.json` is one JSON file: 235 providers and about
8,900 models today, each with context and output limits, price per million tokens (input, output, cache), `tool_call`,
`reasoning` and its effort values, `open_weights`, release and last-updated dates, and a `canonical_model_id` that
ties one model across hosts.
[models.dev](https://models.dev/api.json)

**OpenRouter and Vercel AI SDK.** OpenRouter takes a `models` list as fallbacks and an Auto Router that picks a model
from aggregate community spend. AI SDK has a provider registry (`customProvider`, `createProviderRegistry`) so code
names `provider:model` and the provider is swapped in one place.
[OpenRouter routing](https://openrouter.ai/docs/features/model-routing),
[AI SDK providers](https://sdk.vercel.ai/docs/ai-sdk-core/provider-management)

## Lineclear against them

| Lineclear today | What they do | Gap | Recommendation | Expected gain | Cost |
| --- | --- | --- | --- | --- | --- |
| Stall = 20 min quiet, then a card | OpenHands detects loops from events (4 same action+result, 3 same error, 3 monologues, A-B x6). Claude Squad hashes the pane each tick | A looping worker burns 20 min of tokens before anything moves; quiet and looping are one class | Loop detector on pi session events feeding the existing ladder (A1) | Loops caught in about 2 min; fewer wasted tokens per stall | Small: a pure function over session JSONL, no AI |
| Locks from the roadmap only | Conductor leaves overlap to the user; nobody checks real edits | Two tasks can edit one file outside their locks and meet at merge | Touch-set check each tick: `git diff --name-only` of each running task; an overlap tells the later task and the keeper (A2) | Conflicts found early, not in the merge lane | Small: git only |
| `out` marked after a call fails | LiteLLM cools a deployment after N failures and expires it by time; budgets per key and window | A 429 burst is read as a full week and marks the account `out` for 5 h (`src/stalls.ts`); pace ordering and Usage already cover even spread | Transient cooldown (minutes, expires by itself) apart from `out` (A3) | Fewer false 5 h outs and stalled starts | Small to medium: one field in `accounts.json`, one rule |
| Prices from pi's `models-store.json`; unpriced = "not counted" | models.dev has price, limits, tool_call, reasoning for 8,900 models; opencode fills its pickers from it | Unknown or new models leave holes in cost and the worker list is free text | Pinned snapshot of models.dev refreshed nightly; `doctor` and the worker-list check name an unknown id, a model with `tool_call: false`, and fill price gaps (A4) | Cost per step complete; a typo in the worker list caught before a start | Small to medium: one fetch, one cache file, one check; widens the measure part's file invariant |
| Harness = pi only (layer table in `idea.md`); swap = model swap | Conductor, Vibe Kanban, Claude Squad run Claude Code, Codex, opencode, Cursor as harnesses; Goose speaks ACP | If pi breaks or a subscription only works in its own CLI, there is no second route; the owner's subscriptions are used through pi only | A written decision, then one extra harness behind an adapter, tried first as the reviewer role (A5) | Independence from one harness; use of subscriptions that only their CLI supports | Medium to high: adapter, session reading, tests |
| One worktree per task, deleted at close | Claude Squad pause keeps the branch and drops the worktree; Conductor archives | A task in an `until` wait holds no slot but keeps its worktree and deps | Park: a task on a wait longer than a set time is stopped, worktree removed, branch kept, and resumed at the wake time | Disk freed for waits of hours | Medium: touches rules and the server's close path; backlog only |
| Worktrees, no containers | Sculptor and OpenHands use containers for safety and clean deps | Shared host env across tasks | None now: scope limit (principle 12) | none | n/a |
| Install by README; doctor; nightly cold-start | `npx vibe-kanban` and bundled harnesses (Conductor); `/connect` per provider (opencode) | Home already knows the logged-in models from `pi --list-models`; the doctor does not name worker-list providers that are not ready | Doctor compares that list with the worker list and prints ready or needs login per provider, no paid call (inside A4) | A first run fails at the doctor, not in the first task | Small |
| Roadmap steps with `after` and `locks` | Roo Boomerang: orchestrator passes a scoped subtask and gets a summary back | Lineclear already does this with briefs and part pages | Nothing | none | n/a |

## Top 5 recommendations

Each is a roadmap step in the format of `docs/ROADMAP.md`. Ids are proposals (A1 to A5); the planner assigns real
ones and checks `files` and locks.

### A1 Loops caught within minutes
- result: a worker that repeats the same call or error is moved up the ladder within 3 minutes, not 20.
- why: OpenHands shows event-based detection is cheap and exact; the ladder sees only silence and quiet turns.
- done when: a pure `loopOf(events)` in `src/` flags the four OpenHands patterns (same action and result 4 times,
  same error 3, three monologues, A-B 6 times) from pi's session files; it enters the ladder as a new class in
  `docs/stalls.md` with a limit; a test plants each pattern; `lineclear measure` counts them.
- parts: rules
- locks: rules
- after: none

### A2 Overlap seen before merge
- result: when two running tasks edit the same file, the later one is told within a tick and the keeper sees it.
- why: `files` lines are guesses from the plan; real edits differ, and none of the tools read checks them.
- done when: the loop lists each running task's changed files from git; an overlap outside a shared lock writes a
  `decisions.jsonl` line and a `shepherdr task tell` to the later task; a test with two worktrees plants it.
- parts: rules
- locks: rules
- after: none

### A3 Cooldown apart from out
- result: a burst of 429s pauses a provider for minutes and does not mark it full for 5 hours.
- why: LiteLLM keeps cooldown (short, by time) apart from budget; here a "rate" or "too many" text becomes a usage
  limit (`src/stalls.ts`).
- done when: `accounts.json` accepts `cooldownUntil`; 3 rate failures in 5 minutes set it and it clears by time; the
  start rules treat it like `out` but never fall to the 5 h default; Usage shows it; a test per case.
- parts: rules
- locks: rules, usage-mark
- after: none

### A4 Model registry and a doctor that names logins
- result: an unknown or tool-less model in the worker list is refused with a plain line, every priced step has a
  cost, and the doctor says which listed provider needs a login.
- why: models.dev gives price, limits and `tool_call` for about 8,900 models in one file; opencode depends on it.
- done when: a nightly job refreshes a pinned models.dev snapshot beside `models-store.json`; `priceFinder` falls back
  to it before "not counted" and `docs/parts/measure.md` names the file as an allowed source; the worker-list check
  fails on an unknown id or `tool_call: false`; the doctor compares `pi --list-models` with the worker list and
  never makes a call on a paid key.
- parts: install, measure
- locks: install, measure
- after: none

### A5 Second harness: decision, then one adapter
- result: the reviewer role can run on a second harness (opencode, or Codex or Claude Code through ACP) and the
  owner sees which one ran.
- why: every comparable tool runs several harnesses; independence stops at pi. The reviewer only reads and reports,
  so it is the safest first role. This goes against `idea.md` (pi runs the agent), so a written decision comes first.
- done when: the decision is in `idea.md` with the protocol (ACP first, since Goose, Cline and Zed speak it); one
  adapter file starts the harness, reads its end state and token use; a canary review passes on both harnesses
  (principle 8); a pin and a contract test cover the adapter.
- parts: server, pi
- locks: server, pi
- after: A4

Parking waiting tasks (worktree removed, branch kept) waits until A1 to A3 show where resources really go; it
belongs in `docs/backlog.md`.

## Upstream Shepherdr 3.0 to 3.1.2

Lineclear's server forks Shepherdr 2.0. Read: the [releases](https://github.com/eliasstravik/shepherdr/releases)
v3.0.0, v3.1.0, v3.1.1, v3.1.2, [`lib/features.json`](https://github.com/eliasstravik/shepherdr/blob/main/lib/features.json)
(43 features) and [`lib/addons.json`](https://github.com/eliasstravik/shepherdr/blob/main/lib/addons.json).
3.0 turns it into a layout of 29 mods for the Herdr desktop app; 3.1 adds a phone-first web app on the same data.

| Upstream | What it is | Lineclear today | Verdict |
| --- | --- | --- | --- |
| Feature registry (`features.json`), CI-checked | Each feature lists its shared logic (`core/`), its Herdr side (mods) and its web side (files); CI fails on a feature missing a side, a mod in no feature, or a listed file that is gone | One UI, so no two sides. The same job is done by part pages and `lineclear parts check` (every file in one part, interfaces listed, contract tests) and by the borders gate | Do not adopt. Take only the idea of a user-visible feature list with its test file, if the README's claims drift (backlog) |
| Add-ons (`addons.json`) switch a feature off on every side | Artifacts, voice, reactions, browser, autopilot, other machines can be turned off; `needs` links add-ons; the web app is one too | One product, fixed scope; settings exist but no add-on layer | Do not adopt. A switch per feature doubles the states the UI bar must design and test |
| One shared core, one always-on service so nothing runs twice | The window's mods and the web service share `core/`; the service takes background work from the window; "serve from" picks one machine | Principle 7 and Phase 19: one server, one task store, other machines are herdr hands | Already held. Keep the gate on calls outside the adapter; nothing to add |
| A task is merged only when its own work landed (3.1.2) | Catching up with main is never "done: merged" | `landed()` in `server/server/live/engine/git.ts` compares trees and squash commits; `merge.ts:169` says "it was in main already" and a branch with no work counts as landed | Adopt as a test: a task whose branch only rebased onto main must not read as merged work. One test in `server-tests`, no new code unless it fails |
| Workers keep working while they wait on CI or another machine; stop only for a decision (3.1.2, `worker.md`) | A brief rule: do the next useful thing (review round, proof, follow-up notes) while a check runs | Brief says to run `lineclear check` once and wait for it; the merge lane and check slots are the board's. `lineclear wait` stops a task for a wait | Adopt: one line in `templates/brief.md` that a worker with a check running does its review and proof prep in that time and never ends its turn to wait |
| Workers say time left from the first status (3.1.1) | A rule in `worker.md`, shown in Tasks | The same rule exists (`--left` in the agent skill) | Already held |
| Ready adopts a pull request the agent already opened (3.1.1) | `ready` and Accept pick up an existing PR for the branch | `shepherdr pr` opens or updates one | Check that `ready` after a hand-opened PR does not open a second; low priority |
| Install: layout backup, `.new` files, refuses to overwrite own mods, `--dry-run`, doctor holds sync while a helper is replaced | Safe install and update of a shared layout | Install and update tests, rollback, `doctor` (L135, L136) | Take `--dry-run` for `install.sh` and `lineclear update` if missing (small, backlog) |

Two of these become one small step each. Both fit the rules loop's part and the brief template.

### A6 A caught-up branch is not merged work
- result: a task that only caught up with main never shows as merged; the board names the work that landed.
- why: upstream fixed this in 3.1.2 after tasks read "done: merged" with nothing of their own.
- done when: a server test rebases a branch with no own commits onto a moved main and the task is not marked merged
  work; one with own commits is; the case where `merge.ts` reports "already in main" keeps its wording.
- parts: server
- locks: server
- after: none

### A7 Work while the check runs
- result: a worker uses the minutes of its check for the review and its proof, and ends no turn to wait for it.
- why: upstream 3.1.2 made the same change; the check takes up to 180 s, a review round takes longer.
- done when: `templates/brief.md` has the rule in one line; a brief test finds it; the stall class "quiet turn" is not
  raised for a turn that holds a running check.
- parts: planner, rules
- locks: planner, rules
- after: none

## What not to copy

- **Containers per task (Sculptor, OpenHands Docker).** Breaks the scope limit (principle 12) and needs an image per
  project. A worktree per task already stops file clashes; overlap check A2 covers the rest. Revisit only for
  untrusted code.
- **A hosted kanban or cloud layer (Vibe Kanban).** The company shut down because free users paid for nothing, and
  its remote services were removed. The board is local and the Inbox is the owner's only surface.
- **LiteLLM proxy as a service.** A new always-on service with a Postgres need, and its budgets fail open without a
  database. Copy the ideas (cooldown, fallback by alias, budget per window), not the process.
- **OpenRouter Auto Router and per-request routing.** The model would change per prompt with no canary, against
  "a model swap is proven by a canary and the numbers" (principle 8). Lineclear's role-to-model list stays explicit.
- **Auto-yes on every prompt (`cs -y`).** Answer only a short list of known safe prompts; anything else is an Inbox
  ask, since "what happened beats what was said".
- **Pane-text hashing as the only liveness signal (Claude Squad).** It cannot tell a spinner from progress; use it
  at most beside session events and commits.
- **Checkpoints outside git (Cline, Roo).** A branch and commits are already the checkpoints and survive a restart.
- **Upstream's feature registry and add-ons.** See the upstream section: they solve a two-sided product, and ours has one UI.
- **Mode juggling inside one agent (Roo modes, Boomerang).** Our roles are separate sessions with a different
  company's reviewer; one agent changing hats would lose that independence.

## Not verified

- Release counts and star counts were not read. Sculptor's current harness list and Conductor's Linux support were
  not checked. The Cline Kanban page was not read, only its menu entry. OpenHands detector thresholds are the SDK's
  defaults and may be overridden by the server.
