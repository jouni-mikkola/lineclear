import { definePlugin, setUI } from '@client/kernel.ts'
import { PageIcon } from '@client/ui.tsx'
import { ArtifactList, useTaskOff, TaskArtifacts, PlaceArtifactsItem, PlaceArtifacts, Viewer } from './artifacts-lists.tsx'
import { SplitArtifact, ArtifactCard } from './artifacts-frame.tsx'
export type { Pick } from './artifacts-frame.tsx'
export { showInPanel, ArtifactFrame } from './artifacts-frame.tsx'

export default definePlugin({
  name: 'artifacts',
  setup(reg) {
    reg.views.artifacts = ArtifactList
    reg.views.artifact = SplitArtifact
    reg.taskPanel.push({ id: 'artifacts', order: 60, label: 'Artifacts', Icon: PageIcon, useOff: useTaskOff, View: TaskArtifacts })
    reg.placeMenu.push({ order: 70, joined: true, View: PlaceArtifactsItem })
    reg.chatBody.push({ when: (ui, key) => ui.arts === key && ui.term !== key, View: PlaceArtifacts })
    reg.keys.push({
      order: 0,
      // Esc goes back from a coordinator's artifacts to its chat
      handle: ({ e, ui }) => {
        if (!ui.arts || e.key !== 'Escape' || ui.viewer || ui.menu || (e.target as HTMLElement | null)?.closest?.('input, textarea, [role=menu]')) return false
        e.preventDefault()
        setUI({ arts: null })
        return true
      },
    })
    reg.messageParts.push({ order: 50, View: ArtifactCard })
    reg.overlays.push(Viewer)
  },
})
