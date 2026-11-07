// The rule loop's decision log and the watch on a red main.
import { addDecisions } from '../../../../src/decisions-store.ts'

/** a row of the decisions table, where the rule loop logs its choices */
export function decide(step: string, kind: string, reason: string) {
  addDecisions(process.env, [{ time: new Date().toISOString(), project: '-', step, kind, reason }])
}

/** the newest finished check.yml run on main */
export interface MainRun {
  sha: string
  conclusion: string
}

export interface RedMainActions {
  /** puts a revert commit of the sha on main; false when it could not */
  revert: (sha: string) => Promise<boolean>
  /** opens a task to fix what the sha broke */
  fixTask: (sha: string, reverted: boolean) => Promise<void>
}

/** A red main is reverted and gets a fix task once per commit; a failed attempt is tried again on the next look. */
export class RedMainWatch {
  private handled = new Set<string>()

  async look(run: MainRun | undefined, act: RedMainActions): Promise<'reverted' | 'task only' | undefined> {
    if (run?.conclusion !== 'failure' || this.handled.has(run.sha)) return undefined
    this.handled.add(run.sha)
    const reverted = await act.revert(run.sha).catch(() => false)
    await act.fixTask(run.sha, reverted)
    decide('main-green', 'revert', `${run.sha.slice(0, 7)} turned main red: ${reverted ? 'reverted' : 'revert failed'}, fix task opened`)
    return reverted ? 'reverted' : 'task only'
  }
}
