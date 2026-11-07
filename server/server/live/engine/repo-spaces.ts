// The herdr space of a repo itself, opened only because a task asked for a worktree: noted when it opens, closed again
// with the repo's last task space, unless you have started using it.
import { realpathSync } from '../mfs.ts'
import { readJson, writeJson } from '../../store.ts'
import type { herdr, WorkspaceInfo } from '../herdr.ts'

export type RepoSpacesHerdr = Pick<typeof herdr, 'workspaces' | 'agents' | 'panes' | 'paneIdle' | 'closeWorkspace'>

/** the herdr spaces opened for repos, to close with their last task */
const SPACES = 'repo-spaces.json'

export const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** the repo's own spaces (its checkout, not a linked worktree) among `list` */
export const repoSpaces = (list: WorkspaceInfo[], repo: string) =>
  list.filter((w) => w.worktree && !w.worktree.is_linked_worktree && real(w.worktree.checkout_path) === real(repo))

/** note the repo space herdr opened since `list` was read, so it can be closed again with the repo's last task space */
export async function noteOpened(h: Pick<RepoSpacesHerdr, 'workspaces'>, list: WorkspaceInfo[], repo: string) {
  const before = new Set(repoSpaces(list, repo).map((w) => w.workspace_id))
  const made = repoSpaces(await h.workspaces().catch(() => []), repo).find((w) => !before.has(w.workspace_id))
  if (made) writeJson(SPACES, { ...readJson<Record<string, string>>(SPACES, {}), [real(repo)]: made.workspace_id })
}

/**
 * A repo space herdr opened for a task's worktree closes once no worktree space of the repo is open: unless you are
 * looking at it or have used it (another tab or pane, an agent, a command at work, another folder).
 */
export async function closeRepoSpace(h: RepoSpacesHerdr, repo: string) {
  const id = readJson<Record<string, string>>(SPACES, {})[real(repo)]
  if (!id) return
  const forget = () => {
    const now = readJson<Record<string, string>>(SPACES, {})
    delete now[real(repo)]
    writeJson(SPACES, now)
  }
  const list = await h.workspaces().catch(() => null)
  if (!list) return
  const w = list.find((x) => x.workspace_id === id)
  if (!w?.worktree || w.worktree.is_linked_worktree || real(w.worktree.checkout_path) !== real(repo)) return forget()
  if (list.some((x) => x.worktree?.is_linked_worktree && real(x.worktree.repo_root) === real(repo))) return
  if (w.focused) return
  const [panes, agents] = await Promise.all([h.panes(id), h.agents()]).catch(() => [null, null])
  if (!panes || !agents) return
  const one = panes.length === 1 ? panes[0] : undefined
  const used =
    !one ||
    (w.tab_count ?? 1) > 1 ||
    agents.some((a) => a.pane_id === one.pane_id) ||
    real(one.foreground_cwd ?? one.cwd ?? '') !== real(repo) ||
    !(await h.paneIdle(one.pane_id).catch(() => false))
  if (!used) await h.closeWorkspace(id).catch(() => undefined)
  forget()
}

/** the sweep looks again at repo spaces that could not be closed when their last task ended */
export async function closeRepoSpaces(h: RepoSpacesHerdr) {
  for (const repo of Object.keys(readJson<Record<string, string>>(SPACES, {}))) await closeRepoSpace(h, repo)
}
