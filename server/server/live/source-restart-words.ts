import type { RestartInfo } from '../../shared/types.ts'
import { one, type Parsed } from './args.ts'
import { machineRef, runOn } from './box.ts'
import { CLIS, kindOf } from './settings.ts'
import { LiveSourceSecrets } from './source-secrets.ts'
import { fit } from './task-options.ts'

export class LiveSourceRestartWords extends LiveSourceSecrets {
  /** lineclear restart <space|id> [--agent CLI] [--model ID] [--effort LEVEL] [--save]: a task's agent restarts only
   *  its own task's */
  protected async restartCommand(target: string | undefined, p: Parsed, ctx: { chat?: string }) {
    const usage = 'lineclear restart <space|task id> [--agent CLI] [--model ID] [--effort LEVEL] [--save]'
    const odd = [...Object.keys(p.opts), ...p.flags].filter((f) => !['agent', 'model', 'effort', 'save'].includes(f))
    if (!target || odd.length) throw new Error(odd.length ? `Restart takes no --${odd[0]}: ${usage}` : usage)
    const ref = machineRef(target)
    if (ref.machine) {
      const l = this.peers?.byName(ref.machine)
      if (!l) throw new Error(`No machine called ${ref.machine}.`)
      const rest = [...Object.entries(p.opts).flatMap(([k, vs]) => vs.flatMap((v) => [`--${k}`, v])), ...[...p.flags].map((k) => `--${k}`)]
      return runOn(this.peers!, l, ['restart', ref.id, ...rest], undefined)
    }
    const t = this.engine.task(target)
    const peer = t ? undefined : this.taskOnPeers(target)
    const place = t || peer ? undefined : this.placeNamed(target)
    const key = t ? `${t.id}/Agent` : peer ? `${peer.id}/Agent` : place?.id
    if (!key) throw new Error(`No space or task ${target}; ${usage}`)
    if (ctx.chat?.includes('/') && ctx.chat !== key) throw new Error("A task's agent restarts only its own agent; ask the coordinator.")
    const cli = one(p, 'agent')
    const kind = cli === undefined ? undefined : kindOf(cli)
    if (cli !== undefined && !kind) throw new Error(`No CLI called ${cli}; herdr starts ${CLIS.join(', ')}`)
    const info = (await this.act({ type: 'restart-info', chat: key })) as { ok: boolean; error?: string; info?: RestartInfo; waiting?: boolean }
    if (info.waiting) throw new Error(`${target}'s machine is out of reach: restart it once it is back.`)
    if (!info.ok || !info.info) throw new Error(info.error ?? 'It could not be restarted.')
    const on = kind ?? info.info.want.kind
    // what Settings say unless named: the model and effort only where they fit the CLI it restarts on
    const keep = on === info.info.want.kind
    const opts = fit(p, '', on, keep ? info.info.want.model : undefined)
    const model = 'model' in opts ? opts.model || undefined : keep ? info.info.want.model : undefined
    const effort = 'effort' in opts ? opts.effort || undefined : keep ? info.info.want.effort : undefined
    const r = (await this.act({ type: 'restart', chat: key, kind: on, model, effort, save: p.flags.has('save') })) as {
      ok: boolean
      error?: string
      waiting?: boolean
      on?: string
    }
    if (r.waiting) return `${target}'s machine is out of reach: it restarts once it is back.`
    if (!r.ok) throw new Error(r.error ?? 'It could not be restarted.')
    return `Restarted ${t?.id ?? peer?.id ?? place!.name} on ${r.on}${p.flags.has('save') ? `, now its space's Settings too` : ''}. A card in its chat says so.`
  }
}
