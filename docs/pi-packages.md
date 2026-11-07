# Popular pi packages, measured

Would the most downloaded pi packages beat what Lineclear's agents use now? Agents run pi with its own compaction,
[pi-web-access](https://www.npmjs.com/package/pi-web-access), the [Context7 extension](https://www.npmjs.com/package/@upstash/context7-pi)
and [pi-claude-bridge](https://www.npmjs.com/package/pi-claude-bridge). Each candidate was read, then run on the same
real tasks as plain pi.

**Verdict: skip all five.** None wins clearly; two do nothing or break with the bridge. Nothing was installed.

| Package | Version | What it does | Keep? |
| --- | --- | --- | --- |
| [billion-context](https://www.npmjs.com/package/billion-context) | 0.1.212 | A proxy between the agent and the model's HTTP API that compresses old turns | Skip: does nothing with the bridge |
| [context-mode](https://www.npmjs.com/package/context-mode) | 2.1.5 | Runs tool work in a sandbox and keeps big outputs in a local SQLite index | Skip: no saving, more tokens on edits |
| [pi-subagents](https://www.npmjs.com/package/pi-subagents) | 0.86.0 | Child pi sessions: scout, reviewer, worker, workflows | Skip: breaks in the foreground, costs 8x on a review |
| [pi-lens](https://www.npmjs.com/package/pi-lens) | 4.4.10 | LSP, linters and type checks after every edit | Skip: same result, 3x slower, up to 1.4 GB per agent |
| [pi-simplify](https://www.npmjs.com/package/pi-simplify) | 0.2.3 | A `/simplify` command: one prompt to tidy the changed lines | Skip: one prompt, the review step already does it |

## How it was measured

- Lineclear's own repo, a fresh clone per run, pi 1.4.0, `claude-bridge/claude-opus-5-5` at its default effort,
  headless (`pi -p --mode json`), the machine's usual extensions. A candidate was added with `-e` (and its skills).
- Tokens are summed from each model call's `usage`: input, cache read and cache write. That is what the model
  processed, the number that fills a plan's window. For pi-subagents the child's session is added.
- Quality is checked against a known answer or a hidden check written before the runs.
- Time is wall time. Identical runs differed up to 2x on a busy machine, so read it as rough.
- Tasks: **A** find where a too-long `lineclear ready` summary is refused (limit, definition, check, test). **B** add
  a `--json` flag to `lineclear roadmap check` with tests; the hidden check runs it on a good and a broken roadmap,
  checks the usage line, the tests and `bun run types`. **C** review commit `41cf45934`. **D** tidy the lines that
  commit changed. **E** count the files most changed in `git log --stat -400` and name the slowest test case: big
  outputs, the case context-mode is built for.

## Results

Medians where there were several runs (runs in brackets).

| Task | Setup | Tokens processed | Time | Quality |
| --- | --- | --- | --- | --- |
| A | plain pi (3) | 121k | 49 s | 3 of 3 right |
| A | context-mode (3) | 172k | 36 s | 3 of 3 right |
| A | billion-context (1) | 208k | 80 s | right |
| A | pi-subagents, scout (1) | 72k + 124k child = 196k | 64 s | right |
| B | plain pi (3) | 180k | 222 s | 3 of 3 pass the hidden check |
| B | context-mode (3) | 261k | 142 s | 3 of 3 pass |
| B | pi-lens (2) | 176k, 232k | 154 s, 176 s | 2 of 2 pass |
| C | plain pi (1) | 130k | 51 s | 9 findings, 2 major |
| C | pi-subagents, reviewer (1) | 173k + 920k child = 1.09M | 256 s | 10 findings, 4 major; one real bug plain pi missed |
| D | plain pi (1) | 194k | 135 s | tests pass, one edit outside the changed lines |
| D | pi-simplify prompt (1) | 308k | 568 s | tests pass, stayed in the changed lines |
| E | plain pi (2) | 24k, 48k | 22 s, 30 s | 2 of 2 right |
| E | context-mode (2) | 44k, 44k | 24 s, 27 s | 2 of 2 right |

The bug only the reviewer child found is real and still on main: `isStored` in `src/dispatcher.ts` looks for one space
before `(this space)`, and `lineclear show` prints two.

## Each package

### billion-context: skip

- **With the bridge it does nothing.** It wraps providers by their HTTP base URL. The bridge's models go through
  Claude Code, not an HTTP API, so its config came up with no providers and the run was plain pi with more tokens.
  It would need agents on an API key provider, which is not how they run.
- **Risk.** A 7,600-line minified bundle per agent, 26,000 lines in all. npm lists 8,239 versions since August 2026,
  dozens a day, so nothing stays pinned long. On load it wrote a
  root CA and its private key under `~/.local/share/billion-context` to read TLS traffic, plus state in three more
  folders, and it asks GitHub for releases. It depends on `mysql2`. Its weekly downloads (about 990k) are far above
  every other pi package, which so many releases can explain better than use.
- **Claim not tested:** month-long sessions in a 100k window. Lineclear runs one short pi per task, so it would not
  reach that case.

### context-mode: skip

- **No saving on real work.** It used more tokens than plain pi on A (+40 %) and B (+45 %), and the same on E, its
  own case. Agents here already filter output (`grep -n`, `head`, `tail`, as AGENTS.md says), so there is little
  raw output left to save. In 2 of its 8 runs the model never called its tools.
- **Risk.** Needs Node 24.15 or later; on older Node its hooks fail on every call (the first A and B runs were on
  Node 22, the other six on Node 24.22, with the same token counts). License is Elastic-2.0, not open
  source. 177,000 lines. It keeps an index of every project's output under `~/.context-mode`, and the README sells a
  paid hosted Gateway.

### pi-subagents: skip for now

- **Breaks with the bridge out of the box.** A foreground child gets the bridge's provider but not its hooks, and its
  first call is refused. It works only with `async: true` (a background child) or with the bridge listed in each
  agent's `extensions`.
- **Scout:** right answer, 60 % more tokens than doing it in one session.
- **Reviewer:** the best review of the runs, but 8x the tokens and 5x the time of plain pi, at high effort by default.
  Lineclear's review step already starts a fresh headless pi with the brief and the diff; that is the same job.
- **Risk.** 198,000 lines, released very often (0.86). Background children run in a detached runner that Lineclear
  does not see as a task.

### pi-lens: skip

- **Same result, slower.** Both runs passed, as all plain runs did. After each edit it added a line such as "typescript
  silent: diagnostics are incomplete" or "clean · 2856 ms". The repo's own `bun run types` and `bun run gates` gave
  the agent the same facts at the end.
- **A second measurement, a one-line edit with a type error** (`src/paths.ts`, `claude-bridge` haiku; tests, scans,
  format and whole-repo tools off in `~/.pi-lens/config.json`):

  | Setup | Time | Peak memory | Caught the new error? |
  | --- | --- | --- | --- |
  | pi-lens | 127 s | 1.4 GB | No: it reported old findings |
  | pi-lens, the agent calls `lens_diagnostics` | 169 s | 0.6 GB | Only when asked |
  | `--no-lens` | 46 s | 0.3 GB | No lens; `bun run types` reports it |

- **Too heavy for parallel agents.** A machine runs 10 to 30 task agents. At 0.6 to 1.4 GB each, that is 6 to 42 GB
  of language servers for feedback the agent gets anyway from `bun run types`, and the task took 2.8x longer.
  It could fit in two narrower shapes, neither measured: the reviewer alone (one per task, read-only, short), or one
  language server per machine shared by all agents. pi-lens starts one per session, so the shared shape needs other
  code.
- **Risk.** 300,000 lines. It can install tools on its own (gopls, gems, pipx packages), starts language servers
  outside Lineclear's check slots, and writes state to `~/.pi-lens`. It may pay off on a codebase without its own
  type check and linter; Lineclear has both.

### pi-simplify: skip

- **It is one prompt.** The package is 80 lines that list the changed lines and send a fixed prompt. In headless
  `pi -p` the command sends nothing (it queues a follow-up the run never takes), so the measured run sent the same
  prompt by hand. Same tests passing, 60 % more tokens, much slower.
- **Risk:** low, last release July 2026. Not needed: the review step and AGENTS.md's code rules cover it.

## Fit with Lineclear's design

Lineclear runs one pi per task in its own herdr pane, a Dispatcher that sorts requests, and coordinators that make
and merge tasks. The board can see, stop and restart each pane.

| Package | Fits the design? | Would replace Lineclear code? | Overlaps with |
| --- | --- | --- | --- |
| billion-context | No. A proxy and TLS interception under every agent, outside the board's view | No | pi's compaction settings; `pi/fresh-dispatcher.ts` (40 lines), which cuts the Dispatcher's context to the latest request |
| context-mode | Partly. Per task, but it adds a second memory beside pi's session | No | AGENTS.md's read rules; the machine's own output caps |
| pi-subagents | Partly. It fills the "pi subagent" half of the Reviewer setting, but hides work in children the board does not see. Delegation in Lineclear is a task: its own pane, worktree and check | Little. The review launch is a prompt today, not code | Tasks and coordinators; `server/server/live/readers/background.ts`, which finds background work by its command |
| pi-lens | Yes in shape (per agent, per edit), no in cost: up to 1.4 GB per agent, run outside the check slots of `pi/heavy-tool.ts`. Maybe for the reviewer only, or one shared server per machine | No | `bun run check` and `bun run gates` |
| pi-simplify | Yes, but adds nothing | No | The review step |

None would cut Lineclear's code: the overlaps are small files or rules, not modules. The best long-term candidate is
pi-subagents for reviews, once a foreground child works with the bridge and a review costs near a plain one.
Measure again then, with the same tasks.
