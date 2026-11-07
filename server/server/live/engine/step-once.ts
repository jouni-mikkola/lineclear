// One agent per roadmap step: a task titled by a step id ("L461 One agent per step") is refused while another task of
// that step is still open, and when the step has already landed on its base. Each duplicate would hold a slot and
// start an agent that reads the brief and the repo for nothing.
import { git } from './git.ts'

/** The step id a title starts with (one capital letter and a number, then a space, as in the roadmap), or undefined for a plain title. */
export const stepIdOfTitle = (title: string) => /^([A-Z]\d+) /.exec(title)?.[1]

/** Commit messages, newest first, as `doneIds` in src/roadmap.ts reads them: this is its server-side twin. */
interface Commit {
  subject: string
  body: string
}

/** Whether commits mark the step done: subject `<TASK>: <id> ...` or a body line `Step: <id>`; a reverted subject does not count. */
export function landedIn(commits: Commit[], id: string): boolean {
  const reverted = new Map<string, number>()
  for (const c of commits) {
    const undone = /^Revert "(.+)"$/.exec(c.subject)
    if (undone) reverted.set(undone[1]!, (reverted.get(undone[1]!) ?? 0) + 1)
    const left = reverted.get(c.subject) ?? 0
    if (left > 0) {
      reverted.set(c.subject, left - 1)
      continue
    }
    const m = /^[A-Za-z][A-Za-z0-9]*-\d+: (\S+)(?: |$)/.exec(c.subject)
    if (m && m[1] === id) return true
    if (c.body.split('\n').some((l) => /^Step: (\S+)\s*$/.exec(l)?.[1] === id)) return true
  }
  return false
}

/** Why a new task for this title must not start, or undefined. `open` are the titles of the project's tasks not yet ended. */
export function whyStepRefused(title: string, open: { id: string; title: string }[], commits: Commit[]): string | undefined {
  const id = stepIdOfTitle(title)
  if (!id) return undefined
  const twin = open.find((t) => stepIdOfTitle(t.title) === id)
  if (twin) return `${twin.id} is already working on step ${id}: one agent per step. Tell or stop it instead of adding a second task.`
  if (landedIn(commits, id)) return `Step ${id} has landed on its base already: no agent starts for it.`
  return undefined
}

/** The board's claims on steps being started: one process holds them, so two requests at the same instant meet here. */
export class StepClaims {
  private held = new Map<string, string>()
  /** Claims a step of a repo for a task being added; returns the earlier holder's name when it is taken. */
  take(repo: string, step: string, by: string): string | undefined {
    const key = `${repo}#${step}`
    const first = this.held.get(key)
    if (first !== undefined) return first
    this.held.set(key, by)
    return undefined
  }
  release(repo: string, step: string) {
    this.held.delete(`${repo}#${step}`)
  }
}

/** The newest commits of a base (the remote's copy when there is one), for `landedIn`. */
export async function commitsOf(repo: string, base: string): Promise<Commit[]> {
  const remote = await git(repo, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`)
  const r = await git(repo, 'log', '-n', '1000', '--format=%s%x1f%b%x1e', remote.ok ? `refs/remotes/origin/${base}` : base)
  if (!r.ok) return []
  return r.out
    .split('\x1e')
    .filter((x) => x.trim())
    .map((x) => {
      const [subject = '', body = ''] = x.replace(/^\n/, '').split('\x1f')
      return { subject, body }
    })
}
