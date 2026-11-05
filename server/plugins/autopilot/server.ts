import { definePlugin } from '../../server/plugin-api.ts'

export default definePlugin({
  name: 'autopilot',
  about:
    'coordinator timer: a coordinator that works on its own, woken by news and by a heartbeat (its HEARTBEAT.md, while idle), switched back off when things break',
})
