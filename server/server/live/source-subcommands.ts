import { randomUUID } from 'node:crypto'
import { taskAlert } from '../../shared/alerts.ts'
import { one, summaryOpts, type Parsed } from './args.ts'
import { ended, type TaskRec } from './engine/engine.ts'
import { BOX, boxHome, forwardTask, machineRef } from './box.ts'
import { room } from './herdr-forward.ts'
import { HOST, NAME, placeId } from './places.ts'
import { projectLists } from './project-models.ts'
import { readSection, settingsBlock } from './prompts.ts'
import { CATALOG, type Level } from './settings.ts'
import { summary } from './health.ts'
import { agentTask, mainCli, type Ctx } from './source-helpers.ts'
import { LiveSourceTasks } from './source-tasks.ts'

const PROCEDURE = () => readSection('lineclear-agent', 'Procedure')

export class LiveSourceSubcommands extends LiveSourceTasks {
  /** what a task's alert says and where it opens: its open card, else its last reply; a done task's card */
  protected taskAlert(t: TaskRec, status = this.engine.statusOf(t), sub = this.engine.subOf(t, status)) {
    const shown = status === 'need' || status === 'ready' || status === 'done' ? status : 'need'
    return taskAlert(t, shown, sub, { task: this.chats.chat(`${t.id}/Agent`), project: status === 'done' ? this.chats.chat(t.project) : undefined })
  }

  /** the task an agent's command is about: its own only, and none for a coordinator's chat to name another's */
  private ownTask(id: string | undefined, ctx: Ctx, usage: string, refusal: (t: string) => string) {
    const t = this.engine.task(id ?? '')
    if (!t) throw new Error(usage.replace('<id>', id ?? ''))
    if (agentTask(ctx) && agentTask(ctx)!.toUpperCase() !== t.id.toUpperCase()) throw new Error(`${refusal(t.id)} ${PROCEDURE()}`)
    return t
  }

  protected aliveCommand(id: string | undefined, ctx: Ctx) {
    if (!id) throw new Error('lineclear alive <task>')
    if (agentTask(ctx) && agentTask(ctx)!.toUpperCase() !== id.toUpperCase()) throw new Error('An agent beats only for its own task.')
    this.engine.alive(id)
    return 'ok'
  }

  protected statusCommand() {
    const kept = this.engine.keptLeftovers()
    const line = `Lineclear on ${NAME}: ${this.places.shown().length} spaces, ${this.engine.tasks.filter((t) => !ended(t) && !t.archived).length} open tasks; herdr ${this.agents.reachable ? 'answers' : 'does not answer'}.`
    return kept.length ? `${line}\nDone tasks that kept work (remove it by hand once you're sure):\n${kept.map((k) => `  ${k}`).join('\n')}` : line
  }

  /** a machine's room as the adapter reads it, with its tasks at work and its slots from the one store */
  protected async roomCommand(machine?: string) {
    if (machine && !this.engine.machines.has(machine) && !this.peers?.knows(machine)) throw new Error(`No machine called ${machine}.`)
    const read = await room(machine)
    if (!read) throw new Error(`${machine ?? NAME} cannot be reached through herdr.`)
    return JSON.stringify({ host: machine ?? NAME, ...read, working: this.engine.workingOn(machine), max: this.settings.machine().max }, null, 2)
  }

  protected async spaceCommand(sub: string | undefined, rest: string[], p: Parsed, ctx: Ctx) {
    if (sub === 'add') {
      const path = rest[0] ?? ctx.cwd
      if (!path) throw new Error('lineclear space add <path> [--name NAME]')
      const pr = await this.addAsSpace(path, one(p, 'name'))
      return `Added ${this.places.nameOf(placeId.space(pr.name))} (${pr.path}) as a space; its tasks are ${pr.key}-1, ${pr.key}-2, …${pr.github ? ` GitHub: ${pr.github}.` : ' No GitHub remote: tasks merge here.'}`
    }
    if (sub === 'list' || !sub)
      return this.places
        .shown()
        .map((x) =>
          x.space ? `${x.name}  ${x.space.key}  ${x.space.path}${x.space.github ? `  github:${x.space.github}` : ''}` : `${x.name}  (home space)  ${boxHome()}`,
        )
        .join('\n')
    if (sub === 'rename') {
      const x = rest[0] ? this.places.find(rest[0]) : undefined
      if (!x || !rest[1]) throw new Error('lineclear space rename <name> <new-name> (lineclear space list shows them)')
      const r = (await this.act({ type: 'rename', id: x.id, name: rest[1] })) as { ok?: boolean; error?: string }
      if (r.ok === false) throw new Error(r.error)
      return `${x.name} is called ${this.places.nameOf(x.id)} now.`
    }
    if (sub === 'set' && rest[0] === 'base') {
      const pr = this.projectFor(p, ctx)
      if (!rest[1]) throw new Error('lineclear space set base <branch> --space NAME')
      await this.places.setBase(pr.name, rest[1])
      this.emit('snapshot')
      return `${pr.name}: new tasks start from and merge into ${pr.base}. Existing tasks keep their target.`
    }
    if (sub === 'remove') {
      if (!rest[0]) throw new Error('lineclear space remove <name>')
      const shown = this.places.find(rest[0])?.name ?? rest[0]
      const pr = await this.removeSpace(rest[0])
      return `Removed ${shown} from Lineclear; ${pr.path} and its code stay on disk. lineclear space add ${pr.path} --name ${shown} brings it back with its open tasks and chat.`
    }
    throw new Error('lineclear space add|list|rename|remove')
  }

  /** a task the list shows "(on desktop)" is run by that machine's worker: its show, tell, close, merge and delete go there */
  protected async taskRoute(sub: string | undefined, rest: string[], p: Parsed, ctx: Ctx) {
    const ref = machineRef(rest[0] ?? '')
    // "machine-b:OMA-91" may be an old id a rename kept: that machine's task is then called by its new id
    const kept = ref.machine
      ? this.peers?.byName(ref.machine)?.snap?.tasks.find((t) => t.aliases?.some((a) => a.toUpperCase() === (rest[0] ?? '').toUpperCase()))
      : undefined
    const args = ref.machine ? [kept?.id ?? ref.id, ...rest.slice(1)] : rest
    const news = this.requestedNews.known(ctx.chat)
    const local = () => this.taskCommand(sub, args, p, ctx)
    if (ref.machine) return (await forwardTask(this.peers, sub, args, p.opts, p.flags, news, ref.machine)) ?? local()
    if (!this.engine.task(rest[0] ?? '')) return (await forwardTask(this.peers, sub, rest, p.opts, p.flags, news)) ?? local()
    const out = await local()
    const other = p.flags.has('json') ? undefined : this.peers?.owner(rest[0] ?? '')
    return other ? `${out}\n(${this.engine.task(rest[0])!.id} is also a task on ${other.rec.machine}: say ${other.rec.machine}:${rest[0]} for that one.)` : out
  }

  /** ready, or done as it was once called */
  protected async readyCommand(word: string, id: string | undefined, rest: string[], p: Parsed, ctx: Ctx) {
    // a task's agent may leave the id out: it reports its own task
    id ??= agentTask(ctx)
    if (!id) throw new Error(`lineclear ${word} <id> --summary "<what changed>". ${PROCEDURE()}`)
    const t = this.engine.task(id)
    if (!t) throw new Error(`No task ${id}`)
    const { said, facts } = summaryOpts(p, rest)
    const r = await this.engine.done(t.id, said ?? '', facts)
    if (r === 'ended') return `Noted. ${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'}).`
    const own = ctx.chat === `${t.id}/Agent`
    if (r === 'closed')
      return `Noted: ${t.branch} has no changes, so there is nothing to merge: ${t.id} is Done.${own ? ' Your worktree, branch and herdr space close once this turn ends: do nothing more in them.' : ''}`
    if (own && this.engine.landAtReady(t.id))
      return `Noted: ${t.id} shows as Ready. Lineclear merges it once this turn ends and starts you again only if the check fails: end your turn now and do nothing more.`
    return `Noted: ${t.id} shows as Ready to merge (not merged yet). Merge only when your brief or the human says so (lineclear merge ${t.id}).`
  }

  protected todoCommand(id: string | undefined, ctx: Ctx) {
    const t = this.ownTask(id, ctx, 'No task <id>; lineclear todo <id>', (x) => `A task's agent says only its own task waits, not ${x}.`)
    this.engine.todo(t.id)
    return `Noted: ${t.id} shows as To do until it gets a go. Reply in one line that you have the brief, then end your turn.`
  }

  /** pr or checks */
  protected async prCommand(word: 'pr' | 'checks', id: string | undefined, ctx: Ctx) {
    const t = this.ownTask(id, ctx, `no task <id>; lineclear ${word} <id>`, (x) => `A task's agent works on its own task's pull request only, not ${x}'s.`)
    const r = word === 'pr' ? await this.engine.openPr(t.id) : await this.engine.checks(t.id)
    if (!r.ok) throw new Error(r.text)
    return r.text
  }

  protected async planCommand(id: string, p: Parsed) {
    const steps = p.opts.step ?? []
    if (!steps.length) throw new Error('lineclear plan <id> --step "..." --step "..."')
    await this.engine.plan(id, steps)
    return 'Plan posted. Stop now and wait: the yes, or a note, arrives as a message.'
  }

  protected askCommand(title: string | undefined, p: Parsed, ctx: Ctx) {
    if (!ctx.chat) throw new Error('lineclear card works from an agent Lineclear started')
    const labels = p.opts.choice ?? []
    if (!title || labels.length < 2)
      throw new Error(`lineclear card "<question>" --choice "<label>" --choice "<label>" …. ${readSection('lineclear', 'Asking')}`)
    const desc = Object.fromEntries((p.opts.desc ?? []).map((d) => d.split('=').map((s) => s.trim()) as [string, string]))
    const id = `ask:${randomUUID().slice(0, 8)}`
    const question = {
      id,
      title,
      ordinary: p.flags.has('ordinary') || undefined,
      kind: Object.keys(desc).length || p.flags.has('other') ? ('Question' as const) : ('Form' as const),
      choices: labels.map((label) => ({ label, description: desc[label] })),
      multi: p.flags.has('multi'),
      other: p.flags.has('other'),
      to: this.chatName(ctx.chat),
    }
    this.chats.post(ctx.chat, { id, question })
    this.emit('chat', ctx.chat)
    this.emit('snapshot')
    return 'Asked. End your turn now; the answer arrives as an [… answered …] line.'
  }

  protected alertCommand(title: string | undefined, p: Parsed, ctx: Ctx) {
    if (!title) throw new Error('lineclear alert "<title>" --body "<why>"')
    const named = one(p, 'task')
    const t = named ? this.engine.task(named) : undefined
    // another machine's task (the main machine's home space keeps every machine's overview): it opens on that task,
    // and while it waits on you it buzzes as the task's own alert would
    const far =
      named && !t
        ? this.peers
            ?.list()
            .flatMap((l) => l.snap?.tasks ?? [])
            .find((x) => x.id.toUpperCase() === named.toUpperCase())
        : undefined
    const waits = far && (far.status === 'need' || far.status === 'ready') ? { tag: far.id, task: true as const } : {}
    // about a task: it opens on its card. While the task waits on you, it says what the task needs as its own alert
    // does (the choices first, then the coordinator's why) and takes that alert's place
    const about = t && this.taskAlert(t)
    const why = [title, one(p, 'body')].filter(Boolean).join(': ')
    const from = ctx.chat ? this.chatName(ctx.chat) : 'Lineclear'
    const body = one(p, 'body') ?? ''
    if (t && about && ['need', 'ready'].includes(this.engine.statusOf(t)))
      this.alert({ id: randomUUID(), from: 'Lineclear', ...about, body: `${about.body}\n${from}: ${why}` })
    else if (far) this.alert({ id: randomUUID(), from, title, body, go: { place: far.place, task: far.id }, ...waits })
    else
      this.alert({
        id: randomUUID(),
        from,
        title,
        body,
        go: about?.go ?? { place: ctx.chat && !ctx.chat.includes('/') ? ctx.chat : placeId.home() },
        ...(agentTask(ctx) ? { task: true as const } : {}),
      })
    return 'Alert sent.'
  }

  protected showCommand(p: Parsed, ctx: Ctx) {
    // the defaults where it runs: its space's (a space's coordinator, one of its tasks, --space, or a folder in it),
    // else this machine's
    const pr = this.placeOfCommand(p, ctx)?.name
    const now = this.health.last ? `\n\n${NAME} now: ${summary(this.health.last)} · ${this.workingLine()}` : ''
    const head = `Defaults for ${pr ? `${this.places.nameOf(placeId.space(pr))} on ${NAME}` : NAME} (a space's own win over its machine's, which win over Everywhere; in brackets where each comes from):`
    // tasks take their model from the space's ordered lists (Settings > Models), not from a model setting
    const lists = pr ? projectLists(pr) : undefined
    const listed = (h: { kind: string; effort?: string }, role: 'worker' | 'reviewer') => ({ ...h, model: lists?.[role]?.join(', then ') })
    const block = settingsBlock('<id>', {
      ways: this.settings.ways(pr),
      reviewer: listed(this.settings.harness('reviewer', pr), 'reviewer'),
      agent: listed(this.settings.harness('task', pr), 'worker'),
      by: this.settings.setBy(pr),
    })
    const repo = pr ? this.places.byName(pr) : undefined
    return `${head}${repo ? `\nBase branch: ${repo.base} (new tasks; per-task override: --base <branch>)` : ''}\n${this.settings.lines(pr, NAME, lists)}${now}\n\nEvery new task's brief${pr ? ` in ${pr}` : ''} ends with:\n${block}\n\nFor one task, set any of these with task add: --set review.rounds=1 --set merge="ask me first" (--set agent=codex, model, effort, reviewer, reviewer.model, reviewer.effort too), or say so in its brief, which wins.`
  }

  /** set or unset */
  protected async setCommand(word: 'set' | 'unset', key: string | undefined, rest: string[], p: Parsed, ctx: Ctx) {
    const value = word === 'unset' ? null : rest.join(' ')
    if (!key || (word === 'set' && !value && !(key.endsWith('.instructions') && rest.length)))
      throw new Error(`lineclear ${word} <key>${word === 'set' ? ' <value>' : ''}`)
    const spaceKey = key === 'space.install' || key === 'space.base'
    if (spaceKey) {
      if (!one(p, 'space') || (key === 'space.base' && word === 'unset'))
        throw new Error(
          key === 'space.install'
            ? 'Use lineclear set space.install "<command>" --space NAME (unset for the default, off for none).'
            : 'Use lineclear set space.base <branch> --space NAME; choose an explicit branch.',
        )
      const pr = this.projectFor(p, ctx)
      if (key === 'space.base') await this.places.setBase(pr.name, value!)
      else this.places.setInstall(pr.name, value)
      this.emit('snapshot')
      return key === 'space.base'
        ? `${pr.name}: base branch ${pr.base}. Existing tasks keep their target.`
        : `${pr.name}: install step ${pr.install ?? 'is the default'}.`
    }
    if (!CATALOG.some((s) => s.rows.some((r) => r.key === key))) throw new Error(`No setting ${key}; lineclear show lists them`)
    // Everywhere unless it says --machine (this machine's own) or --space NAME (that space's own)
    const named = one(p, 'space')
    const pr = named ? (this.places.find(named)?.id === placeId.home() ? '~' : this.projectFor(p, ctx).name) : undefined
    const level: Level = pr ? { space: pr } : p.flags.has('machine') ? 'machine' : 'all'
    if (level === 'all' && BOX) {
      // the main machine keeps Everywhere: it sets it there, and this machine takes it at once
      const r = await mainCli([word, key, ...(value === null ? [] : [value])])
      if (r.code) throw new Error(r.out.trim())
      this.adoptEverywhere()
    } else {
      const r = this.settings.set(key, value, level)
      if (!r.ok) throw new Error(r.error)
    }
    this.settingChanged(key)
    const where = pr ? `${named}'s` : level === 'machine' ? `${NAME}'s` : "Everywhere's"
    const now = this.settings.get(key, pr)
    return `${word === 'unset' ? `${key}: ${where} own is unset; it is ${now} now.` : `${key} = ${now} (${where})`}${key.endsWith('.instructions') ? '\nUsed at the next start or restart; running agents are unchanged. Reviewer changes need a new or restarted task agent.' : ''}`
  }

  protected async doctorCommand() {
    if (BOX) throw new Error(`lineclear doctor checks every machine from the main one: run it there (${HOST} is run from it over SSH).`)
    const own = `${NAME} (this machine, the main one): herdr ${this.agents.reachable ? 'answers' : 'does not answer'}`
    return [own, ...this.pushWarnings().map((warning) => `Alerts: ${warning}`), ...((await this.peers?.doctor()) ?? [])].join('\n')
  }
}
