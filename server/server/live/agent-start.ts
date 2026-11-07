import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { herdr } from './herdr.ts'
import { effortFor, modelArg } from '../../../src/models.ts'
import * as task from './mfs.ts'
import { type AgentRecord, type Spec, ownOldPane, promptPath, sleep } from './agents-helpers.ts'

/** a name herdr accepts: [a-z][a-z0-9_-]{0,31} */
export function agentName(s: string) {
  const n = s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
    .replace(/-+$/, '')
  return n || `shep-${randomUUID().slice(0, 6)}`
}

/** a launch's spec onto its record: what it leaves unsaid stays as the record had it */
export function applySpec(r: AgentRecord, spec: Omit<Spec, 'first' | 'pane' | 'was' | 'fresh' | 'rpc'>) {
  Object.assign(r, {
    name: spec.name,
    kind: spec.kind,
    cwd: spec.cwd,
    workspace: spec.workspace,
    tab: spec.tab ?? r.tab,
    env: spec.env ?? r.env,
    access: spec.access ?? r.access,
    model: spec.model ?? r.model,
    effort: spec.effort ?? r.effort,
    system: spec.system ?? r.system,
    set: spec.set ?? r.set,
    finished: false,
    launch: randomUUID(),
    started: Date.now(),
  })
}

/** the workspace labelled so, or the one still labelled `was` (never a repo's), renamed to it */
export async function findSpace(label: string, was?: string) {
  const list = await herdr.workspaces()
  const ws = list.find((w) => w.label === label)
  const old = !ws && was ? list.find((w) => w.label === was && !w.worktree) : undefined
  if (old) await herdr.renameWorkspace(old.workspace_id, label)
  return ws ?? old
}

/** the pane an agent starts in: its workspace's new tab, or a new workspace */
export async function paneFor(r: AgentRecord, was?: string): Promise<string> {
  const env = r.env ?? {}
  const ws = await findSpace(r.workspace, was)
  if (!ws) return (await herdr.createWorkspace(r.workspace, r.cwd, env)).root_pane.pane_id
  const tab = r.tab ?? r.name
  // a coordinator is one per space: its earlier tabs (dead, or restored by herdr) go when it starts again. A tab with a
  // split, a running command or an agent is the human's, and stays
  const older = tab === 'coordinator' ? await herdr.tabs(ws.workspace_id).catch(() => []) : []
  const made = await herdr.createTab(ws.workspace_id, tab, r.cwd, env)
  const gone = older.filter((t) => t.label === tab && t.tab_id !== made.tab?.tab_id && (t.pane_count ?? 1) === 1)
  if (gone.length) {
    const [panes, agents] = await Promise.all([herdr.panes(ws.workspace_id), herdr.agents()]).catch(() => [[], []] as const)
    for (const t of gone)
      for (const p of panes.filter((p) => p.tab_id === t.tab_id && !agents.some((a) => a.pane_id === p.pane_id)))
        if (await herdr.paneIdle(p.pane_id).catch(() => false)) await herdr.closePane(p.pane_id).catch(() => undefined)
  }
  return made.root_pane.pane_id
}

/** herdr starts the agent in its pane; a new pane needs a moment before its shell is at the prompt */
export async function startIn(r: AgentRecord, pane: string, args: string[]) {
  for (let i = 0; ; i++) {
    try {
      return await herdr.start(r.name, r.kind, pane, args)
    } catch (e) {
      if ((e as { code?: string }).code === 'agent_not_ready') return
      // the agent's own earlier pane (Done, still open) holds its name: closed, then started again
      const old = ownOldPane(e, await herdr.agents().catch(() => []), r.name, pane)
      if (old) {
        await herdr.closePane(old).catch(() => undefined)
        continue
      }
      if (i >= 8) {
        console.error(`lineclear: could not start ${r.name}: ${(e as Error).message}`)
        r.finished = true
        await herdr.closePane(pane).catch(() => undefined)
        throw e
      }
      await sleep(750)
    }
  }
}

/** the CLI's flags. Instructions go in a file: long text with quotes and newlines can't travel as a shell argument */
export async function launchArgs(r: AgentRecord): Promise<string[]> {
  if (r.kind !== 'pi') return []
  // a model is kept by its id, or by its name when picked in the chat's menu; an effort its model lacks goes in as the nearest it has
  const model = modelArg(r.kind, r.model)
  const effort = effortFor(r.kind, r.effort, r.model)
  if (r.system) {
    await task.mkdir(dirname(promptPath(r.name)), { recursive: true })
    await task.writeFile(promptPath(r.name), r.system)
  }
  return [
    ...(r.sessionId ? ['--session-id', r.sessionId] : []),
    ...(r.system ? ['--append-system-prompt', promptPath(r.name)] : []),
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--thinking', effort] : []),
  ]
}

/** the files Lineclear starts its CLI with now, by flag. One started with others (herdr restored an older command) runs without them */
export const launchFiles = (r: AgentRecord): Record<string, string> => (r.kind === 'pi' && r.system ? { '--append-system-prompt': promptPath(r.name) } : {})
