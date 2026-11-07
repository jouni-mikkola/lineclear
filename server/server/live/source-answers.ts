import { openCards } from '../../shared/alerts.ts'
import type { Action } from '../../shared/types.ts'
import { line } from './chatlines.ts'
import { menuId, menuKeys } from './chats.ts'
import { LiveSourceSpaces } from './source-spaces.ts'

type Answer = Extract<Action, { type: 'answer' }>
type Done = { ok: boolean; error?: string }

/** the answers to a card in a chat: a menu in the terminal, Lineclear's own choice card, the CLI's question tool */
export class LiveSourceAnswers extends LiveSourceSpaces {
  protected menuAnswers = new Set<string>()

  protected async answer(a: Answer): Promise<Done> {
    const key = a.chat
    const qid = a.question
    // answered on its copy in the space's chat: the task's chat says so, as does the copy
    const space = this.spaceOf(key, a.space)
    // a notification's button: only the card the chat still ends on, unanswered
    if (a.fromAlert && !openCards(this.chats.chat(key)).some((m) => m.question.id === qid)) return { ok: false, error: 'This card no longer waits on you.' }
    if (qid.startsWith('menu:')) return this.answerMenu(a, space)
    const posted = this.chats.log(key).posted.find((p) => p.question?.id === qid)
    if (posted?.question) return this.answerCard(a, posted.question, space)
    const open = this.chats.openQuestion(key)
    // only the question still asked, and only a part of it not answered yet: an old alert's button can't answer the next
    if (open && (qid === open.id || qid.startsWith(`${open.id}:`)) && this.chats.log(key).answers[qid] === undefined) return this.answerQuestion(a, open, space)
    return { ok: false }
  }

  /** what the human answered, as their line in the chat, and in the space's chat when the answer came from there */
  private youAnswered(a: Answer, space: string | undefined, id: string, title: string, text: string | undefined) {
    this.chats.post(a.chat, {
      id,
      who: 'you',
      answered: `Answered \u201c${title}\u201d`,
      elsewhere: space ? this.chats.answeredIn(space) : undefined,
      text,
    })
    if (space) this.answeredHere(space, a.chat, title, text ?? '')
  }

  /** a menu in the terminal: the keys that pick the choice */
  private async answerMenu(a: Answer, space: string | undefined): Promise<Done> {
    const key = a.chat
    const qid = a.question
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
      for (let i = 0; i < 8 && !changed; i++) {
        await new Promise((r) => setTimeout(r, 350))
        await this.agents.refresh()
        await this.chats.readMenu(key, true)
        const next = this.chats.menu(key)
        changed = !next || menuId(key, next) !== qid
      }
      if (!changed) {
        const error = 'The terminal still shows this prompt. Try again or open the terminal.'
        const id = `menu-failed:${Date.now()}`
        this.chats.post(key, { id, card: { id, text: error } })
        this.emit('chat', key)
        return { ok: false, error }
      }
      const said = menu.multi ? (a.choices?.length ? a.choices.map((i) => menu.choices[i]).join(', ') : menu.reject) : menu.choices[a.choice]
      this.youAnswered(a, space, `menu-answer:${Date.now()}`, menu.title, said)
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

  /** Lineclear's own choice card: the answer goes in as one chat line */
  private async answerCard(
    a: Answer,
    q: NonNullable<ReturnType<LiveSourceAnswers['chats']['log']>['posted'][number]['question']>,
    space: string | undefined,
  ): Promise<Done> {
    const key = a.chat
    // answered already (in the app, by typing, or an old alert's button): never a second answer
    if (q.sent !== undefined || this.chats.log(key).answers[a.question] !== undefined) return { ok: false, error: 'This card is answered already.' }
    const labels = (a.choices ?? [a.choice]).map((i) => q.choices[i]?.label).filter(Boolean)
    const answer = a.other || labels.join(', ')
    q.sent = a.choice
    this.chats.answer(key, a.question, a.choice, a.other, space)
    if (space) this.answeredHere(space, key, q.title, answer)
    await this.send(key, `${line.answer(this.user, q.title, answer)}${a.note ? `\n${a.note}` : ''}`, [], true)
    this.emit('snapshot')
    return { ok: true }
  }

  /** the CLI's own question tool (AskUserQuestion, request_user_input): keys in its own menu */
  private async answerQuestion(a: Answer, open: NonNullable<ReturnType<LiveSourceAnswers['chats']['openQuestion']>>, space: string | undefined): Promise<Done> {
    const key = a.chat
    const qid = a.question
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
    this.youAnswered(a, space, `cli-answer:${qid}`, item?.question ?? '', label)
    this.engine.youWrote(key, { go: false })
    this.emit('chat', key)
    return { ok: true }
  }
}
