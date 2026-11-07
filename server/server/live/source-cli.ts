import { randomUUID } from 'node:crypto'
import { HELP, one, parseArgs, summaryOpts, type Parsed } from './args.ts'
import { ended } from './engine/engine.ts'
import { room } from './herdr-forward.ts'
import { BOX, boxHome, forwardTask, machineRef } from './box.ts'
import { HOST, NAME, placeId } from './places.ts'
import { readSection } from './prompts.ts'
import { LiveSourceSubcommands } from './source-subcommands.ts'

type Ctx = { chat?: string; cwd?: string; stdin?: string; proof?: string }
/** one `lineclear` word: the second word, the rest, the parsed flags, who asks and the first word itself */
type Call = { a0: string; a1?: string; rest: string[]; p: Parsed; ctx: Ctx }
type Word = (c: Call) => string | Promise<string>

export class LiveSourceCli extends LiveSourceSubcommands {
  async cli(args: string[], ctx: Ctx & { local?: boolean }): Promise<{ out: string; code: number; secrets?: Record<string, string> }> {
    try {
      // the values themselves, for the lineclear command to put in a command's environment or a file: never printed,
      // only with a worker-issued capability whose stored scope selects the secret chain
      if (args[0] === 'secret' && (args[1] === 'run' || args[1] === 'env')) {
        const owner = this.agents.secretAccess.authenticate(ctx.proof)
        if (!owner || this.agents.record(owner.chat)?.finished)
          throw new Error(
            'Secret access needs a current agent credential. Use the owning session command; older sessions must wait for route provisioning. No unauthenticated fallback.',
          )
        if (JSON.stringify(this.agents.secretScope(owner.chat)) !== JSON.stringify(owner.chain)) throw new Error('Secret credential scope is no longer valid.')
        return { out: '', code: 0, secrets: this.secretValues(parseArgs(args).words.slice(2), owner.chain) }
      }
      const out = await this.command(parseArgs(args), ctx)
      return { out: out.endsWith('\n') ? out : `${out}\n`, code: 0 }
    } catch (e) {
      return { out: `${(e as Error).message}\n`, code: 1 }
    }
  }

  /** a task's agent speaks only for its own task */
  private ownTask(ctx: Ctx, id: string, say: string) {
    if (ctx.chat?.includes('/') && ctx.chat.split('/')[0].toUpperCase() !== id.toUpperCase()) throw new Error(say)
  }

  private taskOrThrow(id: string | undefined, usage: string) {
    const t = this.engine.task(id ?? '')
    if (!t) throw new Error(`No task ${id ?? ''}; ${usage}`)
    return t
  }

  /** every word of the board command, one row each; `project`, from before spaces, is `space`, and `done` is `ready`'s old name */
  private readonly words: Record<string, Word> = {
    alive: ({ a1, ctx }) => {
      if (!a1) throw new Error('lineclear alive <task>')
      this.ownTask(ctx, a1, 'An agent beats only for its own task.')
      this.engine.alive(a1)
      return 'ok'
    },
    status: ({ a1, rest, p, ctx }) => {
      if (a1) return this.reportCommand(a1, rest, p, ctx)
      const kept = this.engine.keptLeftovers()
      const line = `Lineclear on ${NAME}: ${this.places.shown().length} spaces, ${this.engine.tasks.filter((t) => !ended(t) && !t.archived).length} open tasks; herdr ${this.agents.reachable ? 'answers' : 'does not answer'}.`
      return kept.length ? `${line}\nDone tasks that kept work (remove it by hand once you're sure):\n${kept.map((k) => `  ${k}`).join('\n')}` : line
    },
    // a machine's room as the adapter reads it, with its tasks at work and its slots from the one store
    room: async ({ a1 }) => {
      if (a1 && !this.engine.machines.has(a1) && !this.peers?.knows(a1)) throw new Error(`No machine called ${a1}.`)
      const read = await room(a1)
      if (!read) throw new Error(`${a1 ?? NAME} cannot be reached through herdr.`)
      return JSON.stringify({ host: a1 ?? NAME, ...read, working: this.engine.workingOn(a1), max: this.settings.machine().max }, null, 2)
    },
    space: (c) => this.spaceWord(c),
    project: (c) => this.spaceWord(c),
    task: (c) => this.taskWord(c),
    restart: ({ a1, p, ctx }) => this.restartCommand(a1, p, ctx),
    ready: (c) => this.readyWord(c),
    done: (c) => this.readyWord(c),
    todo: ({ a1, ctx }) => {
      const t = this.taskOrThrow(a1, 'lineclear todo <id>')
      this.ownTask(ctx, t.id, `A task's agent says only its own task waits, not ${t.id}. ${readSection('lineclear-agent', 'Procedure')}`)
      this.engine.todo(t.id)
      return `Noted: ${t.id} shows as To do until it gets a go. Reply in one line that you have the brief, then end your turn.`
    },
    merge: ({ a1, ctx }) => this.mergeCommand(a1, ctx),
    pr: (c) => this.prWord(c),
    checks: (c) => this.prWord(c),
    plan: async ({ a1, p }) => {
      const steps = p.opts.step ?? []
      if (!steps.length) throw new Error('lineclear plan <id> --step "..." --step "..."')
      await this.engine.plan(a1 ?? '', steps)
      return 'Plan posted. Stop now and wait: the yes, or a note, arrives as a message.'
    },
    ask: ({ a1, p, ctx }) => this.askWord(a1, p, ctx),
    alert: ({ a1, p, ctx }) => this.alertCommand(a1, p, ctx),
    show: ({ p, ctx }) => this.showCommand(p, ctx),
    set: ({ a0, a1, rest, p, ctx }) => this.setCommand(a0, a1, rest, p, ctx),
    unset: ({ a0, a1, rest, p, ctx }) => this.setCommand(a0, a1, rest, p, ctx),
    doctor: async () => {
      if (BOX) throw new Error(`lineclear doctor checks every machine from the main one: run it there (${HOST} is run from it over SSH).`)
      const own = `${NAME} (this machine, the main one): herdr ${this.agents.reachable ? 'answers' : 'does not answer'}`
      return [own, ...this.pushWarnings().map((warning) => `Alerts: ${warning}`), ...((await this.peers?.doctor()) ?? [])].join('\n')
    },
    secret: ({ a1, rest, p, ctx }) => this.secretCommand(a1, rest, p, ctx),
  }

  protected async command(p: Parsed, ctx: Ctx): Promise<string> {
    const [a0, a1, ...rest] = p.words
    if (!a0 || a0 === 'help' || p.flags.has('help')) return HELP
    const word = Object.hasOwn(this.words, a0) ? this.words[a0] : undefined
    if (!word) throw new Error(`No command ${a0}; lineclear help lists them`)
    return word({ a0, a1, rest, p, ctx })
  }

  private async spaceWord({ a1, rest, p, ctx }: Call) {
    if (a1 === 'add') {
      const path = rest[0] ?? ctx.cwd
      if (!path) throw new Error('lineclear space add <path> [--name NAME]')
      const pr = await this.addAsSpace(path, one(p, 'name'))
      return `Added ${this.places.nameOf(placeId.space(pr.name))} (${pr.path}) as a space; its tasks are ${pr.key}-1, ${pr.key}-2, …${pr.github ? ` GitHub: ${pr.github}.` : ' No GitHub remote: tasks merge here.'}`
    }
    if (a1 === 'list' || !a1)
      return this.places
        .shown()
        .map((x) =>
          x.space ? `${x.name}  ${x.space.key}  ${x.space.path}${x.space.github ? `  github:${x.space.github}` : ''}` : `${x.name}  (home space)  ${boxHome()}`,
        )
        .join('\n')
    if (a1 === 'rename') {
      const x = rest[0] ? this.places.find(rest[0]) : undefined
      if (!x || !rest[1]) throw new Error('lineclear space rename <name> <new-name> (lineclear space list shows them)')
      const r = (await this.act({ type: 'rename', id: x.id, name: rest[1] })) as { ok?: boolean; error?: string }
      if (r.ok === false) throw new Error(r.error)
      return `${x.name} is called ${this.places.nameOf(x.id)} now.`
    }
    if (a1 === 'set' && rest[0] === 'base') {
      const pr = this.projectFor(p, ctx)
      if (!rest[1]) throw new Error('lineclear space set base <branch> --space NAME')
      await this.places.setBase(pr.name, rest[1])
      this.emit('snapshot')
      return `${pr.name}: new tasks start from and merge into ${pr.base}. Existing tasks keep their target.`
    }
    if (a1 === 'remove') {
      if (!rest[0]) throw new Error('lineclear space remove <name>')
      const shown = this.places.find(rest[0])?.name ?? rest[0]
      const pr = await this.removeSpace(rest[0])
      return `Removed ${shown} from Lineclear; ${pr.path} and its code stay on disk. lineclear space add ${pr.path} --name ${shown} brings it back with its open tasks and chat.`
    }
    throw new Error('lineclear space add|list|rename|remove')
  }

  private async taskWord({ a1, rest, p, ctx }: Call) {
    // a task the list shows "(on desktop)" is run by that machine's worker: its show, tell, close, merge and delete go there
    const ref = machineRef(rest[0] ?? '')
    // "machine-b:OMA-91" may be an old id a rename kept: that machine's task is then called by its new id
    const kept = ref.machine
      ? this.peers?.byName(ref.machine)?.snap?.tasks.find((t) => t.aliases?.some((a) => a.toUpperCase() === (rest[0] ?? '').toUpperCase()))
      : undefined
    const args = ref.machine ? [kept?.id ?? ref.id, ...rest.slice(1)] : rest
    const news = this.requestedNews.known(ctx.chat)
    if (ref.machine) return (await forwardTask(this.peers, a1, args, p.opts, p.flags, news, ref.machine)) ?? this.taskCommand(a1, args, p, ctx)
    if (!this.engine.task(rest[0] ?? '')) return (await forwardTask(this.peers, a1, rest, p.opts, p.flags, news)) ?? this.taskCommand(a1, rest, p, ctx)
    const out = await this.taskCommand(a1, rest, p, ctx)
    const other = p.flags.has('json') ? undefined : this.peers?.owner(rest[0] ?? '')
    return other ? `${out}\n(${this.engine.task(rest[0])!.id} is also a task on ${other.rec.machine}: say ${other.rec.machine}:${rest[0]} for that one.)` : out
  }

  private async readyWord({ a0, a1, rest, p, ctx }: Call) {
    // a task's agent may leave the id out: it reports its own task
    const id = a1 ?? (ctx.chat?.includes('/') ? ctx.chat.split('/')[0] : undefined)
    if (!id) throw new Error(`lineclear ${a0} <id> --summary "<what changed>". ${readSection('lineclear-agent', 'Procedure')}`)
    const t = this.taskOrThrow(id, 'lineclear ready <id>')
    const { said, facts } = summaryOpts(p, rest)
    const r = await this.engine.done(t.id, said ?? '', facts)
    if (r === 'ended') return `Noted. ${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'}).`
    if (r === 'closed')
      return `Noted: ${t.branch} has no changes, so there is nothing to merge: ${t.id} is Done.${ctx.chat === `${t.id}/Agent` ? ' Your worktree, branch and herdr space close once this turn ends: do nothing more in them.' : ''}`
    if (ctx.chat === `${t.id}/Agent` && this.engine.landAtReady(t.id))
      return `Noted: ${t.id} shows as Ready. Lineclear merges it once this turn ends and starts you again only if the check fails: end your turn now and do nothing more.`
    return `Noted: ${t.id} shows as Ready to merge (not merged yet). Merge only when your brief or the human says so (lineclear merge ${t.id}).`
  }

  private async prWord({ a0, a1, ctx }: Call) {
    const t = this.taskOrThrow(a1, `lineclear ${a0} <id>`)
    this.ownTask(ctx, t.id, `A task's agent works on its own task's pull request only, not ${t.id}'s. ${readSection('lineclear-agent', 'Procedure')}`)
    const r = a0 === 'pr' ? await this.engine.openPr(t.id) : await this.engine.checks(t.id)
    if (!r.ok) throw new Error(r.text)
    return r.text
  }

  private askWord(title: string | undefined, p: Parsed, ctx: Ctx) {
    if (!ctx.chat) throw new Error('lineclear card works from an agent Lineclear started')
    const labels = p.opts.choice ?? []
    if (!title || labels.length < 2)
      throw new Error(`lineclear card "<question>" --choice "<label>" --choice "<label>" …. ${readSection('lineclear', 'Asking')}`)
    const desc = Object.fromEntries((p.opts.desc ?? []).map((d) => d.split('=').map((s) => s.trim()) as [string, string]))
    const id = `ask:${randomUUID().slice(0, 8)}`
    this.chats.post(ctx.chat, {
      id,
      question: {
        id,
        title,
        ordinary: p.flags.has('ordinary') || undefined,
        kind: Object.keys(desc).length || p.flags.has('other') ? 'Question' : 'Form',
        choices: labels.map((label) => ({ label, description: desc[label] })),
        multi: p.flags.has('multi'),
        other: p.flags.has('other'),
        to: this.chatName(ctx.chat),
      },
    })
    this.emit('chat', ctx.chat)
    this.emit('snapshot')
    return 'Asked. End your turn now; the answer arrives as an [… answered …] line.'
  }
}
