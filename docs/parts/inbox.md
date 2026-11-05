# inbox

The Inbox: the one place the owner is asked. It holds five kinds of item (a plan, a step, a login or code, an outward
action, a stuck task), routes each need to a rule or an item, and pushes a new item to the owner's phone.

## Invariants

- Only six kinds of item exist (the sixth, a release, reports a promotion with one tap to roll back, or asks for one to promote), and an agent's question outside a login, money or an outward action is answered by
  rule, never put to the owner.
- An item is a file of its own, written atomically.
- An answered item stays, with its answer and time; an item that applied by itself can be undone once.
- A plan's item carries the go answers of the fresh model that read its steps (`checks`).
- A step marked owner-only is never a task: its item (`ownerStep`) shows its done-when, and the owner answers Done with the result as the note.
- Only the owner answers: a push names the item, never a secret.

## Interface

`lineclear ask`, `lineclear asks`, `lineclear inbox`, the inbox folder, and these names:

- `src/inbox.ts`: `addItem`, `closeItem`, `closeSettledUpdates`, `isOpen`, `noticeTimers`, `projectDecisions`, `readItems`, `Item`, `cardExtras`, `GoChecks`, `askMain`, `answerCard`, `KIND_LABEL`
- `src/inbox-answer.ts`: `inboxMain`
- `src/asks.ts`: `asksMain`, `allNeedCards`, `routeAsks`
- `src/cards.ts`: `questionIn`, `askKind`, `IDLE_TEXT`, `lineOf`
- `src/notify.ts`: `Pusher`, `realPush`, `watchInbox`

## Files

- code: `src/inbox.ts`, `src/inbox-answer.ts`, `src/asks.ts`, `src/cards.ts`, `src/notify.ts`
- docs: `docs/asks.md`
- tests: `test/asks.test.ts`, `test/notify.test.ts`, `test/inbox-updates.test.ts`

## Tests

- `test/contracts/inbox.test.ts`, `test/asks.test.ts`, `test/notify.test.ts`, `test/inbox-updates.test.ts`

## Debts

- `src/inbox.ts` and `src/asks.ts` are in import cycles with the planner and measure (the cycles baseline).
