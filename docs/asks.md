# Asks

An ask is a needs-you card in Lineclear's chat. An ask that a rule can answer should never reach you. This page
sorts a week of real cards into kinds, says which rules answer them, and says where the rest go in the Inbox.

`lineclear asks [--days N]` prints the same count from your own chat files, then lists each ask with its task, kind and what should have answered it. It counts the Inbox too: an item with no card in a chat is an ask of kind `inbox <kind>`. `lineclear run` applies the rules.

## The week

The needs-you cards of the 7 days to 2026-11-04, counted by `lineclear asks --days 7` on this machine's chat files:
44 asks and 159 reports (154 of them closed, their task is done).

| Kind | Count | What it is | Goes to |
| --- | --- | --- | --- |
| question | 25 | A question with choices, or a form. | Rule 5: a written rule answers it, never the owner |
| allowance | 14 | The agent's subscription is out until a named time. | Rule 1 |
| plan | 2 | A plan waits for a yes. | Rule 6: applies by itself when the checks pass, the owner can undo |
| merge-chat | 1 | `lineclear merge` refuses because the chat has a new message the agent has not read. | Rule 2 |
| login | 1 | The agent waits for you to log in to a site. | Rule 3 when a login is stored, else Inbox: login or code |
| permission | 1 | A terminal asks permission to run a command. | Inbox: outward (a wrong yes runs a command nobody checked) |
| report | 159 | A task stopped and says why, with no question. | Not an ask. Closed by rule 4 once its task is done |

The three most frequent kinds a rule can answer are question, allowance and plan: rules 5, 1 and 6, each with a
test in `test/asks.test.ts`. The other kinds are listed above with where they go; permission is the one kind left
for the owner.

## The rules

Each rule runs once per card, in each tick of the rule loop, and writes what it did to the decision log.

1. **Allowance.** Read the reset time from the card ("resets 8pm (Europe/Helsinki)", "until 8:00:00 PM"), in the zone
   it names or else the machine's. Declare an `until` wait for the task. The loop stops it and wakes it at that time.
   A card with no readable time goes to the Inbox.
2. **Merge chat.** Tell the task to read its chat, handle the message, and merge again.
3. **Login.** If the project has a stored `NAME_USER` and `NAME_PASSWORD` pair and the card names `NAME`, tell the task
   to load it with `lineclear secrets env` and go on. The message never holds a value. With a stored `NAME_TOTP` it
   also says that `lineclear totp NAME` prints the code. A push or a number to approve, with any `NAME_TOTP` loadable
   (the project's secrets or the shared secrets folder), is never the owner's: the task is told to pick the
   verification-code option. `lineclear ask --kind login` and `lineclear wait owner --kind login` refuse then. Where no
   `NAME_TOTP` is stored they need the missing NAME (`--login NAME`, or `NAME_TOTP` in the wait's words), and the
   Inbox item says it. A captcha still goes to the Inbox.

4. **Report.** A report card is not an ask: `lineclear asks` counts reports apart. Once its task has posted that it is
   done, the rule closes the report. The brief ends a task with its report and no question, and a notice goes in
   that report, not in the Inbox.

5. **Question.** A step question (merge now or wait, which reviewer, a flaky test) is answered with a written rule,
   or the Dispatcher's way from the brief and the roadmap. The owner is not asked.
6. **Plan.** A plan applies by itself once the rule checks pass and the fresh-eyes readiness check says go, unless the
   project's setting "Ask me before: plans" is on. The owner can undo it with one tap.

7. **Coordinator chat.** A choice card that names a task in its space's coordinator chat goes the same way as one in
   the task's own chat. A rule answers the task and the card closes with that answer. A merge the task's settings keep
   for the owner ("Merge: ask me first") has no rule: it is an Inbox item in the same tick. Answering the item
   answers the card, and closing the task closes both.

8. **Machine-only action.** An outward ask for something done on this machine alone (a power cut, a reboot, a
   recording of the boot) sends nothing out. `lineclear ask --kind outward` refuses it and says so: the agent does
   it itself, or files it as a task (LIN-163) and goes on. These were the three asks of the day in
   `docs/numbers.md` under L243, all of one cause (L50's real power cut). Tested in `test/rules-waits.test.ts`.

A rule answers by telling the task or by a wait. Lineclear has already posted the card, and the rule does not
remove it. A card that no rule can answer (no readable time, no stored login) is left as it is. `lineclear asks`
names the Inbox kind it will become.

A card seen again, or one its task has answered since, is not routed twice.
