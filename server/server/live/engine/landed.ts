// Whether a branch's work is in the base already, however the base moved on since.
import { git } from './git.ts'

/** merging `ref` into commit `into` makes exactly commit `is`'s tree */
async function mergesTo(repo: string, into: string, ref: string, is: string) {
  const m = await git(repo, 'merge-tree', '--write-tree', into, ref)
  const b = await git(repo, 'rev-parse', `${is}^{tree}`)
  return m.ok && b.ok && m.out.split('\n')[0] === b.out
}

/** merging `ref` into `base` goes through without a conflict: what GitHub calls mergeable */
export const mergesCleanly = async (repo: string, base: string, ref: string) => (await git(repo, 'merge-tree', '--write-tree', base, ref)).ok

/** the commits on `base` a task's squash merge made: by Lineclear's subject, "<id>: <title>" */
export async function squashesOf(repo: string, base: string, id: string) {
  const r = await git(repo, 'log', '--format=%H %s', '-n', '5000', base)
  return r.ok
    ? r.out
        .split('\n')
        .filter((l) => l.slice(41).startsWith(`${id}: `))
        .map((l) => l.slice(0, 40))
    : []
}

/**
 * Everything on `ref` is in `base` already: its exact tree is one `base` had (a squash merge of the rebased branch
 * makes that commit; a branch with no work has its starting point's), squash-merging it now onto the parent of one of
 * `squashes` (its task's squash merges into `base`) makes that very commit, so nothing came after the merge (not even
 * a commit undoing part of it), however main has moved on since, or merging it into `base` would change nothing.
 */
export async function landed(repo: string, ref: string, base: string, squashes: string[] = []) {
  const tree = await git(repo, 'rev-parse', '--verify', '--quiet', `${ref}^{tree}`)
  if (!tree.ok) return false
  const trees = await git(repo, 'log', '--format=%T', '-n', '5000', base)
  if (trees.ok && trees.out.split('\n').includes(tree.out)) return true
  for (const s of squashes) {
    if (!(await git(repo, 'merge-base', '--is-ancestor', s, base)).ok) continue
    if (await mergesTo(repo, `${s}^`, ref, s)) return true
  }
  return mergesTo(repo, base, ref, base)
}
