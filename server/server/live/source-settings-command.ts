import { projectLists } from './project-models.ts'
import { one, type Parsed } from './args.ts'
import { BOX } from './box.ts'
import { NAME, placeId } from './places.ts'
import { settingsBlock } from './prompts.ts'
import { CATALOG, type Level } from './settings.ts'
import { summary } from './health.ts'
import { mainCli } from './source-helpers.ts'
import { LiveSourceAlerts } from './source-alerts.ts'

type Ctx = { chat?: string; cwd?: string }

export class LiveSourceSettingsCommand extends LiveSourceAlerts {
  protected showCommand(p: Parsed, ctx: Ctx) {
    // the defaults where it runs: its space's (a space's coordinator, one of its tasks, --space, or a folder in it), else this machine's
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

  protected async setCommand(verb: string, key: string | undefined, rest: string[], p: Parsed, ctx: Ctx) {
    const value = verb === 'unset' ? null : rest.join(' ')
    if (!key || (verb === 'set' && !value && !(key.endsWith('.instructions') && rest.length)))
      throw new Error(`lineclear ${verb} <key>${verb === 'set' ? ' <value>' : ''}`)
    if (key === 'space.install') {
      if (!one(p, 'space')) throw new Error('Use lineclear set space.install "<command>" --space NAME (unset for the default, off for none).')
      const pr = this.projectFor(p, ctx)
      this.places.setInstall(pr.name, value)
      this.emit('snapshot')
      return `${pr.name}: install step ${pr.install ?? 'is the default'}.`
    }
    if (key === 'space.base') {
      if (verb === 'unset' || !one(p, 'space')) throw new Error('Use lineclear set space.base <branch> --space NAME; choose an explicit branch.')
      const pr = this.projectFor(p, ctx)
      await this.places.setBase(pr.name, value!)
      this.emit('snapshot')
      return `${pr.name}: base branch ${pr.base}. Existing tasks keep their target.`
    }
    if (!CATALOG.some((s) => s.rows.some((r) => r.key === key))) throw new Error(`No setting ${key}; lineclear show lists them`)
    // Everywhere unless it says --machine (this machine's own) or --space NAME (that space's own)
    const named = one(p, 'space')
    const pr = named ? (this.places.find(named)?.id === placeId.home() ? '~' : this.projectFor(p, ctx).name) : undefined
    const level: Level = pr ? { space: pr } : p.flags.has('machine') ? 'machine' : 'all'
    if (level === 'all' && BOX) {
      // the main machine keeps Everywhere: it sets it there, and this machine takes it at once
      const r = await mainCli([verb, key, ...(value === null ? [] : [value])])
      if (r.code) throw new Error(r.out.trim())
      this.adoptEverywhere()
    } else {
      const r = this.settings.set(key, value, level)
      if (!r.ok) throw new Error(r.error)
    }
    this.settingChanged(key)
    const where = pr ? `${named}'s` : level === 'machine' ? `${NAME}'s` : "Everywhere's"
    const now = this.settings.get(key, pr)
    return `${verb === 'unset' ? `${key}: ${where} own is unset; it is ${now} now.` : `${key} = ${now} (${where})`}${key.endsWith('.instructions') ? '\nUsed at the next start or restart; running agents are unchanged. Reviewer changes need a new or restarted task agent.' : ''}`
  }
}
