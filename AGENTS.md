# Lineclear

What Lineclear is and why: [docs/idea.md](docs/idea.md). The order of work: [docs/ROADMAP.md](docs/ROADMAP.md).

## Commands

- Checks are light and run on GitHub (`check.yml`, 5 minutes a job at most), never on an owner's machine: no browser suite, no coverage run, no local full check in a release or promotion (next goes out when the merged commit's GitHub `check` is green). `test/light-checks.test.ts` fails when that changes.
- `bun run check`: what the branch's change reaches (types, tests, doc checks, gates, the server's check when `server/` changed), in 180 s at most on an idle machine, each test case under 2 s (a file with a slower one needs a baseline; `docs/numbers.md`). It must pass before a merge. `bun scripts/check.ts --full` runs everything (a test file that passed with the same files is skipped unless `--no-cache` or `--full`): the release loop does, on the newest main.
- `bun run types` (tsc), `bun run test` (bun test), `bun run dashes` (no en or em dash in any tracked file).
- `bun run gates`: the code gates (Biome lint and format, knip dead code, jscpd copies, module borders and cycles,
  file size, comments), each against its baseline in `scripts/gates/baseline/`. A fix lowers its baseline:
  `bun run gates --lower` (it never raises one). Modules and their borders: `docs/architecture.md`. In the check,
  lint looks only at the files changed since main and the gates must take 20 s at most; `bun run gates:full` lints
  the whole repo.
- `bun run coverage`: line coverage of the root tests per module against the floors in `scripts/gates/baseline/coverage.json`; `--raise` lifts them, never lowers. Slow: the heavy run and a release run it, not `check`.
- `bun run heavy`: the heavy tier (`gates:full`, `coverage`, `ui:test`, `cold-start`, `one-name`; `lineclear project` shows it). `.github/workflows/heavy.yml` runs the GitHub part on each push to main (only the newest main is tested); where a repo has no such workflow the rule loop runs it after main moves. A red run files one fix task per commit. A release runs it first.
- `bun run cold-start`: installs Lineclear from this commit into a fresh HOME by the README alone, adds a public repo it did not write (through a local bare remote, so nothing leaves the machine) and waits until a step of it merges; it prints the times and every gap for `docs/numbers.md` under L49. Its options are at the top of `scripts/cold-start.ts`. Slow and it spends tokens: the heavy run and a release run it, not `check`.
- `bun run release <version>`: refuses on a dirty tree or a red full check; otherwise sets the version, commits and tags `v<version>` here, installs from the tag into a fresh HOME and runs its doctor. It never pushes.
- `bun run dispatcher:eval`: asks the Dispatcher's model the 58 requests of `test/dispatcher-eval/` and prints the share it called right (goal 100 %, never below 95 %). It spends tokens: not in `check`, run before each release and in U43.
- `bun run ui:test`: the UI bar in headless Chromium (Playwright, once: `bunx playwright install chromium`) on the pages `lineclear run` serves, on port 7432 or `LINECLEAR_UI_PORT`; the
  design system and its bar are in `docs/design.md`; `/design` is its test page. Home is `/`,
  the Inbox `/inbox`, both with `?state=`.
- `bun run ui:cold`: the cold look. Fresh models from three companies get only the pictures of a first run (`docs/cold/`) and are asked who does what; goal 90 % right, answers in `docs/numbers.md`. It spends tokens: not in `check`, run on each UI release.
- `bun run shots`: starts `lineclear run --demo` (fixed demo data, no real names) and takes every view at 390 and 1440 px
  into `docs/shots/`, with `docs/shots/list.md`. A release runs it. The check fails when the README or a docs page shows a
  picture of the app that is not in that list (`bun run shots:check`).
- `server/`: the fork of herdr-projects 2.0 (MIT, see `server/NOTICE`). `bin/lineclear serve --port <port>` starts it; `bun run check` runs its types and tests too (it prints each step's time).
- `bin/lineclear --help` lists the CLI. `bin/lineclear roadmap check .` checks `docs/ROADMAP.md`.

## Layout

- `src/`: the CLI and its commands (`cli.ts` is the entry). `test/`: bun tests, one file per command.
- `bin/lineclear`: the CLI. `install.sh`: the one-command install. `pi/extension.ts`: the pi extension.
- `scripts/`: repo tools. `ui/brand/`: the mark, the wordmark and `tokens.css`. `ui/kit/`: the design system's parts
  and `motion.ts`. `ui/web/`: the web pages `lineclear run` builds and serves. `ui/test/`: the UI bar's browser tests. `ui/shots/`: the screenshot run of `bun run shots`. `docs/`: idea, roadmap, backlog.

## Writing

- General voice: explain Lineclear for any user. No stories about one setup, no dates of one run, no owner details.
  A why is a reason that holds for everyone. Goals stay goals, not claims.
- Short: every sentence earns its place. Plain English, short sentences. No en or em dashes.
- Facts about other tools (Lineclear, herdr, pi) only when anyone can check them, with a link.
- New ideas go to `docs/backlog.md`, never into the roadmap or the code.

## Code

- A module owns one job; code two modules need lives in the lower one (`docs/architecture.md`). One way per job:
  call the existing helper instead of writing a second one.
- Names say what a thing is or does. No dead code, no unused exports, no copied blocks.
- A comment says why, not what. No commented-out code, no TODO without a task id (`TODO(LIN-123)`), no history
  comments ("Changed X", "Added Y"), no filler.
- Every gate baseline in `scripts/gates/baseline/` is empty (the coverage floors and slow-test times are not fault lists), so a gate fails on any fault. Avoid `any` and non-null assertions where a type says it better; Biome does not flag them.
- A file stays under 600 lines and a function under 80 lines.

## UI

- One theme, the dark graphite one, from `ui/brand/tokens.css`. Green clear, amber waits for you, red only broken.
- The stack is fixed in idea.md. A deviation needs a written decision.
- The UI bar (U2 in the roadmap) holds for every view: graphic first, top quality, every state designed (empty,
  loading, error, long text, 200 items), motion on every state change at 60 fps in a performance trace, never
  blocking input, none under prefers-reduced-motion, screenshot tests at 1440 and 390 px, a recording of each motion.
