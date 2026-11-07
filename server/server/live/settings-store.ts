import { Database } from 'bun:sqlite'
import { db, importOnce } from '../store.ts'
import { roleKind, type Role } from './settings-catalog.ts'
import { KEYS, levelsOf, kindOfLevel, defaultOf } from './settings-sections.ts'
import { refuse } from './settings-rules.ts'
import type { Stored, Values, Level, LevelKind } from './settings-types.ts'

const MAKE = 'create table if not exists settings (level text not null, key text not null, value text not null, primary key (level, key))'

/** a level's name in the table: all, machine or space:<name> */
const levelName = (l: Level) => (typeof l === 'object' ? `space:${l.space}` : l)

/** only keys Lineclear knows, with values it takes */
const kept = (v: unknown) => Object.entries((v ?? {}) as Values).filter(([k, x]) => KEYS.includes(k) && typeof x === 'string' && !refuse(k, x))

/** the defaults you set, one row per level and key: two processes setting different keys never lose each other's */
export class SettingsStore {
  protected store: Database

  /** seed: these values, kept only in memory */
  constructor(seed?: Stored) {
    this.store = seed ? new Database(':memory:') : db
    this.store.exec(MAKE)
    if (seed) this.fill(seed)
    else importOnce<Stored>('settings.json', (old, store) => this.fill(old, store))
  }

  private fill(from: Stored, store = this.store) {
    const put = store.query('insert or replace into settings (level, key, value) values (?, ?, ?)')
    const levels: [string, unknown][] = [
      ['all', from.everywhere],
      ['machine', from.machine],
      ...Object.entries(from.spaces ?? {}).map(([s, v]): [string, unknown] => [`space:${s}`, v]),
    ]
    for (const [level, values] of levels) for (const [key, value] of kept(values)) put.run(level, key, value)
  }

  private valueAt(l: Level, key: string): string | undefined {
    return (this.store.query('select value from settings where level = ? and key = ?').get(levelName(l), key) as { value: string } | null)?.value
  }

  /** a key's value at a level and where it comes from: that level, one above it, or Lineclear's own default */
  pick(key: string, l: Level = 'machine'): { value: string; from: LevelKind | 'default' } {
    const ok = levelsOf(key)
    const chain: Level[] = l === 'all' ? ['all'] : l === 'machine' ? ['machine', 'all'] : [l, 'machine', 'all']
    for (const x of chain) {
      const v = ok.includes(kindOfLevel(x)) ? this.valueAt(x, key) : undefined
      if (v !== undefined) return { value: v, from: kindOfLevel(x) }
    }
    return { value: defaultOf(key) ?? '', from: 'default' }
  }

  /** a key's value for a space of this machine (none: the machine's own) */
  get(key: string, space?: string): string {
    return this.pick(key, space ? { space } : 'machine').value
  }

  /** one row written or, with null, removed */
  protected put(l: Level, key: string, value: string | null) {
    if (value === null) this.store.query('delete from settings where level = ? and key = ?').run(levelName(l), key)
    else this.store.query('insert or replace into settings (level, key, value) values (?, ?, ?)').run(levelName(l), key, value)
  }

  /** the Everywhere level, as the main machine hands it to the others */
  everywhere(): Values {
    const rows = this.store.query("select key, value from settings where level = 'all'").all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((r) => [r.key, r.value]))
  }

  /** take the main machine's Everywhere level (this one is not the main one) */
  adopt(all: Values) {
    const next = Object.fromEntries(kept(all))
    if (JSON.stringify(Object.entries(next).sort()) === JSON.stringify(Object.entries(this.everywhere()).sort())) return false
    this.store
      .transaction(() => {
        this.store.exec("delete from settings where level = 'all'")
        for (const [k, v] of Object.entries(next)) this.put('all', k, v)
      })
      .immediate()
    return true
  }

  /** the CLI a role's agent runs at a level: its herdr kind; nothing for an unset backup */
  kindOf(role: Role, l: Level = 'machine'): string | undefined {
    return roleKind(role, (k) => this.pick(k, l).value)
  }
}
