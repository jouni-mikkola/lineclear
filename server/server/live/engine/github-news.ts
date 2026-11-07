// What gh says about the open pull requests of a repo: their words and checks in one read, and a failed job's log.
import * as Runs from '../../../../src/check-runs.ts'
import { gh, parseJson, GhDown, JOB, noChecksAccess, summarize, type Check, type GitHub, type Pr, type PrChecks } from './github.ts'

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
