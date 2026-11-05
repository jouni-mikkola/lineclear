import { registry, setUI, taskOf, useUI } from './kernel.ts'
import { Stack } from './Stack.tsx'
import type { Snapshot } from '@shared/types.ts'
import { TaskPage, PhoneHome } from './App-Panes.tsx'

/* ---------- phone: one column, Chat | Tasks ---------- */

export function PhoneLayout({ snap }: { snap: Snapshot }) {
  const task = taskOf(
    snap,
    useUI((u) => u.task),
  )
  const settings = useUI((u) => !!u.settings)
  const Settings = registry.views.settings
  // a task's chat, or settings, push over the place
  const top = settings && Settings ? <Settings /> : task ? <TaskPage task={task} /> : null
  return (
    <Stack
      base={<PhoneHome snap={snap} />}
      top={top}
      topKey={settings ? 'settings' : (task?.id ?? null)}
      onBack={() => setUI(settings ? { settings: null } : { task: null })}
    />
  )
}
