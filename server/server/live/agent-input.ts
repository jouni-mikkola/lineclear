import { herdr, type AgentInfo, type AgentStatus } from './herdr.ts'
import { inputHoldsText } from './paste-watch.ts'
import type { RpcAgent } from './agent-rpc.ts'
import { type AgentRecord, type OutItem, holdFrom, sleep } from './agents-helpers.ts'

/** what getting text into an agent's CLI needs to know of the agents */
export interface InputHost {
  records: Record<string, AgentRecord>
  rpcs: Map<string, RpcAgent>
  /** since when herdr lists an agent that just started but won't take input yet */
  unready: Map<string, number>
  /** the pane each agent was last started in, to find it again when herdr lists it without its name */
  startedIn: Map<string, string>
  readyMs: number
  submitMs: number
  paneAfter: number
  info(key: string): AgentInfo | undefined
  status(key: string): AgentStatus | 'gone'
}

const justStarted = (h: InputHost, key: string) => Date.now() - (h.records[key]?.started ?? 0) <= 120_000

/** one thing into the CLI. One just started takes no input yet: wait (at most readyMs) until herdr says it is ready, so
 *  the text is not pasted into a screen that is not listening */
export async function putInto(h: InputHost, key: string, item: OutItem) {
  const rpc = h.rpcs.get(key)
  if (rpc) return void (await rpc.prompt(item.text))
  if (justStarted(h, key)) for (let t = 0; h.info(key)?.interactive_ready === false && t < h.readyMs; t += 100) await sleep(100)
  await herdr.prompt(h.records[key].name, item.text)
  void submitted(h, key)
}

/** herdr's named agent never came up: after paneAfter the text is typed into the task's pane, so a brief always arrives */
export async function typeIntoPane(h: InputHost, key: string, item: OutItem, e: unknown) {
  if (holdFrom(e) !== 'start' || item.idle) return false
  const since = h.unready.get(key) ?? Date.now()
  h.unready.set(key, since)
  const pane = h.info(key)?.pane_id ?? h.startedIn.get(key)
  if (!pane || Date.now() - since < h.paneAfter) return false
  // a shell at its prompt would run the text as a command
  if (await herdr.paneIdle(pane).catch(() => true)) return false
  await herdr.paneText(pane, item.text)
  await herdr.paneKeys(pane, ['enter'])
  return true
}

/** a CLI still starting can take a pasted message without its Enter: the turn is waited for (status working), and if the
 *  agent is still idle after, Enter goes again, until it works or its input is empty (an unreadable screen gets the Enter
 *  too). Never the text again: it sits in the input. */
async function submitted(h: InputHost, key: string) {
  if (!justStarted(h, key)) return
  const took = async () => {
    const step = Math.min(100, h.submitMs)
    for (let t = 0; t < h.submitMs; t += step) {
      if (['working', 'blocked', 'gone'].includes(h.status(key))) return true
      await sleep(step)
    }
    return false
  }
  for (let tries = 0; tries < 5 && !(await took()); tries++) {
    const pane = h.info(key)?.pane_id
    if (!pane || h.status(key) !== 'idle') return
    const screen = await herdr.visible(pane).catch(() => undefined)
    if (screen !== undefined && !inputHoldsText(screen)) return
    await herdr.paneKeys(pane, ['enter']).catch(() => undefined)
  }
}
