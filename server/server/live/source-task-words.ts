import { doneNewestFirst, type Task } from '../../shared/types.ts'
import { one, summaryOpts, type Parsed } from './args.ts'
import { checkTitle } from './engine/engine.ts'
import { ended } from './engine/engine-helpers.ts'
import { commitsOf, StepClaims, stepIdOfTitle, whyStepRefused } from './engine/step-once.ts'
import { validateBase } from './engine/github.ts'
import { checkResult } from './engine/result.ts'
import { BOX, noTasks } from './box.ts'
import { placeId } from './places.ts'
import { CLI_NAME, setForTask } from './settings.ts'
import { mainCli, taskAddArgs } from './source-helpers.ts'
import { heldBecause, oddAddFlag, taskListJson, taskListRow, taskShowText } from './source-task-text.ts'
import { harnessOf, reviewerOf } from './task-options.ts'
import { LiveSourceRestartWords } from './source-restart-words.ts'

export class LiveSourceTaskWords extends LiveSourceRestartWords {
  private stepClaims = new StepClaims()

  protected async taskCommand(sub: string | undefined, rest: string[], p: Parsed, ctx: { chat?: string; cwd?: string }) {
    if (sub === 'add') {
      if (!rest[0]?.trim()) throw new Error('lineclear task add "<title>" --desc "<the whole brief>"')
      if (p.flags.has('after')) throw new Error('--after needs the tasks it waits for: --after SHE-12,SHE-13')
      const odd = oddAddFlag(p)
      if (odd) throw new Error(odd)
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
          const { out, code } = await mainCli(taskAddArgs(rest, p), this.requestedNews.known(ctx.chat))
          if (code) throw new Error(out.trim())
          return out.trim()
        }
        const targets = (this.peers?.list() ?? []).flatMap((l) =>
          (l.snap?.places ?? []).filter((x) => !x.home && (x.id === named || x.name === named)).map((x) => ({ l, x })),
        )
        if (targets.length > 1) throw new Error('Several spaces have that name; use its full p:machine:space identity.')
        if (targets.length === 1) {
          const { l, x } = targets[0]
          const args = taskAddArgs(rest, p, x.id.split(':').slice(2).join(':'))
          const { out, code } = await this.onPeer<{ out: string; code: number }>(l, '/api/cli', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ args, chat: this.requestedNews.known(ctx.chat) }),
          })
          if (code) throw new Error(out.trim())
          return out.trim()
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
        const elsewhere = this.tasksOnPeers()
          .filter((x) => x.status !== 'done' && !x.archived && x.place === placeId.space(pr.name))
          .map((x) => ({ id: `${x.machine}:${x.id}`, title: x.name }))
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
        return `Added ${t.id}: ${t.title}, held: ${heldBecause(t.held.why, this.settings.machine().max)} (${this.workingLine()}). It shows as Queued and its agent (${on}) starts by itself when there's room, oldest first.`
      return `Added ${t.id}: ${t.title}. Its agent (${on}) starts on the brief now.${p.opts.after?.length ? ' What it would wait for is done already.' : ''}`
    }
    if (sub === 'list' || !sub) {
      const pr = one(p, 'space') ? this.projectFor(p, ctx) : null
      // archived tasks only with --archived, and then only they
      const shown = (t: { archived?: unknown }) => !!t.archived === p.flags.has('archived')
      const ts = this.engine.tasks.filter((t) => (!pr || t.project === placeId.space(pr.name)) && shown(t)).map((t) => this.engine.view(t))
      const others = pr ? [] : this.tasksOnPeers().filter(shown)
      const all = doneNewestFirst<Task>([...ts, ...others])
      if (p.flags.has('json')) return taskListJson(all, (id) => this.engine.tasks.some((r) => r.id === id && r.stopped))
      const rows = all.map(taskListRow)
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
        return p.flags.has('json') ? JSON.stringify(v, null, 2) : taskShowText(v)
      },
      tell: async () => {
        // a coordinator's go to a task that waits starts it only when this machine has room
        const r = await this.engine.tell(t.id, rest.slice(1).join(' '), { gate: !ctx.chat?.includes('/') })
        if (r.held)
          return `${t.id} is held: ${heldBecause(r.held, this.settings.machine().max)} (${this.workingLine()}). It shows as Queued and gets your message when there's room, oldest first.`
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
            ? `${t.id} waits for no task now, but is held: ${heldBecause(t.held.why, this.settings.machine().max)} (${this.workingLine()}). Its agent gets the go when there's room.`
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
}
