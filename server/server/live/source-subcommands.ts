import { taskAlert } from '../../shared/alerts.ts'
import type { TaskRec } from './engine/engine.ts'
import { LiveSourceTaskWords } from './source-task-words.ts'

export class LiveSourceSubcommands extends LiveSourceTaskWords {
  /** what a task's alert says and where it opens: its open card, else its last reply; a done task's card */
  protected taskAlert(t: TaskRec, status = this.engine.statusOf(t), sub = this.engine.subOf(t, status)) {
    const shown = status === 'need' || status === 'ready' || status === 'done' ? status : 'need'
    return taskAlert(t, shown, sub, { task: this.chats.chat(`${t.id}/Agent`), project: status === 'done' ? this.chats.chat(t.project) : undefined })
  }
}
