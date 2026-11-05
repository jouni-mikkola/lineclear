import { cardMessage, type Message, type UpdateCard } from '../../shared/types.ts'
import type { Source } from '../source.ts'
import * as D from './data.ts'
import { kindOf } from '../live/settings.ts'
import { DemoWorldActions } from './world-actions.ts'
import { CLAUDE_CONTROLS, OTHER_CONTROLS } from './world-helpers.ts'

export class DemoWorld extends DemoWorldActions implements Source {
  constructor() {
    super()
    // a task's first message is its whole brief, Settings block and all, as a live one's is
    for (const t of D.tasks()) {
      const first = this.chats[`${t.id}/Agent`]?.messages[0]
      const desc = this.tasks.find((x) => x.id === t.id)?.desc
      if (first?.who === 'you' && t.desc && desc && first.text?.includes(t.desc)) first.text = first.text.replace(t.desc, desc)
    }
    // timestamps: Shepherdr's update cards were posted before the messages now in the chats
    let at = 1
    const cards: Record<string, Message[]> = {}
    for (const t of this.tasks.filter((x) => !x.archived && (x.status === 'need' || x.status === 'ready' || x.status === 'done'))) {
      const card: UpdateCard = {
        id: `card-${t.id}`,
        task: t.id,
        status: t.status,
        text: t.status === 'done' ? 'is merged' : t.status === 'ready' ? 'is ready to merge' : `needs you: ${t.sub ?? ''}`,
        pr: t.pr,
      }
      ;(cards[t.place] ??= []).push(cardMessage(card, at++))
    }
    // a working task that went quiet, and a project whose main went red
    const quiet = this.tasks.find((x) => !x.archived && x.status === 'work')
    if (quiet)
      (cards[quiet.place] ??= []).push(
        cardMessage({ id: `card-${quiet.id}-stalled`, task: quiet.id, status: 'work', text: 'may be stuck: quiet for 25m' }, at++),
      )
    if (quiet) cards[quiet.place].push(cardMessage({ id: 'card-main-red', red: 'main', text: 'went red: Check failed' }, at++))
    for (const c of Object.values(this.chats)) {
      c.controls = c.cli === 'Claude Code' ? CLAUDE_CONTROLS() : OTHER_CONTROLS()
      c.agent =
        c.cli === 'Claude Code' ? { kind: 'claude', model: 'model-top-5-5', modelLabel: 'Model Top 5.5', effort: 'high' } : { kind: kindOf(c.cli) ?? 'codex' }
      for (const m of c.messages) m.at = at++
      if (cards[c.key]) c.messages.unshift(...cards[c.key])
    }
    // a space whose Settings now say another CLI for its coordinator than the one it runs on
    const moved = this.places.find((p) => !p.home && this.chats[p.chat])
    if (moved) this.chats[moved.chat].restart = { on: 'Claude Code', want: 'Codex' }
  }
}
