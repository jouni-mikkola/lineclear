import { effortsOf, findModel, knowsModels, modelsOf } from '../../../src/models.ts'
import { one, type Parsed } from './args.ts'
import { harnessProblem } from './restart.ts'
import { CLI_NAME, CLIS, kindOf, refuse, type Settings } from './settings.ts'

/** task add's --agent, --model and --effort: what it sets for this one task, refused when it makes no sense */
export function harnessOf(p: Parsed, settings: Settings): { kind?: string; model?: string; effort?: string } {
  const cli = one(p, 'agent')
  const kind = cli === undefined ? undefined : kindOf(cli)
  if (cli !== undefined && !kind) throw new Error(`No CLI called ${cli}; herdr starts ${CLIS.join(', ')}`)
  if (kind) {
    const problem = harnessProblem({ kind })
    if (problem) throw new Error(problem)
  }
  const h = settings.harness('task')
  return { ...(kind ? { kind } : {}), ...fit(p, '', kind ?? h.kind, kind && kind !== h.kind ? undefined : h.model) }
}

/** task add's --reviewer, --reviewer-model and --reviewer-effort: who reviews this one task's change, refused when it
 *  makes no sense */
export function reviewerOf(p: Parsed, settings: Settings): { kind?: string; model?: string; effort?: string } {
  const cli = one(p, 'reviewer')
  if (cli !== undefined && refuse('reviewer.agent', cli)) throw new Error(`--reviewer ${cli}: ${refuse('reviewer.agent', cli)}`)
  const kind = cli === undefined ? undefined : kindOf(cli)
  const h = settings.harness('reviewer')
  return { ...(kind ? { kind } : {}), ...fit(p, 'reviewer-', kind ?? h.kind, kind && kind !== h.kind ? undefined : h.model) }
}

/** a --model and --effort as this CLI takes them (a model by its id), refused when it has no such model, or the model
 *  (or else `model`, Settings') takes no such level; default: the CLI's own */
export function fit(p: Parsed, flag: '' | 'reviewer-', kind: string, model?: string): { model?: string; effort?: string } {
  const m = one(p, `${flag}model`)?.trim()
  const e = one(p, `${flag}effort`)?.trim().toLowerCase()
  const name = CLI_NAME[kind] ?? kind
  const c = modelsOf(kind)
  if (((m && m !== 'default') || (e && e !== 'default')) && !c)
    throw new Error(`Lineclear passes a model and effort to Claude Code and pi only; ${name} runs on its own`)
  if (m !== undefined && refuse(`task.model`, m)) throw new Error(`--${flag}model ${m}: ${refuse('task.model', m)}`)
  const found = m && m !== 'default' ? findModel(kind, m) : undefined
  if (m && m !== 'default' && knowsModels(kind) && !found)
    throw new Error(`--${flag}model ${m}: ${name} has no such model. It takes ${c!.models.map((x) => x.id).join(', ')}, or default`)
  const on = m === undefined ? model : m === 'default' ? undefined : (found?.id ?? m)
  if (e !== undefined && e !== 'default') {
    const levels = effortsOf(kind, on)
    if (!levels.includes(e))
      throw new Error(
        levels.length
          ? `--${flag}effort takes default, ${levels.join(', ')}${on ? ` on ${findModel(kind, on)?.label ?? on}` : ` on ${name}`}`
          : `--${flag}effort: ${findModel(kind, on)?.label ?? on} takes no effort level`,
      )
  }
  const pick = (v?: string) => (v === undefined ? undefined : v === 'default' ? '' : v)
  return Object.fromEntries(Object.entries({ model: pick(m === undefined ? undefined : (found?.id ?? m)), effort: pick(e) }).filter(([, v]) => v !== undefined))
}


/** Preserve all task options when a helper asks for a task on another machine. */
export function taskAddArgs(rest: string[], p: Parsed, space?: string): string[] {
  return [
    'task',
    'add',
    ...rest,
    ...Object.entries(p.opts).flatMap(([key, values]) => (key === 'space' && space ? [space] : values).flatMap((value) => [`--${key}`, value])),
    ...[...p.flags].map((key) => `--${key}`),
  ]
}
