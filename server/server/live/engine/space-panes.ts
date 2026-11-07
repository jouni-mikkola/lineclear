// What runs in a task's herdr space: idle shells left behind, and whether anything but the task's agent is at work.
import type { HerdrSpaces } from './worktrees.ts'

/** every idle shell in this folder with no agent in it, in a tab of its own named `tab` (a split the human added stays), or the space's one pane (the shell herdr
 *  opened it with) */
export async function idleShells(h: HerdrSpaces, ws: string, wt: string, tab: string): Promise<string[]> {
  try {
    const [panes, agents, tabs] = await Promise.all([h.panes(ws), h.agents(), h.tabs(ws)])
    const ours = new Set(tabs.filter((t) => t.label === tab && (t.pane_count ?? 1) === 1).map((t) => t.tab_id))
    const out: string[] = []
    for (const p of panes) {
      if ((panes.length > 1 && !(p.tab_id && ours.has(p.tab_id))) || (p.cwd ?? p.foreground_cwd) !== wt || agents.some((a) => a.pane_id === p.pane_id)) continue
      if (await h.paneIdle(p.pane_id)) out.push(p.pane_id)
    }
    return out
  } catch {
    return []
  }
}

/** something other than the task's agent runs in the space: an agent, or a command at work in a shell */
export async function busy(h: HerdrSpaces, ws: string, agentPane?: string) {
  try {
    const [panes, agents] = await Promise.all([h.panes(ws), h.agents()])
    for (const p of panes) {
      if (p.pane_id === agentPane) continue
      if (agents.some((a) => a.pane_id === p.pane_id) || !(await h.paneIdle(p.pane_id))) return true
    }
    return false
  } catch {
    return true
  }
}
