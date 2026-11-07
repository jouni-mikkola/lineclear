import type { SetBy } from '../../shared/brief.ts'
import { chatProblem } from './readers/index.ts'
import type { Said, Ways } from './settings-block.ts'
import { projectModel } from './project-models.ts'
import { effortFor, effortsOf, findModel, knowsModels, modelsOf } from '../../../src/models.ts'
import { LINECLEAR_MODELS, kindOf, CLI_NAME, type Role, ROLES } from './settings-catalog.ts'
import { defaultMaxTasks, KEYS, levelsOf, kindOfLevel, defaultOf, numOf } from './settings-sections.ts'
import { numValue, refuse } from './settings-rules.ts'
import { SettingsStore } from './settings-store.ts'
import type { MachineLimits, Values, Level } from './settings-types.ts'

/** the rules on top of the stored values: what may be set, what a brief or a machine takes from them */
export class SettingsRules extends SettingsStore {
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
    this.put(l, key, value)
    return { ok: true }
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
    const model = this.storedModel(role, l)
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

  protected waysAt(l: Level, set: Values = {}): Ways {
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

  protected setByAt(l: Level, set: Values = {}): Partial<Record<Said, SetBy>> {
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

  protected harnessAt(role: 'task' | 'coordinator' | 'reviewer', l: Level) {
    const kind = this.kindOf(role, l)!
    return { kind, ...this.modelAt(role, kind, l) }
  }

  /** a role's model and effort as its CLI takes them, for a space (none: this machine): one it doesn't have is its
   *  own default, a level its model lacks the nearest it has; nothing for the CLI's own */
  modelOf(role: Role, kind?: string, space?: string): { model?: string; effort?: string } {
    const l: Level = space ? { space } : 'machine'
    return this.modelAt(role, kind ?? this.kindOf(role, l), l)
  }

  /** a role's model: the head of its project's list for a space, the stored pick elsewhere */
  protected storedModel(role: Role, l: Level): string {
    return (typeof l === 'object' ? projectModel(l.space, role) : undefined) ?? this.pick(`${role}.model`, l).value
  }

  private modelAt(role: Role, kind: string | undefined, l: Level): { model?: string; effort?: string } {
    const stored = this.storedModel(role, l)
    if (!kind) return {}
    const model = stored === 'default' ? undefined : knowsModels(kind) ? findModel(kind, stored)?.id : modelsOf(kind) ? stored : undefined
    return { model, effort: effortFor(kind, this.pick(`${role}.effort`, l).value, model) }
  }
}
