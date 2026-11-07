// A task's place: a git worktree made and removed by git alone, so a done task's folder goes even when herdr is down.
// Putting it away never loses work: a checkout with uncommitted changes, or a branch with work main lacks, is kept and
// said so, and nothing is forced.
import { basename, join } from 'node:path'
import { boxHome, remoteBox } from '../box.ts'
import { exists } from '../mfs.ts'
import * as G from './git.ts'
import * as I from './install.ts'
import * as GH from './github.ts'
import { remoteBranch } from './branch-work.ts'

/** a worktree just made (or found): its folder, and how long its install step took, in ms */
export interface Made {
  path: string
  installMs?: number
}

/** where a task's worktree belongs: its project's repo and the project's install step (git.ts install; left out: the default) */
export interface Home {
  repo: string
  install?: string
}

export interface PutAway {
  /** what was kept, and why, in words: "~/x (uncommitted changes)" */
  kept: string[]
}

const tilde = (p: string) => (p.startsWith(boxHome()) ? `~${p.slice(boxHome().length)}` : p)
/** where new worktrees go: the LINECLEAR_WORKTREES folder here (tests), else .herdr/worktrees in the machine's home */
const worktreesRoot = () => (!remoteBox() && process.env.LINECLEAR_WORKTREES) || join(boxHome(), '.herdr', 'worktrees')
const firstLine = (r: { err: string; out: string }) => (r.err || r.out).split('\n')[0] || 'git could not remove it'

export class Worktrees {
  /**
   * A new worktree for a task on its branch from `base`, .worktreeinclude's files copied in; path: where (under
   * worktreesRoot when left out). One its branch is checked out in already (a start whose answer was lost) is used.
   */
  async create(home: Home, branch: string, base: string, path?: string): Promise<Made> {
    await G.git(home.repo, 'worktree', 'prune')
    const was = await G.worktreeOf(home.repo, branch)
    if (was) return this.installed(home, { path: was })
    const at = path ?? join(worktreesRoot(), basename(home.repo), branch.replace(/\//g, '-'))
    const from = (await remoteBranch(home.repo, branch)) ?? (await GH.startPoint(home.repo, base))
    const have = await G.branchExists(home.repo, branch)
    const add = await G.git(home.repo, 'worktree', 'add', ...(have ? [at, branch] : ['-b', branch, at, from]))
    if (!add.ok) throw new Error(add.err.split('\n')[0] || 'git could not add the worktree')
    await I.copyIncludes(home.repo, at)
    return this.installed(home, { path: at })
  }

  /** its install step has run (a failure throws; the worktree stays, and the next start runs the step again) */
  private async installed(home: Home, made: Made) {
    const t0 = Date.now()
    await I.install(made.path, home.install)
    made.installMs = Date.now() - t0
    return made
  }

  /**
   * Put a task's place away: its agent closed, its worktree removed and its branch deleted, each only when that loses
   * nothing. A checkout with uncommitted changes, or a branch with work `base` lacks, is kept and said so; committed
   * work is kept by its branch alone, so the folder (with its installed packages) goes. squashes: a merged task's squash
   * merges into `base`, which a branch with nothing after them is in, however `base` moved on since.
   */
  async putAway(o: { repo: string; wt?: string; branch?: string; base: string; squashes?: string[]; closeAgent: () => Promise<unknown> }): Promise<PutAway> {
    const where = o.wt ? tilde(o.wt) : `branch ${o.branch}`
    const there = !!o.wt && (await exists(o.wt))
    let kept = await this.holds(o)
    const committedOnly = there && kept.length > 0 && !(await G.dirty(o.wt!))
    if (committedOnly) kept = await this.holds({ ...o, wt: undefined })
    await o.closeAgent()
    if (there && (committedOnly || !kept.length)) {
      const err = await this.drop(o.repo, o.wt!)
      if (err) kept = [`${where} (${err})`]
    }
    await G.git(o.repo, 'worktree', 'prune')
    if (o.branch && !kept.length && (await G.branchExists(o.repo, o.branch))) {
      const d = await G.git(o.repo, 'branch', '-D', o.branch)
      if (!d.ok) kept.push(`branch ${o.branch} (${d.err.split('\n')[0]})`)
    }
    return { kept }
  }

  /** remove a worktree folder by git; why it stays, or undefined once it is gone */
  private async drop(repo: string, wt: string, force = false): Promise<string | undefined> {
    const r = await G.removeWorktree(repo, wt, force)
    return r.ok || !(await exists(wt)) ? undefined : firstLine(r)
  }

  /** what a task's place holds that main lacks, in words ("~/x (uncommitted changes)"); none: it loses nothing */
  async holds(o: { repo: string; wt?: string; branch?: string; base: string; squashes?: string[] }): Promise<string[]> {
    const there = !!o.wt && (await exists(o.wt))
    const branch = !!o.branch && (await G.branchExists(o.repo, o.branch))
    const unsaved = there && (await G.dirty(o.wt!))
    const unmerged = branch && !(await G.landed(o.repo, o.branch!, o.base, o.squashes))
    if (!unsaved && !unmerged) return []
    const why = [unsaved && 'uncommitted changes', unmerged && `work on ${o.branch} that ${o.base} lacks`].filter(Boolean).join(', ')
    return [there ? `${tilde(o.wt!)} (${why})` : `branch ${o.branch} (${why})`]
  }

  /**
   * Remove a deleted task's place for good, its agent closed already: its worktree removed (forced: whatever it held
   * was checked first, or you said --force) and its branch deleted. Returns what could not be removed.
   */
  async remove(o: { repo: string; wt?: string; branch?: string }): Promise<string[]> {
    const left: string[] = []
    if (o.wt && (await exists(o.wt))) {
      const err = await this.drop(o.repo, o.wt, true)
      if (err) left.push(`${tilde(o.wt)} (${err})`)
    }
    await G.git(o.repo, 'worktree', 'prune')
    if (o.branch && (await G.branchExists(o.repo, o.branch))) {
      const d = await G.git(o.repo, 'branch', '-D', o.branch)
      if (!d.ok) left.push(`branch ${o.branch} (${d.err.split('\n')[0]})`)
    }
    return left
  }
}
