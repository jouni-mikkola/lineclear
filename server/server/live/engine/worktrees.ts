// A task's place in herdr, as herdr-projects keeps it: a worktree workspace nested under its project's own space in
// herdr's sidebar, made, opened again and removed through herdr's worktree API. Putting it away never loses work: a
// checkout with uncommitted changes, or a branch with work main lacks, is kept and said so, and nothing is forced. A
// repo space herdr opened only because a task asked for a worktree is closed again with the repo's last task space,
// unless you have started using it.
import { boxHome } from '../box.ts'
import { existsSync } from '../mfs.ts'
import { herdr, type WorkspaceInfo, type WorktreeSpace } from '../herdr.ts'
import * as G from './git.ts'
import * as I from './install.ts'
import * as GH from './github.ts'
import { remoteBranch } from './branch-work.ts'
import { idleShells, busy } from './space-panes.ts'
import { real, RepoSpaces } from './repo-spaces.ts'

/** what this asks of herdr; tests give a stand-in */
export type HerdrSpaces = Pick<
  typeof herdr,
  'workspaces' | 'agents' | 'panes' | 'tabs' | 'paneIdle' | 'worktreeCreate' | 'worktreeOpen' | 'worktreeRemove' | 'createTab' | 'closePane' | 'closeWorkspace'
>

/** a worktree herdr just made (or opened): its folder, its workspace and the shell herdr opened in a new one */
export interface Made {
  path: string
  workspace: string
  root?: string
  /** how long its install step took, in ms */
  installMs?: number
}

/** where a task's worktree belongs: its project's repo, and the name of the project's own space (its coordinator's) */
export interface Home {
  repo: string
  name: string
  /** the project's install step for a new worktree (git.ts install); left out: the default */
  install?: string
}

export interface PutAway {
  /** what was kept, and why, in words: "~/x (uncommitted changes)" */
  kept: string[]
  /** something still runs in its space (or herdr didn't answer): nothing was touched, try again later */
  busy?: boolean
}

const tilde = (p: string) => (p.startsWith(boxHome()) ? `~${p.slice(boxHome().length)}` : p)

export class Worktrees {
  private spaces: RepoSpaces

  constructor(private h: HerdrSpaces = herdr) {
    this.spaces = new RepoSpaces(h)
  }

  private made(r: WorktreeSpace, path?: string): Made {
    const at = path ?? r.worktree?.path ?? r.workspace.worktree?.checkout_path
    if (!at) throw new Error('herdr made no worktree')
    return { path: at, workspace: r.workspace.workspace_id, root: r.already_open ? undefined : r.root_pane.pane_id }
  }

  /**
   * A new worktree for a task on its branch from `base`, .worktreeinclude's files copied in; path: where (herdr picks
   * when left out). One its branch is checked out in already (a start herdr finished but whose answer was lost) is
   * opened instead.
   */
  async create(home: Home, branch: string, base: string, label: string, path?: string): Promise<Made> {
    const open = async () => {
      const at = await G.worktreeOf(home.repo, branch)
      return at && existsSync(at) ? this.made(await this.spaces.opening(home, (from) => this.h.worktreeOpen(from, at, label)), at) : undefined
    }
    const was = await open()
    if (was) return this.installed(home, was)
    const from = (await remoteBranch(home.repo, branch)) ?? (await GH.startPoint(home.repo, base))
    let r: WorktreeSpace
    try {
      r = await this.spaces.opening(home, (src) => this.h.worktreeCreate(src, branch, from, label, path))
    } catch (e) {
      const late = await open()
      if (late) return this.installed(home, late)
      throw e
    }
    const made = this.made(r)
    await I.copyIncludes(home.repo, made.path)
    return this.installed(home, made)
  }

  /** its install step has run (a failure throws; the worktree stays, and the next start runs the step again) */
  private async installed(home: Home, made: Made) {
    const t0 = Date.now()
    await I.install(made.path, home.install)
    made.installMs = Date.now() - t0
    return made
  }

  /** the task's space: its herdr worktree workspace, or the plain one by its label (a task started before) */
  async spaceOf(wt: string | undefined, label: string, list?: WorkspaceInfo[]) {
    const all = list ?? (await this.h.workspaces())
    return (
      (wt ? all.find((w) => w.worktree?.is_linked_worktree && real(w.worktree.checkout_path) === real(wt)) : undefined) ??
      all.find((w) => !w.worktree && w.label === label)
    )
  }

  /**
   * A pane for the task's agent, in a tab of its own that has the agent's environment (herdr's worktree commands take
   * none): in the space just made, in its space as it is, or in its space opened again from the worktree through
   * herdr. The shell herdr opened a new space with is closed.
   */
  async agentPane(o: { home: Home; wt: string; label: string; tab: string; env: Record<string, string>; made?: Made }) {
    let ws: string
    let root: string | undefined
    if (o.made) ({ workspace: ws, root } = o.made)
    else {
      const open = await this.spaceOf(o.wt, o.label)
      if (open) ws = open.workspace_id
      else ({ workspace: ws, root } = this.made(await this.spaces.opening(o.home, (from) => this.h.worktreeOpen(from, o.wt, o.label)), o.wt))
    }
    // the idle shells of the space's agent tabs, with no agent in them (its agent's CLI exited, or herdr restored them after
    // a restart, one more each time), are left behind by the new agent's tab: they are closed, never kept as extra panes for
    // one worktree. A tab of another name is the human's own, and stays.
    const shells = root ? [root] : await idleShells(this.h, ws, o.wt, o.tab)
    const pane = (await this.h.createTab(ws, o.tab, o.wt, o.env)).root_pane.pane_id
    for (const old of shells) await this.h.closePane(old).catch(() => undefined)
    return pane
  }

  /**
   * Put a task's place away: its worktree removed through herdr (which closes its space and the agent's pane with
   * it), its agent closed and its branch deleted, each only when that loses nothing. A checkout with uncommitted
   * changes, or a branch with work `base` lacks, is kept and said so; its space and agent close all the same, and
   * writing to the task opens it again. A space where something else still runs, or a herdr that doesn't answer,
   * leaves everything as it is for a later try. squashes: a merged task's squash merges into `base`, which a branch
   * with nothing after them is in, however `base` moved on since.
   */
  async putAway(o: {
    repo: string
    wt?: string
    branch?: string
    base: string
    squashes?: string[]
    label: string
    agentPane?: string
    closeAgent: () => Promise<unknown>
  }): Promise<PutAway> {
    const where = o.wt ? tilde(o.wt) : `${o.label}'s space`
    let space: WorkspaceInfo | undefined
    try {
      space = await this.spaceOf(o.wt, o.label)
    } catch {
      return { kept: [`${where} (herdr does not answer)`], busy: true }
    }
    if (space && (await busy(this.h, space.workspace_id, o.agentPane))) return { kept: [`${where} (something still runs in its herdr space)`], busy: true }
    const there = !!o.wt && existsSync(o.wt)
    const branch = !!o.branch && (await G.branchExists(o.repo, o.branch))
    let kept = await this.holds(o)
    // committed work main lacks is kept by its branch alone: the folder (with its installed packages) goes, so done
    // tasks do not fill the disk; writing to the task makes its worktree again from the branch
    const wt = o.wt ?? ''
    const committedOnly = there && kept.length > 0 && !(await G.dirty(wt))
    if (committedOnly) kept = await this.holds({ ...o, wt: undefined })
    if (there && !kept.length) {
      const err = await this.dropFolder(o.repo, wt, space)
      if (err) kept.push(`${where} (${err})`)
    }
    await o.closeAgent()
    space = await this.spaceOf(o.wt, o.label).catch(() => undefined)
    if (space) await this.h.closeWorkspace(space.workspace_id).catch(() => undefined)
    await G.git(o.repo, 'worktree', 'prune')
    if (committedOnly) {
      const err = await this.dropFolder(o.repo, wt, space)
      if (err) kept = [`${where} (${err})`]
    }
    if (branch && !kept.length) {
      const d = await G.git(o.repo, 'branch', '-D', o.branch!)
      if (!d.ok) kept.push(`branch ${o.branch} (${d.err.split('\n')[0]})`)
    }
    await this.spaces.close(o.repo)
    return { kept }
  }

  /** remove a worktree folder through herdr, else git (never forced); why it stays, or undefined once it is gone */
  private async dropFolder(repo: string, wt: string, space: WorkspaceInfo | undefined): Promise<string | undefined> {
    if (space?.worktree) await this.h.worktreeRemove(space.workspace_id).catch(() => undefined)
    if (!existsSync(wt)) return undefined
    const r = await G.removeWorktree(repo, wt)
    return r.ok ? undefined : (r.err || r.out).split('\n')[0] || 'git could not remove it'
  }

  /** what a task's place holds that main lacks, in words ("~/x (uncommitted changes)"); none: it loses nothing */
  async holds(o: { repo: string; wt?: string; branch?: string; base: string; squashes?: string[] }): Promise<string[]> {
    const there = !!o.wt && existsSync(o.wt)
    const branch = !!o.branch && (await G.branchExists(o.repo, o.branch))
    const unsaved = there && (await G.dirty(o.wt!))
    const unmerged = branch && !(await G.landed(o.repo, o.branch!, o.base, o.squashes))
    if (!unsaved && !unmerged) return []
    const why = [unsaved && 'uncommitted changes', unmerged && `work on ${o.branch} that ${o.base} lacks`].filter(Boolean).join(', ')
    return [there ? `${tilde(o.wt!)} (${why})` : `branch ${o.branch} (${why})`]
  }

  /**
   * Remove a deleted task's place for good, its agent closed already: its worktree removed (forced: whatever it held
   * was checked first, or you said --force), its space closed and its branch deleted. Whatever else runs in its space
   * goes with it. Returns what could not be removed.
   */
  async remove(o: { repo: string; wt?: string; branch?: string; label: string }): Promise<string[]> {
    const left: string[] = []
    const space = await this.spaceOf(o.wt, o.label).catch(() => undefined)
    if (o.wt && existsSync(o.wt)) {
      if (space?.worktree) await this.h.worktreeRemove(space.workspace_id, true).catch(() => undefined)
      if (existsSync(o.wt)) {
        const r = await G.removeWorktree(o.repo, o.wt, true)
        if (!r.ok && existsSync(o.wt)) left.push(`${tilde(o.wt)} (${(r.err || r.out).split('\n')[0] || 'git could not remove it'})`)
      }
    }
    const still = await this.spaceOf(o.wt, o.label).catch(() => undefined)
    if (still) await this.h.closeWorkspace(still.workspace_id).catch(() => undefined)
    await G.git(o.repo, 'worktree', 'prune')
    if (o.branch && (await G.branchExists(o.repo, o.branch))) {
      const d = await G.git(o.repo, 'branch', '-D', o.branch)
      if (!d.ok) left.push(`branch ${o.branch} (${d.err.split('\n')[0]})`)
    }
    await this.spaces.close(o.repo)
    return left
  }

  closeRepoSpaces() {
    return this.spaces.closeAll()
  }

  workspaces() {
    return this.h.workspaces()
  }
}
