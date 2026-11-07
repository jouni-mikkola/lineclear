// Secrets for agents (API keys, tokens, passwords): the human gives one through a masked box (a card an agent asked
// for, or Settings → Secrets), and agents use it by name, never seeing it: lineclear secret run puts it in a command's
// environment, lineclear secret env writes it to a file git ignores. Each is set at a level, as Settings are:
// Everywhere ('all'), a machine (m:<machine>) or a space (p:<machine>:<space>); the most specific one wins.
// All of them are kept in one file on the main machine, readable by you only (vault.json). A worker for another machine
// (machines.ts) reads it there, on the same disk; a value leaves the main machine only when an agent on another machine
// uses it, over the SSH link to that machine (its lineclear's tunnel), and never lands in a chat, a log or the
// snapshot: those have names only.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { dataDir } from '../../../src/paths.ts'
import { listProjectNames, readSettings } from '../../../src/project.ts'
import { quote } from '../../../src/ssh.ts'
import { parseTotpKey, totpCode } from '../../../src/totp.ts'
import type { SettingSection } from '../../shared/types.ts'

const FILE = 'vault.json'

/** a name an environment variable may have: GITHUB_TOKEN */
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

/** a level's id: all, m:<machine> or p:<machine>:<space> */
const LEVEL = /^(all|m:[^:]+|p:[^:]+:.+)$/

/** at most this long: a key, a token, a private key file's words */
const SECRET_MAX = 64 * 1024

interface Kept {
  value: string
  /** when it was saved (ms) */
  at: number
}

/** each level's secrets, by name */
type Store = Record<string, Record<string, Kept>>

export class Vault {
  /** home: the main machine's Lineclear folder; seed: kept in memory only (tests) */
  constructor(
    private home: string,
    private seed?: Store,
  ) {}

  /** what the file holds; one that can't be read is never taken for none (a save would lose every secret in it) */
  read(): Store {
    if (this.seed) return this.seed
    const f = join(this.home, FILE)
    if (!existsSync(f)) return {}
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as Store
    } catch (e) {
      throw new Error(`Secrets can't be read from ${f} (${(e as Error).message}): fix or move that file; nothing was changed.`)
    }
  }

  /** the names set at each level, and when (none while the file can't be read) */
  names(): Record<string, { name: string; at: number }[]> {
    try {
      this.read()
    } catch {
      return {}
    }
    return Object.fromEntries(
      Object.entries(this.read()).map(([level, all]) => [
        level,
        Object.entries(all)
          .map(([name, k]) => ({ name, at: k.at }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ]),
    )
  }

  /** the value of each name, from the first level of the chain that has it (most specific first), and where from */
  pick(names: string[], chain: string[]): { found: Record<string, { value: string; level: string }>; missing: string[] } {
    const all = this.read()
    const found: Record<string, { value: string; level: string }> = {}
    const missing: string[] = []
    for (const n of names) {
      const level = chain.find((l) => all[l]?.[n] !== undefined)
      const kept = level === undefined ? undefined : all[level]?.[n]
      if (level !== undefined && kept) found[n] = { value: kept.value, level }
      else missing.push(n)
    }
    return { found, missing }
  }

  /** every name the chain reaches, each from the level it comes from */
  visible(chain: string[]): { name: string; level: string; at: number }[] {
    const all = this.read()
    const seen = new Map<string, { name: string; level: string; at: number }>()
    for (const l of chain) for (const [name, k] of Object.entries(all[l] ?? {})) if (!seen.has(name)) seen.set(name, { name, level: l, at: k.at })
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  has(level: string, name: string) {
    return this.read()[level]?.[name] !== undefined
  }

  /** written whole, readable by you only, from the start: a new file each time, then put in place */
  private write(all: Store) {
    mkdirSync(this.home, { recursive: true, mode: 0o700 })
    const f = join(this.home, FILE)
    const tmp = `${f}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
    renameSync(tmp, f)
  }

  /** keeps every value at a level, as sent over SSH to a machine that has no vault of its own yet; what went wrong, or undefined */
  put(level: string, values: Record<string, string>): string | undefined {
    let all: Store
    try {
      all = this.read()
    } catch (e) {
      return (e as Error).message
    }
    const at = Date.now()
    for (const [name, value] of Object.entries(values)) (all[level] ??= {})[name] = { value, at }
    if (!this.seed) this.write(all)
    return undefined
  }

  /** set (or with null, remove) one at a level */
  set(level: string, name: string, value: string | null): { ok: boolean; error?: string } {
    const problem = secretProblem(level, name, value)
    if (problem) return { ok: false, error: problem }
    let all: Store
    try {
      all = this.read()
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    if (value === null) {
      if (!all[level]?.[name]) return { ok: false, error: `No secret ${name} there.` }
      delete all[level][name]
      if (!Object.keys(all[level]).length) delete all[level]
    } else (all[level] ??= {})[name] = { value, at: Date.now() }
    if (!this.seed) this.write(all)
    return { ok: true }
  }
}

/** each level's Secrets page, after the other pages of Settings: the names kept there, never a value */
export function secretPages(settings: SettingSection[], names: Record<string, { name: string; at: number }[]>): SettingSection[] {
  const levels = new Map<string, string | undefined>()
  for (const x of settings) if (x.level && !x.global && !levels.has(x.level)) levels.set(x.level, x.machine)
  const about = 'Keys, tokens and passwords for agents. Agents use them by name and never see them: only the names show, here and in chats.'
  return [
    ...settings,
    ...[...levels].map(([level, machine]) => ({ name: 'Secrets', about, rows: [], level, ...(machine ? { machine } : {}), secrets: names[level] ?? [] })),
  ]
}

/** what is wrong with a secret to keep, if anything */
function secretProblem(level: string, name: string, value: string | null) {
  if (!LEVEL.test(level)) return 'Pick where it is for: Everywhere, a machine or a space.'
  if (!SECRET_NAME.test(name)) return 'A name has letters, digits and _ only, and starts with a letter or _ (like GITHUB_TOKEN).'
  if (value !== null && !value.length) return 'Type or paste the secret.'
  if (value !== null && value.length > SECRET_MAX) return 'That is too long for a secret (64 KB at most).'
  return undefined
}

type Env = Record<string, string | undefined>

// The command line's side of the vault: what an agent's shell loads (`secrets env`, `totp`), and what the other
// commands read to answer a login question without the owner.

/** Reads NAME='value' lines. A value may run over lines. A line that does not fit is skipped. */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const line = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=((?:'(?:[^']|'\\'')*'|[^\s'"]*))\s*$/gm
  for (const m of text.matchAll(line)) {
    const raw = m[2] as string
    out[m[1] as string] = raw.startsWith("'") ? raw.slice(1, -1).replace(/'\\''/g, "'") : raw
  }
  return out
}

const envText = (all: Record<string, string>) =>
  Object.keys(all)
    .sort()
    .map((k) => `${k}=${quote(all[k] ?? '')}\n`)
    .join('')

// A worker for another machine runs on the main one and reads the main one's vault.
const vaultOf = (env: Env) => new Vault(env.LINECLEAR_MAIN_HOME || dataDir(env))

/** the vault as it is, or empty when it cannot be read */
function readQuietly(env: Env): Store {
  try {
    return vaultOf(env).read()
  } catch {
    return {}
  }
}

/** This machine's name as the server keeps it: the short host name, or the label of the machine a worker runs for. */
const host = (env: Env) => (env.LINECLEAR_MACHINE ?? hostname()).replace(/^.*@/, '').split('.')[0] ?? ''
const machineLevel = (env: Env) => `m:${host(env)}`
const spaceLevel = (space: string, env: Env) => `p:${host(env)}:${space}`

function spaceOfProject(project: string, env: Env): string | undefined {
  const s = readSettings(project, env as NodeJS.ProcessEnv)
  return typeof s === 'string' ? undefined : s.space
}

/**
 * The levels a project's secrets come from, the most specific first: its space, this machine, Everywhere.
 * For another machine its own levels lead, then this machine's space, where the owner's secrets are kept.
 */
function chainOf(project: string | undefined, env: Env, machine?: string): string[] {
  const there = machine === undefined ? env : { ...env, LINECLEAR_MACHINE: machine }
  const space = project === undefined ? undefined : spaceOfProject(project, env)
  const spaces = space === undefined ? [] : [...new Set([spaceLevel(space, there), spaceLevel(space, env)])]
  return [...spaces, machineLevel(there), 'all']
}

/** Every name the project's chain reaches, with its value, the most specific level winning. */
function valuesOf(project: string | undefined, env: Env, machine?: string): Record<string, string> {
  const vault = readQuietly(env)
  const out: Record<string, string> = {}
  for (const level of chainOf(project, env, machine).reverse()) for (const [n, k] of Object.entries(vault[level] ?? {})) out[n] = k.value
  return out
}

const gitCommonDir = (cwd: string): string | undefined => {
  try {
    const dir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return realpathSync(dir)
  } catch {
    return undefined
  }
}

/** The project whose repo this folder belongs to (the repo itself or one of its worktrees), or undefined. */
function projectOfDir(cwd: string, env: Env): string | undefined {
  const here = gitCommonDir(cwd)
  if (here === undefined) return undefined
  for (const name of listProjectNames(env as NodeJS.ProcessEnv)) {
    const s = readSettings(name, env as NodeJS.ProcessEnv)
    if (typeof s !== 'string' && gitCommonDir(s.repo) === here) return name
  }
  return undefined
}

/** A project's secrets as an env file, for sending to another machine over SSH. Empty when it has none. */
export function secretsText(project: string, env: Env = process.env, machine?: string): string {
  return envText(valuesOf(project, env, machine))
}

/** The names a task of the project can load. */
export function secretNames(project: string, env: Env = process.env): string[] {
  return Object.keys(valuesOf(project, env)).sort()
}

/** Whether the text names the login (`M365_GA` as "m365 ga" or "M365_GA"), as a whole word. */
const mentions = (text: string, login: string) => new RegExp(`(^|[^a-z0-9])${login.toLowerCase().replace(/_/g, '[ _]')}($|[^a-z0-9])`).test(text.toLowerCase())

/** The logins whose NAME_TOTP is stored for the project. */
export function loadableTotps(project: string | undefined, env: Env = process.env): string[] {
  return (project === undefined ? [] : secretNames(project, env))
    .filter((n) => n.endsWith('_TOTP'))
    .map((n) => n.slice(0, -5))
    .sort()
}

/** The name of the one stored `NAME_USER` and `NAME_PASSWORD` pair that the question names as a whole word. */
export function storedLogin(question: string, names: string[]): string | undefined {
  const found = names
    .filter((n) => n.endsWith('_USER') && names.includes(n.replace(/_USER$/, '_PASSWORD')))
    .map((n) => n.replace(/_USER$/, ''))
    .filter((l) => l.length >= 3 && mentions(question, l))
  return found.length === 1 ? found[0] : undefined
}

/**
 * The logins that make a question to the owner needless: those it names, or, when it names no login, every one with
 * a stored TOTP. Empty when the owner has to be asked.
 */
export function totpAnswers(question: string, logins: string[], named?: string): string[] {
  // a captcha is the owner's whatever the login has stored
  if (/\bcaptcha\b/i.test(question)) return []
  const hit = logins.filter((l) => l === named || mentions(question, l))
  return hit.length > 0 ? hit : named === undefined ? logins : []
}

/** What an agent does when a login is stored (a USER and PASSWORD pair the question names), instead of asking the owner. */
const loginAdvice = (name: string, totp: boolean) =>
  `a stored login exists: ${name}; use ${name}_USER and ${name}_PASSWORD with lineclear secret run, without printing them${totp ? `, code from lineclear totp ${name}` : ''}. The owner is not asked.`

/**
 * Why a wait or a question to the owner about a login is needless: the stored login (secret names only, never
 * values) the agent can use instead. Undefined when none matches and the owner has to be asked.
 */
export function storedLoginAdvice(text: string, project: string | undefined, env: Env = process.env, named?: string): string | undefined {
  const totps = loadableTotps(project, env)
  const pair = named === undefined ? storedLogin(text, project === undefined ? [] : secretNames(project, env)) : undefined
  if (pair !== undefined && !/\bcaptcha\b/i.test(text)) return loginAdvice(pair, totps.includes(pair))
  const stored = totpAnswers(text, totps, named)
  return stored.length > 0 ? totpAdvice(stored) : undefined
}

/** What an agent does when a login has a stored TOTP, instead of asking the owner. */
export const totpAdvice = (logins: string[]) =>
  `${logins.map((l) => `${l}_TOTP`).join(', ')} is stored, so the owner is not asked. Never wait for a push or a number: choose the verification-code option ("Sign in another way" > "Use a verification code") and fill the code from \`lineclear totp ${logins[0]}\` in the same command, without printing it.`

/** `text` with every stored secret value replaced by ***. */
export function maskSecrets(text: string, env: Env = process.env): string {
  const values = Object.values(readQuietly(env))
    .flatMap((all) => Object.values(all).map((k) => k.value))
    .filter((v) => v !== '')
    .sort((a, b) => b.length - a.length)
  for (const v of values) text = text.split(v).join('***')
  return text
}

/** The exit code and the last 20 lines of a failed command's output, secrets masked. */
export function failureTail(code: number | null, output: string, env: Env = process.env): string {
  const text = maskSecrets(output.trimEnd(), env)
  return [`exit ${code}`, ...(text === '' ? [] : text.split('\n').slice(-20))].join('\n')
}

function fail(out: (l: string) => void, message: string, command = 'secrets'): number {
  out(`lineclear ${command}: ${message}`)
  return 1
}

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text()
}

/** `lineclear secrets env` loads the folder's secrets into a shell; `secrets import <space>` is how Lineclear sends a project's to another machine (spread.ts). */
export async function secrets(
  args: string[],
  out: (l: string) => void,
  env: Env = process.env,
  readValue: () => Promise<string> = readStdin,
  cwd: string = process.cwd(),
): Promise<number> {
  const [sub, ...rest] = args
  if (sub === 'import' && rest.length === 1) {
    const space = rest[0] as string
    const values = parseEnvFile(await readValue())
    const problem = vaultOf(env).put(spaceLevel(space, env), values)
    if (problem !== undefined) return fail(out, problem)
    out(`saved ${Object.keys(values).length} secrets for space '${space}'`)
    return 0
  }
  if (sub === 'env' && rest.length === 0) {
    const all = valuesOf(projectOfDir(resolve(cwd), env), env)
    for (const k of Object.keys(all).sort()) out(`export ${k}=${quote(all[k] ?? '')}`)
    return 0
  }
  out('usage: lineclear secrets env (import is for Lineclear itself); add secrets in Settings > Secrets or with lineclear secret set')
  return 2
}

/** `lineclear totp NAME`: the current code of the login NAME, from NAME_TOTP in this folder's secrets. */
export function totp(args: string[], out: (l: string) => void, env: Env = process.env, cwd: string = process.cwd(), now: number = Date.now()): number {
  const raw = args[0]
  if (args.length !== 1 || raw === undefined || raw.startsWith('-')) {
    out("usage: lineclear totp NAME   (prints the code of NAME_TOTP from this folder's secrets)")
    return 2
  }
  const variable = `${raw.toUpperCase().replace(/_TOTP$/, '')}_TOTP`
  if (!SECRET_NAME.test(variable)) return fail(out, `'${raw}' is not a login name`, 'totp')
  const value = valuesOf(projectOfDir(resolve(cwd), env), env)[variable] ?? env[variable]
  if (value === undefined || value.trim() === '') return fail(out, `${variable} is not kept for this folder (Settings > Secrets)`, 'totp')
  try {
    out(totpCode(parseTotpKey(value), now))
    return 0
  } catch {
    return fail(out, `${variable} is not a TOTP key (base32 or an otpauth:// address)`, 'totp')
  }
}
