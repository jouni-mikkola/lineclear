import { dirname, join } from 'node:path'
import { deleteSection, moveSpace, newSection, PINNED, renameSection, sectionProblem } from '../../shared/order.ts'
import { asEmoji, NAME_MAX, nameProblem, type Action } from '../../shared/types.ts'
import { hidden } from './agents.ts'
import { isCommand } from './commands.ts'
import { line } from './chatlines.ts'
import { BOX } from './box.ts'
import { boxDir } from './mfs.ts'
import { NAME, placeId } from './places.ts'
import { restartInfo } from './restart.ts'
import { CLI_NAME, kindOf } from './settings.ts'
import { PLUGIN_KEY, setPluginOn } from '../plugins.ts'
import { heldWords, chatDir } from './source-helpers.ts'
import { LiveSourceRestarts } from './source-restarts.ts'

export class LiveSourceActions extends LiveSourceRestarts {
  /* ---------- acting ---------- */

  async act(a: Action): Promise<unknown> {
    const peer = this.peers?.ownerOfAction(a)
    if (peer) return this.peers!.act(peer, a)
    return this.actLocal(a)
  }

  protected async actLocal(a: Action): Promise<unknown> {
    switch (a.type) {
      case 'send': {
        // a slash command goes into the CLI as you typed it, for the CLI to run
        if (isCommand(a.text) && !a.reply) return this.slashCommand(a.chat, a.text.trim(), a.attachments ?? [], a.cid)
        const space = this.spaceOf(a.chat, a.space)
        if (space) return this.replyHere(space, a)
        // your words answer the choice cards still open there: they quote them
        if (this.chats.closeAsks(a.chat, a.text)) this.emit('snapshot')
        return this.send(a.chat, this.replying(a.chat, a.text, a.reply), a.attachments ?? [], false, a.cid)
      }
      case 'probe': {
        const key = a.chat
        const ensure = key.includes('/') ? () => this.resumeTaskAgent(key) : () => this.coordinator(key)
        // not 'news': machine news is dropped before any agent sees it (quiet.ts), and a cid is what makes a gone agent start
        await this.agents.send(key, hidden('Update smoke check. Nothing to do: reply with only <no-reply>smoke check</no-reply>.'), {
          ensure,
          cid: `smoke-${Date.now()}`,
        })
        return { ok: true }
      }
      case 'react':
        return this.react(a.chat, a.message, a.emoji)
      case 'answer':
        return this.answer(a)
      case 'secret': {
        // kept on the main machine, whichever machine it is for: a worker never gets one from the screen
        if (BOX) return { ok: false, error: 'Secrets are kept on the main machine.' }
        const value = a.value === null ? null : String(a.value ?? '').replace(/[\r\n]+$/, '')
        const r = this.vault.set(a.level, a.name, value)
        if (!r.ok) return r
        this.emit('snapshot')
        // the agent that asked for it is told, by name, wherever it runs
        if (a.card && value !== null) await this.act({ type: 'secret-saved', chat: a.card.chat, card: a.card.id, name: a.name, level: a.level })
        return { ok: true }
      }
      case 'secret-saved': {
        const posted = this.chats.log(a.chat).posted.find((x) => x.id === a.card && x.secret?.name === a.name)
        if (!posted?.secret || !this.vault.has(a.level, a.name)) return { ok: false, error: 'That secret is not kept there.' }
        const where = posted.secret.levels.find((l) => l.id === a.level)?.label ?? this.secretLevelName(a.level)
        this.chats.post(a.chat, { id: a.card, secret: { ...posted.secret, saved: where } })
        await this.send(a.chat, line.secret(this.user, a.name, where), [], true)
        this.emit('chat', a.chat)
        return { ok: true }
      }
      case 'artifact-send':
      case 'artifact-note':
      case 'artifact-say': {
        const x = this.artifacts.get(a.artifact)
        if (!x) return { ok: false, error: 'That artifact is gone.' }
        const to = this.keeperOf(x)
        const art = line.artifact(x.title, x.id, a.v)
        if (a.type === 'artifact-send') this.artifacts.sent(x, a.v, a.text)
        const text =
          a.type === 'artifact-send'
            ? line.artifactSend(this.user, art, a.text)
            : a.type === 'artifact-say'
              ? line.artifactSay(this.user, art, a.text)
              : line.note(this.user, art, a.target, a.note)
        await this.send(to, text, [], true)
        return { to: this.chatName(to) }
      }
      case 'artifact-delete': {
        if (!this.artifacts.remove(a.artifact)) return { ok: false, error: 'That artifact is gone.' }
        this.emit('snapshot')
        return {}
      }
      case 'browser-notes': {
        if (!this.browsers || !a.notes?.length) return { ok: false }
        // a shot goes in only from this chat's own inbox, where Mark up saved it
        const inbox = join(boxDir(), 'inbox', chatDir(a.chat))
        const notes = a.notes.map((n) => ({
          comment: String(n.comment ?? ''),
          pick: {
            ...n.pick,
            shot: n.pick.shot && dirname(n.pick.shot) === inbox && /^[\w-]+-note-[\w-]+\.png$/.test(n.pick.shot.split('/').pop()!) ? n.pick.shot : undefined,
          },
        }))
        const shots = notes.map((n) => n.pick.shot).filter((x): x is string => !!x)
        await this.send(a.chat, line.browserNotes(this.user, { url: a.url, title: a.title, viewport: a.viewport }, notes), shots, true)
        return {}
      }
      case 'automation':
        try {
          // the screen only pauses, runs or removes one: agents add and change them, through the command
          if (!['pause', 'resume', 'run', 'remove'].includes(a.op)) throw new Error('Ask the coordinator in the chat to add or change an automation')
          this.automation(a.place, a.op, a.name)
          return { ok: true }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      case 'model':
      case 'effort':
        return { ok: false, error: 'Use the + menu agent controls and Restart to apply model or effort changes. Chat and work are preserved.' }
      case 'keys':
        await this.agents.keys(a.chat, a.keys)
        return {}
      case 'text':
        await this.agents.text(a.chat, a.text)
        return {}
      case 'call':
        return {}
      case 'setting': {
        if (a.key.startsWith('taskIds.')) {
          const p = a.place && this.places.space(a.place)
          if (!p) return { ok: false, error: 'Select a repository space in Settings.' }
          return this.shown(() => {
            this.engine.taskIds.ensure(a.place!, p.key)
            p.key = this.engine.taskIds.set(a.place!, a.key, a.value).prefix
            this.places.save()
          })
        }
        const [place, branch] = [a.place, a.value]
        if (a.key === 'space.install')
          return place ? this.shown(() => this.places.setInstall(place, a.value ?? null)) : { ok: false, error: 'Choose a repository space.' }
        if (a.key === 'space.base')
          return place && branch ? this.shown(() => this.places.setBase(place, branch)) : { ok: false, error: 'Choose a repository space and branch.' }
        // a plugin's switch: the human's own list, on the main machine
        if (a.key.startsWith(PLUGIN_KEY)) {
          const r = setPluginOn(a.key.slice(PLUGIN_KEY.length), a.value !== 'off')
          if (r.ok) this.emit('snapshot')
          return r
        }
        // its level: Everywhere (all, or none), this machine (its m: id), or one of its spaces
        const pr = a.place?.startsWith('p:') ? this.spaceKey(a.place) : undefined
        if (a.place?.startsWith('p:') && !pr) return { ok: false, error: 'No such space.' }
        const r = this.settings.set(a.key, a.value, pr ? { space: pr } : a.place?.startsWith('m:') ? 'machine' : 'all')
        if (r.ok) {
          this.settingChanged(a.key)
        }
        return r
      }
      case 'archive': {
        const t = this.engine.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        if (a.on) await this.engine.archive(t.id)
        else this.engine.unarchive(t.id)
        this.emit('snapshot')
        return { ok: true }
      }
      case 'pin': {
        const t = this.engine.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        if (a.on && t.archived) return { ok: false, error: `${t.id} is archived.` }
        this.engine.pin(t.id, a.on)
        this.emit('snapshot')
        return { ok: true }
      }
      case 'pause': {
        const t = this.engine.task(a.chat.split('/')[0])
        return t ? this.shown(() => this.engine.pause(t.id)) : { ok: false, error: 'No such task.' }
      }
      case 'restart-info': {
        try {
          const x = this.restartable(a.chat)
          return {
            ok: true,
            info: restartInfo({
              role: x.role,
              space: x.space,
              on: x.on,
              onKnown: !!this.agents.record(a.chat),
              want: x.want,
              kinds: Object.keys(CLI_NAME).filter(this.engine.installed),
              working: this.agents.status(a.chat) === 'working',
            }),
          }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      }
      case 'restart': {
        try {
          if (!a.kind) return { ok: true, on: await this.restart(a.chat, {}) }
          const kind = kindOf(a.kind)
          if (!kind) return { ok: false, error: `No CLI called ${a.kind}.` }
          return { ok: true, on: await this.restart(a.chat, { kind, model: a.model ?? '', effort: a.effort ?? '' }, !!a.save) }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      }
      case 'close': {
        const t = this.engine.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        if (t.closed || t.merged) return { ok: false, error: `${t.id} is Done already (${t.closed ? 'nothing to merge' : 'merged'}).` }
        // work main lacks stays in its worktree and branch, but the screen asks first
        const held = a.force ? [] : await this.engine.holds(t)
        if (held.length) return { ok: false, held: held.map(heldWords) }
        try {
          const { kept } = await this.engine.close(t.id, undefined, undefined, !!a.force)
          this.emit('snapshot')
          return { ok: true, kept }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      }
      case 'space-remove': {
        const pr = this.places.space(a.place)
        if (!pr && a.place === placeId.home())
          return { ok: false, error: `${this.places.nameOf(a.place)} is ${NAME}'s home space: it can be renamed, not removed.` }
        if (!pr) return { ok: false, error: 'That space is gone already.' }
        try {
          await this.removeSpace(pr.name)
          return { ok: true }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      }
      case 'read': {
        if (!a.chats || typeof a.chats !== 'object') return { ok: false, error: 'No chats to mark read.' }
        if (this.unread.mark(a.chats)) this.emit('snapshot')
        return { ok: true }
      }
      case 'rename': {
        const name = typeof a.name === 'string' ? a.name.replace(/\s+/g, ' ').trim() : null
        if (this.places.sections[a.id] || a.id === PINNED) {
          const emoji = a.emoji === undefined ? undefined : asEmoji(a.emoji)
          const bad = emoji === null ? 'One emoji at a time.' : renameSection(this.places.sections, a.id, name ?? '', emoji)
          if (bad) return { ok: false, error: bad }
          this.places.saveSections()
          this.emit('snapshot')
          return { ok: true }
        }
        const { places, machines } = this.listed()
        const m = machines.find((x) => x.id === a.id)
        const p = places.find((x) => x.id === a.id)
        if ((!p && !m) || name === null) return { ok: false, error: 'Nothing to rename.' }
        const emoji = a.emoji === undefined ? undefined : asEmoji(a.emoji)
        if (emoji === null || (emoji !== undefined && !m)) return { ok: false, error: 'Only a machine takes an emoji, one at a time.' }
        if (name.length > NAME_MAX) return { ok: false, error: `A name fits ${NAME_MAX} characters.` }
        if (m && name && machines.some((x) => x.id !== m.id && x.name.toLowerCase() === name.toLowerCase()))
          return { ok: false, error: `A machine is called ${name} already.` }
        // a space's name follows the space rules, its own on its machine
        const bad =
          p && name
            ? nameProblem(
                name,
                places.filter((x) => x.machine === p.machine && x.id !== p.id).map((x) => x.name),
              )
            : undefined
        if (bad) return { ok: false, error: bad }
        this.places.rename(a.id, name)
        if (emoji !== undefined) this.places.setEmoji(a.id, emoji)
        this.emit('snapshot')
        return { ok: true }
      }
      case 'order': {
        if (typeof a.under !== 'string' || !Array.isArray(a.ids) || !a.ids.every((x) => typeof x === 'string')) return { ok: false, error: 'No order to keep.' }
        this.places.setOrder(a.under, a.ids)
        this.emit('snapshot')
        return { ok: true }
      }
      case 'move': {
        if (typeof a.id !== 'string' || typeof a.to !== 'string') return { ok: false, error: 'Nothing to move.' }
        const { places, machines } = this.listed()
        const bad = moveSpace(this.places.order, this.places.sections, places, machines, a.id, a.to, typeof a.before === 'string' ? a.before : undefined)
        if (bad) return { ok: false, error: bad }
        this.places.saveSections()
        this.emit('snapshot')
        return { ok: true }
      }
      case 'section': {
        if (a.op === 'delete') {
          if (!this.places.sections[a.id] || a.id === PINNED) return { ok: false, error: a.id === PINNED ? 'Pinned stays.' : 'No such section.' }
          deleteSection(this.places.sections, this.places.order, a.id)
        } else {
          const name = typeof a.name === 'string' ? a.name.replace(/\s+/g, ' ').trim() : ''
          const emoji = a.emoji === undefined ? '' : asEmoji(a.emoji)
          const machine = typeof a.machine === 'string' && a.machine ? a.machine : undefined
          const { machines } = this.listed()
          if (emoji === null) return { ok: false, error: 'One emoji at a time.' }
          if (machine && !machines.some((m) => m.machine === machine)) return { ok: false, error: 'No such machine.' }
          const bad = sectionProblem(this.places.sections, name, machine)
          if (bad) return { ok: false, error: bad }
          const id = newSection(this.places.sections, this.places.order, { name, ...(emoji ? { emoji } : {}), ...(machine ? { machine } : {}) }, machines)
          this.places.saveSections()
          this.emit('snapshot')
          return { ok: true, id }
        }
        this.places.saveSections()
        this.emit('snapshot')
        return { ok: true }
      }
      case 'delete': {
        const t = this.engine.task(a.chat.split('/')[0])
        if (!t) return { ok: false, error: 'No such task.' }
        try {
          const left = await this.deleteTask(t.id, !!a.force)
          return { ok: true, left }
        } catch (e) {
          // the work it holds, in words without its paths ("uncommitted changes"): the screen offers to lose it
          const { message, held, stopped } = e as Error & { held?: string[]; stopped?: boolean }
          if (!held) return { ok: false, error: message }
          return { ok: false, held: held.map(heldWords), stopped }
        }
      }
    }
  }

  protected byWho(ctx: { chat?: string }) {
    if (!ctx.chat) return 'you (terminal)'
    const name = this.chatName(ctx.chat)
    // added in the turn that answered something you wrote
    return `${name}${ctx.chat.includes('/') ? '' : ' (you asked in chat)'}`
  }

  /** a task's own agent merges its own task only; coordinators and you merge any */
  protected async mergeCommand(id: string | undefined, ctx: { chat?: string }) {
    const t = this.engine.task(id ?? '')
    if (!t) throw new Error(`No task ${id ?? ''}; lineclear merge <id>`)
    if (ctx.chat?.includes('/') && ctx.chat.split('/')[0].toUpperCase() !== t.id.toUpperCase())
      throw new Error(`A task's agent merges only its own task, not ${t.id}.`)
    const r = await this.engine.merge(t.id, { self: ctx.chat === `${t.id}/Agent` })
    if (!r.ok) throw new Error(r.error)
    return `Merged ${t.id} into ${t.base}${r.note ? ` (${r.note})` : ''}.${ctx.chat === `${t.id}/Agent` ? ' Your worktree, branch and herdr space close once this turn ends: do nothing more in them.' : ''}`
  }
}
