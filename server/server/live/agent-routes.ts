import { join } from 'node:path'
import { herdr, type AgentInfo } from './herdr.ts'
import { agentEnv, BOX, helperDir, run } from './box.ts'
import { ROOT } from '../root.ts'
import type { SecretAccess } from './secret-access.ts'
import { isAgentProcess } from './agent-process.ts'
import { type AgentRecord, ROUTING_FAILURE } from './agents-helpers.ts'

export interface RouteHost {
  records: Record<string, AgentRecord>
  live: Map<string, AgentInfo>
  stopping: Set<string>
  secretAccess: SecretAccess
  secretScope(chat: string): string[] | undefined
  emit(event: 'routed', key: string): void
}

/** binds each agent's CLI process to its private `lineclear` command route (helper/route.pl) */
export class AgentRoutes {
  private bound = new Map<string, string>()

  constructor(private host: RouteHost) {}

  has(key: string) {
    return this.bound.has(key)
  }

  drop(key: string) {
    this.host.secretAccess.revoke(key)
    this.bound.delete(key)
  }

  /** Bind the actual CLI process, not HERDR_PANE_ID (old shells can inherit another pane's id). */
  async bind(r: AgentRecord, pane: string) {
    const p = await herdr.processInfo(pane)
    const proc = p.foreground_processes?.find((x) => x.pid && isAgentProcess(r.kind, x.argv))
    return this.bindPid(r, proc?.pid)
  }

  /** the route as an environment for an RPC child of this server: its command reads it, no process is bound */
  envFor(r: AgentRecord): Record<string, string> {
    const chain = this.host.secretScope(r.key)
    this.bound.set(r.key, 'env')
    return { LINECLEAR_ROUTED: '1', LINECLEAR_SECRET_CAPABILITY: chain ? this.host.secretAccess.issue(r.key, `rpc:${r.started}`, chain) : '' }
  }

  private async bindPid(r: AgentRecord, pid: number | undefined) {
    const { records, stopping, secretAccess } = this.host
    if (!pid || r.finished || records[r.key]?.finished || stopping.has(r.key)) return this.drop(r.key)
    const env = agentEnv(r.key, ROOT)
    const chain = this.host.secretScope(r.key)
    const route = {
      chat: r.key,
      cwd: r.cwd,
      capability: chain ? secretAccess.issue(r.key, `${pid}:${r.started}`, chain) : undefined,
      credentialFile: records[r.key]?.env?.LINECLEAR_SECRET_FILE ?? r.env?.LINECLEAR_SECRET_FILE ?? env.LINECLEAR_SECRET_FILE,
      ...(BOX ? { helper: env.LINECLEAR_COMMAND } : { url: env.LINECLEAR_URL }),
    }
    const signature = JSON.stringify([pid, route])
    if (this.bound.get(r.key) !== signature) {
      const router = join(BOX ? helperDir(BOX.home) : join(ROOT, 'helper'), 'route.pl')
      const result = await run(['perl', router, '--bind', String(pid)], { stdin: JSON.stringify(route), timeoutMs: 5000 })
      if (result.code) {
        this.drop(r.key)
        throw new Error(ROUTING_FAILURE)
      }
      // a stop may have raced the asynchronous provisioning write: never restore its authority
      if (records[r.key]?.finished || stopping.has(r.key)) return secretAccess.revoke(r.key)
      this.bound.set(r.key, signature)
    }
    this.host.emit('routed', r.key)
  }
}
