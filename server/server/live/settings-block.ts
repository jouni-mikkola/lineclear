// The Settings block of a task's brief: the ways it works, as lines the agent reads.
import { SET_BY, SETTINGS_HEAD, type SetBy } from '../../shared/brief.ts'

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

export function settingsBlock(id: string, t: Told) {
  return `${SETTINGS_HEAD}\n${settingsLines(id, t)
    .map((l) => `- ${l.text}`)
    .join('\n')}`
}
