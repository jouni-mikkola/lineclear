// Written by scripts/build-plugins.ts from plugins.json and the human's own plugins. Do not edit.
import type { ServerPlugin } from '../server/plugin-api.ts'
import type { PluginEntry } from '../server/plugin-list.ts'
import places from '../plugins/places/server.ts'
import coordinators from '../plugins/coordinators/server.ts'
import tasks from '../plugins/tasks/server.ts'
import chat from '../plugins/chat/server.ts'
import reactions from '../plugins/reactions/server.ts'
import artifacts from '../plugins/artifacts/server.ts'
import terminal from '../plugins/terminal/server.ts'
import worktree from '../plugins/worktree/server.ts'
import browser from '../plugins/browser/server.ts'
import health from '../plugins/health/server.ts'
import alerts from '../plugins/alerts/server.ts'
import keyboard from '../plugins/keyboard/server.ts'
import autopilot from '../plugins/autopilot/server.ts'

export const enabled = ["places","coordinators","tasks","chat","reactions","artifacts","terminal","worktree","browser","health","alerts","keyboard","autopilot"]
export const catalog: PluginEntry[] = [{"name":"places","from":"base","on":true},{"name":"coordinators","from":"base","on":true},{"name":"tasks","from":"base","on":true},{"name":"chat","from":"base","on":true},{"name":"reactions","from":"base","on":true},{"name":"artifacts","from":"base","on":true},{"name":"terminal","from":"base","on":true},{"name":"worktree","from":"base","on":true},{"name":"browser","from":"base","on":true},{"name":"health","from":"base","on":true},{"name":"alerts","from":"base","on":true},{"name":"keyboard","from":"base","on":true},{"name":"autopilot","from":"base","on":true}]
export const user: [string, () => Promise<{ default: ServerPlugin }>][] = []
export default [places, coordinators, tasks, chat, reactions, artifacts, terminal, worktree, browser, health, alerts, keyboard, autopilot]
