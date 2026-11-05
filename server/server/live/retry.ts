// A turn cut off by the model's provider: the agent did not stop, its provider did. Errors that pass by themselves
// (overloaded, at capacity, a rate limit, a dropped connection, a server error) are waited out: the agent is told to
// carry on after 1, 2, 4 and 8 minutes, so five tries over fifteen minutes, and only then does the human hear. Errors
// waiting can't fix (signed out, out of allowance, a model that isn't there, anything not recognised) go to the human
// at once, or to a task's backup agent (engine.ts handOver). Each CLI's log records the error (readers/), and this
// decides what it means. From herdr-projects' docs/provider-errors.md, without the weight.
import { readJson, writeJson } from '../store.ts'
import { hidden } from './agents.ts'

/** what a CLI's log says cut its turn off: the provider's words, and its own code and HTTP status where it has them */
export interface Cut {
  id: string
  at: number
  text: string
  code?: string
  status?: number
}

export interface ProviderError {
  /** it passes by itself: wait and try again */
  passing: boolean
  /** in a few words, for a status line: "Provider overloaded", "Out of allowance" */
  reason: string
}

const CODE_PASSING: Record<string, string> = {
  server_overloaded: 'Provider overloaded',
  overloaded: 'Provider overloaded',
  overloaded_error: 'Provider overloaded',
  model_cap: 'Model at capacity',
  http_connection_failed: 'Connection dropped',
  response_stream_connection_failed: 'Connection dropped',
  response_stream_disconnected: 'Connection dropped',
  response_too_many_failed_attempts: 'Connection dropped',
  internal_server_error: 'Provider server error',
  server_error: 'Provider server error',
}
const CODE_LASTING = [
  'unauthorized',
  'bad_request',
  'context_window_exceeded',
  'usage_limit_exceeded',
  'sandbox_error',
  'authentication_failed',
  'billing_error',
  'invalid_request',
  'model_not_found',
  'max_output_tokens',
]
const WORDS_AUTH = /\b(?:status|error|HTTP)\b[^\n]{0,12}\b40[13]\b|\b401 Unauthorized\b|please run \/login|login expired|not logged in|oauth token/i
const WORDS_ALLOWANCE = /usage limit|(?<!rate.?)limit reached|hit your [\w ]*limit|\bquota\b|billing|credit balance|payment/i
const WORDS_LASTING =
  /not supported|unsupported|does not exist|may not exist|not found|unknown (?:provider|model)|invalid|context (?:window|length)|flagged|content policy/i
const WORDS_PASSING: [RegExp, string][] = [
  [/at capacity/i, 'Model at capacity'],
  [/rate.?limit|too many requests|\b429\b/i, 'Rate limited'],
  [/overloaded|\b529\b/i, 'Provider overloaded'],
  [
    /socket|connection|network|\bE(?:CONN\w+|TIMEDOUT|AI_AGAIN|PIPE)\b|timed? ?out|(?:operation|request) (?:was )?aborted|fetch failed|stream (?:ended|closed|disconnected|error)|disconnect/i,
    'Connection dropped',
  ],
  [
    /\b(?:API error|status|HTTP)\b[^\n]{0,12}\b5\d\d\b|internal server error|bad gateway|service unavailable|upstream|server error|you can retry your request|try again later/i,
    'Provider server error',
  ],
]

/** when an allowance comes back, as the provider says it ("resets 5pm", "try again at 5:00 PM"): " until 5pm" */
const until = (words: string) => {
  const m = words.match(/\bresets (?:at )?([^\n·.,;()]{1,24})|try again (?:at|after) ([^\n.,;()]{1,24})/i)
  const when = (m?.[1] ?? m?.[2])?.trim()
  return when ? ` until ${when}` : ''
}

/** which errors pass by themselves. The CLI's own code decides where it has one (Codex codex_error_info, Claude Code's
 *  error and HTTP status); its words decide for the rest. Not recognised: it doesn't pass. */
export function providerError(words: string, code = '', status = 0): ProviderError {
  const c = code.toLowerCase()
  const said = WORDS_PASSING.find(([re]) => re.test(words))?.[1]
  if (c === 'unauthorized' || c === 'authentication_failed' || status === 401 || status === 403 || WORDS_AUTH.test(words))
    return { passing: false, reason: 'Signed out' }
  if (c === 'usage_limit_exceeded' || c === 'billing_error' || WORDS_ALLOWANCE.test(words)) return { passing: false, reason: `Out of allowance${until(words)}` }
  if (CODE_LASTING.includes(c) || (status >= 400 && status < 500 && status !== 408 && status !== 429) || WORDS_LASTING.test(words))
    return {
      passing: false,
      reason:
        c === 'context_window_exceeded' || /context (?:window|length)|too long/i.test(words)
          ? 'Context window full'
          : c === 'model_not_found' || /model/i.test(words)
            ? 'Model not available'
            : 'Provider refused it',
    }
  if (CODE_PASSING[c]) return { passing: true, reason: said ?? CODE_PASSING[c] }
  if (status === 429 || c === 'rate_limit') return { passing: true, reason: 'Rate limited' }
  if (status === 408 || status >= 500) return { passing: true, reason: said ?? (status === 529 ? 'Provider overloaded' : 'Provider server error') }
  return said ? { passing: true, reason: said } : { passing: false, reason: 'Provider error' }
}

/** an out-of-allowance cut: it is over only until the account is back */
export const isAllowance = (reason: string) => /^Out of allowance/.test(reason)

const MINUTE = 60_000
/** when the provider gives no reset time, the account is looked at again after this, doubling each time, up to 4 hours */
const RECHECK = [30, 60, 120, 240].map((m) => m * MINUTE)
const CLOCK = /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*\(([^)]+)\))?|try again (?:at|after)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
const IN = /\b(?:resets?|try again|retry)\s+in\s+(\d+)\s*(min\w*|m|hours?|hrs?|h)\b/i

/** the offset of a time zone from UTC at an instant, in ms (0 for a zone it doesn't know) */
function zoneOffset(at: number, zone: string): number {
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      })
        .formatToParts(new Date(at))
        .map((x) => [x.type, Number(x.value)]),
    )
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000
  } catch {
    return 0
  }
}

/** when the provider says the allowance is back ("resets 5pm (Europe/Oslo)", "try again at 5:00 PM", "resets in 3 hours"), or none */
export function resetAt(words: string, now = Date.now()): number | undefined {
  const rel = IN.exec(words)
  if (rel) return now + Number(rel[1]) * (/^h/i.test(rel[2]) ? 60 : 1) * MINUTE
  const m = CLOCK.exec(words)
  if (!m) return undefined
  const [h, min, ap, zone] = m[1] ? [m[1], m[2], m[3], m[4]] : [m[5], m[6], m[7], undefined]
  const hour = (Number(h) % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0)
  const zoneName = zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const off = zoneOffset(now, zoneName)
  const local = new Date(now + off)
  let at = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, Number(min ?? 0)) - off
  if (at <= now) at += 24 * 60 * MINUTE
  return at
}

/** what a woken-up chat does: carry on where it left off, or first move to an account that has room. Only when no
 *  reset time was said, so nothing says its account is back, and another account is there, it moves first */
export function wakePlan(r: Pick<Retry, 'certain'>, canSwitch: boolean): 'carry-on' | 'switch' {
  return !r.certain && canSwitch ? 'switch' : 'carry-on'
}

/** the one card of a chat's out-of-allowance stop: a failure again is the same card, not another */
export const cutCardId = (key: string, reason: string) => `cut:${key}:${isAllowance(reason) ? 'allowance' : reason.toLowerCase()}`

/** the waits before each try: after the fifth cut-off turn in a row, it gives up */
const WAITS = [1, 2, 4, 8].map((m) => m * 60_000)

export interface Retry {
  /** the cut-off turn last seen (its log event's id) */
  cut: string
  /** cut-off turns in a row */
  tries: number
  reason: string
  /** the provider's own words */
  words: string
  /** when it is told to carry on; none once it was told (its turn runs) or it gave up */
  due?: number
  /** when it was told */
  nudged?: number
  /** given up: what waiting can't fix, or still cut off after the last try. The human (or a backup agent) is next */
  over?: boolean
  /** out of allowance: when its account may be back, and the chat is woken to carry on or move; none once it was */
  back?: number
  /** the provider said when it is back (back is that time), against a guess from the tries so far */
  certain?: boolean
}

/** the line a cut-off agent is told after the wait */
export const carryOn = (reason: string) => hidden(`Your last turn was cut off by the model's provider (${reason.toLowerCase()}). Carry on where you left off.`)

/** how long until the next try, for a status line: "2m", "<1m" */
export const inMins = (due: number, now = Date.now()) => (due - now < 60_000 ? '<1m' : `${Math.round((due - now) / 60_000)}m`)

/**
 * Every agent's cut-off turns: seen() after each turn ends (with its log's cut, or none), it waits and nudges, or
 * gives up. A turn that ends well, or anything written to the agent, starts the count again. Kept across a restart.
 */
export class Retries {
  private data = readJson<Record<string, Retry>>('retries.json', {})
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private backs = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private hooks: {
      /** tell it to carry on */
      nudge: (key: string, text: string) => void
      /** it can't go on by itself: the human, or a backup agent */
      over: (key: string, r: Retry) => void
      /** its account may be free again: carry on (or move to a free account first, wakePlan); never lost by a restart */
      wake?: (key: string, r: Retry) => void
      changed: (key: string) => void
    },
    private waits = WAITS,
    /** after a restart, how long before a wake-up: herdr must have told which agents run */
    grace = 30_000,
  ) {
    // after a restart, once herdr has told which agents run
    for (const [key, r] of Object.entries(this.data)) {
      if (r.due) this.arm(key, Math.max(r.due, Date.now() + grace))
      if (r.back) this.armBack(key, Math.max(r.back, Date.now() + grace))
    }
  }

  get(key: string): Retry | undefined {
    return this.data[key]
  }

  /** its last turn ended: with what cut it off, or none (it ended well, or a newer turn began since) */
  seen(key: string, cut: Cut | undefined, now = Date.now()) {
    const was = this.data[key]
    // a newer turn began since (a job it left running woke it, you typed in its terminal, the CLI tried again by
    // itself): it went on without being told, and the count starts again
    if (!cut) return was ? this.clear(key) : undefined
    if (was?.cut === cut.id) return
    const e = providerError(cut.text, cut.code, cut.status)
    const tries = (was?.tries ?? 0) + 1
    const words = cut.text.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (e.passing && tries <= this.waits.length) {
      const r: Retry = { cut: cut.id, tries, reason: e.reason, words, due: now + this.waits[tries - 1] }
      this.set(key, r)
      this.arm(key, r.due!)
      this.hooks.changed(key)
      return
    }
    const r: Retry = { cut: cut.id, tries, reason: e.passing ? `${e.reason}, still after ${tries} tries` : e.reason, words, over: true }
    if (!e.passing && isAllowance(e.reason)) {
      // an allowance comes back: the chat is woken then, and a failure again waits longer and says nothing more
      const said = resetAt(cut.text, now)
      const back = said ?? now + RECHECK[Math.min(tries - 1, RECHECK.length - 1)]
      Object.assign(r, { back, certain: said !== undefined })
      const again = !!was?.over && isAllowance(was.reason)
      this.set(key, r)
      this.armBack(key, back)
      this.hooks.changed(key)
      if (!again) this.hooks.over(key, r)
      return
    }
    this.set(key, r)
    // told by what comes next: a backup agent takes over, or the human hears
    this.hooks.over(key, r)
  }

  /** a message went in (yours, a coordinator's): it carries on now, and the count starts again */
  clear(key: string) {
    clearTimeout(this.timers.get(key))
    this.timers.delete(key)
    clearTimeout(this.backs.get(key))
    this.backs.delete(key)
    if (!this.data[key]) return
    delete this.data[key]
    this.save()
    this.hooks.changed(key)
  }

  stop() {
    for (const x of this.timers.values()) clearTimeout(x)
    for (const x of this.backs.values()) clearTimeout(x)
  }

  private set(key: string, r: Retry) {
    this.data[key] = r
    this.save()
  }

  private arm(key: string, due: number) {
    clearTimeout(this.timers.get(key))
    const x = setTimeout(() => this.due(key), Math.max(0, due - Date.now()))
    x.unref?.()
    this.timers.set(key, x)
  }

  private armBack(key: string, at: number) {
    clearTimeout(this.backs.get(key))
    // a timer can't wait more than about 24 days; an allowance is back sooner
    const x = setTimeout(() => this.wake(key), Math.min(Math.max(0, at - Date.now()), 2 ** 31 - 1))
    x.unref?.()
    this.backs.set(key, x)
  }

  private wake(key: string) {
    this.backs.delete(key)
    const r = this.data[key]
    if (!r?.back) return
    r.back = undefined
    r.nudged = Date.now()
    this.save()
    this.hooks.wake?.(key, r)
    this.hooks.changed(key)
  }

  private due(key: string) {
    this.timers.delete(key)
    const r = this.data[key]
    if (!r?.due) return
    r.due = undefined
    r.nudged = Date.now()
    this.save()
    this.hooks.nudge(key, carryOn(r.reason))
    this.hooks.changed(key)
  }

  private save() {
    writeJson('retries.json', this.data)
  }
}
