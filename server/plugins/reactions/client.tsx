import { definePlugin } from '@client/kernel.ts'
import { buzz } from '@client/motion.ts'
import { Pills } from './reactions-bar.tsx'
import { Popup } from './reactions-picker.tsx'
export { quick, mine, react, openBar, openPicker } from './reactions-bar.tsx'
export { EmojiChooser } from './reactions-picker.tsx'

export { buzz }

export default definePlugin({
  name: 'reactions',
  setup(reg) {
    reg.messageEdge.push({ order: 100, View: Pills })
    reg.overlays.push(Popup)
  },
})
