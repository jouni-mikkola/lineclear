// gh for tasks: login, pull requests, their checks and comments, and the runs of a branch.
import * as Runs from '../../../../src/check-runs.ts'
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

function parseJson<T>(out: string, empty: string): T {
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
type Check = { name: string; bucket: string; link?: string }

/** gh was refused GitHub's checks: a fine-grained token can't read them on a private repo (it can read Actions) */
const noChecksAccess = (said: string) => /not accessible by personal access token/i.test(said)

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
const JOB: Record<string, string> = { success: 'pass', neutral: 'pass', skipped: 'skipping', cancelled: 'cancel' }

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

function summarize(list: Check[]): PrChecks {
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

/** what someone wrote on a pull request: a review, a comment on a line of its code, or one on the pull request itself */
export interface PrComment {
  /** unique across the three kinds: r123 (review), c123 (line), i123 (issue comment) */
  id: string
  /** when GitHub has it, ISO */
  at: string
  who: string
  body: string
  url: string
  /** a line comment's file and line ("server/x.ts:42") */
  where?: string
  /** a review's verdict: APPROVED, CHANGES_REQUESTED, COMMENTED */
  state?: string
}

/** each item of a GitHub list, one JSON per line, every page; null when GitHub did not answer */
async function items<T>(g: GitHub, cwd: string, path: string): Promise<T[] | null> {
  const r = await gh(g, cwd, 'api', '--paginate', '--jq', '.[]', path)
  if (!r.ok) return null
  return r.out
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => parseJson<T>(l, 'null'))
}

type Raw = {
  id: number
  pull_request_review_id?: number | null
  user?: { login?: string }
  body?: string
  html_url: string
  created_at?: string
  submitted_at?: string
  state?: string
  path?: string
  line?: number | null
  original_line?: number | null
}

/** everything written on a pull request (reviews, line comments, comments), oldest first; null when unread */
export async function prComments(g: GitHub, cwd: string, n: number): Promise<PrComment[] | null> {
  const repo = `repos/${g.repo}`
  const [reviews, lines, notes] = await Promise.all([
    items<Raw>(g, cwd, `${repo}/pulls/${n}/reviews?per_page=100`),
    items<Raw>(g, cwd, `${repo}/pulls/${n}/comments?per_page=100`),
    items<Raw>(g, cwd, `${repo}/issues/${n}/comments?per_page=100`),
  ])
  if (!reviews || !lines || !notes) return null
  const of = (c: Raw, kind: string): PrComment => ({
    id: `${kind}${c.id}`,
    at: c.submitted_at ?? c.created_at ?? '',
    who: c.user?.login ?? 'someone',
    body: (c.body ?? '').trim(),
    url: c.html_url,
  })
  return [
    ...reviews.filter((c) => c.state !== 'PENDING').map((c) => ({ ...of(c, 'r'), state: c.state })),
    // a line comment is stamped when it was drafted: it is news when its review was sent
    ...lines.map((c) => ({
      ...of(c, 'c'),
      at: reviews.find((r) => r.id === c.pull_request_review_id)?.submitted_at ?? c.created_at ?? '',
      where: c.path ? `${c.path}${(c.line ?? c.original_line) ? `:${c.line ?? c.original_line}` : ''}` : undefined,
    })),
    ...notes.map((c) => of(c, 'i')),
  ].sort((a, b) => a.at.localeCompare(b.at))
}

/** an open pull request with what the engine watches on it: its checks (unset when the token can't read them) and words */
export interface OpenPr {
  pr: Pr
  checks?: PrChecks
  comments: PrComment[]
}

const CONTEXTS = `commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
  __typename
  ... on CheckRun { name status conclusion detailsUrl }
  ... on StatusContext { context state targetUrl }
} } } } } }`

const OPEN_PRS = (checks: boolean) => `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
  pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes {
    number url state isDraft headRefOid baseRefName
    ${checks ? CONTEXTS : ''}
    reviews(last: 50) { nodes { databaseId author { login } body state url submittedAt } }
    comments(last: 50) { nodes { databaseId author { login } body url createdAt } }
    reviewThreads(last: 30) { nodes { comments(last: 30) { nodes {
      databaseId author { login } body url createdAt path line originalLine pullRequestReview { databaseId submittedAt }
    } } } }
  } }
} }`

type Node<T> = { nodes?: (T | null)[] | null } | null | undefined
type Author = { login?: string } | null
type RawComment = {
  databaseId: number
  author?: Author
  body?: string
  url: string
  createdAt?: string
  submittedAt?: string
  state?: string
  path?: string
  line?: number | null
  originalLine?: number | null
  pullRequestReview?: { databaseId?: number; submittedAt?: string } | null
}
type RawContext = {
  __typename: string
  name?: string
  status?: string
  conclusion?: string | null
  detailsUrl?: string
  context?: string
  state?: string
  targetUrl?: string
}
type RawPr = Pr & {
  commits?: Node<{ commit?: { statusCheckRollup?: { contexts?: Node<RawContext> } | null } }>
  reviews?: Node<RawComment>
  comments?: Node<RawComment>
  reviewThreads?: Node<{ comments?: Node<RawComment> }>
}

const nodesOf = <T>(n: Node<T>): T[] => (n?.nodes ?? []).filter((x): x is T => !!x)
const STATUS: Record<string, string> = { SUCCESS: 'pass', PENDING: 'pending', EXPECTED: 'pending' }

function bucketOf(c: RawContext): Check {
  if (c.__typename === 'CheckRun')
    return { name: c.name ?? '', link: c.detailsUrl, bucket: c.status !== 'COMPLETED' ? 'pending' : (JOB[(c.conclusion ?? '').toLowerCase()] ?? 'fail') }
  return { name: c.context ?? '', link: c.targetUrl, bucket: STATUS[c.state ?? ''] ?? 'fail' }
}

function commentsOf(p: RawPr): PrComment[] {
  const of = (c: RawComment, kind: string): PrComment => ({
    id: `${kind}${c.databaseId}`,
    at: c.submittedAt ?? c.createdAt ?? '',
    who: c.author?.login ?? 'someone',
    body: (c.body ?? '').trim(),
    url: c.url,
  })
  return [
    ...nodesOf(p.reviews)
      .filter((c) => c.state !== 'PENDING')
      .map((c) => ({ ...of(c, 'r'), state: c.state })),
    ...nodesOf(p.reviewThreads)
      .flatMap((t) => nodesOf(t.comments))
      .map((c) => {
        const line = c.line ?? c.originalLine
        return { ...of(c, 'c'), at: c.pullRequestReview?.submittedAt ?? c.createdAt ?? '', where: c.path ? `${c.path}${line ? `:${line}` : ''}` : undefined }
      }),
    ...nodesOf(p.comments).map((c) => of(c, 'i')),
  ].sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * Every open pull request of the repo in one call: its commit, checks, reviews and comments (the first 100 pull requests,
 * last touched first). A token that can't read checks gets the rest, with `checks` unset. GhDown when GitHub did not
 * answer, or answered with something that isn't a pull request list.
 */
export async function openPrs(g: GitHub, cwd: string, withChecks = true): Promise<OpenPr[]> {
  const [owner, name] = g.repo.split('/')
  const r = await gh(g, cwd, 'api', 'graphql', '-f', `query=${OPEN_PRS(withChecks)}`, '-F', `owner=${owner}`, '-F', `name=${name}`)
  if (!r.ok) {
    if (withChecks && noChecksAccess(`${r.out}\n${r.err}`)) return openPrs(g, cwd, false)
    throw new GhDown((r.err || r.out || `gh exited ${r.code}`).split('\n')[0])
  }
  const raw = parseJson<{ data?: { repository?: { pullRequests?: Node<RawPr> } | null } }>(r.out, '{}').data?.repository?.pullRequests
  if (!raw || !Array.isArray(raw.nodes)) throw new GhDown('GitHub answered with something unreadable')
  return nodesOf(raw).map((p) => ({
    pr: { number: p.number, url: p.url, state: p.state, isDraft: p.isDraft, headRefOid: p.headRefOid, baseRefName: p.baseRefName },
    checks: withChecks ? summarize(nodesOf(nodesOf(p.commits)[0]?.commit?.statusCheckRollup?.contexts).map(bucketOf)) : undefined,
    comments: commentsOf(p),
  }))
}

/** the repo's key for sharing what is read of it */
export const repoKey = (g: GitHub) => `${g.host}/${g.repo}`

/** the names of the tests a failed check's job log shows as failed (the check's own report, read by check-runs); none when gh can't tell */
export async function failedTestNames(g: GitHub, cwd: string, link: string): Promise<string[]> {
  const said = await jobLines(g, cwd, link)
  return said ? Runs.failedTests(said.join('\n')) : []
}

/** the lines a failed check's job logged, from its link (…/actions/runs/1/job/2, or a run's: its first failed job);
 *  nothing when gh can't tell. Read through the API, as gh run view's own calls skip a GitHub proxy (GH_HOST) for the jobs. */
async function jobLines(g: GitHub, cwd: string, link: string): Promise<string[] | undefined> {
  const run = link.match(/\/actions\/runs\/(\d+)/)?.[1]
  let job = link.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1]
  if (!job && run) {
    const jobs = await gh(
      g,
      cwd,
      'api',
      '--paginate',
      '--jq',
      '.jobs[] | select(.conclusion == "failure") | .id',
      `repos/${g.repo}/actions/runs/${run}/jobs?per_page=100`,
    )
    job = jobs.ok ? jobs.out.split('\n').find(Boolean) : undefined
  }
  if (!job) return undefined
  // a log holds colours, which gh passes on only when told to (and a gh older than that flag goes without it)
  let r = await gh(g, cwd, 'api', '--allow-escape-sequences', `repos/${g.repo}/actions/jobs/${job}/logs`)
  if (!r.ok && /unknown flag/i.test(r.err)) r = await gh(g, cwd, 'api', `repos/${g.repo}/actions/jobs/${job}/logs`)
  if (!r.ok || !r.out.trim()) return undefined
  // each line is "time message" (gh run view's: "job<TAB>step<TAB>time message"): the message is what matters
  return r.out
    .split('\n')
    .map((l) =>
      l
        .split('\t')
        .at(-1)!
        .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '')
        .replace(/\x1b\[[\d;]*m/g, '')
        .trimEnd(),
    )
    .filter((l) => l.trim())
}

/** the last lines a failed check's job logged before its last error (after it come clean-up steps) */
export async function failedLog(g: GitHub, cwd: string, link: string, lines = 15): Promise<string | undefined> {
  const said = await jobLines(g, cwd, link)
  if (!said) return undefined
  const err = said.findLastIndex((l) => l.includes('##[error]'))
  const tail = said
    .slice(0, err < 0 ? undefined : err + 1)
    .slice(-lines)
    .join('\n')
  return tail.length > 1500 ? `…${tail.slice(-1500)}` : tail
}

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
const gh = (g: GitHub, cwd: string, ...args: string[]) =>
  sh(['gh', ...args], cwd, { timeoutMs: 120_000, env: { GH_HOST: g.host, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' } })

/** the repo as gh's --repo takes it, host included */
const R = (g: GitHub) => ['--repo', `${g.host}/${g.repo}`]
