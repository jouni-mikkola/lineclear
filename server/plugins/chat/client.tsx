import { definePlugin } from '@client/kernel.ts'
import { draggingFiles } from './paste.ts'
import { Markdown } from './markdown.tsx'
import { JobsSheet, JobsTag, TurnLine } from './activity.tsx'
import { PlaceRestartItem, RestartSheet, TaskRestartItem } from '@client/restart.tsx'
import { touched, setTouched } from './chat-bubbles.tsx'
import { scrolled, setScrolled } from './chat-cards.tsx'
import { ChatView, FindItem } from './chat-view.tsx'
import { Typing, Photo } from './chat-messages.tsx'
import { QuestionCard } from './chat-asks.tsx'
import { SecretCard, Mic, finishDictation, cancelDictation } from './chat-composer.tsx'
import { PlusMenu, DictationBox, Attachments, keepBox } from './chat-attach.tsx'
export { From, Quote, CardShell } from './chat-cards.tsx'
export { QuestionCard, fileUrl } from './chat-asks.tsx'
export { isPicture, albumRows, useChat } from './chat-bubbles.tsx'
export { finishDictation, cancelDictation, toggleDictation } from './chat-composer.tsx'
export { DictationBox } from './chat-attach.tsx'

export { Markdown }

if (typeof addEventListener === 'function') {
  const touch = () => setTouched(Date.now())
  addEventListener('touchmove', touch, { capture: true, passive: true })
  addEventListener('touchend', touch, { capture: true, passive: true })
  addEventListener('scroll', () => Math.min(Date.now() - touched, Date.now() - scrolled) < 120 && setScrolled(Date.now()), { capture: true, passive: true })
}

export default definePlugin({
  name: 'chat',
  setup(reg) {
    reg.views.chat = ChatView
    reg.chatTail.push({ order: 90, View: Typing })
    reg.messageParts.push({ order: 10, View: ({ msg, chat }) => (msg.activity ? <TurnLine a={msg.activity} chat={chat.key} /> : null) })
    reg.composerAbove.push({ order: 10, View: JobsTag })
    reg.overlays.push(JobsSheet)
    reg.messageParts.push({
      order: 60,
      View: ({ msg, chat, from }) => (msg.question ? <QuestionCard q={msg.question} chat={chat} msg={msg.id} from={from} /> : null),
    })
    reg.messageParts.push({ order: 61, View: ({ msg, chat }) => (msg.secret ? <SecretCard ask={msg.secret} chat={chat} /> : null) })
    reg.composerPlus = PlusMenu
    reg.composerMic = Mic
    reg.composerLive.push({ when: (ui, chatKey) => ui.dict === chatKey, View: DictationBox })
    // while it records, Enter puts it in the box and Esc drops it
    reg.keys.push({
      order: 5,
      handle: ({ e, ui }) => {
        if (!ui.dict || (e.key !== 'Enter' && e.key !== 'Escape') || (e.target as HTMLElement)?.closest?.('input, textarea, button')) return false
        e.preventDefault()
        if (e.key === 'Enter') finishDictation()
        else cancelDictation()
        return true
      },
    })
    reg.placeMenu.push({ order: 50, View: ({ place }) => <FindItem chatKey={place.chat} /> }, { order: 55, joined: true, View: PlaceRestartItem })
    reg.agentMenu.push({ order: 50, View: FindItem }, { order: 55, View: TaskRestartItem })
    reg.overlays.push(RestartSheet)
    reg.composerAbove.push({ order: 20, View: Attachments }, { order: 30, View: PlusMenu })
    reg.overlays.push(Photo)
    addEventListener('pointerdown', keepBox, true)
    addEventListener('mousedown', keepBox, true)
    // a file dropped beside a chat (a header, the task list) mustn't open in the tab and take the app away
    window.addEventListener('dragover', (e) => {
      if (!draggingFiles(e.dataTransfer) || (e.target as HTMLElement)?.closest?.('[data-drop]')) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'none'
    })
    window.addEventListener('drop', (e) => draggingFiles(e.dataTransfer) && !(e.target as HTMLElement)?.closest?.('[data-drop]') && e.preventDefault())
  },
})
