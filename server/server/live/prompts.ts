// What each agent is told at start: the texts live in skill/prompts/<name>.md, this fills them in.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../root.ts'
import { BOX, helperDir } from './box.ts'

const OWN = BOX ? helperDir(BOX.home) : ROOT // the helper's copy on another machine
const skill = (name: string) => join(OWN, 'skill', name, 'SKILL.md')
const known: Record<string, () => string> = {
  lineclear: () => join(OWN, 'bin', 'lineclear'),
  lineclear_skill: () => skill('lineclear'),
  coordinator_skill: () => skill('lineclear-coordinator'),
  agent_skill: () => skill('lineclear-agent'),
  start: () => join(OWN, 'skill', 'lineclear-agent', 'START.md'),
}

function fill(name: string, vars: Record<string, string | number> = {}): string {
  const text = readFileSync(join(ROOT, 'skill', 'prompts', `${name}.md`), 'utf8')
  const value = (k: string) =>
    k === 'chat' && name === 'command' ? JSON.stringify(vars.chat) : (known[k]?.() ?? String(vars[k] ?? (k === 'command' ? fill('command', vars) : '')))
  return text
    .replace(/\{\{(\w+)\}\}/g, (_, k) => value(k))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const ids = (xs: string[]) => ({ ids: xs.join(', '), is: xs.length === 1 ? 'is' : 'are' })
export const readSection = (name: string, section: string) => `Read the section "${section}" of ${skill(name)}.`
export function coordinatorPrompt(p: { role: 'space' | 'home' | 'main'; name: string; path?: string; machine: string; chat?: string }) {
  const vars = { ...p, path: String(p.path), chat: p.chat ?? p.name }
  return [fill('coordinator', vars), ...(p.role === 'space' ? [] : [fill(`coordinator-${p.role}`, vars)])].join('\n\n')
}

export const taskPrompt = (t: { id: string; branch: string; base: string }, times = '') =>
  [fill('task', { ...t, chat: `${t.id}/Agent` }), times].filter(Boolean).join('\n\n')
export const taskFirst = (t: { title: string; desc: string }) => (t.desc && t.desc !== t.title ? `${t.title}\n\n${t.desc}` : t.title)

export function restartLine(o: { from: string; to: string; chat: string; commits?: string; changes?: string }) {
  const task = o.commits !== undefined
  const work = task ? fill('restart-task', { commits: o.commits || 'none', changes: o.changes || 'none' }) : ''
  const chat = o.chat ? fill('restart-chat', o) : ''
  return fill('restart', { ...o, kind: task ? 'task' : 'chat', where: task ? 'worktree and branch' : 'folder', task: work, chat })
}

export const relaunchedLine = () => fill('relaunched')
export const resumedLine = (on: string) => fill('resumed', { on })

export function queuedLine(who: string[], when: 'start' | 'later' | 'changed', id = '<id>') {
  const rest = fill('queued-rest', { them: who.length === 1 ? 'it is' : 'they are', id })
  return fill(`queued-${when}`, { ...ids(who), rest })
}

export const goLine = (who: string[], notes: string[], cleared = false) =>
  cleared ? fill('go-cleared', ids(who)) : [fill('go', ids(who)), ...notes].join('\n')

export const prNewsLine = (id: string, pr: { number: number; url: string }, news: string[]) => fill('pr-news', { id, ...pr, news: news.join('\n') })

export const privatePrompt = (own: string, reviewer?: string): string =>
  [fill('private'), own, ...(reviewer === undefined ? [] : [fill('private-reviewer'), reviewer])].join('\n\n')
