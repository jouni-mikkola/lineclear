import { asEmoji, artifactQuote, cardMessage, nameProblem, type Action } from '../../shared/types.ts'
import * as D from './data.ts'
import { ARTIFACT_DATA } from './artifacts.ts'
import { CLI_NAME, kindOf } from '../live/settings.ts'
import { harnessProblem, harnessWords, restartClis } from '../live/restart.ts'
import { nextWords } from '../live/trigger.ts'
import { excerpt } from '../live/chatlines.ts'
import { shortUrl } from '../../shared/browser.ts'
import { deleteSection, moveSpace, newSection, PINNED, renameSection, sectionProblem, setOrder } from '../../shared/order.ts'
import { seq, id } from './world-helpers.ts'
import { DemoWorldState } from './world-state.ts'

export class DemoWorldActions extends DemoWorldState {
  async act(a: Action): Promise<unknown> {
    switch (a.type) {
      case 'send': {
        const at = Date.now()
        const waiting = this.held(a.chat) || undefined
        const waitsFor = waiting && a.chat.includes('/') ? ('menu' as const) : undefined
        const cid = a.cid
        const to = a.reply ? this.chats[a.chat]?.messages.find((x) => x.id === a.reply) : undefined
        const art = to && !to.text && !to.file && to.artifact ? this.art(to.artifact.id) : undefined
        const reply =
          to &&
          (art
            ? { id: to.id, who: to.who, text: artifactQuote(art.title, to.artifact!.v), artifact: true }
            : { id: to.id, who: to.who, text: to.text ? excerpt(to.text, 160) : (to.file?.name ?? ''), ...(to.text ? {} : { file: true }) })
        const files = (a.attachments ?? []).map((p, i) => ({
          who: 'you' as const,
          file: {
            name: p
              .split('/')
              .pop()!
              .replace(/^[a-z0-9]+-/, ''),
            path: p,
          },
          waiting,
          waitsFor,
          cid,
          reply: !i && !a.text ? reply : undefined,
        }))
        // your words answer the choice cards still open there, as in the real one (not a plan, nor the CLI's own question)
        for (const m of this.chats[a.chat]?.messages ?? []) {
          const q = m.question
          if (!q || q.asks || q.kind === 'Plan' || q.sent !== undefined) continue
          Object.assign(q, { sent: -1, said: a.text.trim() || undefined, via: 'chat' })
          for (const [pl, qid] of Object.entries(this.asks)) if (qid === q.id) delete this.asks[pl]
        }
        this.push(a.chat, ...(a.text ? [{ who: 'you' as const, text: a.text, waiting, waitsFor, cid, reply }] : []), ...files)
        // a To do task's agent decides from your words: a go sets it to work, a change to its brief leaves it waiting
        const todo = this.task(a.chat.split('/')[0])
        // a queued task: any message is the go, it waits for nothing more
        if (todo?.status === 'queued')
          setTimeout(() => {
            todo.after = undefined
            this.push(a.chat, { who: 'agent', text: 'Starting now.' })
            this.setTask(todo.id, 'work', 'Reading the code')
          }, 800)
        if (todo?.status === 'todo')
          setTimeout(() => {
            const text = a.text ?? ''
            if (!/\b(go|start)\b/i.test(text) || /\b(don'?t|not yet|wait)\b/i.test(text))
              return this.push(a.chat, { who: 'agent', text: 'Noted. I’ll keep waiting for your go.' })
            this.push(a.chat, { who: 'agent', text: 'On it.' })
            this.setTask(todo.id, 'work', 'Reading the code')
          }, 800)
        return { waiting: !!waiting, waitsFor, at }
      }
      case 'react': {
        const m = this.chats[a.chat]?.messages.find((x) => x.id === a.message)
        if (!m) return {}
        const rx = (m.reactions ??= [])
        const i = rx.findIndex((r) => r.emoji === a.emoji)
        const w = i >= 0 ? rx[i].by : undefined
        const next = w === 'me' ? undefined : w === 'them' ? 'both' : w === 'both' ? 'them' : 'me'
        if (i >= 0) rx.splice(i, 1)
        if (next) rx.splice(i >= 0 ? i : rx.length, 0, { emoji: a.emoji, by: next, pending: next !== 'them' && this.held(a.chat) ? true : undefined })
        this.emit('chat', a.chat)
        return {}
      }
      case 'answer':
        return this.answer(a)
      case 'secret': {
        const r = this.vault.set(a.level, a.name, a.value === null ? null : a.value.replace(/[\r\n]+$/, ''))
        if (!r.ok) return r
        // the card that asked for it says where it is kept, and the chat shows what you gave: its name
        const m = a.card && this.chats[a.card.chat]?.messages.find((x) => x.secret?.id === a.card!.id)
        if (a.card && m?.secret && a.value !== null) {
          const where = m.secret.levels.find((l) => l.id === a.level)?.label ?? a.level
          m.secret = { ...m.secret, saved: where }
          this.push(a.card.chat, { who: 'you', answered: 'Gave a secret', text: `${a.name}, for ${where}` })
          setTimeout(() => this.push(a.card!.chat, { who: 'agent', text: `Thanks: ${a.name} is in. Posting the release notes now.` }), 900)
        }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'artifact-send':
      case 'artifact-say':
      case 'artifact-note': {
        const art = this.art(a.artifact)
        if (!art) return { ok: false, error: 'That artifact is gone.' }
        // its keeper: the agent's chat while it has a task, else the place's coordinator
        const key = Object.values(this.chats).find((c) => c.key.includes('/') && c.messages.some((m) => m.artifact?.id === art.id))?.key ?? art.place
        if (a.type === 'artifact-send') {
          this.artifactSent[art.id] = { html: art.versions[0].html, text: a.text }
          this.push(key, { who: 'you', answered: `Sent from "${art.title}"`, text: a.text })
        } else if (a.type === 'artifact-note')
          this.push(key, { who: 'you', text: `[note on ${a.target ? `${a.target} in "${art.title}"` : `"${art.title}"`}] ${a.note}` })
        else {
          this.push(key, { who: 'you', answered: `About "${art.title}"`, text: a.text })
          // the agent takes it and comes back with a new version, as a real one would
          setTimeout(() => this.push(key, { who: 'agent', text: 'On it.' }), 900)
          setTimeout(() => {
            const n = art.v + 1
            art.v = n
            art.at = Date.now()
            art.when = 'now'
            art.versions.unshift({ n, when: 'now', by: art.by, note: a.text.slice(0, 40), html: art.versions[0].html })
            const extra = ARTIFACT_DATA[art.id]
            if (extra) extra[n] = extra[n - 1]
            this.push(key, { who: 'agent', text: 'Done: the new version is in.', artifact: { id: art.id, v: n } })
            this.emit('snapshot')
          }, 3200)
        }
        return { to: art.keeper }
      }
      case 'browser-notes': {
        // as the live chat shows them: each element and its note
        this.push(a.chat, {
          who: 'you',
          text: [`Notes in the browser on ${shortUrl(a.url)}:`, ...a.notes.map((n, i) => `${i + 1}. ${n.pick.element}: ${n.comment}`)].join('\n'),
        })
        return {}
      }
      case 'artifact-delete': {
        this.artifacts = this.artifacts.filter((x) => x.id !== a.artifact)
        this.emit('snapshot')
        return {}
      }
      case 'model':
      case 'effort':
        return { ok: false, error: 'Use the + menu agent controls and Restart to apply model or effort changes. Chat and work are preserved.' }
      case 'text':
        this.termInput[a.chat] = (this.termInput[a.chat] ?? '') + a.text
        this.emit('terminal', a.chat, this.screen(a.chat))
        return {}
      case 'keys': {
        for (const k of a.keys) {
          const now = this.termInput[a.chat] ?? ''
          if (k === 'backspace') this.termInput[a.chat] = now.slice(0, -1)
          else if (k === 'enter' && now.trim()) {
            this.termInput[a.chat] = ''
            this.push(a.chat, { who: 'you', text: now.trim() })
          } else if (k === 'ctrl+c' || k === 'esc') this.termInput[a.chat] = ''
        }
        this.emit('terminal', a.chat, this.screen(a.chat))
        return {}
      }
      case 'call': {
        if (a.on) setTimeout(() => this.push(a.chat, { who: 'you', text: 'Also ping me when CI is green.' }, { who: 'agent', text: 'Will do.' }), 1500)
        return {}
      }
      case 'automation': {
        const list = (this.automations[a.place] ??= [])
        const x = list.find((y) => y.name === a.name)
        if (!x) return { ok: false, error: `No automation “${a.name}” here` }
        if (a.op === 'remove') this.automations[a.place] = list.filter((y) => y !== x)
        else if (a.op === 'run') x.runs = [{ at: Date.now(), task: `GTM-${50 + x.runs.length}` }, ...x.runs]
        else {
          x.on = a.op === 'resume'
          x.next = x.on && x.time ? nextWords(x.time, D.DEMO_ZONE) : []
        }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'setting': {
        if (a.key === 'space.base') {
          if (!a.place || !(a.place in this.bases) || !a.value?.trim() || /[\s~^:?*[\\]/.test(a.value)) return { ok: false, error: 'Choose a branch name.' }
          this.bases[a.place] = a.value
          this.emit('snapshot')
          return { ok: true }
        }
        // a plugin's switch: on at once here (a real install restarts with it)
        if (a.key.startsWith('plugin.')) {
          const name = a.key.slice('plugin.'.length)
          this.pluginsOff = a.value === 'off' ? [...this.pluginsOff.filter((n) => n !== name), name] : this.pluginsOff.filter((n) => n !== name)
          this.sections = D.settings(this.stores, this.pluginsOff)
          this.emit('snapshot')
          return { ok: true }
        }
        // set at its level, on its machine; Everywhere is every machine's
        const [kind, machine, space] = (a.place ?? 'all').split(':')
        const level = kind === 'p' ? { space } : kind === 'm' ? ('machine' as const) : ('all' as const)
        const on = kind === 'all' ? Object.values(this.stores) : [this.stores[machine as keyof typeof this.stores]].filter(Boolean)
        for (const st of on) {
          const r = st.set(a.key, a.value, level)
          if (!r.ok) return r
        }
        this.sections = D.settings(this.stores, this.pluginsOff)
        this.emit('snapshot')
        return {}
      }
      case 'archive': {
        const t = this.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        t.archived = a.on ? Date.now() : undefined
        // archiving a working one stops its agent first
        if (a.on && t.status === 'work') Object.assign(t, { status: 'need', sub: 'Stopped', report: undefined })
        t.state = a.on ? 'Archived · just now' : D.STATE_LABEL[t.status]
        if (a.on) t.age = 'now'
        if (a.on) t.pinned = undefined
        this.emit('snapshot')
        return { ok: true }
      }
      case 'pin': {
        const t = this.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        t.pinned = a.on && !t.archived ? Date.now() : undefined
        this.emit('snapshot')
        return { ok: true }
      }
      case 'restart-info': {
        const c = this.chat(a.chat)
        const t = this.task(a.chat.split('/')[0])
        const on = kindOf(c?.cli ?? '') ?? 'claude'
        const want = c?.restart ? (kindOf(c.restart.want) ?? on) : on
        return {
          ok: true,
          info: {
            role: a.chat.includes('/') ? 'task' : 'coordinator',
            space: this.places.find((p) => p.id === (t?.place ?? a.chat))?.name,
            on: c?.agent ?? { kind: on },
            onWords: harnessWords(c?.agent ?? { kind: on }),
            want: { kind: want },
            clis: restartClis(['claude', 'codex', 'pi']),
            working: t?.status === 'work',
          },
        }
      }
      case 'restart': {
        const c = this.chat(a.chat)
        if (!c) return { ok: false, error: 'No such chat.' }
        const kind = a.kind ?? (c.restart ? kindOf(c.restart.want) : undefined) ?? kindOf(c.cli) ?? 'claude'
        const problem = harnessProblem({ kind, model: a.model, effort: a.effort })
        if (problem) return { ok: false, error: problem }
        const words = harnessWords({ kind, model: a.model, effort: a.effort })
        c.agent = { kind, model: a.model, effort: a.effort }
        c.cli = CLI_NAME[kind] ?? kind
        c.restart = undefined
        c.messages.push(cardMessage({ id: `restart-${id()}`, restart: true, text: `Restarted on ${words}` }, Date.now() + seq))
        this.emit('chat', a.chat)
        return { ok: true, on: words }
      }
      case 'pause': {
        const t = this.task(a.chat.split('/')[0])
        if (t?.status !== 'work') return { ok: false, error: 'It isn’t working.' }
        Object.assign(t, { status: 'todo', sub: '', report: undefined, state: 'To do · paused just now' })
        this.emit('snapshot')
        return { ok: true }
      }
      case 'close': {
        const t = this.task(a.chat.split('/')[0])
        if (!t || t.status === 'done') return { ok: false, error: 'It is done already.' }
        // a task at work or waiting holds work on its branch: asked about once, as the real one is
        if (!a.force && t.status !== 'todo' && t.status !== 'queued') return { ok: false, held: [`work on ${t.branch ?? 'its branch'} that main lacks`] }
        Object.assign(t, {
          status: 'done',
          sub: 'Nothing to merge',
          report: undefined,
          state: 'Done · nothing to merge · just now',
          age: 'now',
          doneAt: Date.now(),
        })
        this.emit('snapshot')
        return { ok: true }
      }
      case 'space-remove': {
        const pr = this.places.find((p) => p.id === a.place)
        if (pr?.home) return { ok: false, error: `${pr.name} is ${pr.machine}'s home space: it can be renamed, not removed.` }
        if (!pr) return { ok: false, error: 'That space is gone already.' }
        const working = this.tasks.filter((t) => t.place === pr.id && !t.archived && t.status === 'work').map((t) => t.id)
        if (working.length)
          return {
            ok: false,
            error: `${working.join(', ')} ${working.length > 1 ? 'are' : 'is'} still working: pause or finish ${working.length > 1 ? 'them' : 'it'} first.`,
          }
        // its tasks go with it (the live one keeps them, for when it is added again)
        this.places = this.places.filter((p) => p !== pr)
        this.tasks = this.tasks.filter((t) => t.place !== pr.id)
        delete this.addedAt[pr.id]
        this.emit('snapshot')
        return { ok: true }
      }
      case 'read': {
        for (const [k, at] of Object.entries(a.chats)) if (k !== '*' && at > (this.read[k] ?? 0)) this.read[k] = at
        this.emit('snapshot')
        return { ok: true }
      }
      case 'rename': {
        if (this.groups[a.id] || a.id === PINNED) {
          const emoji = a.emoji === undefined ? undefined : asEmoji(a.emoji)
          const bad = emoji === null ? 'One emoji at a time.' : renameSection(this.groups, a.id, a.name.replace(/\s+/g, ' ').trim(), emoji)
          if (bad) return { ok: false, error: bad }
          this.emit('snapshot')
          return { ok: true }
        }
        const m = this.machines.find((x) => x.id === a.id)
        const p = this.places.find((x) => x.id === a.id)
        const emoji = a.emoji === undefined ? undefined : asEmoji(a.emoji)
        if (emoji === null || (emoji !== undefined && !m)) return { ok: false, error: 'Only a machine takes an emoji, one at a time.' }
        if (m) {
          m.name = a.name.trim() || m.machine
          if (emoji) m.emoji = emoji
          else if (emoji === '') delete m.emoji
        } else if (!p) return { ok: false, error: 'Nothing to rename.' }
        else {
          const name = a.name.trim() || (p.home ? 'home' : p.id.split(':').at(-1)!)
          const bad = nameProblem(
            name,
            this.places.filter((x) => x.machine === p.machine && x !== p).map((x) => x.name),
          )
          if (bad) return { ok: false, error: bad }
          p.name = name
        }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'order': {
        setOrder(this.order, a.under, a.ids)
        this.emit('snapshot')
        return { ok: true }
      }
      case 'move': {
        const bad = moveSpace(this.order, this.groups, this.places, this.machines, a.id, a.to, a.before)
        if (bad) return { ok: false, error: bad }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'section': {
        if (a.op === 'delete') deleteSection(this.groups, this.order, a.id)
        else {
          const name = a.name.replace(/\s+/g, ' ').trim()
          const emoji = a.emoji === undefined ? '' : asEmoji(a.emoji)
          const bad = emoji === null ? 'One emoji at a time.' : sectionProblem(this.groups, name, a.machine || undefined)
          if (bad) return { ok: false, error: bad }
          const id = newSection(this.groups, this.order, { name, ...(emoji ? { emoji } : {}), ...(a.machine ? { machine: a.machine } : {}) }, this.machines)
          this.emit('snapshot')
          return { ok: true, id }
        }
        this.emit('snapshot')
        return { ok: true }
      }
      case 'delete': {
        const t = this.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        // a task not finished holds work on its branch: refused once, as the real one is
        if (!a.force && t.status !== 'done') return { ok: false, held: [`work on ${t.branch ?? 'its branch'} that main lacks`] }
        this.tasks.splice(this.tasks.indexOf(t), 1)
        this.emit('snapshot')
        return { ok: true }
      }
    }
  }
}
