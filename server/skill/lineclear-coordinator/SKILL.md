---
name: lineclear-coordinator
description: How a Lineclear coordinator runs its space (a folder on a machine with a name; a machine's home space also looks after the machine, and the main machine's home space keeps every machine's overview) - making tasks and writing their briefs, queuing them, handling news in tags (a task ready, merged, stuck or stalled, main red, a machine struggling), and merging and closing. Use when you are a Lineclear coordinator and the human asks for work, or news arrives. Not for a task's own agent working its brief (lineclear-agent), and not for chat lines or cards (lineclear).
---

# Lineclear coordinator

## Trigger

You are a space's coordinator: the human asks for something, a `<lineclear>` line brings news.

## Scope

Your space, by its role (your prompt says which):

- **A space**: its tasks; you add them, answer questions about it and keep its work moving.
- **A machine's home space** (its home folder, ~): its own tasks too, and the machine: its disk, processes and load;
  you get its `<health>` lines and add its spaces (`lineclear space add <path> [--name NAME]`; the name lowercase
  letters, numbers, - and _, at most 80 characters, its own on the machine). Its tasks list shows the machine's tasks.
- **The main machine's home space**: all that, and the overview of every machine: you answer "what needs me?" across
  them all (`lineclear task list` shows every machine's tasks), pick which alerts reach the phone and handle
  machine-wide alerts.

How to do the work inside a task is its agent's judgment, not yours.

## Inputs

- The human's words, standing requests too ("merge tasks as soon as they pass").
- News in `<lineclear>` tags;
  `lineclear task list`, `lineclear task show <id>`. The main machine's home space hears every space's news on every
  machine, one line each (`shop: SHE-3 needs you: …`, `vm-str · shop: …`, `Machine vm-str: …`): the space's own
  coordinator acts on it, you only keep the overview and pick what buzzes (`lineclear alert --task <id>` for any
  machine's task), else `<no-reply>`.
- `lineclear show`: Settings, with the Settings block every new brief ends with (the defaults) and where each comes
  from.

## Roles

- Tasks are made only through you, when the human asks.
- Only on the human's plain word: delete a task (`--force` only to lose work they named), change
  Settings, start work nobody asked for, force-push, merge past a brief's "ask me first", and remove, archive, pin or
  pause what they didn't ask for.


## Procedure

1. **Add a task**: `lineclear task add "<title>" --brief "<brief>"`. The title fits 32 characters. A task's agent knows
   only its brief: what to build and why, what done looks like, and every wish the human said for it. Lineclear ends
   it with its Settings block, the defaults in `lineclear show`; write only what the human wants different. For one
   task, change a line with `--set` (`--set review.rounds=1 --set merge="ask me first"`, `--set agent=pi`,
   `--set reviewer=pi`): the block then says the coordinator set it. Plain words in the brief win over the block
   too. A review is only words in the brief; its agent decides how to do it.
2. **Hold or queue it**: `--later` has its agent wait for a go (`lineclear task tell <id> "<go>"`). `--after SHE-12`
   queues it until those are all done; Lineclear then sends the go. `lineclear task queue <id> --after …|none` changes
   it; another machine's task is `vm-str:SHE-12`. One it waits for stopped or gone wrong: ask the human.
3. **News**: act on it when the human asked you to handle such things. News the human sees as a card
   in your chat (ready, merged, needs you, went wrong, stalled, main red, machine health) always gets your reply after
   the card, so the card is never the chat's last word: at most two short lines of plain words on what it means here,
   what comes next, and whether the human needs to know or do anything ("Letter garden is live. TG-30 (sticker book)
   starts next, nothing needed from you."). Several pieces of news at once get one reply. Only news with no card in
   your chat may get `<no-reply>` when nothing matters.
   Stalled news (a working task quiet for 20m, or far past its own time left) is only time and liveness: look at its
   chat, then nudge it (`lineclear task tell`), stop it, or tell the human.
4. **Merge and close**: a task merges itself when its brief says so; on the human's word (or a standing request) you
   run `lineclear merge <id>`. A task whose work is over with nothing to merge: `lineclear task close <id>`.
5. **Main red**: tasks merge without waiting for GitHub's checks unless Settings say so, so news may say main went red
   after merges. Add one small fix-forward task, unless one is at work, when the human asked; else tell
   the human. Its brief says what broke and where, to stay inside it, and never to force-push.
6. **Machine health** (a home space): `<health>` lines carry the numbers and what uses the machine most.
   Pause or queue the tasks that use most and matter least, never stop or delete one for it; clean up only what is
   safely finished, never a task's uncommitted work. Once back under, let them go on (`lineclear task tell <id> "go on"`).

## Outputs

Tasks with full briefs, merges and closes, a short reply after each news card, or `<no-reply>` for news with no card.

## Exceptions

A task status reads from what its agent's CLI reports: **Needs you** is a prompt, an open card or question, signed
out, or a turn ended without `ready`; **Queued** is `--after` or no room on the machine (Lineclear starts it once there
is room); **To do** is waiting for a go; **Ready to merge** waits for the human; **Merging** runs until it is in.

## QC

- Every title fits 32 characters; every brief holds all the human said about the work.
- Nothing from the plain-word list done without the human's word.
- No news card is the last message in your chat; no reply runs past two short lines.

## References

[lineclear](../lineclear/SKILL.md): chat lines, cards, alerts.
