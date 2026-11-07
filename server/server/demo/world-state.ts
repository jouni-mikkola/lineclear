import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  apart,
  cardMessage,
  nameProblem,
  slugify,
  type Action,
  type ActivityAsk,
  type AddSpace,
  type Artifact,
  type Chat,
  type FolderEntry,
  type Folders,
  type Machine,
  type Message,
  type Place,
  type Snapshot,
  type Task,
  type TaskStatus,
  type TermScreen,
  type UpdateCard,
  type WorktreeAsk,
} from '../../shared/types.ts'
import { Emitter, type SourceEvents } from '../source.ts'
import * as D from './data.ts'
import { chats } from './chats.ts'
import { ARTIFACT_DATA, ARTIFACT_HTML, thumb } from './artifacts.ts'
import { DEMO_PRS, demoWorktree } from './code.ts'
import { demoActivity } from './activity.ts'
import { settingsBlock } from '../live/prompts.ts'
import { repositorySection } from '../live/settings.ts'
import { secretPages, Vault } from '../live/secrets.ts'
import { Browsers } from '../live/browser.ts'
import { sortPlaces, type PlaceOrder, type SectionDefs } from '../../shared/order.ts'
import { DEFAULT_WAYS, DEFAULT_REVIEWER, seq, id, CLAUDE_CONTROLS, demoPath, OTHER_CONTROLS } from './world-helpers.ts'

export class DemoWorldState extends Emitter<SourceEvents> {
  readonly kind = 'demo' as const
  places: Place[] = D.places()
  machines: Machine[] = D.machines()
  /** the sidebar's order the human dragged */
  order: PlaceOrder = {}
  /** the sections the human made in the sidebar */
  groups: SectionDefs = {}
  /** how far you have read each chat: the demo's own messages count as read, what comes after it starts doesn't */
  read: Record<string, number> = { '*': Date.now() + 1000 }
  // every brief ends with its Settings block, as a live one does: HP-204's with two lines changed, one by its
  // coordinator and one by its space
  tasks: Task[] = D.tasks().map((t) => ({
    base: 'main',
    ...(DEMO_PRS[t.id] ? { ...t, pr: DEMO_PRS[t.id] } : t),
    desc: `${t.desc}\n\n${settingsBlock(t.id, t.id === 'HP-204' ? { ways: { ...DEFAULT_WAYS, rounds: 1, merge: 'ask me first' }, reviewer: DEFAULT_REVIEWER, by: { rounds: 'task', merge: 'space' } } : { ways: DEFAULT_WAYS, reviewer: DEFAULT_REVIEWER })}`,
  }))
  chats: Record<string, Chat> = chats()
  asks: Record<string, string> = { ...D.ASKS }
  /** each machine's defaults at their levels, as live */
  stores = D.settingStores()
  /** each place's HEARTBEAT.md as edited here */
  pluginsOff: string[] = []
  bases: Record<string, string> = Object.fromEntries(this.places.filter((p) => p.level === 2 && !p.id.endsWith(':~')).map((p) => [p.id, 'main']))
  sections = D.settings(this.stores)
  /** agents' secrets, in memory only */
  vault = new Vault('', D.secrets())
  automations = structuredClone(D.AUTOMATIONS)
  artifacts: Artifact[] = D.artifacts()
  /** what each artifact's page sent, by the HTML version it was sent from */
  artifactSent: Record<string, { html: number; text: string }> = {}
  termInput: Record<string, string> = {}
  files: Record<string, () => Blob> = { ...D.FILES }
  /** files uploaded for a chat (chat, newline, path): each can be seen before it is sent */
  protected uploaded = new Set<string>()
  /** a real shared browser for the demo's tasks, to review the Browser panel (LINECLEAR_DEMO_BROWSER=1 and
   *  agent-browser): in its own namespace, its profiles in a temporary folder */
  browsers = process.env.LINECLEAR_DEMO_BROWSER
    ? new Browsers({
        host: D.DEMO_HOST,
        user: () => 'Elias',
        working: () => false,
        tell: () => undefined,
        env: (task) => ({
          AGENT_BROWSER_NAMESPACE: 'lineclear-demo',
          AGENT_BROWSER_SESSION: task,
          AGENT_BROWSER_PROFILE: join(tmpdir(), 'lineclear-demo', 'browser', task),
        }),
      })
    : null

  /* ---------- adding projects ---------- */

  /** made-up folders: each machine's from the data, plus the ones made here */
  protected folderTree: Record<string, Map<string, boolean>> = Object.fromEntries(
    Object.entries(D.FOLDERS).map(([m, fs]) => {
      const tree = new Map<string, boolean>()
      for (const f of fs) {
        const parts = `~/${f.replace(/\*$/, '')}`.split('/')
        for (let i = 2; i < parts.length; i++) if (!tree.has(parts.slice(0, i).join('/'))) tree.set(parts.slice(0, i).join('/'), false)
        tree.set(parts.join('/'), f.endsWith('*'))
      }
      return [m, tree]
    }),
  )

  /** where the projects added here live; the demo's own ones are in ~/dev */
  protected addedAt: Record<string, string> = {}

  protected projectPath(p: Place) {
    return this.addedAt[p.id] ?? `~/dev/${p.name}`
  }

  /* ---------- a task's worktree (code.ts) ---------- */

  async activity(ask: ActivityAsk) {
    return demoActivity(ask)
  }

  async worktree(ask: WorktreeAsk) {
    return demoWorktree(
      ask,
      this.tasks.some((t) => t.id === ask.task && t.agent),
    )
  }

  async folders(machine: string, path: string): Promise<Folders> {
    const tree = this.folderTree[machine]
    if (!tree) throw new Error(machine ? `Can't reach ${machine} right now.` : 'Pick a machine.')
    const at = demoPath(path)
    const added = new Set(this.places.filter((p) => !p.home && p.machine === machine).map((p) => this.projectPath(p)))
    const entry = (p: string): FolderEntry => ({ name: p.split('/').pop()!, path: p, repo: !!tree.get(p), added: added.has(p) || undefined })
    const kids = [...tree.keys()].filter((p) => p.startsWith(`${at === '~' ? '~' : at}/`) && !p.slice(at.length + 1).includes('/'))
    const exists = at === '~' || tree.has(at)
    const repo = [...tree.entries()].find(([p, r]) => r && (at === p || at.startsWith(`${p}/`)))?.[0] ?? null
    const entries = kids.map(entry).sort((a, b) => Number(b.repo) - Number(a.repo) || a.name.localeCompare(b.name))
    return {
      path: at,
      exists,
      dir: exists,
      repo,
      added: (repo && added.has(repo)) || undefined,
      entries,
      likely: at === '~' ? [...tree.entries()].filter(([p, r]) => r && !added.has(p)).map(([p]) => entry(p)) : undefined,
    }
  }

  async addSpace(req: AddSpace): Promise<{ place: string }> {
    const tree = this.folderTree[req.machine]
    if (!tree) throw new Error(`Can't reach ${req.machine} right now.`)
    const at = demoPath(req.path)
    if (at === '~') throw new Error('Pick or name a folder inside your home, not home itself.')
    const info = await this.folders(req.machine, at)
    if (!info.repo && !req.create) throw new Error(`${at} is not a git repository`)
    if (req.create) {
      const parts = at.split('/')
      for (let i = 2; i <= parts.length; i++) if (!tree.has(parts.slice(0, i).join('/'))) tree.set(parts.slice(0, i).join('/'), false)
      tree.set(at, true)
    }
    const name = (req.name ?? '').trim() || slugify((info.repo ?? at).split('/').pop()!)
    const bad = nameProblem(
      name,
      this.places.filter((p) => p.machine === req.machine).map((p) => p.name),
    )
    if (bad) throw new Error(bad)
    const id = `p:${req.machine}:${name}`
    // the snapshot sorts it among its machine's others
    this.places = [...this.places, { id, name, machine: req.machine, level: 2, status: 'idle', chat: id, githubRemote: false }]
    this.addedAt[id] = info.repo ?? at
    this.chats[id] = { key: id, cli: 'Claude Code', messages: [], controls: CLAUDE_CONTROLS() }
    this.emit('snapshot')
    return { place: id }
  }

  /* ---------- reading ---------- */

  snapshot(): Snapshot {
    return {
      name: 'Lineclear',
      host: D.DEMO_HOST,
      ...sortPlaces(this.places, this.machines, this.order, this.groups),
      tasks: this.tasks.map((t) =>
        t.status === 'done'
          ? t
          : { ...t, browser: this.browsers?.status() ?? { ready: false, hint: 'The demo has no browser: start it with LINECLEAR_DEMO_BROWSER=1.' } },
      ),
      automations: this.automations,
      artifacts: this.artifacts,
      asks: this.asks,
      attentionRequests: Object.fromEntries([
        ...this.places.map(
          (p) =>
            [
              p.chat,
              [...new Set((this.chats[p.chat]?.messages ?? []).flatMap((m) => (m.question && m.question.sent === undefined ? [m.question.id] : [])))],
            ] as [string, string[]],
        ),
        ...this.tasks
          .filter((t) => t.status === 'need' && !t.archived)
          .map((t) => {
            const key = t.agent?.chat ?? `${t.id}/Agent`
            const ids = (this.chats[key]?.messages ?? []).flatMap((m) => (m.question && m.question.sent === undefined ? [m.question.id] : []))
            return [key, ids.length ? [...new Set(ids)] : ['attention']] as const
          }),
      ]),
      last: this.last(),
      read: this.read,
      settings: secretPages(
        [...this.sections, ...Object.entries(this.bases).map(([id, base]) => repositorySection(id, id.split(':')[1], base))],
        this.vault.names(),
      ),
      demo: true,
      user: 'Elias',
    }
  }

  /** when each coordinator's chat last had something from it or Lineclear (tasks' chats count for nothing here) */
  protected last() {
    const out: Record<string, number> = {}
    for (const c of Object.values(this.chats)) {
      if (c.key.includes('/')) continue
      const at = c.messages.findLast((m) => m.who === 'agent')?.at
      if (at) out[c.key] = at
    }
    return out
  }

  /** the spaces a space's lists show: its own; a home space's machine's; the main machine's every one */
  protected subtree(id: string) {
    const p = this.places.find((x) => x.id === id)
    return this.places.filter((x) => x.id === id || p?.level === 0 || (p?.level === 1 && x.machine === p.machine)).map((x) => x.id)
  }

  protected placeStatus(p: Place): Place['status'] {
    if (p.unreachableSince) return 'off'
    const sub = this.subtree(p.id)
    const ts = this.tasks.filter((t) => sub.includes(t.place) && !t.archived)
    if (ts.some((t) => t.status === 'need') || sub.some((x) => this.asks[x])) return 'need'
    if (ts.some((t) => t.status === 'ready')) return 'ready'
    if (ts.some((t) => t.status === 'work' || t.status === 'merging')) return 'work'
    return 'idle'
  }

  chat(key: string) {
    // an agent nobody has written to yet still has a chat: an empty one
    if (!this.chats[key] && key.includes('/'))
      this.chats[key] = { key, cli: this.cliOf(key), messages: [], controls: this.cliOf(key) === 'Claude Code' ? CLAUDE_CONTROLS() : OTHER_CONTROLS() }
    return this.chats[key]
  }

  protected cliOf(key: string) {
    return this.task(key.split('/')[0])?.agent?.cli ?? 'Claude Code'
  }

  protected art(aid: string) {
    return this.artifacts.find((a) => a.id === aid)
  }

  async artifact(aid: string, v?: number) {
    const a = this.art(aid)
    const ver = a?.versions.find((x) => x.n === (v ?? a.v))
    const html = ver && ARTIFACT_HTML[aid]?.[ver.html]
    if (!a || !ver || !html) return undefined
    // its data: the newest at or before that version
    const data = Object.entries(ARTIFACT_DATA[aid] ?? {})
      .filter(([n]) => Number(n) <= ver.n)
      .pop()?.[1]
    const sent = this.artifactSent[aid]?.html === ver.html ? this.artifactSent[aid].text : undefined
    return { html, data, sent }
  }

  async artifactThumb(aid: string, dark: boolean) {
    return this.art(aid) ? thumb(aid, dark) : null
  }

  watch(_chats: string[], terms: string[]) {
    for (const k of terms) this.emit('terminal', k, this.screen(k))
  }

  async upload(chat: string, name: string, data: Uint8Array) {
    const path = `~/inbox/${Date.now().toString(36)}-${name.replace(/[^a-zA-Z0-9_. -]+/g, '_')}`
    const blob = new Blob([new Uint8Array(data)])
    this.files[path] = () => blob
    this.uploaded.add(`${chat}\n${path}`)
    return path
  }

  async attachment(chat: string, path: string) {
    // one attached in this chat, or uploaded for it and still waiting in the message box
    if (!this.uploaded.has(`${chat}\n${path}`) && !this.chats[chat]?.messages.some((m) => m.file?.path === path)) return null
    return this.files[path]?.() ?? null
  }

  /* ---------- helpers ---------- */

  protected task(tid: string) {
    return this.tasks.find((t) => t.id === tid)
  }

  protected push(key: string, ...msgs: Omit<Message, 'id'>[]) {
    const c = (this.chats[key] ??= { key, cli: 'Claude Code', messages: [], controls: CLAUDE_CONTROLS() })
    // what is sent together shares its time, as in a live chat: the pictures in it sit side by side
    const at = Date.now() + seq
    // an artifact sent with words is a message of its own, as in a live chat
    for (const m of msgs) c.messages.push(...apart([{ id: id(), at, ...m }]))
    this.emit('chat', key)
    // something new from its agent: unread where it isn't on screen
    if (msgs.some((m) => m.who === 'agent')) this.emit('snapshot')
  }

  protected setTask(tid: string, status: TaskStatus, sub: string) {
    const t = this.task(tid)
    if (!t) return
    // done: a small card says so in its project's chat
    if (status === 'done' && t.status !== 'done') {
      const card: UpdateCard = { id: `card-${t.id}-done`, task: t.id, status, text: 'is merged', pr: t.pr }
      ;(this.chats[t.place]?.messages ?? []).push(cardMessage(card, Date.now() + seq))
      this.emit('chat', t.place)
    }
    // done: it finished now, so it tops its Done group
    if (status === 'done' && t.status !== 'done') Object.assign(t, { doneAt: Date.now(), age: 'now' })
    if (status !== 'done') t.doneAt = undefined
    t.status = status
    t.sub = sub
    t.state = D.STATE_LABEL[status]
    if (t.agent) t.agent = { ...t.agent, status }
    // what its agent reported: frozen while it waits on you, gone once the job is done
    if (t.report) t.report = status === 'work' || status === 'need' ? { ...t.report, paused: status === 'need' || undefined } : undefined
    this.emit('snapshot')
  }

  /** an agent on its CLI's own menu, or a machine out of reach: what you send waits (a busy agent takes it at once) */
  protected held(key: string) {
    const place = this.places.find((p) => p.chat === key)
    if (place) return !!place.unreachableSince
    const g = this.task(key.split('/')[0])?.agent
    return g?.status === 'need' && !!this.chats[key]?.messages.some((m) => m.question?.asks && m.question.sent === undefined)
  }

  /** a Claude Code pane 100 cells wide, as herdr reads it: full-width rulers, lines that never pass the edge */
  protected screen(key: string): TermScreen {
    const cols = 100
    const c = this.chats[key]
    const you = c?.messages.filter((m) => m.who === 'you').at(-1)
    const ag = c?.messages.filter((m) => m.who === 'agent' && m.text).at(-1)
    const task = key.includes('/')
    const [tid, role] = key.split('/')
    const name = task ? `${tid} ${role.toLowerCase()}` : (this.places.find((p) => p.chat === key)?.name ?? key)
    const d = (s: string) => `\x1b[38;5;243m${s}\x1b[0m`
    const g = (s: string) => `\x1b[38;2;61;214;140m${s}\x1b[0m`
    const y = (s: string) => `\x1b[38;2;245;181;68m${s}\x1b[0m`
    const plain = (s = '') =>
      s
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[`*]/g, '')
        .replace(/\n+/g, ' ')
        .trim()
    // a long line goes on at the next row, as the terminal wraps it
    const wrap = (first: string, text: string) => {
      const rows: string[] = []
      for (let rest = text, lead = first; rest; lead = '  ') {
        rows.push(lead + rest.slice(0, cols - 2))
        rest = rest.slice(cols - 2)
      }
      return rows
    }
    const rule = d('─'.repeat(cols))
    const lines = [
      d(`✻ ${name} · ${c?.cli ?? 'Claude Code'} · herdr pane`),
      '',
      ...wrap(`${d('>')} `, you?.text ?? '(waiting for you)'),
      '',
      `${g('●')} Read ${task ? 'src/webhooks/verify.ts (84 lines)' : 'board state (6 agents)'}`,
      `${g('●')} Bash ${task ? 'npm test' : 'herdr agent list'}`,
      `  ${d(`⎿ ${task ? '42 passed' : '2 need you · 3 working'}`)}`,
      ...wrap(`${g('●')} `, plain(ag?.text)),
      '',
      rule,
      `${y('>')} ${this.termInput[key] ?? ''}\x1b[7m \x1b[0m`,
      rule,
      `  ${d('⏵⏵ bypass permissions on (shift+tab to cycle)')}`,
    ]
    return { ansi: lines.join('\n'), cols, rows: 30 }
  }

  /* ---------- acting ---------- */

  browser(task: string, out: { send(d: string): void; close(): void; buffered?(): number }) {
    if (!this.browsers) {
      out.send(JSON.stringify({ type: 'error', message: 'The demo has no browser.' }))
      out.close()
      return { message() {}, end() {} }
    }
    return this.browsers.attach(task, out)
  }

  protected answer(a: Extract<Action, { type: 'answer' }>) {
    const c = this.chats[a.chat]
    const msg = c?.messages.find((m) => m.question?.id === a.question)
    const q = msg?.question
    if (!c || !q || q.sent !== undefined) return { ok: false }
    if (q.noteRequiredFor !== undefined && a.choice === q.noteRequiredFor && !a.note) return { ok: false, error: 'A note is needed to send it back.' }
    q.sent = a.choice
    const label = a.other || q.choices[a.choice]?.label || ''
    if (q.asks) {
      // a CLI's own question: the card goes once answered, and what waited goes in after the answer
      c.messages = c.messages.filter((m) => m !== msg)
      const waiting = c.messages.filter((m) => m.waiting)
      c.messages = c.messages.filter((m) => !m.waiting)
      this.push(
        a.chat,
        { who: 'you', answered: `Answered “${q.title}”`, text: label, reactions: [{ emoji: '👍', by: 'them' }] },
        { who: 'agent', text: D.REPLIES[q.id] ?? 'Thanks.' },
      )
      void waiting
    } else {
      this.push(
        a.chat,
        { who: 'you', answered: `Answered “${q.title}”`, text: label + (a.note ? `\n${a.note}` : ''), reactions: [{ emoji: '👍', by: 'them' }] },
        { who: 'agent', text: D.REPLIES[q.id] ?? 'Thanks.' },
      )
    }
    for (const [pl, qid] of Object.entries(this.asks)) if (qid === q.id) delete this.asks[pl]
    if (q.id === 'f2') this.setTask('GTM-15', a.choice === 0 ? 'done' : 'ready', this.task('GTM-15')?.sub ?? '')
    if (q.id === 'f4') this.setTask('GTM-14', 'work', 'Carrying on')
    if (q.id === 'f5') this.setTask('LV-3', 'work', 'Writing the upload route')
    if (q.id === 'f6') this.setTask('GTM-16', 'work', a.choice === 0 ? 'Building it now' : 'Rewriting the plan')
    if (q.id === 'f7') this.setTask('LV-4', 'work', 'Building the devices list')
    this.emit('snapshot')
    return { ok: true }
  }
}
