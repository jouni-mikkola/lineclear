# ui

The web UI `lineclear run` serves: Home, the Inbox, the Roadmap, the chat, Settings and the browsers, the design
system's kit and brand, the web API that feeds them, and the README with its film and stills.

## Invariants

- One dark graphite theme from `ui/brand/tokens.css`: green clear, amber waits for you, red only broken.
- Every view meets the UI bar of `docs/design.md`: each state designed, motion on each change at 60 fps and none
  under reduced motion, screenshots at 1440 and 390 px.
- The pages read the web API only; the API reads files and git, with no AI.
- A view is built from the kit's parts, one part per pattern.
- Home's line draws the signal box (`signalBox`, with writing dots), a train (`train`, with its load) and the account engines (`engine`, with fill) from `ui/brand/rail.ts`, the same shapes on every view.
- Someone new installs Lineclear from the README alone; its film and pictures are made by `bun run media` from the brand, never drawn.
- Each project on Home says Running or Paused (`HomeProject.paused`), with one switch that writes its settings.
- The mark opens nothing: it goes Home. Settings holds the order of the models per role and the chat address, each under its own heading.
- Under each project Home says why work waits (`HomeProject.waiting`): what runs now, what each paused task waits for, and why a ready step has not started, in plain words with no task ids or lock names.

## Interface

The web pages and the web API of `src/web.ts`, and these names:
- `src/web.ts`: `startWeb`
- `src/web-address.ts`: `webAddress`
- `src/browsers.ts`: `describeSessions`, `openSessions`, `BrowserSession`
- `src/home-data.ts`: `localProjects`, `HomeProject`, `projectsData`
- `src/roadmap-source.ts`: `lineclearTasks`
- `src/roadmap-view.ts`: `roadmapData`, `lineOfRoadmap`
- `src/demo.ts`: `demoMain`
- `src/prefs.ts`: `TEST_PROJECT`

## Files

- code: `ui/`, `src/web.ts`, `src/roadmap-source.ts`, `src/web-guard.ts`, `src/web-settings.ts`, `src/prefs.ts`, `src/web-views.ts`, `src/web-chat-api.ts`, `src/web-routes.ts`, `src/home-spend.ts`, `src/web-files.ts`, `src/web-address.ts`, `src/home-data.ts`, `src/home-waits.ts`, `src/home-doctor.ts`, `src/task-detail.ts`, `src/task-live.ts`, `src/task-changes.ts`, `src/search.ts`, `src/roadmap-view.ts`, `src/step-page.ts`, `src/browsers.ts`, `src/read-aside.ts`, `src/projects-feed.ts`, `src/projects-worker.ts`, `src/heal.ts`, `scripts/svg-motion.ts`, `scripts/role-icons.ts`, `scripts/cold.ts`, `playwright.config.ts`, `scripts/readme-film.ts`, `scripts/readme-roles.ts`, `scripts/media.ts`, `scripts/media-lib.ts`, `scripts/release-notes.ts`, `scripts/film/`, `src/shots.ts`, `src/demo.ts`, `scripts/shots-check.ts`, `playwright.shots.config.ts`, `src/live.ts`, `src/live-diff.ts`, `playwright.budget.config.ts`
- docs: `docs/design.md`, `docs/cold/`, `docs/design/`, `docs/brand.md`, `docs/brand/`, `docs/u26/`, `docs/u33/`, `docs/u34/`, `docs/u35/`, `docs/u37/`, `docs/u39/`, `docs/u5/`, `README.md`, `CHANGELOG.md`, `docs/readme/`, `docs/releases/TEMPLATE.md`, `docs/shots/`
- tests: `test/home-doctor.test.ts`, `test/web-prefs.test.ts`, `test/web-never-waits.test.ts`, `test/fixtures/slow-projects-worker.ts`, `test/fixtures/failing-projects-worker.ts`, `test/brand-parts.test.ts`, `test/fake-lineclear.test.ts`, `test/ui-isolation.test.ts`, `test/web.test.ts`, `test/browsers.test.ts`, `test/browser-sessions.test.ts`, `test/home-data.test.ts`, `test/home-projects.test.ts`, `test/home-fixtures.ts`, `test/amber.test.ts`, `test/task-detail.test.ts`, `test/task-live.test.ts`, `test/task-changes.test.ts`, `test/search.test.ts`, `test/board-home.test.ts`, `test/board-widths.test.ts`, `test/board-usage.test.ts`, `test/kit-tokens.test.ts`, `test/kit-format.test.ts`, `test/markdown.test.ts`, `test/rich-text.test.ts`, `test/rail.test.tsx`, `test/views-count.test.ts`, `test/role-icons.test.ts`, `test/readme-film.test.ts`, `test/media.test.ts`, `test/brand-voice.test.ts`, `test/shots.test.ts`, `test/roadmap-since.test.ts`, `test/step-page.test.ts`, `test/step-record.test.ts`, `test/live.test.ts`, `test/live-diff.test.ts`

## Tests
- `test/web.test.ts`, `test/home-doctor.test.ts`, `test/home-data.test.ts`, `test/home-projects.test.ts`, `test/browsers.test.ts`, `test/views-count.test.ts`, `test/kit-tokens.test.ts`, `test/readme-film.test.ts`, `test/media.test.ts`, `test/brand-voice.test.ts`, `test/shots.test.ts`
- `bun run ui:test`: the UI bar in a browser (`ui/test/`); it is not in the check.

## Debts
- No contract test yet: `test/contracts/ui.test.ts`.
