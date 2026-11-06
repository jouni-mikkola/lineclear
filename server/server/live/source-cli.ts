import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { age } from '../../shared/time.ts'
import { readJson, writeJson } from '../store.ts'
import { pilotCommand, type PilotRun } from './autopilot.ts'
import { modelsOf } from './models.ts'
import { HELP, one, parseArgs, summaryOpts, type Parsed } from './args.ts'
import type { Automation } from './automations.ts'
import { heartbeatFile } from './heartbeat.ts'
import { eventRules, eventsText, eventWords, nextWords, runWords, timeRule, timeWords, triggerWords } from './trigger.ts'
import { checkTitle, ended, type TaskRec } from './engine/engine.ts'
import { answerCard } from './answer.ts'
import * as G from './engine/git.ts'
import { room } from './herdr-forward.ts'
import { BOX, boxHome, forwardTask, machineRef } from './box.ts'
import { asMode, HOST, NAME, placeId } from './places.ts'
import { settingsBlock } from './prompts.ts'
import { CATALOG, CLI_NAME, CLIS, kindOf, type Level } from './settings.ts'
import { summary } from './health.ts'
import { harnessOf, mainCli } from './source-helpers.ts'
import { LiveSourceSubcommands } from './source-subcommands.ts'

export class LiveSourceCli extends LiveSourceSubcommands {
  protected async resumePilots(cut: PilotRun[]) {
    // herdr may still be coming up after a restart: give it up to 40 s before the coordinator is asked for
    for (let i = 0; i < 40 && !this.agents.reachable; i++) await new Promise((done) => setTimeout(done, 1000))
    for (const r of cut) {
      if (this.places.mode(r.place) !== 'autopilot' || this.pilots.current(r.place) !== r) continue
      try {
        await this.switchPilot(r.place, 'autopilot', false, true, undefined, r)
      } catch (e) {
        console.error(`lineclear: ${r.place}'s coordinator timer did not start again after the restart: ${(e as Error).message}`)
      }
    }
  }

  protected async pilotCli(r: PilotRun, args: string[], ctx: { chat: string; cwd: string; stdin?: string }) {
    try {
      this.pilots.check(r, -1)
      pilotCommand(r, ctx.chat, args)
      const p = parseArgs(args)
      if (args[0] === 'task' && args[1] === 'add') {
        const project = this.placeOfCommand(p, ctx)
        if (placeId.space(project?.name ?? '') !== r.place) throw new Error('New tasks must stay in this coordinator timer space.')
        this.pilots.check(r, this.activePilotTasks(r))
      }
      if (args[0] === 'secret' && ['run', 'env'].includes(args[1])) {
        const names = p.words.slice(2)
        if (names.some((n) => !r.config.secrets.includes(n))) throw new Error('That secret is outside this permission profile.')
        const chain = [r.place, placeId.machine(), 'all']
        return { out: '', code: 0, secrets: this.secretValues(names, chain) }
      }
      if (args[0] === 'checkpoint') {
        const t = this.engine.task(ctx.chat.split('/')[0])
        if (!t?.worktree || t.pilot !== r.id || args.length !== 2 || !args[1].trim())
          throw new Error('Use lineclear checkpoint "commit message" from your owned task.')
        const safe = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', t.worktree]
        for (const op of [
          ['add', '--all'],
          ['commit', '-m', args[1]],
        ]) {
          const result = await G.sh([...safe, ...op], t.worktree, { timeoutMs: 30000, env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } })
          if (result.code) throw new Error(result.err || result.out)
        }
        return { out: 'Saved commit.\n', code: 0 }
      }
      if (args[0] === 'complete') {
        if (ctx.chat !== r.place || args.length !== 2 || !args[1].trim()) throw new Error('Use lineclear complete "goal evidence" from the coordinator.')
        const saved = readJson<Record<string, string>>('autopilot-progress.json', {})
        saved[r.place] = args[1].slice(0, 20000)
        writeJson('autopilot-progress.json', saved)
        this.pilots.outcome(r, `Finished: ${args[1].slice(0, 160)}`, true)
        await this.switchPilot(r.place, 'regular')
        return { out: 'coordinator timer finished.\n', code: 0 }
      }
      if (args[0] === 'progress') {
        if (args.length !== 1 && args.length !== 2) throw new Error('Use lineclear progress ["progress and next step"].')
        const saved = readJson<Record<string, string>>('autopilot-progress.json', {})
        if (args[1] !== undefined) {
          saved[r.place] = args[1].slice(0, 20000)
          writeJson('autopilot-progress.json', saved)
        }
        return { out: `${saved[r.place] ?? '(none yet)'}\n`, code: 0 }
      }
      return await this.cli(args, ctx)
    } catch (e) {
      return { out: `${(e as Error).message}\n`, code: 1 }
    }
  }

  protected async monitorPilots() {
    for (const r of this.pilots.runs.filter((r) => r.state === 'on' || r.state === 'workers')) {
      // Chat usage is provider-reported and delayed. It is a stop threshold, never an exact billing cap.
      r.used = Math.max(r.used, (r.carried ?? 0) + this.pilotUsage.tokens(r.id))
      this.pilots.save()
      try {
        this.pilots.check(r, -1)
      } catch (e) {
        r.state = 'failed'
        r.error = (e as Error).message
        this.pilots.save()
        await this.stopPilotAgents(r, false)
        this.emit('snapshot')
      }
    }
  }

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
        if (a1 && !this.engine.machines.has(a1)) throw new Error(`No machine called ${a1}.`)
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
      case 'mode': {
        const place = this.placeNamed(a1)
        const mode = asMode(rest[0])
        if (!place || !mode) throw new Error('lineclear mode <place> autopilot|regular')
        // an agent's or script's shell carries LINECLEAR_CHAT or a credential: only the owner's own terminal turns coordinator timer on
        if (mode === 'autopilot' && (ctx.chat || ctx.proof))
          throw new Error('coordinator timer is switched on only by the owner, on the screen or in their own terminal.')
        const switched = (await this.act({ type: 'mode', place: place.id, mode, by: 'terminal' })) as { ok?: boolean; error?: string }
        if (switched.error) throw new Error(switched.error)
        return `${place.name}: Coordinator timer ${mode === 'autopilot' ? 'on' : 'off'}.`
      }
      case 'task': {
        // a task the list shows "(on desktop)" is run by that machine's worker: its show, tell, close, merge and delete go there
        const ref = machineRef(rest[0] ?? '')
        const args = ref.machine ? [ref.id, ...rest.slice(1)] : rest
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
      case 'answer':
        return answerCard((x) => this.act(x), ctx.chat, one(p, 'space'), a1, rest.join(' '))
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
        const h = this.settings.heartbeat(pr ? { space: pr } : 'machine')
        const next = nextWords(h.time, h.zone)
        const beat = `\n\nHeartbeat on coordinator timer: ${timeWords(h.time, h.zone)}${next.length ? ` (next ${next.join(', ')})` : ''}; news that wakes it at once: ${eventWords(h.on).toLowerCase()}, the rest waits for the heartbeat. Each brings the place's HEARTBEAT.md, its standing checklist: lineclear heartbeat [<place>] shows it, lineclear heartbeat set [<place>] < file changes it.`
        const block = settingsBlock('<id>', {
          ways: this.settings.ways(pr),
          reviewer: this.settings.harness('reviewer', pr),
          agent: this.settings.harness('task', pr),
          by: this.settings.setBy(pr),
        })
        const repo = pr ? this.places.byName(pr) : undefined
        return `${head}${repo ? `\nBase branch: ${repo.base} (new tasks; per-task override: --base <branch>)` : ''}\n${this.settings.lines(pr, NAME)}${beat}${now}\n\nEvery new task's brief${pr ? ` in ${pr}` : ''} ends with:\n${block}\n\nFor one task, set any of these with task add: --set review.rounds=1 --set merge="ask me first" (--set agent=codex, model, effort, reviewer, reviewer.model, reviewer.effort too), or say so in its brief, which wins.`
      }
      case 'models': {
        const kinds = a1 ? [kindOf(a1)] : ['claude', 'codex', 'pi']
        if (!kinds[0]) throw new Error(`No CLI called ${a1}; herdr starts ${CLIS.join(', ')}`)
        return kinds
          .map((k) => {
            const c = modelsOf(k!)
            if (!c) return `${CLI_NAME[k!]}: Lineclear passes it no model or effort; it picks its own.`
            const rows = c.models.map(
              (m) => `  ${m.id.padEnd(28)} ${m.label === m.id ? '' : `${m.label}: `}${m.efforts.length ? m.efforts.join(', ') : 'no effort levels'}`,
            )
            return `${CLI_NAME[k!]} (--agent ${k}), effort levels ${c.efforts.join(', ')}:\n${rows.length ? rows.join('\n') : '  any model id it knows'}${c.others?.length ? `\n  it also takes older ones by id: ${c.others.map((m) => m.id).join(', ')}` : ''}`
          })
          .join('\n\n')
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
        if (a1.startsWith('autopilot.') || /^coordinator\.(agent|model|effort)$/.test(a1)) await this.replacePilots()
        const where = pr ? `${named}'s` : level === 'machine' ? `${NAME}'s` : "Everywhere's"
        const now = this.settings.get(a1, pr)
        // a trigger in words too, to tell the human
        return `${a0 === 'unset' ? `${a1}: ${where} own is unset; it is ${now} now.` : `${a1} = ${now} (${where})`}${this.settings.words(a1, now).replace(/^\n\s*/, '\nIn words: ')}${a1.endsWith('.instructions') ? '\nUsed at the next start or restart; running agents are unchanged. Reviewer changes need a new or restarted task agent.' : ''}`
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
      case 'heartbeat': {
        // a space by its name, else the coordinator asking, else the space of its folder, else the home space. Its
        // checklist is printed and changed here, never named by path: the file is on the machine Lineclear runs from
        const set = a1 === 'set'
        const name = set ? rest[0] : a1
        const named = name ? this.placeNamed(name) : undefined
        if (name && !named) throw new Error(`No place ${name}`)
        const at =
          named ??
          this.placeList().find((x) => x.id === ctx.chat) ??
          this.placeList().find((x) => this.placeOfCommand(p, ctx) && x.id === placeId.space(this.placeOfCommand(p, ctx)!.name)) ??
          this.placeList().find((x) => x.id === placeId.home())!
        if (this.peers?.owner(at.id)) throw new Error(`${at.name} is on another machine: ask there`)
        if (set) {
          if (ctx.stdin === undefined)
            throw new Error('Give the whole new HEARTBEAT.md on stdin: lineclear heartbeat set [<place>] < file, or with a heredoc. Empty stops the heartbeat.')
          this.heartbeats.write(at.id, ctx.stdin.trim() ? ctx.stdin : '')
          if (this.places.mode(at.id) === 'autopilot') await this.switchPilot(at.id, 'autopilot', false, true)
          this.emit('snapshot')
          return ctx.stdin.trim()
            ? `${at.name}'s HEARTBEAT.md is saved: the next heartbeat goes through it.`
            : `${at.name}'s HEARTBEAT.md is empty now: no heartbeat until it has a checklist again.`
        }
        const h = this.settings.heartbeat(this.levelOf(at.id))
        const last = this.heartbeats.last(at.id)
        // on coordinator timer, the next one counts from the last; else the rule's next three
        const due = at.mode === 'autopilot' && last ? this.heartbeats.next(at.id, h.time, h.zone) : undefined
        const times = due !== undefined ? [runWords(due, h.zone)] : nextWords(h.time, h.zone)
        const when = `${timeWords(h.time, h.zone)}${due !== undefined ? `; last ${age(last!)} ago` : ''}${times.length ? `; next ${times.join(', ')}${due !== undefined ? ' once idle' : ''}` : ''}`
        const held = this.heartbeats.held(at.id)
        const list = this.heartbeats.read(at.id, this.roleOf(at.id)).trim()
        return [
          `${at.name}: Coordinator timer ${at.mode === 'autopilot' ? 'on' : 'off'}; heartbeat: ${when}. Wakes at once on: ${eventWords(h.on).toLowerCase()}${held.length ? ` (${held.length} news waiting for the heartbeat)` : ''}. (Settings: heartbeat.when, heartbeat.on, time.zone.)`,
          list
            ? `HEARTBEAT.md${existsSync(heartbeatFile(at.id)) ? '' : ' (the starting checklist: none saved yet)'}:\n${list}`
            : 'HEARTBEAT.md is empty: no heartbeat until it has a checklist.',
          `Change it: lineclear heartbeat set${named ? ` ${at.name}` : ''} < file (the whole new text on stdin; empty stops the heartbeat), or the human in Settings → coordinator timer.`,
        ].join('\n\n')
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
