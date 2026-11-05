import { definePlugin } from '@client/kernel.ts'
import { GlobeIcon } from '@client/ui.tsx'
import { browserOff, BrowserView } from './browser-view.tsx'
export { BrowserView, browserOff } from './browser-view.tsx'

export default definePlugin({
  name: 'browser',
  setup(reg) {
    reg.taskPanel.push({ id: 'browser', order: 50, label: 'Browser', Icon: GlobeIcon, useOff: browserOff, View: BrowserView })
  },
})
