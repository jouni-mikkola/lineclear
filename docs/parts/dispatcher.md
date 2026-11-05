# dispatcher

The Dispatcher: one chat where the owner says what they want in plain words. It picks the project, hands a goal to the
planner (`lineclear plan`) or a move to the roadmap, and follows each request to its steps.

## Invariants

- The Dispatcher never builds: a goal becomes a planning task, never a worker of its own.
- It picks a project from the owner's list only, and asks again when two match.
- It calls the 58 requests of `test/dispatcher-eval/` right at least 95 % of the time (goal 100 %).
- `lineclear status` and `lineclear inbox` print the lines `src/reads-cache.ts` keeps (the web server refreshes them every 30 s, a read older than 2 min is made live), so they answer in under 2 s however many projects there are.
- A chat message stays within `chat-limits.ts`, the same limits on the server and the page.

## Interface

`lineclear dispatcher`, `lineclear move`, `lineclear status --plan`, the web chat, and these names:

- `src/dispatcher.ts`: `dispatcherMain`, `moveMain`, `applyMove`, `dispatcherDir`
- `src/requests.ts`: `planStatus`, `liveLink`, `recordRequest`, `addedSteps`, `planViews`, `PlanView`
- `src/reads-cache.ts`: `keepReads`, `cachedRead`, `forgetReads`
- `src/chat.ts`: `chatEvents`, `dispatcherChat` (it makes a missing Dispatcher once a minute), `taskChatLinks`, `MAX_FILE_BYTES`, `namedImageResponse`, `parseSend` (the request body, as untyped JSON), `sizeText`, `ChatMessage`, `ChatView`
- `src/chat-limits.ts`: `sizeText`, `ACCEPT`, `MAX_FILE_BYTES`, `MAX_FILES`, `MAX_TEXT`

## Files

- code: `src/dispatcher.ts`, `src/requests.ts`, `src/chat.ts`, `src/chat-limits.ts`, `src/reads-cache.ts`
- words: `templates/dispatcher.md`
- research: `docs/research/dispatcher-flow.md`
- tests: `test/dispatcher.test.ts`, `test/dispatcher-chat.test.ts`, `test/dispatcher-pick.test.ts`, `test/dispatcher-eval.test.ts`, `test/dispatcher-eval/`, `test/chat.test.ts`

## Tests

- `test/dispatcher.test.ts`, `test/dispatcher-chat.test.ts`, `test/dispatcher-pick.test.ts`, `test/dispatcher-eval.test.ts`, `test/chat.test.ts`
- `bun run dispatcher:eval` asks the model; it is not in the check.

## Debts

- `src/chat.ts` has a block copied inside itself (the copies baseline).
- No contract test yet: `test/contracts/dispatcher.test.ts`.
