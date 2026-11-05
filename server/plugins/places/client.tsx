import { definePlugin } from '@client/kernel.ts'
import { MarkRead } from '@client/unread.ts'
import { AddSpace } from './add.tsx'
import { SectionDialogs } from './section.tsx'
import { Places, NewSection, stepPlace } from './places-sections.tsx'
import { ConfirmRemove } from './places-items.tsx'

export default definePlugin({
  name: 'places',
  setup(reg) {
    reg.views.places = Places
    reg.views.placesMenu = NewSection
    reg.overlays.push(AddSpace, ConfirmRemove, MarkRead, SectionDialogs)
    reg.keys.push({ order: 1, handle: ({ e, ui, snap }) => stepPlace(e, ui, snap) })
  },
})
