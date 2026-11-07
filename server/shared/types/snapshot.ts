import type { Place } from './place.ts'
import type { Machine } from './machine.ts'
import type { Task } from './task.ts'
import type { SettingSection } from './settings.ts'

export interface Snapshot {
  name: string
  host: string
  /** every space */
  places: Place[]
  /** the machines, as headings over their spaces */
  machines: Machine[]
  tasks: Task[]
  /** open coordinator questions, by place id (a choice card's id, or "blocked" on the CLI's own menu): counted as waiting on you */
  asks: Record<string, string>
  settings: SettingSection[]
  /** where the human's name in chat lines comes from */
  user: string
}
