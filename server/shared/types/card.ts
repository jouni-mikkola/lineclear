import type { HealthLevel } from './machine.ts'
import type { TaskStatus } from './task.ts'
import type { CardAsk } from './question.ts'

/** One small update card Lineclear posts in a project's coordinator chat. */
export interface UpdateCard {
  id: string
  /** the task it is about */
  task?: string
  /** the task's state when posted */
  status?: TaskStatus
  /** a few words on one line ("is merged"); a task's summary is in the task, never on its card */
  text: string
  /** the task's pull request, linked from the card */
  pr?: { number: number; url: string }
  /** a machine health card: what crossed its limit (or came back under it); text says it in words */
  health?: { level: HealthLevel; machine: string }
  /** the project's base branch went red on GitHub ("main"); text says which checks failed */
  red?: string
  /** its agent started again (text: "Restarted on pi (Model Code 6, high)") */
  restart?: boolean
  /** a task that needs you: a copy of what it asks, answered here as in its own chat */
  ask?: CardAsk
}
