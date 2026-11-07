import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { doneNewestFirst } from '../../shared/types.ts'
import { one, summaryOpts, type Parsed } from './args.ts'
import { checkTitle } from './engine/engine.ts'
import { validateBase } from './engine/git.ts'
import { checkResult } from './engine/result.ts'
import { BOX, noTasks } from './box.ts'
import { NAME, placeId } from './places.ts'
import { CLI_NAME, setForTask } from './settings.ts'
import { agentTask, harnessOf, reviewerOf, statusLine, taskAddArgs, type Ctx } from './source-helpers.ts'
import { LiveSourceSecrets } from './source-secrets.ts'

const ADD_FLAGS = [
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
]
type Cli = { out: string; code: number }

export class LiveSourceTasks extends LiveSourceSecrets {
  /** why a task is held, in words: "all 4 slots are taken (…)" */
  protected heldLine(why?: string) {
    return `${why === 'slots' ? `all ${this.settings.machine().max} slots are taken` : 'the machine is busy'} (${this.workingLine()})`
  }

  /** a task add for a space this machine does not know: the main machine or the peer that owns the space runs it */
  private async addElsewhere(named: string, rest: string[], p: Parsed, ctx: Ctx): Promise<string | undefined> {
    const chat = this.requestedNews.known(ctx.chat)
    const answer = (r: Cli) => {
      if (r.code) throw new Error(r.out.trim())
      return r.out.trim()
    }
    // Helpers reach their own worker. Delegate a foreign target through the owning main installation.
    if (BOX && process.env.LINECLEAR_MAIN_HOME) {
      const server = JSON.parse(readFileSync(join(process.env.LINECLEAR_MAIN_HOME, 'server.json'), 'utf8')) as { port: number }
      const r = await fetch(`http://127.0.0.1:${server.port}/api/cli`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: taskAddArgs(rest, p), chat }),
        signal: AbortSignal.timeout(20_000),
      })
      return answer((await r.json()) as Cli)
    }
    const targets = (this.peers?.list() ?? []).flatMap((l) =>
      (l.snap?.places ?? []).filter((x) => !x.home && (x.id === named || x.name === named)).map((x) => ({ l, x })),
    )
    if (targets.length > 1) throw new Error('Several spaces have that name; use its full p:machine:space identity.')
    if (!targets.length) return undefined
    const { l, x } = targets[0]
    const args = taskAddArgs(rest, p, x.id.split(':').slice(2).join(':'))
    return answer(
      await this.onPeer<Cli>(l, '/api/cli', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args, chat }) }),
    )
  }

  private async taskAdd(rest: string[], p: Parsed, ctx: Ctx) {
    if (!rest[0]?.trim()) throw new Error('lineclear task add "<title>" --desc "<the whole brief>"')
    if (p.flags.has('after')) throw new Error('--after needs the tasks it waits for: --after SHE-12,SHE-13')
    const odd = [...Object.keys(p.opts), ...p.flags].find((f) => !ADD_FLAGS.includes(f))
    if (odd)
      throw new Error(
        `Task add takes no --${odd}: only --desc, --result, --space, --base, --after, --later, --set, --agent, --model, --effort, --reviewer, --reviewer-model, --reviewer-effort and --on`,
      )
    // --set key=value: a How tasks work setting for this task, or what --agent, --reviewer and the like set
    const set: Record<string, string> = {}
    for (const pair of p.opts.set ?? []) {
      const r = setForTask(pair)
      if ('error' in r) throw new Error(r.error)
      if ('flag' in r) (p.opts[r.flag] ??= []).push(r.value)
      else set[r.key] = r.value
    }
    const bare = [...p.flags].find((f) => f !== 'later')
    if (bare) throw new Error(`--${bare} needs a value`)
    const [title, result] = [checkTitle(rest[0]), checkResult(one(p, 'result'))]
    const named = one(p, 'space')
    if (named && !this.places.byName(named) && !this.places.byKey(named) && !this.places.space(named)) {
      const out = await this.addElsewhere(named, rest, p, ctx)
      if (out !== undefined) return out
    }
    const pr = (named && this.places.space(named)) || this.projectFor(p, ctx)
    await validateBase(pr.path, one(p, 'base') ?? pr.base)
    const where = one(p, 'on')
    if (where && !this.engine.machines.has(where)) throw new Error(`No machine called ${where}: \`lineclear machine list\` names them.`)
    const after = p.opts.after ?? []
    const t = this.engine.add({
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
      agent: harnessOf(p, this.settings),
      reviewer: reviewerOf(p, this.settings),
      set,
    })
    const a = t.agent!
    const on = [CLI_NAME[a.kind] ?? a.kind, a.model, a.effort && `${a.effort} effort`].filter(Boolean).join(', ')
    const added = `Added ${t.id}: ${t.title}`
    if (t.after?.length)
      return `${added}, queued after ${t.after.join(', ')}. Its agent (${on}) reads the brief now and waits; Lineclear tells it to go once ${t.after.length === 1 ? 'that task is' : 'they are all'} done.`
    if (p.flags.has('later')) return `${added}, for later. Its agent (${on}) reads the brief now and waits for a go (lineclear task tell ${t.id} "go").`
    if (t.held)
      return `${added}, held: ${this.heldLine(t.held.why)}. It shows as Queued and its agent (${on}) starts by itself when there's room, oldest first.`
    return `${added}. Its agent (${on}) starts on the brief now.${after.length ? ' What it would wait for is done already.' : ''}`
  }

  private taskList(p: Parsed, ctx: Ctx) {
    const pr = one(p, 'space') ? this.projectFor(p, ctx) : null
    const archivedOnly = p.flags.has('archived')
    // archived tasks only with --archived, and then only they
    const shown = (t: { archived?: unknown }) => !!t.archived === archivedOnly
    const ts = this.engine.tasks.filter((t) => (!pr || t.project === placeId.space(pr.name)) && shown(t)).map((t) => this.engine.view(t))
    const others = pr ? [] : (this.peers?.list() ?? []).flatMap((l) => (l.snap?.tasks ?? []).filter(shown).map((t) => ({ ...t, machine: l.rec.machine })))
    const all = doneNewestFirst<(typeof ts)[number] | (typeof others)[number]>([...ts, ...others])
    const machine = (t: object) => ('machine' in t && t.machine ? (t.machine as string) : NAME)
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
          machine: machine(t),
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
        `${t.id.padEnd(8)} ${t.status.padEnd(5)} ${t.name}${t.pinned ? '  (pinned)' : ''}${statusLine(t) ? `  · ${statusLine(t)}` : ''}  (on ${machine(t)})`,
    )
    const archived = archivedOnly ? 0 : this.engine.tasks.filter((t) => t.archived && (!pr || t.project === placeId.space(pr.name))).length
    return (rows.join('\n') || (archivedOnly ? 'No archived tasks.' : noTasks())) + (archived ? `\n(${archived} archived: lineclear task list --archived)` : '')
  }

  protected async taskCommand(sub: string | undefined, rest: string[], p: Parsed, ctx: Ctx) {
    if (sub === 'add') return this.taskAdd(rest, p, ctx)
    if (sub === 'list' || !sub) return this.taskList(p, ctx)
    if (sub === 'merge') return this.mergeCommand(rest[0], ctx)
    const agent = agentTask(ctx)
    const coordinatorOnly = (why: string) => {
      if (agent) throw new Error(why)
    }
    if (sub === 'delete') {
      coordinatorOnly("A task's agent can't delete tasks; only a coordinator does, when the human plainly asks.")
      const t = this.engine.task(rest[0] ?? '')
      if (!t) throw new Error(`No task ${rest[0] ?? ''}; lineclear task delete <id> [--force]`)
      const left = await this.deleteTask(t.id, p.flags.has('force'))
      return `Deleted ${t.id}: its agent, chat, working folder and branch are gone${left.length ? `, except ${left.join(', ')} (remove that by hand)` : ''}.${t.merged ? ` Its commits stay on ${t.base ?? 'main'}.` : ''}`
    }
    const t = this.engine.task(rest[0] ?? '')
    if (!t) throw new Error(`No task ${rest[0] ?? ''}`)
    const kept = (l: string[]) => (l.length ? `; kept ${l.join(', ')}` : '')
    const own = ctx.chat === `${t.id}/Agent`
    const only = (verb: string) => coordinatorOnly(`Only a coordinator ${verb} tasks, when the human asks.`)
    switch (sub) {
      case 'show': {
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
      }
      case 'tell': {
        // a coordinator's go to a task that waits starts it only when this machine has room
        const r = await this.engine.tell(t.id, rest.slice(1).join(' '), { gate: !agent })
        return r.held ? `${t.id} is held: ${this.heldLine(r.held)}. It shows as Queued and gets your message when there's room, oldest first.` : `Told ${t.id}.`
      }
      case 'queue': {
        const refs = p.opts.after ?? []
        if (!refs.length) throw new Error('lineclear task queue <id> --after SHE-12[,SHE-13]  (--after none clears it)')
        const none = refs.length === 1 && /^(none|nothing|-)$/i.test(refs[0].trim())
        const r = this.engine.queue(t.id, none ? [] : refs, { self: own })
        if (r.queued.length)
          return `${t.id} is queued after ${r.queued.join(', ')}. ${own ? 'Stop at a clean point, reply in one line and end your turn: Lineclear tells you to go.' : 'Its agent is told to wait; Lineclear tells it to go once they are done.'}`
        if (r.went)
          return t.held
            ? `${t.id} waits for no task now, but is held: ${this.heldLine(t.held.why)}. Its agent gets the go when there's room.`
            : `${t.id} waits for nothing more: its agent is told to go.`
        return none ? `${t.id} was not queued.` : `${t.id} isn't queued: what it would wait for is done already.`
      }
      case 'stop':
        return `Stopped ${t.id}: its agent is closed${kept(await this.engine.stopTask(t.id))}. Writing to it starts it again.`
      case 'close': {
        coordinatorOnly(`Coordinators close tasks. A task's agent reports with lineclear ready ${agent} (with no changes on its branch, that is Done at once).`)
        const { said, facts } = summaryOpts(p)
        const left = (await this.engine.close(t.id, said, facts, p.flags.has('discard') || p.flags.has('force'))).kept
        return `Closed ${t.id}: it is Done, with nothing to merge, and its agent is closed${left.length ? kept(left) : t.worktree ? '; its working folder and branch are gone' : ''}.`
      }
      case 'archive':
      case 'unarchive': {
        only(`${sub}s`)
        if (sub === 'unarchive') {
          if (!t.archived) return `${t.id} isn't archived.`
          this.engine.unarchive(t.id)
          this.emit('snapshot')
          return `Brought ${t.id} back: it shows in its lists again (${this.engine.view(t).state}).`
        }
        if (t.archived) return `${t.id} is archived already.`
        const r = await this.engine.archive(t.id)
        this.emit('snapshot')
        return `Archived ${t.id}${r.stopped ? `: its agent was stopped first${kept(r.kept)}` : ''}. It is out of every list; search and Archived still find it, and lineclear task unarchive ${t.id} brings it back.`
      }
      case 'pause': {
        coordinatorOnly(`Only a coordinator pauses tasks, when the human asks. To wait yourself: lineclear todo ${agent}.`)
        await this.engine.pause(t.id)
        this.emit('snapshot')
        return `Paused ${t.id}: its agent was interrupted and it is To do. Its work, worktree and chat stay; any message to it (task tell) is the go to go on.`
      }
      case 'pin':
      case 'unpin': {
        only(`${sub}s`)
        const on = sub === 'pin'
        if (!!t.pinned === on) return on ? `${t.id} is pinned already.` : `${t.id} isn't pinned.`
        this.engine.pin(t.id, on)
        this.emit('snapshot')
        return on ? `Pinned ${t.id}: it shows in Pinned at the top of its tasks.` : `Unpinned ${t.id}: it is back in its group (${this.engine.view(t).state}).`
      }
    }
    throw new Error('lineclear task add|list|show|tell|queue|stop|close|archive|unarchive|pin|unpin|pause|merge|delete')
  }
}
