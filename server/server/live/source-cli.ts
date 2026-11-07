import { randomUUID } from 'node:crypto'
import { age } from '../../shared/time.ts'
import { HELP, one, parseArgs, summaryOpts, type Parsed } from './args.ts'
import type { Automation } from './automations.ts'
import { eventRules, eventsText, nextWords, timeRule, triggerWords } from './trigger.ts'
import { checkTitle, ended, type TaskRec } from './engine/engine.ts'
import { room } from './herdr-forward.ts'
import { BOX, boxHome, forwardTask, machineRef } from './box.ts'
import { HOST, NAME, placeId } from './places.ts'
import { settingsBlock } from './prompts.ts'
import { CATALOG, type Level } from './settings.ts'
import { summary } from './health.ts'
import { harnessOf, mainCli } from './source-helpers.ts'
import { LiveSourceSubcommands } from './source-subcommands.ts'

export class LiveSourceCli extends LiveSourceSubcommands {
  /* ---------- the lineclear command ---------- */

  async cli(
    args: string[],
    ctx: { chat?: string; cwd?: string; stdin?: string; local?: boolean; proof?: string },
  ): Promise<{ out: string; code: number; secrets?: Record<string, string> }> {
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

  protected async command(p: Parsed, ctx: { chat?: string; cwd?: string; stdin?: string; proof?: string }): Promise<string> {
    const [a0, a1, ...rest] = p.words
    if (!a0 || a0 === 'help' || p.flags.has('help')) return HELP
    switch (a0) {
      case 'alive': {
        if (!a1) throw new Error('lineclear alive <task>')
        if (ctx.chat?.includes('/') && ctx.chat.split('/')[0].toUpperCase() !== a1.toUpperCase()) throw new Error('An agent beats only for its own task.')
        this.engine.alive(a1)
        return 'ok'
      }
      case 'status': {
        if (a1) return this.reportCommand(a1, rest, p, ctx)
        const kept = this.engine.keptLeftovers()
        const line = `Lineclear on ${NAME}: ${this.places.shown().length} spaces, ${this.engine.tasks.filter((t) => !ended(t) && !t.archived).length} open tasks; herdr ${this.agents.reachable ? 'answers' : 'does not answer'}.`
        return kept.length ? `${line}\nDone tasks that kept work (remove it by hand once you're sure):\n${kept.map((k) => `  ${k}`).join('\n')}` : line
      }
      // a machine's room as the adapter reads it, with its tasks at work and its slots from the one store
      case 'room': {
        if (a1 && !this.engine.machines.has(a1) && !this.peers?.knows(a1)) throw new Error(`No machine called ${a1}.`)
        const read = await room(a1)
        if (!read) throw new Error(`${a1 ?? NAME} cannot be reached through herdr.`)
        return JSON.stringify({ host: a1 ?? NAME, ...read, working: this.engine.workingOn(a1), max: this.settings.machine().max }, null, 2)
      }
      // project, from before spaces, is space
      case 'project':
      case 'space': {
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
              x.space
                ? `${x.name}  ${x.space.key}  ${x.space.path}${x.space.github ? `  github:${x.space.github}` : ''}`
                : `${x.name}  (home space)  ${boxHome()}`,
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
      case 'task': {
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
        return other
          ? `${out}\n(${this.engine.task(rest[0])!.id} is also a task on ${other.rec.machine}: say ${other.rec.machine}:${rest[0]} for that one.)`
          : out
      }
      case 'restart':
        return this.restartCommand(a1, p, ctx)
      // done is ready's old name, still taken
      case 'ready':
      case 'done': {
        // a task's agent may leave the id out: it reports its own task
        const id = a1 ?? (ctx.chat?.includes('/') ? ctx.chat.split('/')[0] : undefined)
        if (!id) throw new Error(`lineclear ${a0} <id> --summary "<what changed>"`)
        const t = this.engine.task(id)
        if (!t) throw new Error(`No task ${id}`)
        const { said, facts } = summaryOpts(p, rest)
        const r = await this.engine.done(t.id, said ?? '', facts)
        if (r === 'ended') return `Noted. ${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'}).`
        if (r === 'closed')
          return `Noted: ${t.branch} has no changes, so there is nothing to merge: ${t.id} is Done.${ctx.chat === `${t.id}/Agent` ? ' Your worktree, branch and herdr space close once this turn ends: do nothing more in them.' : ''}`
        if (ctx.chat === `${t.id}/Agent` && this.engine.landAtReady(t.id))
          return `Noted: ${t.id} shows as Ready. Lineclear merges it once this turn ends and starts you again only if the check fails: end your turn now and do nothing more.`
        return `Noted: ${t.id} shows as Ready to merge (not merged yet). Merge only when your brief or the human says so (lineclear merge ${t.id}).`
      }
      case 'todo': {
        const t = this.engine.task(a1 ?? '')
        if (!t) throw new Error(`No task ${a1 ?? ''}; lineclear todo <id>`)
        if (ctx.chat?.includes('/') && ctx.chat.split('/')[0].toUpperCase() !== t.id.toUpperCase())
          throw new Error(`A task's agent says only its own task waits, not ${t.id}.`)
        this.engine.todo(t.id)
        return `Noted: ${t.id} shows as To do until it gets a go. Reply in one line that you have the brief, then end your turn.`
      }
      case 'merge':
        return this.mergeCommand(a1, ctx)
      case 'pr':
      case 'checks': {
        const t = this.engine.task(a1 ?? '')
        if (!t) throw new Error(`no task ${a1 ?? ''}; lineclear ${a0} <id>`)
        if (ctx.chat?.includes('/') && ctx.chat.split('/')[0].toUpperCase() !== t.id.toUpperCase())
          throw new Error(`A task's agent works on its own task's pull request only, not ${t.id}'s.`)
        const r = a0 === 'pr' ? await this.engine.openPr(t.id) : await this.engine.checks(t.id)
        if (!r.ok) throw new Error(r.text)
        return r.text
      }
      case 'plan': {
        const steps = p.opts.step ?? []
        if (!steps.length) throw new Error('lineclear plan <id> --step "..." --step "..."')
        await this.engine.plan(a1, steps)
        return 'Plan posted. Stop now and wait: the yes, or a note, arrives as a message.'
      }
      case 'ask': {
        if (!ctx.chat) throw new Error('lineclear card works from an agent Lineclear started')
        const title = a1
        const labels = p.opts.choice ?? []
        if (!title || labels.length < 2) throw new Error('lineclear card "<question>" --choice "<label>" --choice "<label>" …')
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
      case 'artifact':
        return this.artifactCommand(a1, rest, p, ctx)
      case 'alert': {
        if (!a1) throw new Error('lineclear alert "<title>" --body "<why>"')
        const t = one(p, 'task') ? this.engine.task(one(p, 'task')!) : undefined
        // another machine's task (the main machine's home space keeps every machine's overview): it opens on that task,
        // and while it waits on you it buzzes as the task's own alert would
        const far =
          one(p, 'task') && !t
            ? this.peers
                ?.list()
                .flatMap((l) => l.snap?.tasks ?? [])
                .find((x) => x.id.toUpperCase() === one(p, 'task')!.toUpperCase())
            : undefined
        const waits = far && (far.status === 'need' || far.status === 'ready') ? { tag: far.id, task: true as const } : {}
        // about a task: it opens on its card. While the task waits on you, it says what the task needs as its own alert
        // does (the choices first, then the coordinator's why) and takes that alert's place
        const about = t && this.taskAlert(t)
        const why = [a1, one(p, 'body')].filter(Boolean).join(': ')
        const from = ctx.chat ? this.chatName(ctx.chat) : 'Lineclear'
        if (t && about && ['need', 'ready'].includes(this.engine.statusOf(t)))
          this.alert({ id: randomUUID(), from: 'Lineclear', ...about, body: `${about.body}\n${from}: ${why}` })
        else if (far) this.alert({ id: randomUUID(), from, title: a1, body: one(p, 'body') ?? '', go: { place: far.place, task: far.id }, ...waits })
        else
          this.alert({
            id: randomUUID(),
            from,
            title: a1,
            body: one(p, 'body') ?? '',
            go: about?.go ?? { place: ctx.chat && !ctx.chat.includes('/') ? ctx.chat : placeId.home() },
            ...(ctx.chat?.includes('/') ? { task: true as const } : {}),
          })
        return 'Alert sent.'
      }
      case 'show': {
        // the defaults where it runs: its space's (a space's coordinator, one of its tasks, --space, or a folder in it),
        // else this machine's
        const pr = this.placeOfCommand(p, ctx)?.name
        const now = `${this.health.last ? `\n\n${NAME} now: ${summary(this.health.last)} · ${this.workingLine()}` : ''}`
        const head = `Defaults for ${pr ? `${this.places.nameOf(placeId.space(pr))} on ${NAME}` : NAME} (a space's own win over its machine's, which win over Everywhere; in brackets where each comes from):`
        const block = settingsBlock('<id>', {
          ways: this.settings.ways(pr),
          reviewer: this.settings.harness('reviewer', pr),
          agent: this.settings.harness('task', pr),
          by: this.settings.setBy(pr),
        })
        const repo = pr ? this.places.byName(pr) : undefined
        return `${head}${repo ? `\nBase branch: ${repo.base} (new tasks; per-task override: --base <branch>)` : ''}\n${this.settings.lines(pr, NAME)}${now}\n\nEvery new task's brief${pr ? ` in ${pr}` : ''} ends with:\n${block}\n\nFor one task, set any of these with task add: --set review.rounds=1 --set merge="ask me first" (--set agent=codex, model, effort, reviewer, reviewer.model, reviewer.effort too), or say so in its brief, which wins.`
      }
      case 'set':
      case 'unset': {
        const value = a0 === 'unset' ? null : rest.join(' ')
        if (!a1 || (a0 === 'set' && !value && !(a1.endsWith('.instructions') && rest.length)))
          throw new Error(`lineclear ${a0} <key>${a0 === 'set' ? ' <value>' : ''}`)
        if (a1 === 'space.install') {
          if (!one(p, 'space')) throw new Error('Use lineclear set space.install "<command>" --space NAME (unset for the default, off for none).')
          const pr = this.projectFor(p, ctx)
          this.places.setInstall(pr.name, value)
          this.emit('snapshot')
          return `${pr.name}: install step ${pr.install ?? 'is the default'}.`
        }
        if (a1 === 'space.base') {
          if (a0 === 'unset' || !one(p, 'space')) throw new Error('Use lineclear set space.base <branch> --space NAME; choose an explicit branch.')
          const pr = this.projectFor(p, ctx)
          await this.places.setBase(pr.name, value!)
          this.emit('snapshot')
          return `${pr.name}: base branch ${pr.base}. Existing tasks keep their target.`
        }
        if (!CATALOG.some((s) => s.rows.some((r) => r.key === a1))) throw new Error(`No setting ${a1}; lineclear show lists them`)
        // Everywhere unless it says --machine (this machine's own) or --space NAME (that space's own)
        const named = one(p, 'space')
        const pr = named ? (this.places.find(named)?.id === placeId.home() ? '~' : this.projectFor(p, ctx).name) : undefined
        const level: Level = pr ? { space: pr } : p.flags.has('machine') ? 'machine' : 'all'
        if (level === 'all' && BOX) {
          // the main machine keeps Everywhere: it sets it there, and this machine takes it at once
          const r = await mainCli([a0, a1, ...(value === null ? [] : [value])])
          if (r.code) throw new Error(r.out.trim())
          this.adoptEverywhere()
        } else {
          const r = this.settings.set(a1, value, level)
          if (!r.ok) throw new Error(r.error)
        }
        this.settingChanged(a1)
        const where = pr ? `${named}'s` : level === 'machine' ? `${NAME}'s` : "Everywhere's"
        const now = this.settings.get(a1, pr)
        // a trigger in words too, to tell the human
        return `${a0 === 'unset' ? `${a1}: ${where} own is unset; it is ${now} now.` : `${a1} = ${now} (${where})`}${a1.endsWith('.instructions') ? '\nUsed at the next start or restart; running agents are unchanged. Reviewer changes need a new or restarted task agent.' : ''}`
      }
      case 'automation': {
        const op = a1 ?? 'list'
        const pr = one(p, 'space') || op !== 'list' ? this.projectFor(p, ctx) : null
        const place = pr ? placeId.space(pr.name) : ''
        const name = rest[0]
        const odd = [...Object.keys(p.opts), ...p.flags].filter(
          (f) => !['when', 'on', 'task', 'brief', 'desc', 'space', 'agent', 'model', 'effort', 'name'].includes(f),
        )
        if (odd.length)
          throw new Error(
            `Automation ${op} takes no --${odd[0]}: only --when (a time rule), --on (events), --task, --brief, --agent, --model, --effort, --name and --space`,
          )
        const agent = one(p, 'agent') || one(p, 'model') || one(p, 'effort') ? harnessOf(p, this.settings) : undefined
        const brief = one(p, 'brief') ?? one(p, 'desc')
        const zone = this.settings.zone()
        const runs = (x: Automation) =>
          x.runs?.at(-1) ? `last ran ${age(x.runs.at(-1)!.at)} ago: ${x.runs.at(-1)!.task ?? `failed (${x.runs.at(-1)!.error})`}` : 'not run yet'
        // its trigger in words, its next runs, and as kept (for an edit)
        const told = (x: Automation) => {
          const next = x.on ? nextWords(x.trigger.time, zone) : []
          return `${triggerWords(x.trigger, zone)}${next.length ? `; next ${next.join(', ')}` : ''} [${[x.trigger.time && `--when "${x.trigger.time}"`, x.trigger.on?.length && `--on "${eventsText(x.trigger.on)}"`].filter(Boolean).join(' ')}]`
        }
        if (op === 'add') {
          if (!name || !one(p, 'task') || (!one(p, 'when') && !one(p, 'on')))
            throw new Error('lineclear automation add "<name>" --task "<title>" [--brief "<brief>"] [--when "<time rule>"] [--on "<events>"] (one or both)')
          const x = this.automation(place, 'add', undefined, {
            name,
            when: one(p, 'when'),
            on: one(p, 'on'),
            title: one(p, 'task')!,
            brief,
            agent,
          }) as Automation
          return `Automation “${x.name}” is on: ${told(x)}. It adds the task “${x.task.title}” to ${pr!.name}, with a fresh agent. Tell the human when it runs in these words.`
        }
        if (op === 'edit') {
          if (!name)
            throw new Error(
              'lineclear automation edit "<name>" [--name "<new name>"] [--task …] [--brief …] [--when "<time rule>" | off] [--on "<events>" | none] [--agent …]',
            )
          const when = one(p, 'when')
          const on = one(p, 'on')
          const x = this.automations.edit(place, name, {
            name: one(p, 'name'),
            time: when !== undefined ? timeRule(when) : undefined,
            on: on !== undefined ? eventRules(on) : undefined,
            task: {
              ...(one(p, 'task') ? { title: checkTitle(one(p, 'task')!) } : {}),
              ...(brief !== undefined ? { desc: brief || undefined } : {}),
              ...(agent ? { agent } : {}),
            },
          })
          this.emit('snapshot')
          return `Automation “${x.name}” changed: ${told(x)}.`
        }
        if (op === 'pause' || op === 'resume' || op === 'run' || op === 'remove') {
          if (!name) throw new Error(`lineclear automation ${op} "<name>"`)
          const r = this.automation(place, op, name)
          if (op === 'run') return `Ran “${name}”: added ${(r as TaskRec).id}.`
          return op === 'remove' ? 'Removed.' : op === 'pause' ? `Paused “${name}”.` : `“${name}” is on again.`
        }
        if (op !== 'list') throw new Error('lineclear automation add|edit|pause|resume|run|remove|list')
        return (
          this.automations.list
            .filter((x) => !place || x.place === place)
            .map(
              (x) =>
                `${x.name} · ${told(x)} · adds “${x.task.title}”${x.task.agent?.kind ? ` (${[x.task.agent.kind, x.task.agent.model, x.task.agent.effort].filter(Boolean).join(', ')})` : ''} · ${this.places.space(x.place)?.name ?? x.place}${x.on ? '' : ' · paused'} · ${runs(x)}`,
            )
            .join('\n') || 'No automations.'
        )
      }
      case 'doctor': {
        if (BOX) throw new Error(`lineclear doctor checks every machine from the main one: run it there (${HOST} is run from it over SSH).`)
        const own = `${NAME} (this machine, the main one): herdr ${this.agents.reachable ? 'answers' : 'does not answer'}${this.browsers ? `; shared browser ${this.browsers.status().ready ? 'ready' : this.browsers.status().hint}` : ''}`
        return [own, ...this.pushWarnings().map((warning) => `Alerts: ${warning}`), ...((await this.peers?.doctor()) ?? [])].join('\n')
      }
      case 'secret':
        return this.secretCommand(a1, rest, p, ctx)
    }
    throw new Error(`No command ${a0}; lineclear help lists them`)
  }
}
