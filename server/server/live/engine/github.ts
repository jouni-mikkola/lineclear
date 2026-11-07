import { branchExists, git, sh } from './git.ts'

/**
 * gh and the repo's host: logged in ("yes"), not logged in there or no gh at all ("no"), or logged in but not answering
 * now ("down": an outage, a proxy away, a lapsed token), which is never taken as "no".
 */
export async function ghLogin(g: GitHub, cwd: string): Promise<{ state: 'yes' | 'no' | 'down'; said?: string }> {
  const r = await gh(g, cwd, 'auth', 'status', '--hostname', g.host).catch(() => null)
  if (!r || r.code === 127) return { state: 'no' }
  if (r.ok) return { state: 'yes' }
  const said = `${r.out}\n${r.err}`
  if (/not logged in/i.test(said)) return { state: 'no' }
  return {
    state: 'down',
    said:
      said
        .split('\n')
        .map((l) => l.trim().replace(/^[-X✓] /, ''))
        .find((l) => /invalid|fail|error|timeout|could not/i.test(l)) ?? said.trim().split('\n')[0],
  }
}

/** gh answered, but not with what GitHub's API gives: GitHub is down for now, never "no pull request" or "no runs" */
export class GhDown extends Error {}

export function parseJson<T>(out: string, empty: string): T {
  try {
    return JSON.parse(out.trim() || empty) as T
  } catch {
    throw new GhDown('GitHub answered with something unreadable')
  }
}

export interface Pr {
  number: number
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  /** the commit the pull request is at */
  headRefOid: string
  baseRefName: string
}

const PR_FIELDS = 'number,url,state,isDraft,headRefOid,baseRefName'

/** the branch's pull request: its open one, else one merged already */
export async function findPr(g: GitHub, cwd: string, branch: string): Promise<Pr | null> {
  const r = await gh(g, cwd, 'pr', 'list', ...R(g), '--head', branch, '--state', 'all', '--json', PR_FIELDS, '--limit', '10')
  // a list gh could not read is not an empty one: no pull request would open a second
  if (!r.ok) throw new GhDown((r.err || r.out || `gh exited ${r.code}`).split('\n')[0])
  const list = parseJson<Pr[]>(r.out, '[]')
  return list.find((p) => p.state === 'OPEN') ?? list.find((p) => p.state === 'MERGED') ?? null
}

export async function viewPr(g: GitHub, cwd: string, n: number): Promise<Pr | null> {
  const r = await gh(g, cwd, 'pr', 'view', String(n), ...R(g), '--json', PR_FIELDS)
  return r.ok ? parseJson<Pr>(r.out, 'null') : null
}

/** open a pull request from the branch (pushed already); its number and link, or gh's words */
export async function openPr(
  g: GitHub,
  cwd: string,
  o: { branch: string; base: string; title: string; body: string; draft: boolean },
): Promise<{ number: number; url: string } | { error: string }> {
  const r = await gh(
    g,
    cwd,
    'pr',
    'create',
    ...R(g),
    '--head',
    o.branch,
    '--base',
    o.base,
    '--title',
    o.title,
    '--body',
    o.body,
    ...(o.draft ? ['--draft'] : []),
  )
  const m = r.out.match(/https?:\/\/\S+\/pull\/(\d+)/)
  return m ? { number: Number(m[1]), url: m[0] } : { error: (r.err || r.out || `gh exited ${r.code}`).split('\n')[0] }
}

export const editPr = (g: GitHub, cwd: string, n: number, body: string) => gh(g, cwd, 'pr', 'edit', String(n), ...R(g), '--body', body)

export const closePr = (g: GitHub, cwd: string, n: number, comment: string) => gh(g, cwd, 'pr', 'close', String(n), ...R(g), '--comment', comment)

export const readyPr = (g: GitHub, cwd: string, n: number) => gh(g, cwd, 'pr', 'ready', String(n), ...R(g))

export type PrChecks = {
  state: 'pending' | 'pass' | 'fail' | 'none' | 'error'
  passed: number
  failed: { name: string; link?: string; tests?: string[] }[]
  error?: string
}

/** a check as gh pr checks buckets it: pass, fail, pending, skipping or cancel */
export type Check = { name: string; bucket: string; link?: string }

/** gh was refused GitHub's checks: a fine-grained token can't read them on a private repo (it can read Actions) */
export const noChecksAccess = (said: string) => /not accessible by personal access token/i.test(said)

/**
 * The jobs GitHub Actions ran on a commit, read through the Actions API, for a token that may read Actions but not
 * checks; null when GitHub did not answer.
 */
async function actionJobs(g: GitHub, cwd: string, sha: string): Promise<Check[] | null> {
  const runs = await gh(g, cwd, 'api', '--paginate', '--jq', '.workflow_runs[].id', `repos/${g.repo}/actions/runs?head_sha=${sha}&per_page=100`)
  if (!runs.ok) return null
  const jobs = await Promise.all(
    runs.out
      .split('\n')
      .filter(Boolean)
      .map((id) =>
        gh(g, cwd, 'api', '--paginate', '--jq', '.jobs[] | {name, status, conclusion, html_url}', `repos/${g.repo}/actions/runs/${id}/jobs?per_page=100`),
      ),
  )
  if (jobs.some((r) => !r.ok)) return null
  try {
    return jobs
      .flatMap((r) => r.out.split('\n').filter(Boolean))
      .map((l) => JSON.parse(l) as { name: string; status: string; conclusion: string | null; html_url: string })
      .map((j) => ({ name: j.name, link: j.html_url, bucket: j.status !== 'completed' ? 'pending' : (JOB[j.conclusion ?? ''] ?? 'fail') }))
  } catch {
    return null
  }
}
export const JOB: Record<string, string> = { success: 'pass', neutral: 'pass', skipped: 'skipping', cancelled: 'cancel' }

/** GitHub's checks on a pull request. "none" only when GitHub answered with no checks; anything unread is "error". */
export async function prChecks(g: GitHub, cwd: string, n: number): Promise<PrChecks> {
  const r = await gh(g, cwd, 'pr', 'checks', String(n), ...R(g), '--json', 'name,bucket,link')
  const out = r.out.trim()
  let list: Check[] | null = null
  if (!out.startsWith('[')) {
    // gh says "no checks reported" (and exits 1) when a branch simply has none
    if (/no checks reported/i.test(`${r.out}\n${r.err}`)) return { state: 'none', passed: 0, failed: [] }
    const pr = noChecksAccess(`${r.out}\n${r.err}`) ? await viewPr(g, cwd, n) : null
    list = pr && (await actionJobs(g, cwd, pr.headRefOid))
    if (!list) return { state: 'error', passed: 0, failed: [], error: (r.err || r.out || `gh exited ${r.code}`).split('\n')[0] }
  }
  try {
    list ??= JSON.parse(out) as Check[]
  } catch {
    return { state: 'error', passed: 0, failed: [], error: 'GitHub answered with something unreadable' }
  }
  return summarize(list)
}

export function summarize(list: Check[]): PrChecks {
  if (!list.length) return { state: 'none', passed: 0, failed: [] }
  const failed = list.filter((c) => c.bucket === 'fail' || c.bucket === 'cancel').map((c) => ({ name: c.name, link: c.link || undefined }))
  const pending = list.some((c) => c.bucket === 'pending')
  const passed = list.filter((c) => c.bucket === 'pass').length
  return { state: failed.length ? 'fail' : pending ? 'pending' : 'pass', passed, failed }
}

/** how long GitHub's checks on pull requests take (ms): the middle of the last few runs that passed; none when unknown */
export async function checksTook(g: GitHub, cwd: string): Promise<number | undefined> {
  const r = await gh(
    g,
    cwd,
    'api',
    '--jq',
    '.workflow_runs[] | [.run_started_at, .updated_at]',
    `repos/${g.repo}/actions/runs?event=pull_request&status=success&per_page=5`,
  )
  if (!r.ok) return undefined
  const took = r.out
    .split('\n')
    .map((l) => {
      try {
        const [a, b] = JSON.parse(l) as [string, string]
        return Date.parse(b) - Date.parse(a)
      } catch {
        return Number.NaN
      }
    })
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b)
  return took.length ? took[Math.floor(took.length / 2)] : undefined
}

/** GitHub squash-merges the pull request only while its head is still `sha`, the commit this machine has */
export const mergePr = (g: GitHub, cwd: string, n: number, sha: string, subject: string, body: string) =>
  gh(g, cwd, 'pr', 'merge', String(n), ...R(g), '--squash', '--match-head-commit', sha, '--subject', subject, '--body', body)

/** the repo has GitHub Actions workflows at this commit that run on pull requests: a pull request of it gets checks,
 *  even before they show */
export async function hasPrWorkflows(wt: string) {
  const r = await git(wt, 'ls-tree', '--name-only', 'HEAD', '.github/workflows/')
  if (!r.ok) return false
  for (const f of r.out.split('\n').filter((f) => /\.ya?ml$/.test(f))) {
    const y = await git(wt, 'show', `HEAD:${f}`)
    // on: pull_request, on: [push, pull_request], or a pull_request: key under on:
    if (y.ok && /^\s*(?:on:.*\bpull_request|-?\s*pull_request(?:_target)?\b)/m.test(y.out)) return true
  }
  return false
}

/** a commit's runs of GitHub Actions on a branch, as one verdict: all passed, one failed, or some still run */
/** the workflow the branch rules require; only its result holds merges */
const REQUIRED_WORKFLOW = 'check'

export type BranchRun = {
  sha: string
  state: 'pass' | 'fail' | 'pending'
  /** the same verdict from the required workflow alone; pending when it has no finished run */
  required: 'pass' | 'fail' | 'pending'
  failed: { name: string; link: string }[]
}

/**
 * The verdicts of GitHub Actions' runs on pushes to a branch, its newest commit first; null when GitHub did not
 * answer. A run cancelled (a newer push took its place) counts for nothing: a commit with only those is left out.
 */
export async function branchRuns(g: GitHub, cwd: string, branch: string, limit = 30): Promise<BranchRun[] | null> {
  const r = await gh(
    g,
    cwd,
    'run',
    'list',
    ...R(g),
    '--branch',
    branch,
    '--event',
    'push',
    '--limit',
    String(limit),
    '--json',
    'headSha,status,conclusion,url,workflowName',
  )
  if (!r.ok) return null
  const runs = parseJson<{ headSha: string; status: string; conclusion: string; url: string; workflowName: string }[]>(r.out, '[]')
  const out: BranchRun[] = []
  for (const sha of [...new Set(runs.map((x) => x.headSha))]) {
    const of = runs.filter((x) => x.headSha === sha && x.conclusion !== 'cancelled')
    if (!of.length) continue
    const failed = of
      .filter((x) => x.status === 'completed' && !['success', 'neutral', 'skipped'].includes(x.conclusion))
      .map((x) => ({ name: x.workflowName, link: x.url }))
    const need = of.filter((x) => x.workflowName.toLowerCase() === REQUIRED_WORKFLOW)
    const required = need.some((x) => x.status === 'completed' && !['success', 'neutral', 'skipped'].includes(x.conclusion))
      ? 'fail'
      : need.length && need.every((x) => x.status === 'completed')
        ? 'pass'
        : 'pending'
    out.push({ sha, failed, required, state: failed.length ? 'fail' : of.some((x) => x.status !== 'completed') ? 'pending' : 'pass' })
  }
  return out
}

/** the repo's key for sharing what is read of it */
export const repoKey = (g: GitHub) => `${g.host}/${g.repo}`

const PERMISSION_TTL_MS = 60 * 60_000
const RATE_LIMIT_BACKOFF_MS = 10 * 60_000
const permissions = new Map<string, { at: number; ok: boolean; backoff?: boolean }>()

/** for tests: every fake GitHub repo shares one name, so an answer kept for it must not outlive its test */
export function forgetWritePermissions() {
  permissions.clear()
}

/**
 * Write permission on the GitHub repo, from the REST API (its own, larger limit; GraphQL's secondary limit failed every
 * task add). Read once an hour per repo. On a rate limit the last answer, or yes, holds for a while: the push itself
 * still fails when the permission is really missing.
 */
async function canWrite(g: GitHub, repo: string): Promise<boolean> {
  const now = Date.now()
  const key = `${g.host}/${g.repo}`
  const known = permissions.get(key)
  if (known && now - known.at < (known.backoff ? RATE_LIMIT_BACKOFF_MS : PERMISSION_TTL_MS)) return known.ok
  const r = await gh(g, repo, 'api', `repos/${g.repo}`, '--jq', '.permissions | (.push or .maintain or .admin)')
  if (!r.ok && /rate limit|abuse|secondary|HTTP 429/i.test(`${r.err}\n${r.out}`)) {
    const ok = known?.ok ?? true
    permissions.set(key, { at: now, ok, backoff: true })
    return ok
  }
  const ok = r.ok && r.out.trim() === 'true'
  permissions.set(key, { at: now, ok })
  return ok
}

/** Check a named destination before a task gets a worktree. Never change origin/HEAD. */
export async function validateBase(repo: string, base: string) {
  if (!base || base.startsWith('-') || !(await git(repo, 'check-ref-format', `refs/heads/${base}`)).ok)
    throw new Error('Choose a branch name, like main, develop or feature/login.')
  const common = await git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (!common.ok || !(await sh(['test', '-w', common.out], repo)).ok) throw new Error('No permission to write to this repository.')
  const remote = (await git(repo, 'remote', 'get-url', 'origin')).ok
  if (remote) {
    const fetched = await git(repo, 'fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`)
    if (!fetched.ok) throw new Error(`Cannot fetch branch ${base} from origin: ${(fetched.err || fetched.out).split('\n')[0]}`)
    const g = await github(repo)
    if (g) {
      if (!(await canWrite(g, repo))) throw new Error(`Cannot confirm permission to merge into ${base} on GitHub. Sign in with repository write access first.`)
    } else {
      const r = await git(repo, 'push', '--dry-run', 'origin', `refs/remotes/origin/${base}:refs/heads/${base}`)
      if (!r.ok) throw new Error(`Cannot confirm permission to push ${base} to origin: ${(r.err || r.out).split('\n')[0]}`)
    }
  } else if (!(await branchExists(repo, base))) throw new Error(`No local branch ${base}.`)
}

/** a GitHub repo as gh reaches it: owner/name, and the host gh is logged in to for it (github.com, github.localhost) */
export interface GitHub {
  repo: string
  host: string
}

/** host and owner/name of a remote URL in any form git takes: https://host/o/r(.git), ssh://git@host/o/r, git@host:o/r */
function parseRemote(url: string): GitHub | null {
  const m = url.trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/i)
  return m && /github/i.test(m[1]) ? { host: m[1].toLowerCase(), repo: m[2] } : null
}

/**
 * The repo's GitHub remote, read live (a repo may gain one after it was added): origin as written, and as git rewrites
 * it (url.insteadOf), so github.com mapped to github.localhost is found either way. gh talks to the host git really
 * reaches when that is a GitHub one, else to the one written.
 */
export async function github(repo: string): Promise<GitHub | null> {
  return (await githubs(repo))[0] ?? null
}

/** each GitHub repo origin may be: as git rewrites it first, then as written */
export async function githubs(repo: string): Promise<GitHub[]> {
  const [written, used] = await Promise.all([git(repo, 'config', '--get', 'remote.origin.url'), git(repo, 'remote', 'get-url', 'origin')])
  const all = [used.ok ? parseRemote(used.out) : null, written.ok ? parseRemote(written.out) : null].filter((g): g is GitHub => !!g)
  return all.filter((g, i) => all.findIndex((x) => x.host === g.host && x.repo === g.repo) === i)
}

export async function githubRemote(repo: string): Promise<string | null> {
  return (await github(repo))?.repo ?? null
}

/** the commit a task's branch starts from: the remote's base when there is one (fetched first), else the local one.
 *  A commit, not a remote-tracking ref, so no upstream is written into the repo's shared config. */
export async function startPoint(repo: string, base: string) {
  await validateBase(repo, base)
  const from = (await git(repo, 'rev-parse', '--verify', '--quiet', `origin/${base}`)).ok ? `origin/${base}` : base
  if (!(await branchExists(repo, base)) && from !== base) {
    const made = await git(repo, 'branch', '--', base, from)
    if (!made.ok) throw new Error(`Cannot create local branch ${base}: ${made.err}`)
  }
  const r = await git(repo, 'rev-parse', '--verify', '--quiet', `${from}^{commit}`)
  return r.ok ? r.out : from
}

/** Claims `refs/lineclear/claims/<name>` on the repo (creating a ref that exists fails): 'won', 'held' by another loop, or 'error'. */
export async function claimRef(g: GitHub, cwd: string, name: string, sha: string): Promise<'won' | 'held' | 'error'> {
  const r = await gh(g, cwd, 'api', '--method', 'POST', `repos/${g.repo}/git/refs`, '-f', `ref=refs/lineclear/claims/${name}`, '-f', `sha=${sha}`, '--silent')
  return r.ok ? 'won' : /Reference already exists/i.test(`${r.out}\n${r.err}`) ? 'held' : 'error'
}

/** gh for one repo: its host in GH_HOST (gh can't tell github.localhost from the remote alone), never a prompt */
export const gh = (g: GitHub, cwd: string, ...args: string[]) =>
  sh(['gh', ...args], cwd, { timeoutMs: 120_000, env: { GH_HOST: g.host, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' } })

/** the repo as gh's --repo takes it, host included */
const R = (g: GitHub) => ['--repo', `${g.host}/${g.repo}`]
