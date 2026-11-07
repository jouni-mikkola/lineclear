import { chatProblem } from './readers/index.ts'
import { cpus, totalmem } from 'node:os'
import type { SettingSection } from '../../shared/types.ts'
import { readJson, writeJson } from '../store.ts'
import type { SetBy } from '../../shared/brief.ts'
import { settingsBlock, settingsLines, type Said, type Ways } from './prompts.ts'
import { effortFor, effortsOf, findModel, knowsModels, modelsOf } from '../../../src/models.ts'
import {
  type MachineLimits,
  defaultMaxTasks,
  type Stored,
  type Values,
  KEYS,
  refuse,
  type Level,
  type LevelKind,
  levelsOf,
  kindOfLevel,
  defaultOf,
  LINECLEAR_MODELS,
  kindOf,
  numOf,
  numValue,
  CLI_NAME,
  type Role,
  roleKind,
  ROLES,
  CATALOG,
  type Section,
  agentRow,
} from './settings-catalog.ts'

/** under a machine's rows: why the defaults are what they are, in this machine's own numbers */
export function machineNote(l: MachineLimits, cores = cpus().length, memGb = Math.round(totalmem() / 2 ** 30)) {
  const load = (x: number | null) => (x === null ? 'off' : `${+(x * cores).toFixed(1)}`)
  const gb = (pct: number | null) => (pct === null ? 'off' : `${Math.round((memGb * pct) / 100)} GB`)
  const now = [
    l.max !== null || l.startLoad !== null
      ? `New tasks wait${l.max !== null ? ` while ${l.max} are at work` : ''}${l.max !== null && l.startLoad !== null ? ', or' : ''}${l.startLoad !== null ? ` while the load is over ${load(l.startLoad)}` : ''}${l.startMemory !== null ? ` or over ${gb(l.startMemory)} of memory is in use` : ''}.`
      : '',
    `Its coordinator hears when the load stays over ${load(l.alertLoad)} for 10 minutes, memory passes ${gb(l.alertMemory)}, home or /tmp is over ${l.alertDisk === null ? 'off' : `${l.alertDisk}%`} full${l.alertHerdr ? ', or herdr stops answering' : ''}.`,
  ].filter(Boolean)
  return {
    noteTitle: 'Why these defaults',
    note: [
      `This machine has ${cores} cores and ${memGb} GB of memory. ${now.join(' ')}`,
      '',
      `- ${defaultMaxTasks(cores)} tasks at once, cores minus 2: each task's checks and merges need cores of their own, and two stay free for one full check and the server.`,
      '- Load 1× cores to start: every core is busy then, so one more task only slows the rest.',
      "- Memory 80% to start: room for a test run's peak before the machine starts killing processes.",
      "- Load 1.5× cores for 10 minutes to alert: half again more work than cores, for longer than one test run's spike.",
      '- Memory and disk 90% to alert: close enough to full that something will soon fail.',
      '',
      'Waiting tasks show as Queued and start by themselves, oldest first; while load counts, one at a time, 30 seconds apart, so each one shows in the load. Only working tasks count. Lineclear never pauses a running task: when told, the coordinator decides.',
    ].join('\n'),
  }
}

/** the defaults you set, at their levels */
export class Settings {
  private d: Stored

  /** seed: these values, kept only in memory (the demo's) */
  constructor(private seed?: Stored) {
    const raw = (seed ?? readJson<Record<string, unknown>>('settings.json', {})) as Record<string, unknown>
    const keep = (v: unknown) =>
      Object.fromEntries(Object.entries((v ?? {}) as Values).filter(([k, x]) => KEYS.includes(k) && typeof x === 'string' && !refuse(k, x))) as Values
    if (raw.everywhere) {
      const spaces = (raw.spaces ?? {}) as Record<string, unknown>
      this.d = {
        everywhere: keep(raw.everywhere),
        machine: keep(raw.machine),
        spaces: Object.fromEntries(Object.entries(spaces).map(([k, v]) => [k, keep(v)])),
      }
      // settings no longer kept (Coordinator timer's old limits and wake picks) leave the file too
      if (JSON.stringify(this.d) !== JSON.stringify(raw)) this.save()
      return
    }
    // settings.json once held one level, set Everywhere (and before that scopes, many task settings and one CLI for
    // every agent): its values go to All machines, but a machine's capacity was each machine's own and stays so
    const all = (typeof raw.all === 'object' && raw.all ? raw.all : raw) as Record<string, unknown>
    const one = all.agent ?? all['coordinator.agent'] ?? (typeof all['worker.agent'] === 'string' ? all['worker.agent'].split(' · ')[0] : undefined)
    if (typeof one === 'string') {
      all['task.agent'] ??= one
      all['coordinator.agent'] ??= one
    }
    const old = keep(all)
    const mine = (k: string) => k.startsWith('machine.')
    this.d = {
      everywhere: Object.fromEntries(Object.entries(old).filter(([k]) => !mine(k))),
      machine: Object.fromEntries(Object.entries(old).filter(([k]) => mine(k))),
      spaces: {},
    }
  }

  private save() {
    if (!this.seed) writeJson('settings.json', this.d)
  }

  /** the values set at one level */
  private at(l: Level): Values {
    return l === 'all' ? this.d.everywhere : l === 'machine' ? this.d.machine : (this.d.spaces[l.space] ?? {})
  }

  /** a key's value at a level and where it comes from: that level, one above it, or Lineclear's own default */
  pick(key: string, l: Level = 'machine'): { value: string; from: LevelKind | 'default' } {
    const ok = levelsOf(key)
    const chain: Level[] = l === 'all' ? ['all'] : l === 'machine' ? ['machine', 'all'] : [l, 'machine', 'all']
    for (const x of chain) {
      const v = ok.includes(kindOfLevel(x)) ? this.at(x)[key] : undefined
      if (v !== undefined) return { value: v, from: kindOfLevel(x) }
    }
    return { value: defaultOf(key) ?? '', from: 'default' }
  }

  /** a key's value for a space of this machine (none: the machine's own) */
  get(key: string, space?: string): string {
    return this.pick(key, space ? { space } : 'machine').value
  }

  /** set (or with null, unset) a value at a level (Everywhere when none); refused values say why */
  set(key: string, value: string | null, l: Level = 'all'): { ok: boolean; error?: string } {
    if (!KEYS.includes(key)) return { ok: false, error: `No setting ${key}` }
    if (!levelsOf(key).includes(kindOfLevel(l)))
      return {
        ok: false,
        error: levelsOf(key).includes('machine') ? `${key} is set Everywhere or for one machine, not a space.` : `${key} is set Everywhere only.`,
      }
    if (value !== null && LINECLEAR_MODELS.has(key))
      return { ok: false, error: "Set in Lineclear's Settings > Models: its ordered lists pick the worker, reviewer and backup models." }
    if (value !== null) {
      const chat = key === 'task.agent' || key === 'coordinator.agent' || (key === 'task.fallback' && value.trim().toLowerCase() !== 'off')
      const err = refuse(key, value) ?? (chat ? chatProblem(kindOf(value) ?? value) : undefined) ?? this.unfit(key, value, l)
      if (err) return { ok: false, error: err }
      const num = numOf(key)
      // a number is kept with its unit, however it was written ("13", "1.5x", "80 %")
      if (num) value = numValue(num, value)!
      else if (key === 'time.zone') value = value.trim()
      // a CLI is kept by its name, however it was written
      else if (key === 'task.fallback' && value.trim().toLowerCase() === 'off') value = 'off'
      else if ((key.endsWith('.agent') || key === 'task.fallback') && value !== 'inherit') value = CLI_NAME[kindOf(value)!]
    }
    const at = typeof l === 'object' ? (this.d.spaces[l.space] ??= {}) : this.at(l)
    if (value === null) delete at[key]
    else at[key] = value
    if (typeof l === 'object' && !Object.keys(at).length) delete this.d.spaces[l.space]
    this.save()
    return { ok: true }
  }

  /** the Everywhere level, as the main machine hands it to the others */
  everywhere(): Values {
    return { ...this.d.everywhere }
  }

  /** take the main machine's Everywhere level (this one is not the main one) */
  adopt(all: Values) {
    const next = Object.fromEntries(Object.entries(all).filter(([k, v]) => KEYS.includes(k) && typeof v === 'string' && !refuse(k, v)))
    if (JSON.stringify(next) === JSON.stringify(this.d.everywhere)) return false
    this.d.everywhere = next
    this.save()
    return true
  }

  /** the CLI a role's agent runs at a level: its herdr kind; nothing for an unset backup */
  kindOf(role: Role, l: Level = 'machine'): string | undefined {
    return roleKind(role, (k) => this.pick(k, l).value)
  }

  /** why a model or effort doesn't fit the role's CLI (or its model) at a level: it lists what does */
  private unfit(key: string, value: string, l: Level): string | undefined {
    const [role, what] = key.split('.') as [Role, string]
    if (!ROLES.includes(role) || (what !== 'model' && what !== 'effort') || value.trim().toLowerCase() === 'default') return undefined
    const kind = this.kindOf(role, l)
    if (!kind || !modelsOf(kind)) return undefined
    if (what === 'model')
      return knowsModels(kind) && !findModel(kind, value)
        ? `${CLI_NAME[kind]} has no model ${value}. Pick one of: default · ${modelsOf(kind)!
            .models.map((m) => m.label)
            .join(' · ')}.`
        : undefined
    const model = this.pick(`${role}.model`, l).value
    const levels = effortsOf(kind, model)
    if (levels.includes(value.trim().toLowerCase())) return undefined
    return levels.length
      ? `${findModel(kind, model)?.label ?? CLI_NAME[kind]} takes ${['default', ...levels].join(' · ')}.`
      : `${findModel(kind, model)?.label ?? CLI_NAME[kind]} has no effort levels.`
  }

  /** what every new brief is told about how to work, for a space (none: this machine), with what the coordinator set
   *  for one task (task add --set) on top */
  ways(space?: string, set: Values = {}): Ways {
    return this.waysAt(space ? { space } : 'machine', set)
  }

  private waysAt(l: Level, set: Values = {}): Ways {
    const get = (key: string) => set[key] ?? this.pick(key, l).value
    const merge = get('brief.merge')
    const rounds = Number.parseInt(get('review.rounds'), 10)
    return {
      review: get('brief.review') !== 'off',
      mustFix: get('review.mustFix'),
      rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : 3,
      merge: merge === 'ask me first' ? merge : 'on its own',
      waitChecks: merge === 'after GitHub checks',
    }
  }

  /** who set each line of a brief's Settings block that differs from Lineclear's own default, for a space (none: this
   *  machine): the coordinator for this one task (set), else the most specific level it comes from */
  setBy(space?: string, set: Values = {}): Partial<Record<Said, SetBy>> {
    return this.setByAt(space ? { space } : 'machine', set)
  }

  private setByAt(l: Level, set: Values = {}): Partial<Record<Said, SetBy>> {
    const by = (...keys: string[]): SetBy | undefined => {
      if (keys.some((k) => k in set)) return 'task'
      const froms = keys
        .map((k) => ({ ...this.pick(k, l), key: k }))
        .filter((p) => p.from !== 'default' && p.value !== defaultOf(p.key))
        .map((p) => p.from)
      return (['space', 'machine', 'all'] as const).find((f) => froms.includes(f))
    }
    const all: Record<Exclude<Said, 'check'>, SetBy | undefined> = {
      review: by('brief.review'),
      reviewer: by('reviewer.agent', 'reviewer.model', 'reviewer.effort'),
      mustFix: by('review.mustFix'),
      rounds: by('review.rounds'),
      merge: by('brief.merge'),
      agent: by('task.agent', 'task.model', 'task.effort'),
    }
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v)) as Partial<Record<Said, SetBy>>
  }

  /** A launch snapshot, with the same per-role inheritance as other settings. Never part of a task's saved brief. */
  instructions(role: 'coordinator' | 'task' | 'reviewer', space?: string): string {
    const p = this.pick(`${role}.instructions`, space ? { space } : 'machine')
    const scope = { all: 'Everywhere', machine: 'this machine', space: `space ${space}`, default: 'default' }[p.from]
    return `Private instructions for ${role} (from ${scope}):\n${p.value.trim() || '(none)'}`
  }

  /** how long a task's shared browser may sit idle before it closes, in ms, at a level; null: it never does */
  idleClose(l: Level = 'machine'): number | null {
    const n = Number.parseFloat(this.pick('browser.idleClose', l).value)
    return Number.isFinite(n) && n > 0 ? n * 60_000 : null
  }

  /** when this machine's tasks may start, and when its coordinator is told it struggles, as numbers */
  machine(l: 'all' | 'machine' = 'machine'): MachineLimits {
    const get = (key: string) => this.pick(key, l).value
    const num = (key: string) => {
      const n = Number.parseFloat(get(key))
      return Number.isFinite(n) && n > 0 ? n : null
    }
    return {
      max: Math.max(1, Math.round(num('machine.maxTasks') ?? defaultMaxTasks())),
      startLoad: num('machine.startLoad'),
      startMemory: num('machine.startMemory'),
      alertLoad: num('machine.alertLoad'),
      alertMemory: num('machine.alertMemory'),
      alertDisk: num('machine.alertDisk'),
      alertHerdr: get('machine.alertHerdr') !== 'off',
    }
  }

  /** the CLI, model and effort tasks or coordinators start with, or tasks are reviewed by, for a space (none: this
   *  machine); nothing for a CLI's own default */
  harness(role: 'task' | 'coordinator' | 'reviewer', space?: string): { kind: string; model?: string; effort?: string } {
    return this.harnessAt(role, space ? { space } : 'machine')
  }

  private harnessAt(role: 'task' | 'coordinator' | 'reviewer', l: Level) {
    const kind = this.kindOf(role, l)!
    return { kind, ...this.modelAt(role, kind, l) }
  }

  /** a role's model and effort as its CLI takes them, for a space (none: this machine): one it doesn't have is its
   *  own default, a level its model lacks the nearest it has; nothing for the CLI's own */
  modelOf(role: Role, kind?: string, space?: string): { model?: string; effort?: string } {
    const l: Level = space ? { space } : 'machine'
    return this.modelAt(role, kind ?? this.kindOf(role, l), l)
  }

  private modelAt(role: Role, kind: string | undefined, l: Level): { model?: string; effort?: string } {
    const stored = this.pick(`${role}.model`, l).value
    if (!kind) return {}
    const model = stored === 'default' ? undefined : knowsModels(kind) ? findModel(kind, stored)?.id : modelsOf(kind) ? stored : undefined
    return { model, effort: effortFor(kind, this.pick(`${role}.effort`, l).value, model) }
  }

  /** every key with its value for a space (none: this machine) and where it comes from, as lineclear show prints
   *  them */
  lines(space?: string, host = 'this machine') {
    const l: Level = space ? { space } : 'machine'
    const name = { space: 'this space', machine: host, all: 'Everywhere', default: 'default' }
    const keys = (told: boolean) =>
      CATALOG.filter((s) => !!(s.told || s.prompt) === told).flatMap((s) =>
        s.rows
          .filter((r) => r.key !== 'alerts')
          .map((r) => {
            const p = this.pick(r.key, l)
            return `${r.key.padEnd(22)} ${p.value}  (${name[p.from]})`
          }),
      )
    return `What agents are told (private launch instructions and new briefs):\n${keys(true).join('\n')}\n\nHow Lineclear runs:\n${keys(false).join('\n')}`
  }

  /** the pages of every level this machine holds: Everywhere (the main machine's, which its others share), this
   *  machine, and each of its spaces */
  sections(
    devices: string[],
    machines: { name: string; state: string }[],
    plugins: SettingSection | null,
    host = 'this machine',
    spaces: string[] = [],
    name = host,
    pushWarnings: string[] = [],
  ): SettingSection[] {
    const levels: { l: Level; id: string }[] = [
      { l: 'all', id: 'all' },
      { l: 'machine', id: `m:${host}` },
      ...spaces.map((space) => ({ l: { space } as Level, id: `p:${host}:${space}` })),
    ]
    const fromName = (f: LevelKind | 'default') => (f === 'machine' ? name : 'Everywhere')
    const above = (l: Level): Level | null => (l === 'all' ? null : l === 'machine' ? 'all' : 'machine')
    const rows = (s: Section, l: Level) => {
      // the words each row of How tasks work adds to a brief, as its Settings block has them at this level
      const told = s.told ? settingsLines('<id>', { ways: this.waysAt(l), reviewer: this.harnessAt('reviewer', l), by: this.setByAt(l) }) : []
      const text = (said: Said) => told.find((x) => x.said === said)?.text
      const lines: Record<string, string | undefined> = s.told
        ? {
            'brief.review': text('review'),
            'reviewer.agent': text('reviewer'),
            'review.mustFix': text('mustFix'),
            'review.rounds': text('rounds'),
            'brief.merge': text('merge'),
          }
        : {}
      return s.rows.map((r) => {
        if (r.key === 'alerts')
          return {
            ...r,
            value: devices.length ? devices.join(', ') : 'No device yet',
            warn: pushWarnings.length
              ? `${pushWarnings.length} device${pushWarnings.length === 1 ? '' : 's'} could not receive the last alert.\n${pushWarnings.slice(0, 3).join('\n')}${pushWarnings.length > 3 ? '\nMore details: lineclear doctor' : ''}`
              : undefined,
          }
        const p = this.pick(r.key, l)
        const here = p.from === kindOfLevel(l)
        const up = above(l)
        // set here: what a reset goes back to; not set here: where its value comes from
        const back = up ? this.pick(r.key, up) : { value: defaultOf(r.key) ?? '', from: 'default' as const }
        return {
          ...agentRow({ ...r, value: p.value }, (k) => this.pick(k, l).value),
          ...(lines[r.key] ? { line: lines[r.key] } : {}),
          ...(here
            ? { inherits: { value: back.value, from: back.from === 'default' && l === 'all' ? 'Default' : fromName(back.from) } }
            : l === 'all'
              ? {}
              : { from: fromName(p.from) }),
        }
      })
    }
    const note = (s: Section, l: Level) =>
      s.name === 'Private instructions'
        ? {
            noteTitle: 'When rules take effect',
            note: 'Used at the next start or restart. Saving leaves running agents alone. A resumed session may remember old rules: the new snapshot replaces those private rules. Task agents pass the reviewer snapshot from their own latest start to each review; restart the task agent to refresh it.',
          }
        : s.name === 'How tasks work'
          ? { note: settingsBlock('<id>', { ways: this.waysAt(l), reviewer: this.harnessAt('reviewer', l), by: this.setByAt(l) }) }
          : s.name === 'Machine'
            ? machineNote(this.machine(l === 'all' ? 'all' : 'machine'))
            : {}
    return [
      ...levels.flatMap(({ l, id }) =>
        CATALOG.filter((s) => (s.levels ?? ['all', 'machine', 'space']).includes(kindOfLevel(l))).map((s) => ({
          name: s.name,
          about: s.about,
          rows: rows(s, l),
          ...note(s, l),
          level: id,
          ...(s.levels?.length === 1 ? { global: true } : {}),
          ...(s.told || s.prompt ? { told: true } : {}),
          ...(l === 'all' ? {} : { machine: host }),
        })),
      ),
      ...(plugins ? [plugins] : []),
      {
        name: 'Machines',
        about: 'Every machine Lineclear reaches, and how it is now.',
        rows: machines.map((m) => ({ label: m.name, key: '', value: m.state, fixed: true })),
      },
    ]
  }
}

/** task add's --set for one task: a How tasks work key by its Settings key or its short name, and the flag of task
 *  add's own the agent and reviewer keys stand for */
const ONE_TASK: Record<string, string> = {
  review: 'brief.review',
  merge: 'brief.merge',
  mustfix: 'review.mustFix',
  'must-fix': 'review.mustFix',
  rounds: 'review.rounds',
  'review-rounds': 'review.rounds',
}
const FLAG_OF: Record<string, string> = {
  'task.agent': 'agent',
  'task.model': 'model',
  'task.effort': 'effort',
  'reviewer.agent': 'reviewer',
  'reviewer.model': 'reviewer-model',
  'reviewer.effort': 'reviewer-effort',
}

/** one --set key=value: a How tasks work setting for this task as Settings keeps it, the task add flag it stands for
 *  (agent, model, effort, reviewer…), or why it can't be */
export function setForTask(pair: string): { key: string; value: string } | { flag: string; value: string } | { error: string } {
  const eq = pair.indexOf('=')
  const name = pair.slice(0, eq).trim()
  const value = pair
    .slice(eq + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
  const told = CATALOG.filter((x) => x.told).flatMap((x) => x.rows.map((r) => r.key))
  const short = name.toLowerCase()
  const key =
    told.find((k) => k.toLowerCase() === short) ??
    ONE_TASK[short] ??
    (FLAG_OF[`task.${short}`] && `task.${short}`) ??
    (short === 'reviewer' ? 'reviewer.agent' : Object.keys(FLAG_OF).find((k) => k.toLowerCase() === short))
  if (eq < 1 || !key)
    return {
      error: `--set takes key=value, a key of: ${[...told.filter((k) => !FLAG_OF[k]), 'agent', 'model', 'effort', 'reviewer', 'reviewer.model', 'reviewer.effort'].join(', ')} (lineclear show has them)`,
    }
  if (FLAG_OF[key]) return { flag: FLAG_OF[key], value }
  const err = refuse(key, value)
  if (err) return { error: `--set ${name}: ${err}` }
  const num = numOf(key)
  return { key, value: num ? numValue(num, value)! : value }
}

/** A repository's own destination; it has no machine or Everywhere fallback. */
export const repositorySection = (level: string, machine: string, base: string, install = ''): SettingSection => ({
  name: 'Repository',
  machine,
  level,
  rows: [
    {
      key: 'space.base',
      label: 'Base branch',
      value: base,
      text: true,
      hint: 'New tasks start from and merge into this branch. Existing tasks keep their target.',
    },
    {
      key: 'space.install',
      label: 'Install step',
      value: install,
      text: true,
      hint: 'Runs in each new task worktree before its agent starts. Empty: bun install --frozen-lockfile in Bun repos. off: none.',
    },
  ],
})
