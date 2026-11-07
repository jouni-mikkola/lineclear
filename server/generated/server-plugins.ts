// Written by scripts/build-plugins.ts from plugins.json and the human's own plugins. Do not edit.
import type { ServerPlugin } from '../server/plugin-api.ts'
import type { PluginEntry } from '../server/plugin-list.ts'
import reactions from '../plugins/reactions/server.ts'
import artifacts from '../plugins/artifacts/server.ts'
import worktree from '../plugins/worktree/server.ts'
import browser from '../plugins/browser/server.ts'
import health from '../plugins/health/server.ts'
import alerts from '../plugins/alerts/server.ts'

export const enabled = ["reactions","artifacts","worktree","browser","health","alerts"]
export const catalog: PluginEntry[] = [{"name":"reactions","from":"base","on":true},{"name":"artifacts","from":"base","on":true},{"name":"worktree","from":"base","on":true},{"name":"browser","from":"base","on":true},{"name":"health","from":"base","on":true},{"name":"alerts","from":"base","on":true}]
export const user: [string, () => Promise<{ default: ServerPlugin }>][] = []
export default [reactions, artifacts, worktree, browser, health, alerts]
