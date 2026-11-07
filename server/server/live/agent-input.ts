import { herdr } from './herdr.ts'
import type { RpcAgent } from './agent-rpc.ts'
import type { AgentRecord, OutItem } from './agents-helpers.ts'

/** what getting text into an agent needs to know of the agents */
export interface InputHost {
  records: Record<string, AgentRecord>
  rpcs: Map<string, RpcAgent>
}

/** one thing into the agent. An RPC agent answers with what it did (started, queued or handled); a pane's CLI takes it
 *  from herdr and says nothing */
export async function putInto(h: InputHost, key: string, item: OutItem): Promise<string | undefined> {
  const rpc = h.rpcs.get(key)
  if (rpc) return rpc.prompt(item.text)
  await herdr.prompt(h.records[key].name, item.text)
  return undefined
}
