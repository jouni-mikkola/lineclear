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
  /** where each agent's CLI was last bound, and whether it took */
  private tried = new Map<string, { pane: string; at: number; ok: boolean }>()
  private repairing = false

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
    const { records, stopping, secretAccess } = this.host
    const p = await herdr.processInfo(pane)
    const proc = p.foreground_processes?.find((x) => x.pid && isAgentProcess(r.kind, x.argv))
    if (!proc?.pid || r.finished || records[r.key]?.finished || stopping.has(r.key)) return this.drop(r.key)
    const env = agentEnv(r.key, ROOT)
    const chain = this.host.secretScope(r.key)
    const route = {
      chat: r.key,
      cwd: r.cwd,
      capability: chain ? secretAccess.issue(r.key, `${proc.pid}:${r.started}`, chain) : undefined,
      credentialFile: records[r.key]?.env?.LINECLEAR_SECRET_FILE ?? r.env?.LINECLEAR_SECRET_FILE ?? env.LINECLEAR_SECRET_FILE,
      ...(BOX ? { helper: env.LINECLEAR_COMMAND } : { url: env.LINECLEAR_URL }),
    }
    const signature = JSON.stringify([proc.pid, route])
    if (this.bound.get(r.key) !== signature) {
      const router = join(BOX ? helperDir(BOX.home) : join(ROOT, 'helper'), 'route.pl')
      const result = await run(['perl', router, '--bind', String(proc.pid)], { stdin: JSON.stringify(route), timeoutMs: 5000 })
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

  /** a route is bound when an agent is first seen in its pane (a restored session), and again after a failure, at
   *  most every 30 s: never on a timer for one that is bound */
  async repair() {
    if (this.repairing) return
    this.repairing = true
    try {
      for (const r of Object.values(this.host.records)) {
        const a = this.host.live.get(r.name)
        const was = this.tried.get(r.key)
        if (!a) this.tried.delete(r.key)
        if (!a || (was && was.pane === a.pane_id && (was.ok || Date.now() - was.at < 30_000))) continue
        const tried = { pane: a.pane_id, at: Date.now(), ok: true }
        this.tried.set(r.key, tried)
        await this.bind(r, a.pane_id)
          .then(() => (tried.ok = this.has(r.key))) // no CLI in the pane yet binds nothing
          .catch((e) => {
            tried.ok = false
            console.error(`lineclear: routing ${r.key}: ${e.message}`)
          })
      }
    } finally {
      this.repairing = false
    }
  }
}
