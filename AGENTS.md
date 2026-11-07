# Lineclear

What Lineclear is and why: [docs/idea.md](docs/idea.md). The order of work: [docs/ROADMAP.md](docs/ROADMAP.md).

## Commands

- Checks are light and run on GitHub (`check.yml`, 5 minutes a job at most), never on an owner's machine: no browser suite, no coverage run, no local full check in a release or promotion (next goes out when the merged commit's GitHub `check` is green). `test/light-checks.test.ts` fails when that changes.
- `bun run check`: on a machine of yours it runs nothing (no tsc, no tests). GitHub runs the types and the tests, sharded to finish in about a minute: `lineclear pr` pushes the branch, `lineclear checks` waits for the result, and it must be green before a merge. On a runner (`GITHUB_ACTIONS`) the same script runs the change's tests, or `--full` runs everything in shards; a test case is under 2 s (a file with a slower one needs a baseline; `docs/numbers.md`).
- `bun run types` (tsc), `bun run test` (bun test).
- `bun run gates`: Biome (lint and format), knip (dead code) and the module borders of `docs/architecture.md`. Any fault fails.
- `bun run release <version>`: refuses on a dirty tree or a red full check; otherwise sets the version, commits and tags `v<version>` here, installs from the tag into a fresh HOME and runs its doctor. It never pushes.
- `bun run dispatcher:eval`: asks the Dispatcher's model the 61 requests of `test/dispatcher-eval/` and prints the share it called right (goal 100 %, never below 95 %). It spends tokens: not in `check`, run before each release and in U43.
- `bun run ui:test`: the UI bar in headless Chromium (Playwright, once: `bunx playwright install chromium`) on the pages `lineclear run` serves, on port 7432 or `LINECLEAR_UI_PORT`
  The design system is in `docs/design.md`. Home is `/`, the Inbox `/inbox`, both with `?state=`.
- `server/`: the fork of herdr-projects 2.0 (MIT, see `server/NOTICE`). `bin/lineclear serve --port <port>` starts it; GitHub's `bun run check` runs its types and tests too (it prints each step's time).
- `bin/lineclear --help` lists the CLI. `bin/lineclear roadmap check .` checks `docs/ROADMAP.md`, or `docs/roadmap/<id>.md` when that folder exists.

## Layout

- `src/`: the CLI and its commands (`cli.ts` is the entry). `test/`: bun tests, one file per command.
- `bin/lineclear`: the CLI. `install.sh`: the one-command install. `pi/extension.ts`: the pi extension.
- `scripts/`: repo tools. `ui/brand/`: the mark, the wordmark and `tokens.css`. `ui/kit/`: the design system's parts
  and `motion.ts`. `ui/web/`: the web pages `lineclear run` builds and serves. `ui/test/`: the UI bar's browser tests. `docs/`: idea, roadmap.

## Writing

- General voice: explain Lineclear for any user. No stories about one setup, no dates of one run, no owner details.
  A why is a reason that holds for everyone. Goals stay goals, not claims.
- Short: every sentence earns its place. Plain English, short sentences. No en or em dashes.
- Facts about other tools (Lineclear, herdr, pi) only when anyone can check them, with a link.

## Code

- A module owns one job; code two modules need lives in the lower one (`docs/architecture.md`). One way per job:
  call the existing helper instead of writing a second one.
- Names say what a thing is or does. No dead code, no unused exports, no copied blocks.
- A comment says why, not what. No commented-out code, no TODO without a task id (`TODO(LIN-123)`), no history
  comments ("Changed X", "Added Y"), no filler.
- Avoid `any` and non-null assertions where a type says it better; Biome does not flag them.
- A file stays under 600 lines and a function under 80 lines.

## UI

- One theme, the dark graphite one, from `ui/brand/tokens.css`. Green clear, amber waits for you, red only broken.
- The stack is fixed in idea.md. A deviation needs a written decision.
- The UI bar (U2 in the roadmap) holds for every view: graphic first, top quality, every state designed (empty,
  loading, error, long text, 200 items), motion on every state change at 60 fps in a performance trace, never
  blocking input, none under prefers-reduced-motion, screenshot tests at 1440 and 390 px, a recording of each motion.
