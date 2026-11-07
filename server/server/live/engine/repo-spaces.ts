// The herdr spaces opened for a repo because a task asked for a worktree: made with the first worktree, closed again
// with the repo's last task space unless you have started using them.
import { realpathSync } from '../mfs.ts'
import { readJson, writeJson } from '../../store.ts'
import type { WorkspaceInfo, WorktreeFrom, WorktreeSpace } from '../herdr.ts'
import type { HerdrSpaces, Home } from './worktrees.ts'

export const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** the herdr spaces opened for repos, to close with their last task */
const SPACES = 'repo-spaces.json'

export class RepoSpaces {
  constructor(private h: HerdrSpaces) {}

  private repoSpaces(list: WorkspaceInfo[], repo: string) {
    return list.filter((w) => w.worktree && !w.worktree.is_linked_worktree && real(w.worktree.checkout_path) === real(repo))
  }

  /**
   * A herdr worktree create or open, nested under the project's own space (its coordinator's, which herdr then knows
   * as the repo's), else the repo's space herdr knows, else the repo's folder: herdr opens a space for it, which is
   * noted so it can be closed again with the repo's last task space.
   */
  async opening(home: Home, f: (from: WorktreeFrom) => Promise<WorktreeSpace>): Promise<WorktreeSpace> {
    const list = await this.h.workspaces().catch(() => null)
    const own = list?.find(
      (w) => w.label === home.name && (!w.worktree || (!w.worktree.is_linked_worktree && real(w.worktree.checkout_path) === real(home.repo))),
    )
    const known = own ?? (list ? this.repoSpaces(list, home.repo)[0] : undefined)
    if (known) {
      try {
        return await f({ workspace_id: known.workspace_id })
      } catch {
        /* not one herdr takes as the repo's (another folder of the same name): the folder it is */
      }
    }
    const r = await f({ cwd: home.repo })
    if (!list) return r
    const before = new Set(this.repoSpaces(list, home.repo).map((w) => w.workspace_id))
    const made = this.repoSpaces(await this.h.workspaces().catch(() => []), home.repo).find((w) => !before.has(w.workspace_id))
    if (made) writeJson(SPACES, { ...readJson<Record<string, string>>(SPACES, {}), [real(home.repo)]: made.workspace_id })
    return r
  }

  /**
   * A repo space herdr opened for a task's worktree closes once no worktree space of the repo is open: unless you are
   * looking at it or have used it (another tab or pane, an agent, a command at work, another folder).
   */
  async close(repo: string) {
    const all = readJson<Record<string, string>>(SPACES, {})
    const id = all[real(repo)]
    if (!id) return
    const forget = () => {
      const now = readJson<Record<string, string>>(SPACES, {})
      delete now[real(repo)]
      writeJson(SPACES, now)
    }
    const list = await this.h.workspaces().catch(() => null)
    if (!list) return
    const w = list.find((x) => x.workspace_id === id)
    if (!w?.worktree || w.worktree.is_linked_worktree || real(w.worktree.checkout_path) !== real(repo)) return forget()
    if (list.some((x) => x.worktree?.is_linked_worktree && real(x.worktree.repo_root) === real(repo))) return
    if (w.focused) return
    const [panes, agents] = await Promise.all([this.h.panes(id), this.h.agents()]).catch(() => [null, null])
    if (!panes || !agents) return
    const one = panes.length === 1 ? panes[0] : undefined
    const used =
      !one ||
      (w.tab_count ?? 1) > 1 ||
      agents.some((a) => a.pane_id === one.pane_id) ||
      real(one.foreground_cwd ?? one.cwd ?? '') !== real(repo) ||
      !(await this.h.paneIdle(one.pane_id).catch(() => false))
    if (!used) await this.h.closeWorkspace(id).catch(() => undefined)
    forget()
  }

  /** the sweep looks again at repo spaces that could not be closed when their last task ended */
  async closeAll() {
    for (const repo of Object.keys(readJson<Record<string, string>>(SPACES, {}))) await this.close(repo)
  }
}
