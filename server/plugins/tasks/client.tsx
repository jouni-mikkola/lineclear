import { definePlugin } from '@client/kernel.ts'
import { TaskList, TasksMenu, Automations, ArchivedLink, PrLink } from './tasks-lists.tsx'
import { ConfirmArchive } from './tasks-rows.tsx'

export default definePlugin({
  name: 'tasks',
  setup(reg) {
    reg.views.tasks = TaskList
    reg.views.tasksMenu = TasksMenu
    reg.tasksFooter.push(Automations, ArchivedLink)
    reg.overlays.push(ConfirmArchive)
    reg.agentHeader.push({ order: 40, View: PrLink })
  },
})
