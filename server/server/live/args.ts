// Reads a lineclear command line: positional words and --options (repeatable ones collect into lists).
import { splitFacts, STATUS_MAX, SUMMARY_MAX, TITLE_MAX } from '../../shared/types.ts'

export interface Parsed {
  words: string[]
  opts: Record<string, string[]>
  flags: Set<string>
}

const FLAGS = new Set(['ordinary', 'other', 'multi', 'json', 'project-coordinator', 'off', 'help', 'force', 'discard', 'archived', 'machine', 'later', 'save'])

export function parseArgs(args: string[]): Parsed {
  const words: string[] = []
  const opts: Record<string, string[]> = {}
  const flags = new Set<string>()
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const name = eq > 0 ? a.slice(2, eq) : a.slice(2)
      if (eq > 0) (opts[name] ??= []).push(a.slice(eq + 1))
      else if (FLAGS.has(name) || i + 1 >= args.length || args[i + 1].startsWith('--')) flags.add(name)
      else (opts[name] ??= []).push(args[++i])
    } else words.push(a)
  }
  // --project, from before spaces, is --space
  if (opts.project) opts.space = [...(opts.space ?? []), ...opts.project]
  delete opts.project
  return { words, opts, flags }
}

export const one = (p: Parsed, name: string) => p.opts[name]?.at(-1)

/** a task's --summary and --facts: a facts line written at the summary's end comes apart; a summary past SUMMARY_MAX is
    refused, for its writer to make shorter (like a title past TITLE_MAX) */
export function summaryOpts(p: Parsed, rest: string[] = []): { said?: string; facts?: string } {
  const { said, facts } = splitFacts(one(p, 'summary') ?? rest.join(' '), one(p, 'facts')?.replace(/^\s*Facts:\s*/, ''))
  if (said.length > SUMMARY_MAX)
    throw new Error(
      `That summary is ${said.length} characters: write a shorter one, ${SUMMARY_MAX} at most, in plain words on what changed for the human. PR, commit, checks, review and what is not proven go in --facts "…"; more detail goes in your chat or your proof.`,
    )
  return { said: said || undefined, facts }
}

export const HELP = `lineclear: talk to Lineclear from a terminal (agents use it; so can you)

Spaces (a folder on a machine with a name and its own coordinator; each machine has its home space, ~)
  lineclear space add <path> [--name NAME]       add a git repo folder as a space (its own herdr space); the name
                                                 follows the space rules: lowercase letters, numbers, - and _,
                                                 at most 80 characters, its own on its machine
  lineclear space set base <branch> --space NAME  new tasks start from and merge into this branch; existing tasks keep theirs
  lineclear space list
  lineclear space rename <name> <new-name>       only the name that shows changes (its folder, herdr space and task
                                                 ids stay)
  lineclear space remove <name>                  Lineclear forgets it (its folder stays); not while its tasks work,
                                                 never the home space
  lineclear answer <card id> "<answer>" --space NAME
                                                 answer a choice card of the space's coordinator chat in words

Tasks (coordinators add them, only when the human asks)
  lineclear room [MACHINE]    a machine's load, cores, free memory, tasks at work and slots, as JSON
  lineclear task add "<title>" --brief "<the brief>" [--result "<one sentence: what the owner sees or does once it lands>"] [--space NAME] [--base BRANCH] [--after SHE-12,SHE-13] [--later] [--on MACHINE]
                                                 [--set KEY=VALUE ...] [--agent CLI] [--model ID] [--effort LEVEL]
                                                 [--reviewer CLI] [--reviewer-model ID] [--reviewer-effort LEVEL]
                                                 the title at most ${TITLE_MAX} characters (it fits one line on a phone);
                                                 its agent starts at once, in its own worktree. Lineclear ends the
                                                 brief with its Settings block (lineclear show has the defaults); the
                                                 brief's own words win (skip the review, plan first, ask me before
                                                 merging). --set changes one line of it for this task, marked as set
                                                 by the coordinator: --set review=off, --set review.mustFix=critical,
                                                 --set review.rounds=1, --set merge="ask me first"; --set agent=…,
                                                 model, effort, reviewer, reviewer.model and reviewer.effort are the
                                                 flags below.
                                                 --later: its agent reads the brief and waits for a go (To do); the go
                                                 is a message to it that says so (task tell).
                                                 --agent, --model and --effort pick the CLI (claude, codex, pi, …),
                                                 model and effort for this task instead of Settings': only what
                                                 that CLI and model take (lineclear models), or default.
                                                 --reviewer, --reviewer-model and --reviewer-effort pick who reviews
                                                 its change (codex, claude, pi), named in its brief's Review line.
                                                 --after queues it: its agent reads the brief and waits, and Lineclear
                                                 tells it to go once those tasks are all done (merged, or nothing to
                                                 merge); vm-str:SHE-12 is another machine's.
                                                 While the machine has no room (its max tasks working, or its load
                                                 or memory over the start limit) a new task waits as Queued and
                                                 starts by itself once there's room, oldest first
  lineclear task queue <id> --after SHE-12[,SHE-13]
                                                 queue a task after others, or change what it waits for; --after none
                                                 clears it and it goes. A message to a queued task reaches its agent,
                                                 which clears its queue itself if the message is a go
  lineclear task list [--space NAME] [--json] [--archived]
                                                 archived tasks are left out; --archived lists only them
  lineclear task show <id> [--json]
  lineclear task tell <id> "<text>"            from a coordinator, a go to a task that waits (To do, Queued) waits
                                                 too while the machine has no room (Settings → the machine), and it
                                                 says so; Lineclear hands it over once there's room
  lineclear task stop <id>                       close its agent and herdr space; its work stays (a worktree with
                                                 unsaved or unmerged work is kept); writing to it starts it again
  lineclear task close <id> [--summary "..."] [--discard]
                                                 a task with nothing to merge: stop its agent, close its herdr space,
                                                 remove its worktree and branch (kept, and said so, when they hold
                                                 unsaved or unmerged work) and mark it Done (summary, at most
                                                 ${SUMMARY_MAX} characters: Nothing to merge). Refused while its branch
                                                 has commits the base lacks, unless --discard (the work is elsewhere; the branch is kept)
  lineclear task delete <id> [--force]           only when the human plainly asks: stop its agent, close its herdr
                                                 space (and all that runs there), remove its worktree, branch, chat
                                                 and record, so it leaves every list; posts nothing. Refused while it
                                                 holds uncommitted or unmerged work, unless --force. A merged task's
                                                 commits stay on main
  lineclear task archive <id>                    only when the human asks: out of every list and count, its record,
                                                 chat and summary kept (search and Archived find it); a running
                                                 agent is stopped first. Done tasks archive themselves after
                                                 tasks.archiveAfter (default 7 days; off allowed)
  lineclear task unarchive <id>                  bring it back into its lists
  lineclear task pause <id>                      only when the human asks: interrupt its working agent (as Esc does;
                                                 it stays alive) and put it in To do, as lineclear todo; its work,
                                                 worktree and chat stay, and any message to it (task tell) goes on
  lineclear task pin <id>                        only when the human asks: show it in Pinned at the top of its
                                                 tasks (it keeps its status); archiving or deleting it drops the pin
  lineclear task unpin <id>                      put it back in its own group
  lineclear restart <space|id> [--agent CLI] [--model ID] [--effort LEVEL] [--save]
                                                 only when the human asks: start a space's coordinator or a task's
                                                 agent again on Settings' CLI, model and effort for its role (or
                                                 these: what lineclear models lists, or default); --save makes them
                                                 the space's Settings too. A working agent is interrupted first. The
                                                 same CLI resumes its session; another takes over with the chat so
                                                 far (a task's: its brief, commits and changes too). Its worktree,
                                                 branch and waiting messages stay; a coordinator's tasks go on

Task agents
  lineclear todo <id>                            the brief says to wait for a go: show as To do until one comes
  lineclear ready <id> --summary "<what changed>" [--facts "<PR · commit · checks · review · not proven>"]
                                                 the summary at most ${SUMMARY_MAX} characters, in plain words for the
                                                 human (longer is refused); the facts go in the PR,
                                                 task show and the coordinator's news, not the card;
                                                 Ready to merge (done is its old name); a branch with no changes (an
                                                 answer, research) has nothing to merge and goes straight to Done
  lineclear pr <id>                              on GitHub: push its branch and open its pull request (a draft until
                                                 ready) or push to the open one; run it again after new commits
  lineclear checks <id>                          wait for GitHub's checks on its pull request (up to 9 minutes); merging
                                                 waits for them only when Settings say to
  lineclear merge <id>                           squash-merge into main (on GitHub through its pull request, as it is:
                                                 rebased only on a conflict with main, without waiting for GitHub's
                                                 checks unless Settings say to, refused on ones already failed; then
                                                 main here is pulled), mark merged, then put away
                                                 its agent, herdr space, worktree and branch (keeping unsaved or
                                                 unmerged work); only when the brief or the human says so. It
                                                 answers within two minutes: run it in the foreground and wait
  lineclear plan <id> --step "..." [--step "..."]
  lineclear status <id> "<line>" --done <0-100> [--left 5m|1h20m]
  lineclear alive <task>      (the pi extension beats it while a tool call runs; no agent runs it)
                                                 how far along you are, in your own words: the task's status line (at
                                                 most ${STATUS_MAX} characters), its pie and the time left (it counts down
                                                 while you work). Run it at the start and at each natural step

Chat
  lineclear card "<question>" --choice "<label>" ... [--desc "<label>=<one line>"] [--other] [--multi] [--ordinary]
      --ordinary: ordinary questions only; never permissions, startup approvals or plans
  lineclear alert "<title>" --body "<why now>" [--task <id>]
                                                 with --task: it says what that task needs and opens on its card

Secrets (API keys, tokens, passwords: used by name, never seen or printed)
  lineclear secret list                          the names you can use here, and where each is kept
  lineclear secret ask NAME --why "<what for>" [--force]
                                                 a masked box in your chat for the human; end your turn, and a
                                                 <secret name="NAME"> line says it is kept. --force: ask again for one
                                                 kept already (wrong or expired)
  lineclear secret run NAME [NAME …] -- <command> [its words]
                                                 runs the command with each one in its environment ($NAME),
                                                 masked (********) in what it prints
  lineclear secret env NAME [NAME …] [--file .env]
                                                 writes NAME=value lines to a file git ignores (readable by you only)
  lineclear secret set NAME [--machine | --space NAME] < file
  lineclear secret rm NAME [--machine | --space NAME]
                                                 for the human: keep one (its value on stdin) or remove it, Everywhere
                                                 (none), for this machine or one space; the most specific one wins

Artifacts (one self-contained HTML file, optional JSON data; checked at phone width, then shown in your chat)
  lineclear artifact new <file.html> --title "<title>" [--data <file.json>] [--space NAME]
  lineclear artifact update <id> [<file.html>] [--data <file.json>] [--title "<title>"] [--note "<what changed>"]
                                                 a new version of the same one; --data alone changes only its data
  lineclear artifact check <file.html> [--data <file.json>]   pictures and errors, without showing it
  lineclear artifact list [--space NAME]
  lineclear artifact show <id>                   its versions and the files of its latest, to edit
  lineclear artifact rm <id>

Settings and automations
  lineclear show [--space NAME]                the app's few settings (how tasks work, each agent's CLI, model and
                                                 effort, auto-archive, the time zone, this machine's
                                                 limits and numbers now, alerts)
                                                 as they are where it runs (its space, else this machine),
                                                 each with where it comes from, and the lines every brief ends with
  lineclear models [CLI]                         each CLI's models and the effort levels each takes, as the CLI says
  lineclear set <key> <value> [--machine | --space NAME]
  lineclear unset <key> [--machine | --space NAME]
                                                 defaults are set Everywhere (none), for this machine (--machine)
                                                 or one space (--space); the most specific one set wins.
                                                 unset drops that level's own, so the level above it counts again.
                                                 Counts and limits take any number in their range
  lineclear automation add "<name>" --task "<title>" [--brief "<brief>"] [--when "<time rule>"] [--on "<events>"]
                         [--agent CLI] [--model ID] [--effort LEVEL] [--space NAME]
                                                 each run adds that task to the space, with a fresh agent; it runs on
                                                 its time rule, its events, or both (at least one)
  lineclear automation edit "<name>" [--name "<new name>"] [--task …] [--brief …] [--when … | off] [--on … | none]
                         [--agent …]

  Triggers: automations take a time rule, events, or both,
  their times in time.zone (Everywhere). Write them from the human's words; show them back in the words Lineclear
  prints, never as written.
      time rule (--when): an iCalendar RRULE (RFC 5545), with DTSTART and EXDATE lines where needed
          FREQ=MINUTELY;INTERVAL=30                       every 30 minutes
          FREQ=MINUTELY;INTERVAL=30;BYHOUR=8,9,…,21;BYDAY=MO,TU,WE,TH,FR    every 30 min, 8:00-22:00, weekdays
          FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;BYHOUR=16;BYMINUTE=0           every other Friday at 16:00
          FREQ=MONTHLY;BYDAY=-1FR;BYHOUR=9;BYMINUTE=0                    the last Friday of the month at 9:00
          DTSTART:20261201T090000 RRULE:FREQ=DAILY;COUNT=10 EXDATE:20261206T090000   from, how many, skip dates
        or once 2026-11-02 9:00, or off. Without DTSTART it counts from 2026-01-01 0:00 (every other week, every 7 min)
      events (--on): all news, none, or some split by commas, each with optional filters
          added · ready · failed · needs-you · merged · stalled · main-red
          space=<name> · branch=<glob, * any> · title=<words in the title>       ready, merged branch=release/*
        an automation hears its own space's news unless a rule names another space=
  lineclear automation pause|resume|run|remove "<name>" [--space NAME]
                                                 run: add its task now
  lineclear automation list [--space NAME]     with each one's last run

Setup
  lineclear doctor                               check every machine saved in herdr; put its helper there again (main machine)
  lineclear status                               spaces, open tasks, herdr, and done tasks that kept work
                                                 (with a task's id: that task's progress, above)
`
