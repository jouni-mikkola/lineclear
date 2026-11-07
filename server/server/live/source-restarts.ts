import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { openCards } from '../../shared/alerts.ts'
import type { Action } from '../../shared/types.ts'
import { HOME } from '../store.ts'
import { hidden } from './agents.ts'
import type { Template } from './automations.ts'
import { eventRules, timeRule } from './trigger.ts'
import { line } from './chatlines.ts'
import { menuId, menuKeys } from './chats.ts'
import { checkTitle, ended } from './engine/engine.ts'
import { NAME, placeId } from './places.ts'
import { restartLine, resumedLine } from './prompts.ts'
import { fitHarness, harnessProblem, harnessWords, recentChat, type Harness } from './restart.ts'
import { CLI_NAME } from './settings.ts'
import { chatDir } from './source-helpers.ts'
import { LiveSourceSpaces } from './source-spaces.ts'

export class LiveSourceRestarts extends LiveSourceSpaces {
  /** a coordinator started again on this CLI, model and effort: the same CLI resumes its session, another takes over
   *  with its role's prompt and the chat's last words. Its tasks go on as they are; a card in its chat marks it */
  protected async restartCoordinator(id: string, to: Harness) {
    if (!this.places.coordinator(id)) throw new Error(`No place ${id}`)
    if (!this.engine.installed(to.kind)) throw new Error(`${CLI_NAME[to.kind] ?? to.kind} isn't installed on this machine.`)
    const h = fitHarness(to)
    const words = harnessWords(h)
    const from = this.agents.record(id)?.kind
    const them = CLI_NAME[from ?? ''] ?? from ?? 'Its agent'
    // read once its turn has stopped: what it said meanwhile counts
    const first = async () => {
      await this.agents.stopTurn(id)
      if (!from) return undefined
      return from === h.kind
        ? hidden(resumedLine(words), 'restart')
        : hidden(restartLine({ from: them, to: words, chat: recentChat(this.chats.chat(id).messages, them) }), 'restart')
    }
    await this.coordinator(id, { as: h, restart: first })
    const card = `restart:${id}:${Date.now()}`
    this.chats.post(id, { id: card, card: { id: card, restart: true, text: `Restarted on ${words}` } })
    if (this.watched.includes(id)) this.emit('chat', id)
    return words
  }

  /** start a coordinator or a task's agent again, on Settings' CLI, model and effort or these; save: as its space's
   *  Settings too */
  protected async restart(key: string, to: Partial<Harness>, save = false) {
    const x = this.restartable(key)
    const requested = { ...x.want, ...to, kind: to.kind ?? x.want.kind }
    const problem = harnessProblem(requested)
    if (problem) throw new Error(problem)
    const h = fitHarness(requested)
    // refused before anything is saved
    if (x.t && ended(x.t)) throw new Error(this.engine.overWords(x.t))
    if (x.t && !x.t.worktree) throw new Error(`${x.t.id} hasn't started yet: it starts on what its brief says.`)
    if (!this.engine.installed(h.kind)) throw new Error(`${CLI_NAME[h.kind] ?? h.kind} isn't installed on this machine.`)
    if (save) {
      const at = x.space ? { space: x.space } : ('machine' as const)
      for (const [k, v] of [
        ['agent', CLI_NAME[h.kind] ?? h.kind],
        ['model', h.model ?? 'default'],
        ['effort', h.effort ?? 'default'],
      ])
        if (this.settings.pick(`${x.role}.${k}`, at).value !== v) {
          const r = this.settings.set(`${x.role}.${k}`, v, at)
          if (!r.ok) throw new Error(r.error ?? `Couldn't save ${x.role}.${k}`)
          this.settingChanged(`${x.role}.${k}`)
        }
    }
    const words = x.t ? await this.engine.restart(x.t.id, h) : await this.restartCoordinator(key, h)
    this.emit('snapshot')
    this.emit('chat', key)
    return words
  }

  /** a space's automation: added (by the command only), paused or on again, run now, removed */
  protected automation(
    place: string,
    op: 'add' | 'pause' | 'resume' | 'run' | 'remove',
    name: string | undefined,
    to?: { name: string; when?: string; on?: string; title: string; brief?: string; agent?: Template['agent'] },
  ) {
    if (!this.places.space(place)) throw new Error('Automations add tasks to a space with a repo: pick one (--space NAME)')
    if (op === 'add') {
      const t = to!
      const task: Template = { title: checkTitle(t.title), ...(t.brief?.trim() ? { desc: t.brief.trim() } : {}), ...(t.agent ? { agent: t.agent } : {}) }
      const time = t.when?.trim() ? timeRule(t.when) : 'off'
      const on = t.on?.trim() ? eventRules(t.on) : []
      if (!t.name?.trim()) throw new Error('An automation needs a name')
      const x = this.automations.add({ place, name: t.name.trim(), trigger: { ...(time !== 'off' ? { time } : {}), ...(on.length ? { on } : {}) }, task })
      this.emit('snapshot')
      return x
    }
    const x = this.automations.find(place, name ?? '')
    if (!x) throw new Error(`No automation “${name}” here`)
    if (op === 'remove') this.automations.remove(place, x.name)
    else if (op === 'run') {
      const t = this.fire(x)
      if (!t) throw new Error(x.runs?.at(-1)?.error ?? 'It could not add its task')
      this.emit('snapshot')
      return t
    } else this.automations.pause(place, x.name, op === 'resume')
    this.emit('snapshot')
    return x
  }

  /** a change from the screen, shown once it is made; or why it could not be */
  protected async shown(change: () => unknown): Promise<{ ok: boolean; error?: string }> {
    try {
      await change()
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    this.emit('snapshot')
    return { ok: true }
  }

  protected async answer(a: Extract<Action, { type: 'answer' }>) {
    const key = a.chat
    const qid = a.question
    // answered on its copy in the space's chat: the task's chat says so, as does the copy
    const space = this.spaceOf(key, a.space)
    // a notification's button: only the card the chat still ends on, unanswered
    if (a.fromAlert && !openCards(this.chats.chat(key)).some((m) => m.question.id === qid)) return { ok: false, error: 'This card no longer waits on you.' }
    // a menu in the terminal: the keys that pick the choice
    if (qid.startsWith('menu:')) {
      await this.chats.readMenu(key, true)
      const menu = this.chats.menu(key)
      if (!menu || menuId(key, menu) !== qid) return { ok: false, error: 'The terminal prompt changed. Read the new card before answering.' }
      const keys = menuKeys(menu, a.choice, a.choices)
      if (!keys) return { ok: false, error: 'Choose one of the options on the card.' }
      // Lock this prompt across concurrent taps, and hold typed messages while its answer is checked.
      if (this.menuAnswers.has(key)) return { ok: false, error: 'Your answer is still being checked.' }
      this.menuAnswers.add(key)
      try {
        await this.agents.keys(key, keys)
        let changed = false
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 350))
          await this.agents.refresh()
          await this.chats.readMenu(key, true)
          const next = this.chats.menu(key)
          if (!next || menuId(key, next) !== qid) {
            changed = true
            break
          }
        }
        if (!changed) {
          const error = 'The terminal still shows this prompt. Try again or open the terminal.'
          this.chats.post(key, { id: `menu-failed:${Date.now()}`, card: { id: `menu-failed:${Date.now()}`, text: error } })
          this.emit('chat', key)
          return { ok: false, error }
        }
        const said = menu.multi ? (a.choices?.length ? a.choices.map((i) => menu.choices[i]).join(', ') : menu.reject) : menu.choices[a.choice]
        this.chats.post(key, {
          id: `menu-answer:${Date.now()}`,
          who: 'you',
          answered: `Answered “${menu.title}”`,
          elsewhere: space ? this.chats.answeredIn(space) : undefined,
          text: said,
        })
        if (space) this.answeredHere(space, key, menu.title, said ?? '')
        if (a.note) await this.agents.send(key, a.note)
      } finally {
        this.menuAnswers.delete(key)
        void this.agents.deliver(key)
      }
      // an answer in the CLI's own menu (a permission) is no go for a queued task
      this.engine.youWrote(key, { go: false })
      this.emit('chat', key)
      return { ok: true }
    }
    // Lineclear's own choice card: the answer goes in as one chat line
    const posted = this.chats.log(key).posted.find((p) => p.question?.id === qid)
    if (posted?.question) {
      const q = posted.question
      // answered already (in the app, by typing, or an old alert's button): never a second answer
      if (q.sent !== undefined || this.chats.log(key).answers[qid] !== undefined) return { ok: false, error: 'This card is answered already.' }
      const labels = (a.choices ?? [a.choice]).map((i) => q.choices[i]?.label).filter(Boolean)
      const answer = a.other || labels.join(', ')
      q.sent = a.choice
      this.chats.answer(key, qid, a.choice, a.other, space)
      if (space) this.answeredHere(space, key, q.title, answer)
      await this.send(key, `${line.answer(this.user, q.title, answer)}${a.note ? `\n${a.note}` : ''}`, [], true)
      this.emit('snapshot')
      return { ok: true }
    }
    // the CLI's own question tool (AskUserQuestion, request_user_input): keys in its own menu
    const open = this.chats.openQuestion(key)
    // only the question still asked, and only a part of it not answered yet: an old alert's button can't answer the next
    if (open && (qid === open.id || qid.startsWith(`${open.id}:`)) && this.chats.log(key).answers[qid] === undefined) {
      const idx = qid === open.id ? undefined : qid.slice(open.id.length + 1)
      const item = open.items[Number(idx ?? 0)]
      // noted before the keys go in: a second tap meanwhile (the app and an alert's button) is refused
      this.chats.answer(key, qid, a.choice, a.other, space)
      const keys: string[] = []
      if (a.other) keys.push(String((item?.options.length ?? 0) + 1))
      else if (item?.multiSelect) {
        for (const c of a.choices ?? [a.choice]) keys.push(String(c + 1))
        keys.push('enter')
      } else keys.push(String(a.choice + 1))
      await this.agents.keys(key, keys)
      if (a.other) {
        await this.agents.text(key, a.other)
        await this.agents.keys(key, ['enter'])
      }
      // the last question of a form: the CLI asks to submit
      if (Number(idx ?? 0) >= open.items.length - 1 && open.items.length > 1) setTimeout(() => this.agents.keys(key, ['enter']), 600)
      const label =
        a.other ||
        (a.choices ?? [a.choice])
          .map((i) => item?.options[i]?.label)
          .filter(Boolean)
          .join(', ')
      this.chats.post(key, {
        id: `cli-answer:${qid}`,
        who: 'you',
        answered: `Answered “${item?.question ?? ''}”`,
        elsewhere: space ? this.chats.answeredIn(space) : undefined,
        text: label,
      })
      if (space) this.answeredHere(space, key, item?.question ?? '', label)
      this.engine.youWrote(key, { go: false })
      this.emit('chat', key)
      return { ok: true }
    }
    return { ok: false }
  }

  /** a level's name, as Settings shows it: Everywhere, this machine's, a space's */
  protected secretLevelName(level: string) {
    if (level === 'all') return 'Everywhere'
    if (level === placeId.machine()) return NAME
    return level.startsWith('p:') ? (this.places.nameOf(level) ?? level.split(':').slice(2).join(':')) : level.slice(2)
  }

  /** delete a task (its agent, herdr space, worktree, branch, chat and record) and what this side kept of its chat */
  protected async deleteTask(id: string, force: boolean) {
    const key = `${id}/Agent`
    const left = await this.engine.deleteTask(id, { force })
    rmSync(join(HOME, 'inbox', chatDir(key)), { recursive: true, force: true })
    this.emit('snapshot')
    return left
  }
}
