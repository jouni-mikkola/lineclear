// What each agent is told at start, and the Settings block that ends every new task's brief.
import { join } from 'node:path'
import { SET_BY, SETTINGS_HEAD, type SetBy } from '../../shared/brief.ts'
import { ROOT } from '../root.ts'
import { BOX, helperDir } from './box.ts'

const OWN = BOX ? helperDir(BOX.home) : ROOT

const SKILLS = join(OWN, 'skill')
const skill = (name: string) => join(SKILLS, name, 'SKILL.md')

const commandLine = (chat: string) =>
  `Your authoritative command is LINECLEAR_CHAT=${JSON.stringify(chat)} ${join(OWN, 'bin', 'lineclear')}. Use it if a shell finds another lineclear. Never start a server to repair routing. For a dev/demo server use the repo command with --url <URL>.`

export const readSection = (name: string, section: string) => `Read the section "${section}" of ${skill(name)}.`

const base = (who: string, own: string) =>
  `You are ${who}, running inside Lineclear (the board the human uses). Read ${skill('lineclear')} first, then ${skill(own)}. The human reads your replies in a calm chat: keep them short and plain.`

/** a short card, not two whole skills: a refusing command names the section to read */
const taskBase = (id: string) =>
  `You are the agent of task ${id}, running inside Lineclear (the board the human uses). Read ${join(SKILLS, 'lineclear-agent', 'START.md')} first: it is your whole start. Open a skill (${skill('lineclear')}, ${skill('lineclear-agent')}) only at the section a command names. The human reads your replies in a calm chat: keep them short and plain.`

export interface Ways {
  review: boolean
  mustFix: string
  rounds: number
  merge: string
  waitChecks: boolean
}

interface Reviewer {
  kind: string
  model?: string
  effort?: string
}

const REVIEWER_NAME: Record<string, string> = { claude: 'Claude Code', pi: 'pi' }
function onWords(r: Reviewer, as = (name: string) => name) {
  const name = as(REVIEWER_NAME[r.kind] ?? r.kind)
  if (!r.model && !r.effort) return `${name} (its default model and effort)`
  return `${name} (${[r.model ? `model ${r.model}` : 'its default model', r.effort ? `${r.effort} effort` : 'its default effort'].join(', ')})`
}

const reviewerWords = (r: Reviewer) => onWords(r, (name) => `a headless ${name} or a ${name} subagent`)

export const SEVERITIES = ['critical', 'major', 'minor', 'trivial']

export type Said = 'review' | 'reviewer' | 'mustFix' | 'rounds' | 'merge' | 'check' | 'agent'

export interface Told {
  ways: Ways
  reviewer?: Reviewer
  agent?: Reviewer
  by?: Partial<Record<Said, SetBy>>
}

const plural = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`)

export function settingsLines(id: string, t: Told): { said: Said; text: string }[] {
  const w = t.ways
  const fix = SEVERITIES.slice(0, Math.max(1, SEVERITIES.indexOf(w.mustFix) + 1))
  const merge =
    w.merge === 'ask me first'
      ? `ask me first. Ask the human first, and merge (lineclear merge ${id}) once they say yes.`
      : w.waitChecks
        ? `after GitHub checks. Merge it yourself once it works and GitHub's checks pass (lineclear checks ${id}, then lineclear merge ${id}).`
        : `on its own. Merge it yourself once it works (lineclear merge ${id}). Don't wait for GitHub's checks.`
  const lines: { said: Said; text: string }[] = [
    {
      said: 'review',
      text: w.review
        ? 'Review: on. Have your change reviewed by fresh eyes before it merges.'
        : "Review: off. No review; the lines on reviewing below don't apply.",
    },
    ...(t.reviewer ? [{ said: 'reviewer' as const, text: `Reviewer: ${reviewerWords(t.reviewer)}.` }] : []),
    {
      said: 'mustFix',
      text: `Must fix: ${w.mustFix}. Findings are tagged ${SEVERITIES.join('/')}; fix ${fix.length === SEVERITIES.length ? 'all of them' : plural(fix)}${w.rounds > 1 ? ', then review again' : ''}.`,
    },
    {
      said: 'rounds',
      text:
        w.rounds > 1
          ? `Review rounds: ${w.rounds}. Stop when a round finds none to fix, at most ${w.rounds} rounds.`
          : 'Review rounds: 1. One round, no review again.',
    },
  ]
  lines.push({ said: 'merge', text: `Merge: ${merge}` })
  lines.push({
    said: 'check',
    text: 'Checks: GitHub runs the full check. While you work run only the tests of what you changed (lineclear check --changed); lineclear check hands your branch to GitHub and waits for its result.',
  })
  if (t.agent) lines.push({ said: 'agent', text: `Agent: ${onWords(t.agent)}. Only so you know what you run on.` })
  return lines.map((l) => (t.by?.[l.said] ? { ...l, text: `${l.text} (${SET_BY[t.by[l.said]!]})` } : l))
}

export function splitBrief(desc: string): [work: string, how: string] {
  const i = desc.lastIndexOf(SETTINGS_HEAD)
  return i < 0 ? [desc, ''] : [desc.slice(0, i).trimEnd(), desc.slice(i)]
}

/** The Settings block that ends a brief; the coordinator's words win where they differ. */
export function settingsBlock(id: string, t: Told) {
  return `${SETTINGS_HEAD}\n${settingsLines(id, t)
    .map((l) => `- ${l.text}`)
    .join('\n')}`
}

export function coordinatorPrompt(place: { role: 'space' | 'home' | 'main'; name: string; path?: string; machine: string; chat?: string }) {
  const who = `the coordinator of the space ${place.name} on ${place.machine} (${place.path})`
  const duties =
    place.role === 'space'
      ? ''
      : place.role === 'home'
        ? `\n\nThis is ${place.machine}'s home space: you also look after the machine and add spaces on it (lineclear space add).`
        : `\n\nThis is the home space of the main machine, ${place.machine}: you also look after this machine and you keep the overview of every machine, which alerts reach the phone.`
  return `${base(who, 'lineclear-coordinator')}\n\n${commandLine(place.chat ?? place.name)}${duties}`
}

export function taskPrompt(t: { id: string; branch: string; base: string }, times = '') {
  return [
    taskBase(t.id),
    commandLine(`${t.id}/Agent`),
    `You work in your own git worktree on branch ${t.branch} (from ${t.base}): commit there, and don't switch branches.`,
    times,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function taskFirst(t: { title: string; desc: string }) {
  return t.desc && t.desc !== t.title ? `${t.title}\n\n${t.desc}` : t.title
}

export function restartLine(o: { from: string; to: string; chat: string; commits?: string; changes?: string }) {
  const task = o.commits !== undefined
  return [
    `Restarted: the human restarted this ${task ? 'task' : 'chat'} on ${o.to}. ${o.from} ran it until now; carry on in the same ${task ? 'worktree and branch' : 'folder'}.`,
    ...(task ? [`Commits on the branch so far:\n${o.commits || 'none'}`, `Uncommitted changes:\n${o.changes || 'none'}`] : []),
    ...(o.chat ? [`The chat so far, latest last:\n\n${o.chat}`] : []),
    'If nothing is left, reply in one short line and end your turn.',
  ].join('\n\n')
}

export function relaunchedLine() {
  return `Your agent had stopped: Lineclear started you again, session as it was. Carry on; if nothing is left, reply with only <no-reply>relaunched</no-reply>.`
}

export function resumedLine(on: string) {
  return `The human restarted you on ${on}, session as it was. Carry on; if idle, reply with only <no-reply>restarted</no-reply>.`
}

export function queuedLine(ids: string[], when: 'start' | 'later' | 'changed', id = '<id>') {
  const them = ids.length === 1 ? 'it is' : 'they are'
  const rest = `Lineclear tells you "Go: … start now." once ${them} done. A go from the human or coordinator: run lineclear task queue ${id} --after none and start.`
  if (when === 'changed') return `You now wait for ${ids.join(', ')} instead. Don't start yet. ${rest}`
  if (when === 'later')
    return `Hold on: you are now queued after ${ids.join(', ')}. Stop at a clean point, reply in one line, end your turn. ${rest}`
  return `Queued: this task waits for ${ids.join(', ')} to be done. Don't start yet: reply in one line that you have the brief, end your turn. ${rest}`
}

export function goLine(ids: string[], notes: string[], cleared = false) {
  if (cleared) return `Go: you no longer wait for ${ids.join(', ')}, start now.`
  return [`Go: ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} done, start now.`, ...notes].join('\n')
}

/** GitHub news on a done task's pull request: what happened, never what to do */
export function prNewsLine(id: string, pr: { number: number; url: string }, news: string[]) {
  return [`GitHub news on PR #${pr.number} (${pr.url}), since you reported ${id} ready:`, ...news, 'The lineclear-agent skill says how to handle it.'].join(
    '\n',
  )
}

export function privatePrompt(own: string, reviewer?: string): string {
  return [
    'Private instruction snapshot for this start; it replaces earlier ones, even when empty. Follow the repository AGENTS.md, CLAUDE.md and REVIEW.md too. Never write these rules into repo files, git, briefs, reports or GitHub. The human and the brief win over private rules; on a conflict with team rules, explain and ask. Not a secret store.',
    own,
    ...(reviewer === undefined
      ? []
      : [
          'Reviewer handoff only: the next block is for reviewers. Give it and the precedence/privacy rules above to every fresh reviewer, never your task-only rules.',
          reviewer,
        ]),
  ].join('\n\n')
}
