// What GitHub says of a repo, read once for every task in it: callers during a read share it, and one younger than they
// ask for is reused, so waiting for checks costs no calls of its own.
import * as GH from './github.ts'

/** ok; down: gh could not read the repo (outage, bad answer); unauthenticated: gh is not logged in to it */
export type RepoState = { state: 'ok' | 'down' | 'unauthenticated'; since: number; said?: string }

interface Read {
  at: number
  prs: Map<number, GH.OpenPr>
}

export class RepoWatch {
  private reads = new Map<string, { done?: Read; going?: Promise<Read> }>()
  private runs = new Map<string, { at: number; runs: GH.BranchRun[] | null; going?: Promise<GH.BranchRun[] | null> }>()
  private states = new Map<string, RepoState>()

  state(key: string): RepoState {
    return this.states.get(key) ?? { state: 'ok', since: 0 }
  }

  mark(key: string, state: RepoState['state'], said?: string) {
    if (this.state(key).state === state && this.states.has(key)) return
    this.states.set(key, { state, said, since: Date.now() })
  }

  /** the repo's open pull requests as GitHub has them, read at most once per `maxAge` ms however many ask; GhDown when unread */
  async read(g: GH.GitHub, cwd: string, maxAge: number): Promise<Read> {
    const key = GH.repoKey(g)
    const e = this.reads.get(key) ?? {}
    this.reads.set(key, e)
    if (e.done && Date.now() - e.done.at <= maxAge) return e.done
    if (!e.going) {
      e.going = GH.openPrs(g, cwd)
        .then((list) => {
          const done = { at: Date.now(), prs: new Map(list.map((o) => [o.pr.number, o])) }
          e.done = done
          this.mark(key, 'ok')
          return done
        })
        .catch((err: unknown) => {
          if (err instanceof GH.GhDown) this.mark(key, 'down', err.message)
          throw err
        })
        .finally(() => {
          e.going = undefined
        })
    }
    return e.going
  }

  /**
   * GitHub's checks on a pull request at `head`: from the shared read, read again once when it is of an older commit.
   * Undefined when the repo's reads can't tell (not among its first 100, or a token that can't read checks): the caller asks gh itself.
   */
  async checks(g: GH.GitHub, cwd: string, n: number, head: string, maxAge: number): Promise<GH.PrChecks | undefined> {
    let found = (await this.read(g, cwd, maxAge)).prs.get(n)
    if (found && found.pr.headRefOid !== head) found = (await this.read(g, cwd, 0)).prs.get(n)
    return found?.pr.headRefOid === head ? found.checks : undefined
  }

  /** a branch's runs, read at most once per `maxAge` ms however many ask */
  async branchRuns(g: GH.GitHub, cwd: string, branch: string, maxAge: number): Promise<GH.BranchRun[] | null> {
    const key = `${GH.repoKey(g)}#${branch}`
    const e = this.runs.get(key) ?? { at: 0, runs: null }
    this.runs.set(key, e)
    if (e.runs && Date.now() - e.at <= maxAge) return e.runs
    e.going ??= GH.branchRuns(g, cwd, branch)
      .then((runs) => {
        e.runs = runs
        e.at = Date.now()
        this.mark(GH.repoKey(g), 'ok')
        return runs
      })
      .catch((err: unknown) => {
        if (err instanceof GH.GhDown) this.mark(GH.repoKey(g), 'down', err.message)
        throw err
      })
      .finally(() => {
        e.going = undefined
      })
    return e.going
  }
}
