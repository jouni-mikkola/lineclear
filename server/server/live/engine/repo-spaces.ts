// The herdr spaces opened for repos only because a task asked for a worktree: noted, and closed with the repo's last task.
import { realpathSync } from '../mfs.ts'
import { readJson, writeJson } from '../../store.ts'
import type { herdr, WorkspaceInfo } from '../herdr.ts'

type Spaces = Pick<typeof herdr, 'workspaces' | 'agents' | 'panes' | 'paneIdle' | 'closeWorkspace'>

export const real = (p: string) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** the herdr spaces opened for repos, to close with their last task */
const SPACES = 'repo-spaces.json'

/** the spaces herdr knows as the repo's own checkout */
export const repoSpaces = (list: WorkspaceInfo[], repo: string) =>
  list.filter((w) => w.worktree && !w.worktree.is_linked_worktree && real(w.worktree.checkout_path) === real(repo))

export function noteRepoSpace(repo: string, workspace: string) {
  writeJson(SPACES, { ...readJson<Record<string, string>>(SPACES, {}), [real(repo)]: workspace })
}

/**
 * A repo space herdr opened for a task's worktree closes once no worktree space of the repo is open: unless you are
 * looking at it or have used it (another tab or pane, an agent, a command at work, another folder).
 */
export async function closeRepoSpace(h: Spaces, repo: string) {
  const all = readJson<Record<string, string>>(SPACES, {})
  const id = all[real(repo)]
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
export async function closeRepoSpaces(h: Spaces) {
  for (const repo of Object.keys(readJson<Record<string, string>>(SPACES, {}))) await closeRepoSpace(h, repo)
}
