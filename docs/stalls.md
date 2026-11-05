# The stall ladder

Shepherdr posts a "may be stuck: quiet for" card after 20 minutes with no sign of life. A "may be stuck: past its time left" card is a late task, not a silent one (class `late`, below): it is asked once for a new estimate, and the rungs below start only when a second late card comes. `lineclear run` reads those cards and
moves the task one rung per card. Each rung goes to `decisions.jsonl`.

1. A reminder, with `shepherdr task tell`.
2. A restart that resumes its session: `shepherdr task stop`, then `shepherdr task tell`.
3. The worker list's next model. The task is closed with `shepherdr task close`, which keeps a branch with
   unmerged work. The step starts again on the next model, and its brief names the old branch to go on from. This
   runs inside the tick, so the step starts once. Each step has this handover once.
4. An Inbox item of kind `stuck`, and a declared wait, so the task is not nudged again.

A task with a declared wait is never moved up. Cards older than the loop's first look at the project are ignored.

## A silent wait for you

A task that waits for you with no open question, no plan to approve, no login or menu it is blocked on, and no declared wait
is a stall too: nobody can act on it. After 5 minutes Shepherdr posts the same "may be stuck" card, and another every 5
minutes it lasts. The ladder moves the task one rung per card. A task that shows a question, a plan or a login never
gets one, and the loop drops a card whose task has since got one. This holds in every space the loop runs.

## Quiet turns

A turn that ends with no question, no wait and no `ready` gets a nudge, each time: up to three in an hour per task. A
reply that promises its next action ("I'll keep calling", "I'll check again") is quiet too, and its nudge says to run
that action now or declare a wait. The next quiet turn in that hour goes to rung 2, the restart, after which the count starts over. Each one has a line in
`decisions.jsonl`.

## Restart loop on outdated settings

Shepherdr starts an agent again once when it runs on other settings than it would start with now. If it is stale again
within the hour, Shepherdr stops, logs the flag that differs once and adds a `stall` line to `decisions.jsonl`. A pi agent hides its flags, so it is never judged stale.

## Straight to rung 3

- The task's subscription is full, or its free or extra account ran out.
- Shepherdr left the task waiting for you because it is signed out.

## Accounts

`~/.config/lineclear/accounts.json` maps a provider (the part of a model name before the `/`) to its account:

```json
{
  "anthropic": { "kind": "subscription", "out": true },
  "openai-codex": { "kind": "key" }
}
```

`kind` is `subscription`, `free`, `extra` or `key`. `out: true` says the subscription is full or the free or extra
account ran out. The rule loop sets it when a task's model call fails with a full session or week, or a reviewer
reports a usage limit (the account is marked and nobody is messaged: the brief tells the worker to pick another reviewer), together with `resetAt` (the reset time, read from the error; 5 hours for a session and 7
days for a week when it names none) and `window` (`session` or `week`). The mark clears by itself at `resetAt`, for
every role. A mark with no `resetAt` (written by hand) stays. A provider with no entry has room.

A task whose model call failed that way moves to the role's next model in the same tick, before any stall rung, and
restarts from its branch. If no later model has room, it waits until `resetAt` (a `lineclear wait until`), not for
you. Each move is a line in `moves.jsonl` beside `accounts.json`, and Usage in Settings shows each account as free
or full until a time, with the moves.

A model on a `key` is used only after you answered Allow to its Inbox question. The answer holds for that key.
"Not now" is not asked again for a day.

## A herdr that is unhealthy

herdr runs every agent's terminal. Each tick (`src/herdr-health.ts`) reads the herdr servers. One that used over 90 % of a core for 6 ticks in a row, or runs outside `herdr.service`, is stopped and the service restarted, with one `wake` line in `decisions.jsonl`. A workspace of a done or closed task is closed with a `close` line. A service that is not active shows on Home with its failure count. Tests: `test/herdr-health.test.ts`, `test/herdr-health-tick.test.ts`.

## A start that never answered

A start counts only once its agent's pi session holds an answer. A task at work whose agent never answered, or that
herdr no longer knows by name, climbs its own ladder (`src/starts.ts`), timed from when the loop first saw it:

1. After 2 minutes: the brief nudge, typed into the pane that runs in its worktree, then Enter.
2. 2 minutes later: a restart, `shepherdr task stop`, then `shepherdr task tell`.
3. 2 minutes later: the task is stopped with a `start` wait. It shows "start failed", never as waiting for you.

A rung whose nudge or restart fails is logged as failed. An agent that herdr sees working on its first turn holds the
ladder for 6 minutes. A start failed ends once its agent answers, for example after a restart by hand. An agent that
answered once is never a failed start: if it goes quiet later, it is the stall ladder's.

## A held lock

A lock held too long gets one remedy per stall, by the status of its holder (the open task whose title starts with the
step id). `work`: reminded. Step merged: the task is closed. `queued`, or `need` with no open question, plan or declared
wait: told to resume. A holder that waits for the owner gets no tell; the remedy line says "waits for the owner".

## Stall classes

Every way a task or a ready step stops moving has a class (`CLASS_INFO` in `src/stall-class.ts`): signed out, account
full, revive loop, idle after done, main red, lock held too long, no room, no sign of life, late (busy but past its time left: asked for a new estimate once, the ladder climbs only if no status comes), brief never sent, roadmap
broken, repo folder off main, a command that fails, a machine out of reach, head-of-line block across projects, merge
result lost (queued two hours), coordinator gone (the loop did not tick a project for 30 minutes), and unknown. Each has a limit in minutes. Past it the stall goes to
`decisions.jsonl` with its class, its remedy with the minutes from the stall, and its end with the minutes it cost.
`lineclear stalls` and `/api/stalls` sum the last day by class, and the loop keeps one line a day. A test plants each
class (`test/stall-class.test.ts`).
