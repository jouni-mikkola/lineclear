// What each CLI's models and effort levels really are, so the + menu, Settings and task add offer only what it takes.
// Each CLI is asked itself where it can tell: Claude Code's own model catalog in its install (which models it knows
// and which take xhigh and max) and its --help, `pi --list-models` and pi's --help. What they
// said is kept in cli-models.json and asked again by version (claude) or every few hours; where a CLI can't tell, its models come from the registry (src/models.ts: what
// every installed harness lists), and none are built in. A level a model lacks becomes the nearest it has (nearest), never an error at start.
import { realpathSync, statSync } from 'node:fs'
import { type ModelEntry, readRegistry } from '../../../src/models.ts'
import { readJson, writeJson } from '../store.ts'

export interface Model {
  /** what the CLI takes: model-top-5-5, vendor/model-code@llm */
  id: string
  /** what the screen says: Model Top 5.5 */
  label: string
  /** the effort levels it takes, lowest first; none: it has no effort to set */
  efforts: string[]
  /** its own default level */
  effort?: string
}

export interface CliModels {
  /** what the menus offer, in the CLI's own order */
  models: Model[]
  /** older ones it still takes by id (--model model-top-4-8), offered only once one is in use */
  others?: Model[]
  /** every level the CLI takes */
  efforts: string[]
  /** what it was read from (a version, a binary), and when */
  from?: string
  at?: number
}

/** every level any CLI takes, lowest first; off and none are the same, lowest is the old name for the lowest level */
const RANK: Record<string, number> = { off: 0, none: 0, lowest: 1, minimal: 1, low: 2, medium: 3, high: 4, xhigh: 5, max: 6, ultra: 7 }
export const LEVELS = Object.keys(RANK)

const CLAUDE_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const PI_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
/** the CLIs Lineclear passes a model and effort to, with the levels each takes before it is asked */
const LEVELS_OF: Record<string, string[]> = { claude: CLAUDE_LEVELS, pi: PI_LEVELS }

/** Claude Code's families as its /model menu offers them, newest of each; its aliases (opus, haiku) name these too */
const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku']
const STALE = 6 * 3_600_000
const TEST = process.env.NODE_ENV === 'test'

let cache: Record<string, CliModels> = TEST ? {} : readJson('cli-models.json', {})
/** what the installed harnesses offer (src/models.ts), read again every few hours */
let registry: ModelEntry[] = []
let registryAt = 0
let readEntries: () => ModelEntry[] = TEST ? () => [] : readRegistry
const asking = new Set<string>()
const looked = new Map<string, number>()

/** what this CLI takes; nothing for a CLI Lineclear passes no model or effort to */
export function modelsOf(kind: string): CliModels | undefined {
  const levels = LEVELS_OF[kind]
  if (!levels) return undefined
  if (!TEST) {
    ask(kind)
  }
  askRegistry()
  // pi's models are the registry's, never an older cached read
  const c = kind === 'pi' ? undefined : cache[kind]
  const listed = fromRegistry(kind)
  const models = c?.models.length ? c.models : (listed?.models ?? [])
  return { ...c, models, efforts: c?.efforts ?? listed?.efforts ?? levels }
}

/** a model by its id, its name on screen or an alias (opus, sonnet:high's sonnet), any case; nothing when this CLI
 *  doesn't have it, or can't tell (pi before it was asked) */
export function findModel(kind: string, value?: string): Model | undefined {
  const v = value?.trim().toLowerCase()
  const c = modelsOf(kind)
  if (!v || v === 'default' || !c) return undefined
  const all = [...c.models, ...(c.others ?? [])]
  return (
    all.find((m) => m.id.toLowerCase() === v || m.label.toLowerCase() === v) ??
    (kind === 'claude' ? (/[a-z]/.test(v) ? c.models.find((m) => `-${m.id}-`.includes(`-${v}-`)) : undefined) : undefined) ??
    // pi: a model without its provider
    (kind === 'pi' ? all.find((m) => m.id.toLowerCase().endsWith(`/${v}`)) : undefined)
  )
}

/** whether this CLI can say which models it has: else any model id goes */
export const knowsModels = (kind: string) => !!modelsOf(kind)?.models.length

/** the model as the CLI takes it: its id, or what was written when the CLI can't tell */
export function modelArg(kind: string, value?: string): string | undefined {
  if (!value || value === 'default') return undefined
  return findModel(kind, value)?.id ?? value
}

/** the levels this model takes (the CLI's own, for its default model or one it can't tell about) */
export function effortsOf(kind: string, model?: string): string[] {
  const c = modelsOf(kind)
  if (!c) return []
  return (model ? findModel(kind, model)?.efforts : undefined) ?? c.efforts
}

/** the level nearest to this one among these, a tie going to the lower; nothing for the CLI's own or an unknown word */
export function nearest(levels: string[], effort?: string): string | undefined {
  const e = effort?.trim().toLowerCase()
  if (!e || e === 'default' || !levels.length) return undefined
  if (levels.includes(e)) return e
  const r = RANK[e]
  if (r === undefined) return undefined
  return levels.reduce((best, l) => (Math.abs(RANK[l] - r) < Math.abs(RANK[best] - r) ? l : best))
}

/** an effort as this CLI and model take it: the nearest level it has, or nothing for its own default */
export const effortFor = (kind: string, effort?: string, model?: string) => nearest(effortsOf(kind, model), effort)

/* ---------- asking the CLIs ---------- */

function ask(kind: string) {
  if (kind === 'pi') return
  // looked at most once a minute: the + menu asks on every chat it draws
  if (Date.now() - (looked.get(kind) ?? 0) < 60_000) return
  looked.set(kind, Date.now())
  const c = cache[kind]
  const from = kind === 'claude' ? claudeBinary() : undefined
  if (c && (kind === 'claude' ? c.from === from : Date.now() - (c.at ?? 0) < STALE)) return
  if (asking.has(kind)) return
  asking.add(kind)
  read(kind, from)
    .then((got) => {
      if (!got?.models.length) return
      cache = { ...cache, [kind]: { ...got, from, at: Date.now() } }
      writeJson('cli-models.json', cache)
    })
    .catch(() => {})
    .finally(() => asking.delete(kind))
}

/** the Claude Code install that runs, by its path and when it changed: a new version is read again */
function claudeBinary() {
  try {
    const p = realpathSync(Bun.which('claude') ?? '')
    return `${p}@${statSync(p).mtimeMs}`
  } catch {
    return undefined
  }
}

async function run(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const t = setTimeout(() => p.kill(), 20_000)
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  clearTimeout(t)
  return `${out}${err}`
}

async function read(kind: string, from?: string): Promise<CliModels | undefined> {
  if (kind === 'claude' && from) {
    const bin = from.slice(0, from.lastIndexOf('@'))
    const [catalog, help] = await Promise.all([
      run(['grep', '-aoE', '\\{id:"claude-[a-z0-9-]+",family:"[a-z]+",display_name:"[^"]+"|capabilities:\\[[^]]*\\]|default_effort:"[a-z]+"', bin]),
      run([bin, '--help']),
    ])
    return parseClaude(catalog, help)
  }
  return undefined
}

/** the levels a --help lists for this flag: "--effort <level> … (low, medium, high, xhigh, max)" */
function helpLevels(help: string, flag: string): string[] {
  const m = help.replace(/\s+/g, ' ').match(new RegExp(`${flag} <\\w+>[^-]*?[(:] ?((?:[a-z]+, )+[a-z]+)`))
  return m ? m[1].split(', ').filter((l) => l in RANK) : []
}

/** Claude Code's model catalog as grep finds it in its install: each model's id, family and name, then its
 *  capabilities (effort, xhigh_effort, max_effort) and default level */
export function parseClaude(catalog: string, help: string): CliModels | undefined {
  const levels = helpLevels(help, '--effort')
  const all: (Model & { family: string })[] = []
  for (const line of catalog.split('\n')) {
    const id = line.match(/^\{id:"([^"]+)",family:"([^"]+)",display_name:"([^"]+)"/)
    const last = all.at(-1) as (Model & { family: string; caps?: boolean; dflt?: boolean }) | undefined
    if (id) all.push({ id: id[1], family: id[2], label: id[3], efforts: [] })
    else if (last && !last.caps && line.startsWith('capabilities:')) {
      last.caps = true
      const caps = line.match(/"([a-z_]+)"/g)?.map((x) => x.slice(1, -1)) ?? []
      const has = caps.includes('effort')
        ? ['low', 'medium', 'high', ...(caps.includes('xhigh_effort') ? ['xhigh'] : []), ...(caps.includes('max_effort') ? ['max'] : [])]
        : []
      last.efforts = levels.length ? has.filter((l) => levels.includes(l)) : has
    } else if (last && !last.dflt && last.caps && line.startsWith('default_effort:')) {
      last.dflt = true
      last.effort = line.match(/"([a-z]+)"/)?.[1]
    }
  }
  const tidy = ({ id, label, efforts, effort }: Model): Model => ({ id, label, efforts, ...(effort && efforts.includes(effort) ? { effort } : {}) })
  const models = FAMILIES.map((f) => all.findLast((m) => m.family === f)).filter((m): m is Model & { family: string } => !!m)
  if (!models.length) return undefined
  return {
    models: models.map(tidy),
    others: all.filter((m) => !models.includes(m)).map(tidy),
    efforts: levels.length ? levels : CLAUDE_LEVELS,
  }
}

/** the registry's models of one harness: provider/name ids, every level pi takes */
function fromRegistry(kind: string): CliModels | undefined {
  if (listedFor.registry !== registry) listedFor = { registry, byKind: new Map() }
  if (!listedFor.byKind.has(kind)) listedFor.byKind.set(kind, readFromRegistry(kind))
  return listedFor.byKind.get(kind)
}

// every snapshot asks for the same lists: they are worked out once for each read of the registry
let listedFor: { registry: ModelEntry[]; byKind: Map<string, CliModels | undefined> } = { registry: [], byKind: new Map() }

function readFromRegistry(kind: string): CliModels | undefined {
  const found = registry.filter((m) => m.harness === kind)
  if (!found.length) return undefined
  const names = found.map((m) => m.name)
  const models = found.map((m) => ({
    id: `${m.provider}/${m.name}`,
    // a model's own name, unless another provider has one so named too
    label: names.indexOf(m.name) === names.lastIndexOf(m.name) ? m.name : `${m.provider}/${m.name}`,
    efforts: LEVELS_OF[kind],
  }))
  return { models, efforts: LEVELS_OF[kind] }
}

function askRegistry() {
  if (Date.now() - registryAt < STALE) return
  const first = registryAt === 0
  registryAt = Date.now()
  // the first read is waited for: a fresh server must not answer "no models" to the first start
  if (first) registry = readEntries()
  else
    setTimeout(() => {
      registry = readEntries()
    }, 0)
}

/** why a CLI that lists its models won't start without one: no model is picked for it by default */
export function chooseModel(kind: string, model?: string): string | undefined {
  const c = modelsOf(kind)
  if (!c?.models.length || findModel(kind, model)) return undefined
  return `No model is set for ${kind}. Choose one of: ${c.models.map((m) => m.id).join(', ')}.`
}

/** for tests: how a fresh server reads the harnesses, before any read happened */
export function setRegistryReader(read: () => ModelEntry[]) {
  readEntries = read
  registry = []
  registryAt = 0
}

/** for tests: what the harnesses offered */
export function setRegistry(entries: ModelEntry[]) {
  registry = entries
  registryAt = Date.now()
}

/** for tests: what the CLIs said */
export function setModels(kind: string, c: CliModels | undefined) {
  cache = { ...cache }
  if (c) cache[kind] = c
  else delete cache[kind]
}
