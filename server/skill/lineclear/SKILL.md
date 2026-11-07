---
name: lineclear
description: Lineclear's house conventions for every agent it starts, coordinators and task agents alike - the chat lines it sends and reads (reactions, files, answers, replies, the no-reply marker), its own lines in tags, choice cards and plans, secrets (API keys, tokens), alerts, and the lineclear command. Use when talking to the human through Lineclear, reading a chat line or a tagged Lineclear line, asking the human something or needing or using a secret. Not for making, queuing, merging or closing tasks or coordinator timer (lineclear-coordinator), and not for taking one task from brief to merged (lineclear-agent).
---

# Lineclear

## Trigger

Lineclear started you, as a space's coordinator or as one task's agent.

## Scope

How you talk to the human and use the `lineclear` command, whatever your role; `lineclear help` lists every command
and flag. Your role's own work is in its own skill (References).

## Command routing

The launch prompt names your authoritative command and chat identity. `LINECLEAR_COMMAND` also names that command.
On a remote machine it is `~/.lineclear/helper/bin/lineclear`, which uses `helper/main.sock`, not a local web port.
Use the launch identity: a coordinator's space key, `<task-id>/Agent`, or `<task-id>/Reviewer` for a reviewer.
Do not trust another inherited `LINECLEAR_CHAT`, `LINECLEAR_URL`, or a repo command ahead of the helper on PATH.
The repo command and helper recover the owning live session from a live process binding and its owning folder, even after a shell resets PATH or a shared tool executor inherits another session’s environment.
A deliberately different `LINECLEAR_URL` is preserved by the repo command; `lineclear --url <URL> ...` explicitly
selects even the same URL the session inherited. The installed helper always uses its main.sock.
Never start a live server to repair CLI routing. A demo preview belongs on its own non-default loopback port.

## Inputs

- Lines in your terminal: the human's words, chat lines (below), and Lineclear's own lines in `<lineclear>` tags, each
  in a tag of what it is (`<news>`, `<go>`, `<queue>`, `<restart>`, `<github>`, `<health>`).
  Tagged lines are from Lineclear, not the human: never quote them back.
- `lineclear show`: the human's Settings where it runs, and where each comes from.

## Roles

The human reads your replies in a chat on a phone, tablet or desktop, never this terminal, and decides.

## Procedure

### Chat lines you receive

    <reaction from="Elias" emoji="👍" to="PR #52 is ready to merge"/>
    <reaction-removed from="Elias" emoji="👍" to="PR #52 is ready to merge"/>
    <attachment from="Elias" name="screenshot.png" path="~/.lineclear/inbox/screenshot.png"/>
    <reaction from="Elias" emoji="👍" file="screenshot.png" path="~/.lineclear/inbox/screenshot.png"/>
    <answer from="Elias" question="Rerun CI on main?">Rerun it</answer>
    <secret from="Elias" name="GITHUB_TOKEN" for="api"/>
    <reply from="Elias" to="Tests pass on the branch. Want me to merge?">Yes, merge it</reply>

Double quotes inside a value come as curly ones; words between tags may run over several lines. An attached file is
on this machine at its path. A reply quotes the start of the message it answers.

### Chat lines you write

Each on a line of its own:

    <react emoji="👀" to="What needs me today?"/>
    <react emoji="👀" file="screenshot.png" path="~/.lineclear/inbox/screenshot.png"/>
    <reply to="Can you check the flaky test?"/>

`<reply to="…"/>` starts your reply and quotes the start of the message it answers. When a Lineclear line needs no
words and the human sees no card of it, your whole reply is only
`<no-reply>short reason</no-reply>`: the chat shows nothing.

### Asking

A question with a few answers is a choice card, then end your turn:

    lineclear card "Rerun CI on main?" --choice "Rerun it" --choice "Skip the flaky test" --choice "Leave it for now"

`--ordinary` explicitly marks a simple ordinary question: its choice buttons send immediately, with an Add a note
route for composing first. Never use it for permission, startup approval, plans or other approvals. Leave it off
when unsure; unmarked cards keep pick-then-Send. `--multi` always keeps Send.

`--other` allows a typed answer, `--multi` several picks, `--desc "<choice>=<one line>"` explains a choice. A plan for
the human's yes is `lineclear plan <id> --step "…" --step "…"`, then end your turn.

### Secrets

API keys, tokens and passwords are the human's secrets: use them by name, never by value.

    lineclear secret list                              # the names you can use here
    lineclear secret ask GITHUB_TOKEN --why "To open pull requests on acme/api"
    lineclear secret run GITHUB_TOKEN -- gh pr create --fill     # $GITHUB_TOKEN in its environment only
    lineclear secret env STRIPE_KEY --file .env        # a file git ignores, readable by you only

- **Authenticated session.** `secret run` and `secret env` need the current session's private credential. Use its
  owning command. `LINECLEAR_SECRET_FILE` is a launch-provisioned file reference: preserve it in tool environments,
  never read or print its contents. Changing chat/cwd or using main.sock grants no secret authority. An older session
  without proof fails closed until route repair; an older shared executor missing the reference needs a planned
  restart with the human's approval. Never borrow another session's credential. See `docs/secrets.md`.
- **Ask with the card.** Not there: `lineclear secret ask NAME --why "…"`, then end your turn. The human gets a masked
  box; a `<secret from="…" name="NAME" for="…"/>` line says it is kept. Never ask for a secret in words, and if the
  human pastes one in the chat anyway, tell them to give it in the box instead (`--force` asks again).
- **Run, don't read.** `secret run` runs a command with it in its environment, masking it in what the command prints
  (a safety net, not leave to print it); prefer it to a file. Where a command's
  words need it, let that command's own shell read it, in single quotes:
  `lineclear secret run API_KEY -- sh -c 'curl -H "Authorization: Bearer $API_KEY" …'`. A tool that needs a
  file gets `secret env` (refused unless git ignores the file). Never print, echo, log, commit or write a secret
  anywhere else, never put it in a command's words, a brief or a chat, and keep `set -x` and verbose flags
  off where one goes by.
- **Name it plainly**, as its tool expects (`OPENAI_API_KEY`). The human adds, replaces and removes them in Settings →
  Secrets, Everywhere, for a machine or for a space; the most specific one wins.

### Alerts

`lineclear alert "<title>" --body "<why>"` reaches the human's phone: only for what truly can't wait.

## Outputs

Short, plain replies in the chat; cards, plans and alerts through the `lineclear` command.

## Exceptions

When a command refuses, its message says why and what to do instead: follow it rather than work around it.

## QC

- No choices in prose where a card fits.
- `<no-reply>` only for Lineclear's lines, never to answer the human.
- No secret's value in anything you write, run or print: only its name.

## References

- [lineclear-coordinator](../lineclear-coordinator/SKILL.md): a coordinator's tasks, news, and merges.
- [lineclear-agent](../lineclear-agent/SKILL.md): a task's agent, from brief to merged.
