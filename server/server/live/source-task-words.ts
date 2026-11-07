import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { doneNewestFirst, type RestartInfo } from '../../shared/types.ts'
import { one, summaryOpts, type Parsed } from './args.ts'
import { checkTitle } from './engine/engine.ts'
import { ended } from './engine/engine-helpers.ts'
import { commitsOf, StepClaims, stepIdOfTitle, whyStepRefused } from './engine/step-once.ts'
import { validateBase } from './engine/github.ts'
import { checkResult } from './engine/result.ts'
import { BOX, machineRef, noTasks, runOn } from './box.ts'
import { NAME, placeId } from './places.ts'
import { CLI_NAME, CLIS, kindOf, setForTask } from './settings.ts'
import { statusLine, taskAddArgs } from './source-helpers.ts'
import { fit, harnessOf, reviewerOf } from './task-options.ts'
import { LiveSourceSecrets } from './source-secrets.ts'

export class LiveSourceTaskWords extends LiveSourceSecrets {
  private stepClaims = new StepClaims()

  protected async taskCommand(sub: string | undefined, rest: string[], p: Parsed, ctx: { chat?: string; cwd?: string }) {
    if (sub === 'add') {
      if (!rest[0]?.trim()) throw new Error('lineclear task add "<title>" --desc "<the whole brief>"')
      if (p.flags.has('after')) throw new Error('--after needs the tasks it waits for: --after SHE-12,SHE-13')
      const odd = [...Object.keys(p.opts), ...p.flags].filter(
        (f) =>
          ![
            'brief',
            'desc',
            'result',
            'space',
            'base',
            'after',
            'later',
            'agent',
            'model',
            'effort',
            'reviewer',
            'reviewer-model',
            'reviewer-effort',
            'set',
            'on',
            'reopened',
          ].includes(f),
      )
      if (odd.length)
        throw new Error(
          `Task add takes no --${odd[0]}: only --desc, --result, --space, --base, --after, --later, --set, --agent, --model, --effort, --reviewer, --reviewer-model, --reviewer-effort, --on and --reopened`,
        )
      // --set key=value: a How tasks work setting for this task, or what --agent, --reviewer and the like set
      const set: Record<string, string> = {}
      for (const pair of p.opts.set ?? []) {
        const r = setForTask(pair)
        if ('error' in r) throw new Error(r.error)
        if ('flag' in r) (p.opts[r.flag] ??= []).push(r.value)
        else set[r.key] = r.value
      }
      const bare = [...p.flags].filter((f) => f !== 'later')[0]
      if (bare) throw new Error(`--${bare} needs a value`)
      const [title, result] = [checkTitle(rest[0]), checkResult(one(p, 'result'))]
      const named = one(p, 'space')
      if (named && !this.places.byName(named) && !this.places.byKey(named) && !this.places.space(named)) {
        // Helpers reach their own worker. Delegate a foreign target through the owning main installation.
        if (BOX && process.env.LINECLEAR_MAIN_HOME) {
          const server = JSON.parse(readFileSync(join(process.env.LINECLEAR_MAIN_HOME, 'server.json'), 'utf8')) as { port: number }
          const r = await fetch(`http://127.0.0.1:${server.port}/api/cli`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ args: taskAddArgs(rest, p), chat: this.requestedNews.known(ctx.chat) }),
            signal: AbortSignal.timeout(20_000),
          })
          const result = (await r.json()) as { out: string; code: number }
          if (result.code) throw new Error(result.out.trim())
          return result.out.trim()
        }
        const targets = (this.peers?.list() ?? []).flatMap((l) =>
          (l.snap?.places ?? []).filter((x) => !x.home && (x.id === named || x.name === named)).map((x) => ({ l, x })),
        )
        if (targets.length > 1) throw new Error('Several spaces have that name; use its full p:machine:space identity.')
        if (targets.length === 1) {
          const { l, x } = targets[0]
          const args = taskAddArgs(rest, p, x.id.split(':').slice(2).join(':'))
          const result = await this.onPeer<{ out: string; code: number }>(l, '/api/cli', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ args, chat: this.requestedNews.known(ctx.chat) }),
          })
          if (result.code) throw new Error(result.out.trim())
          return result.out.trim()
        }
      }
      const pr = named && this.places.space(named) ? this.places.space(named)! : this.projectFor(p, ctx)
      // claimed before the first await: a second add of the step on this board meets the claim, not a gap
      const stepId = stepIdOfTitle(title)
      const repo = pr.github ?? pr.path
      const first = stepId ? this.stepClaims.take(repo, stepId, this.byWho(ctx)) : undefined
      if (first !== undefined) throw new Error(`Step ${stepId} is being started by ${first} already: one agent per step.`)
      let t: ReturnType<typeof this.engine.add>
      try {
        await validateBase(pr.path, one(p, 'base') ?? pr.base)
        const commits = stepId && one(p, 'reopened') !== 'true' ? await commitsOf(pr.path, one(p, 'base') ?? pr.base) : []
        const open = this.engine.tasks.filter((x) => x.project === placeId.space(pr.name) && !x.archived && !ended(x))
        const elsewhere = (this.peers?.list() ?? []).flatMap((l) =>
          (l.snap?.tasks ?? [])
            .filter((x) => x.status !== 'done' && !x.archived && x.place === placeId.space(pr.name))
            .map((x) => ({ id: `${l.rec.machine}:${x.id}`, title: x.name })),
        )
        const refused = whyStepRefused(title, [...open, ...elsewhere], commits)
        if (refused) throw new Error(refused)
        const after = p.opts.after ?? []
        const agent = harnessOf(p, this.settings)
        const reviewer = reviewerOf(p, this.settings)
        const where = one(p, 'on')
        if (where && !this.engine.machines.has(where)) throw new Error(`No machine called ${where}: \`lineclear machine list\` names them.`)
        t = this.engine.add({
          project: pr.name,
          machine: where,
          base: one(p, 'base'),
          title,
          result,
          desc: one(p, 'brief') ?? one(p, 'desc'),
          by: this.byWho(ctx),
          requester: this.requestedNews.known(ctx.chat),
          after,
          later: p.flags.has('later'),
          agent,
          reviewer,
          set,
        })
      } finally {
        if (stepId) this.stepClaims.release(repo, stepId)
      }
      const on = [CLI_NAME[t.agent!.kind] ?? t.agent!.kind, t.agent!.model, t.agent!.effort && `${t.agent!.effort} effort`].filter(Boolean).join(', ')
      if (t.after?.length)
        return `Added ${t.id}: ${t.title}, queued after ${t.after.join(', ')}. Its agent (${on}) reads the brief now and waits; Lineclear tells it to go once ${t.after.length === 1 ? 'that task is' : 'they are all'} done.`
      if (p.flags.has('later'))
        return `Added ${t.id}: ${t.title}, for later. Its agent (${on}) reads the brief now and waits for a go (lineclear task tell ${t.id} "go").`
      if (t.held)
        return `Added ${t.id}: ${t.title}, held: ${t.held.why === 'slots' ? `all ${this.settings.machine().max} slots are taken` : 'the machine is busy'} (${this.workingLine()}). It shows as Queued and its agent (${on}) starts by itself when there's room, oldest first.`
      return `Added ${t.id}: ${t.title}. Its agent (${on}) starts on the brief now.${p.opts.after?.length ? ' What it would wait for is done already.' : ''}`
    }
    if (sub === 'list' || !sub) {
      const pr = one(p, 'space') ? this.projectFor(p, ctx) : null
      // archived tasks only with --archived, and then only they
      const shown = (t: { archived?: unknown }) => !!t.archived === p.flags.has('archived')
      const ts = this.engine.tasks.filter((t) => (!pr || t.project === placeId.space(pr.name)) && shown(t)).map((t) => this.engine.view(t))
      const others = pr ? [] : (this.peers?.list() ?? []).flatMap((l) => (l.snap?.tasks ?? []).filter(shown).map((t) => ({ ...t, machine: l.rec.machine })))
      const all = doneNewestFirst<(typeof ts)[number] | (typeof others)[number]>([...ts, ...others])
      if (p.flags.has('json'))
        return JSON.stringify(
          all.map((t) => ({
            id: t.id,
            title: t.name,
            status: t.status,
            result: 'result' in t ? t.result : undefined,
            sub: statusLine(t),
            closed: 'closed' in t && t.closed ? true : undefined,
            closedBy: 'closedBy' in t && t.closed ? t.closedBy : undefined,
            machine: 'machine' in t && t.machine ? t.machine : NAME,
            space: 'place' in t ? t.place.split(':').slice(2).join(':') : undefined, // the name `--space` takes
            archived: t.archived,
            pinned: t.pinned,
            orphaned: t.orphaned,
            // the owner stopped it; a tell would start it again
            stopped: this.engine.tasks.some((r) => r.id === t.id && r.stopped) || undefined,
          })),
          null,
          2,
        )
      const rows = all.map(
        (t) =>
          `${t.id.padEnd(8)} ${t.status.padEnd(5)} ${t.name}${t.pinned ? '  (pinned)' : ''}${statusLine(t) ? `  · ${statusLine(t)}` : ''}  (on ${'machine' in t && t.machine ? t.machine : NAME})`,
      )
      const archived = p.flags.has('archived') ? 0 : this.engine.tasks.filter((t) => t.archived && (!pr || t.project === placeId.space(pr.name))).length
      const tail = archived ? `\n(${archived} archived: lineclear task list --archived)` : ''
      return (rows.join('\n') || (p.flags.has('archived') ? 'No archived tasks.' : noTasks())) + tail
    }
    if (sub === 'merge') return this.mergeCommand(rest[0], ctx)
    if (sub === 'delete') {
      if (ctx.chat?.includes('/')) throw new Error("A task's agent can't delete tasks; only a coordinator does, when the human plainly asks.")
      const t = this.engine.task(rest[0] ?? '')
      if (!t) throw new Error(`No task ${rest[0] ?? ''}; lineclear task delete <id> [--force]`)
      const left = await this.deleteTask(t.id, p.flags.has('force'))
      return `Deleted ${t.id}: its agent, chat, working folder and branch are gone${left.length ? `, except ${left.join(', ')} (remove that by hand)` : ''}.${t.merged ? ` Its commits stay on ${t.base ?? 'main'}.` : ''}`
    }
    const t = this.engine.task(rest[0] ?? '')
    if (!t) throw new Error(`No task ${rest[0] ?? ''}`)
    // the words that go by another name
    const alias: Record<string, string> = { unarchive: 'archive', unpin: 'pin' }
    const words: Record<string, () => string | Promise<string>> = {
      show: async () => {
        const v = this.engine.view(t)
        if (p.flags.has('json')) return JSON.stringify(v, null, 2)
        return [
          `${v.id} ${v.name}`,
          `State: ${v.state}${statusLine(v) ? ` · ${statusLine(v)}` : ''}${v.pinned ? ' · pinned' : ''}`,
          v.result ? `Result: ${v.result}` : '',
          `Added: ${v.created}`,
          v.branch ? `Branch: ${v.branch}` : '',
          v.base ? `Merges into: ${v.base}` : '',
          v.mergeStopped ? `Merge stopped: ${v.mergeStopped}` : '',
          v.desc ? `\n${v.desc}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      },
      tell: async () => {
        // a coordinator's go to a task that waits starts it only when this machine has room
        const r = await this.engine.tell(t.id, rest.slice(1).join(' '), { gate: !ctx.chat?.includes('/') })
        if (r.held)
          return `${t.id} is held: ${r.held === 'slots' ? `all ${this.settings.machine().max} slots are taken` : 'the machine is busy'} (${this.workingLine()}). It shows as Queued and gets your message when there's room, oldest first.`
        return `Told ${t.id}.`
      },
      queue: async () => {
        const refs = p.opts.after ?? []
        if (!refs.length) throw new Error('lineclear task queue <id> --after SHE-12[,SHE-13]  (--after none clears it)')
        const none = refs.length === 1 && /^(none|nothing|-)$/i.test(refs[0].trim())
        const r = this.engine.queue(t.id, none ? [] : refs, { self: ctx.chat === `${t.id}/Agent` })
        if (r.queued.length)
          return `${t.id} is queued after ${r.queued.join(', ')}. ${ctx.chat === `${t.id}/Agent` ? 'Stop at a clean point, reply in one line and end your turn: Lineclear tells you to go.' : 'Its agent is told to wait; Lineclear tells it to go once they are done.'}`
        if (r.went)
          return t.held
            ? `${t.id} waits for no task now, but is held: ${t.held.why === 'slots' ? `all ${this.settings.machine().max} slots are taken` : 'the machine is busy'} (${this.workingLine()}). Its agent gets the go when there's room.`
            : `${t.id} waits for nothing more: its agent is told to go.`
        return none ? `${t.id} was not queued.` : `${t.id} isn't queued: what it would wait for is done already.`
      },
      stop: async () => {
        const kept = await this.engine.stopTask(t.id)
        return `Stopped ${t.id}: its agent is closed${kept.length ? `; kept ${kept.join(', ')}` : ''}. Writing to it starts it again.`
      },
      close: async () => {
        if (ctx.chat?.includes('/'))
          throw new Error(
            `Coordinators close tasks. A task's agent reports with lineclear ready ${ctx.chat.split('/')[0]} (with no changes on its branch, that is Done at once).`,
          )
        const { said, facts } = summaryOpts(p)
        const { kept } = await this.engine.close(t.id, said, facts, p.flags.has('discard') || p.flags.has('force'))
        return `Closed ${t.id}: it is Done, with nothing to merge, and its agent is closed${kept.length ? `; kept ${kept.join(', ')}` : t.worktree ? '; its working folder and branch are gone' : ''}.`
      },
      archive: async () => {
        if (ctx.chat?.includes('/')) throw new Error(`Only a coordinator ${sub}s tasks, when the human asks.`)
        if (sub === 'unarchive') {
          if (!t.archived) return `${t.id} isn't archived.`
          this.engine.unarchive(t.id)
          this.emit('snapshot')
          return `Brought ${t.id} back: it shows in its lists again (${this.engine.view(t).state}).`
        }
        if (t.archived) return `${t.id} is archived already.`
        const r = await this.engine.archive(t.id)
        this.emit('snapshot')
        return `Archived ${t.id}${r.stopped ? `: its agent was stopped first${r.kept.length ? `; kept ${r.kept.join(', ')}` : ''}` : ''}. It is out of every list; search and Archived still find it, and lineclear task unarchive ${t.id} brings it back.`
      },
      pause: async () => {
        if (ctx.chat?.includes('/'))
          throw new Error(`Only a coordinator pauses tasks, when the human asks. To wait yourself: lineclear todo ${ctx.chat.split('/')[0]}.`)
        await this.engine.pause(t.id)
        this.emit('snapshot')
        return `Paused ${t.id}: its agent was interrupted and it is To do. Its work, worktree and chat stay; any message to it (task tell) is the go to go on.`
      },
      pin: async () => {
        if (ctx.chat?.includes('/')) throw new Error(`Only a coordinator ${sub}s tasks, when the human asks.`)
        const on = sub === 'pin'
        if (!!t.pinned === on) return on ? `${t.id} is pinned already.` : `${t.id} isn't pinned.`
        this.engine.pin(t.id, on)
        this.emit('snapshot')
        return on ? `Pinned ${t.id}: it shows in Pinned at the top of its tasks.` : `Unpinned ${t.id}: it is back in its group (${this.engine.view(t).state}).`
      },
    }
    const name = alias[sub ?? ''] ?? sub ?? ''
    if (Object.hasOwn(words, name)) return words[name]()
    throw new Error('lineclear task add|list|show|tell|queue|stop|close|archive|unarchive|pin|unpin|pause|merge|delete')
  }

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
    const peer = t ? undefined : (this.peers?.list() ?? []).flatMap((l) => l.snap?.tasks ?? []).find((x) => x.id.toUpperCase() === target.toUpperCase())
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
