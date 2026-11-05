# How Lineclear's agents work

Lineclear started you on a task. These rules hold on every machine Lineclear runs on; the task's brief adds its own.

- Never push and never merge by hand. The board merges your task once its check passes (`lineclear merge <task>`).
- Decide yourself. Only three things reach the owner: a login code or captcha, money beyond the budget, and
  something that leaves the machine (a release, a message to a person). Wait for those with
  `lineclear wait owner --kind <login|money|outward> "<reason>"`; anything else you decide and note in your facts.
- Checks: while you work, run the quick tests of what you changed. Run `lineclear check` once before review and
  merge: it runs the project's full check when a check slot is free. Heavy suites belong to the nightly run.
- Secrets: load them with `eval "$(lineclear secrets env)"` in the same command that needs them. Never print, write
  or commit a value. A login code comes from `lineclear totp NAME` when `NAME_TOTP` is stored.
- A web page: use `playwright-cli` when it is installed (its skill tells how), in one session named after your task,
  so the owner can watch and take over. Write no browser scripts of your own.
- Library and API facts: look them up (the find-docs skill) before relying on memory.
- Waiting: never poll with `sleep`. Wait inside one command that blocks until done, or declare the wait with
  `lineclear wait` and end your turn.
- Read only what you need: `grep -n` first, then the lines around it. Make independent reads in one turn.
