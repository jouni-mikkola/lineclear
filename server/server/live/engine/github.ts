// gh for tasks: login, pull requests, their checks and comments, and the runs of a branch.
import { gh, git, type GitHub, R } from './git.ts'

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
  if (!r.ok) return null
  try {
    const list = JSON.parse(r.out || '[]') as Pr[]
    return list.find((p) => p.state === 'OPEN') ?? list.find((p) => p.state === 'MERGED') ?? null
  } catch {
    return null
  }
}

export async function viewPr(g: GitHub, cwd: string, n: number): Promise<Pr | null> {
  const r = await gh(g, cwd, 'pr', 'view', String(n), ...R(g), '--json', PR_FIELDS)
  try {
    return r.ok ? (JSON.parse(r.out) as Pr) : null
  } catch {
    return null
  }
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

export type PrChecks = { state: 'pending' | 'pass' | 'fail' | 'none' | 'error'; passed: number; failed: { name: string; link?: string }[]; error?: string }

/** a check as gh pr checks buckets it: pass, fail, pending, skipping or cancel */
export type Check = { name: string; bucket: string; link?: string }

/** gh was refused GitHub's checks: a fine-grained token can't read them on a private repo (it can read Actions) */
export const noChecksAccess = (said: string) => /not accessible by personal access token/i.test(said)

/**
 * The jobs GitHub Actions ran on a commit, read through the Actions API, for a token that may read Actions but not
 * checks; null when GitHub did not answer.
 */
export async function actionJobs(g: GitHub, cwd: string, sha: string): Promise<Check[] | null> {
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
export type BranchRun = { sha: string; state: 'pass' | 'fail' | 'pending'; failed: { name: string; link: string }[] }

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
  let runs: { headSha: string; status: string; conclusion: string; url: string; workflowName: string }[]
  try {
    runs = JSON.parse(r.out || '[]')
  } catch {
    return null
  }
  const out: BranchRun[] = []
  for (const sha of [...new Set(runs.map((x) => x.headSha))]) {
    const of = runs.filter((x) => x.headSha === sha && x.conclusion !== 'cancelled')
    if (!of.length) continue
    const failed = of
      .filter((x) => x.status === 'completed' && !['success', 'neutral', 'skipped'].includes(x.conclusion))
      .map((x) => ({ name: x.workflowName, link: x.url }))
    out.push({ sha, failed, state: failed.length ? 'fail' : of.some((x) => x.status !== 'completed') ? 'pending' : 'pass' })
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
  try {
    return r.out
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T)
  } catch {
    return null
  }
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

/** the last lines a failed check's job logged before its last error (after it come clean-up steps), from its link
 *  (…/actions/runs/1/job/2, or a run's: its first failed job); nothing when gh can't tell. Read through the API, as
 *  gh run view's own calls skip a GitHub proxy (GH_HOST) for the jobs. */
export async function failedLog(g: GitHub, cwd: string, link: string, lines = 15): Promise<string | undefined> {
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
  const said = r.out
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
  const err = said.findLastIndex((l) => l.includes('##[error]'))
  const tail = said
    .slice(0, err < 0 ? undefined : err + 1)
    .slice(-lines)
    .join('\n')
  return tail.length > 1500 ? `…${tail.slice(-1500)}` : tail
}
