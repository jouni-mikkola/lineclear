import { join } from 'node:path'
import { toUrl, type BrowserDown, type BrowserPick, type BrowserUp, type FrameMeta } from '../../shared/browser.ts'
import { ROOT } from '../root.ts'
import { randomBytes } from 'node:crypto'
import { BOX, forward, helperDir, run as onBox, script, sshArgs } from './box.ts'
import { boxOf, describe } from './pick.ts'
import { type BrowserClient, type BrowsersOpts, type Run, CLASH, BEHIND, type Hub, Cdp, readLine } from './browser-helpers.ts'

export class BrowsersHubs {
  constructor(protected o: BrowsersOpts) {}

  protected hubs = new Map<string, Hub>()
  protected bin!: string
  protected ready!: Promise<boolean>
  protected ok = false
  protected why = ''

  protected env!: (task: string) => Record<string, string>

  /** whether the Browser item works on this machine, and if not, what to do */
  status(): { ready: boolean; hint?: string } {
    return this.ok ? { ready: true } : { ready: false, hint: this.why || 'Checking agent-browser…' }
  }

  /** agent-browser answers here: once it did, or now (one slow answer at start-up must not stop every clean-up after) */
  protected async usable() {
    return (await this.ready) || this.ok || this.check()
  }

  protected async check() {
    let ok = false
    try {
      if (BOX) {
        const r = await onBox([this.bin, '--version'], { timeoutMs: 20_000 })
        ok = /agent-browser/i.test(r.out) && r.code === 0
      } else {
        const p = Bun.spawn([this.bin, '--version'], { env: { ...process.env }, stdout: 'pipe', stderr: 'pipe' })
        ok = /agent-browser/i.test(await new Response(p.stdout).text()) && (await p.exited) === 0
      }
    } catch {
      /* not there at all */
    }
    this.ok = ok
    this.why = ok
      ? ''
      : BOX
        ? `agent-browser is missing on ${this.o.host}: shepherdr doctor on the main machine puts it there again`
        : `agent-browser is missing on ${this.o.host}: run bun install in ${ROOT}`
    return ok
  }

  protected async run(task: string, args: string[], timeout = 30_000): Promise<Run> {
    if (BOX) {
      // on the task's machine, next to its app
      const r = await onBox([this.bin, ...args, '--json'], { env: { ...this.env(task), LINECLEAR_OWN: '1' }, timeoutMs: timeout })
      try {
        const j = JSON.parse(r.out.trim().split('\n').pop() || '{}') as { success?: boolean; data?: Record<string, unknown>; error?: string }
        return { ok: !!j.success, data: j.data ?? undefined, error: j.error ?? (r.err.trim() || undefined) }
      } catch (e) {
        return { ok: false, error: r.err.trim() || (e as Error).message }
      }
    }
    const p = Bun.spawn([this.bin, ...args, '--json'], { env: { ...process.env, ...this.env(task), LINECLEAR_OWN: '1' }, stdout: 'pipe', stderr: 'pipe' })
    const t = setTimeout(() => p.kill(), timeout)
    try {
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
      await p.exited
      const j = JSON.parse(out.trim().split('\n').pop() || '{}') as { success?: boolean; data?: Record<string, unknown>; error?: string }
      return { ok: !!j.success, data: j.data ?? undefined, error: j.error ?? (err.trim() || undefined) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    } finally {
      clearTimeout(t)
    }
  }

  /** a command of ours: the stream reports it like the agent's, so it doesn't count as the agent driving */
  protected async ours(h: Hub, args: string[]) {
    h.own++
    try {
      return await this.run(h.task, args)
    } finally {
      h.own--
      h.ownUntil = Date.now() + 300
    }
  }

  protected hub(task: string): Hub {
    let h = this.hubs.get(task)
    if (!h) {
      h = {
        task,
        clients: new Set(),
        driver: 'agent',
        told: false,
        url: '',
        title: '',
        target: '',
        connected: false,
        viewport: { w: 1280, h: 720 },
        agentAt: 0,
        own: 0,
        ownUntil: 0,
        hovering: false,
        direct: new Set(),
        seenAt: 0,
      }
      this.hubs.set(task, h)
    }
    return h
  }

  protected start(h: Hub) {
    h.starting ??= (async () => {
      if (!(await this.usable())) return this.broadcast(h, { type: 'error', message: this.why })
      // a daemon another agent-browser started meanwhile: agent-browser restarts it on the next try
      const ours = async (args: string[]) => {
        const r = await this.ours(h, args)
        return !r.ok && CLASH.test(r.error ?? '') && !h.gone ? this.ours(h, args) : r
      }
      let st = await ours(['stream', 'status'])
      if (h.gone) return
      if (!st.ok) throw new Error(st.error ?? 'agent-browser did not answer')
      if (!st.data?.connected) {
        const o = await ours(['open', 'about:blank'])
        // closed with its task meanwhile: what this just opened goes too
        if (h.gone) return void this.run(h.task, ['close'])
        if (!o.ok) throw new Error(o.error ?? 'the browser did not start')
        st = await ours(['stream', 'status'])
      }
      const port = Number(st.data?.port)
      if (!port) throw new Error('agent-browser has no stream for this session')
      if (!h.clients.size || h.gone) return
      if (BOX) {
        h.fwd?.close()
        h.fwd = await forward(BOX, port)
        this.connect(h, h.fwd.port)
        void this.share(h, port)
        return
      }
      this.connect(h, port)
    })()
      .catch((e) => this.broadcast(h, { type: 'error', message: this.hint((e as Error).message) }))
      .finally(() => (h.starting = undefined))
    return h.starting
  }

  /** an error said plainly, with what to do */
  protected hint(e: string) {
    if (CLASH.test(e))
      return `Another agent-browser (another version, or other settings) is using this browser, so it keeps restarting. The agent should run ${this.bin}, the version Shepherdr pins, without --session or --profile.`
    if (/chrome|chromium|executable|no browser|install/i.test(e))
      return `Chrome is missing on ${this.o.host}: run ${this.bin} install there. (${e.split('\n')[0]})`
    return `The browser could not start: ${e.split('\n')[0]}`
  }

  protected connect(h: Hub, port: number) {
    // 15 frames a second is smooth enough to watch and light enough for a phone
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?maxFps=15`)
    h.up = ws
    ws.onmessage = (e) => {
      const s = String(e.data)
      let m: { type?: string; [k: string]: unknown }
      try {
        m = JSON.parse(s)
      } catch {
        return
      }
      switch (m.type) {
        case 'frame':
          h.frame = s
          h.meta = m.metadata as FrameMeta
          for (const c of h.clients) if (!h.direct.has(c) && (c.buffered?.() ?? 0) < BEHIND) c.send(s)
          return
        case 'url':
          h.url = String(m.url ?? '')
          return this.stateSoon(h)
        case 'tabs': {
          const tab = (m.tabs as { active?: boolean; targetId?: string; title?: string; url?: string }[]).find((t) => t.active)
          if (tab) Object.assign(h, { target: tab.targetId ?? '', title: tab.title ?? '', url: tab.url ?? h.url })
          return this.stateSoon(h)
        }
        case 'status':
          h.connected = !!m.connected
          if (m.viewportWidth) h.viewport = { w: Number(m.viewportWidth), h: Number(m.viewportHeight) }
          return this.stateSoon(h)
        case 'command':
          if (h.own || Date.now() < h.ownUntil) return
          h.agentAt = Date.now()
          // you drive, and the agent did something in the browser: it is told once to hold off
          if (h.driver === 'you' && !h.told) this.tellTake(h)
          return this.stateSoon(h)
      }
    }
    ws.onclose = () => {
      if (h.up !== ws) return
      h.up = undefined
      h.connected = false
      h.frame = undefined
      h.cdp?.close()
      h.cdp = undefined
      this.stateSoon(h)
      // the agent closed it, or its daemon went idle: a screen still watching opens it again
      if (h.clients.size) setTimeout(() => h.clients.size && !h.up && this.start(h), 1500)
    }
  }

  /**
   * Another machine's stream, straight to the screens: the helper's relay.pl there passes connections on to
   * agent-browser's port (which takes only pages of that machine), and tailscale serve shares it on the tailnet under
   * a path no one can guess. The main machine only hands out the link. Where tailscale serve can't run there, frames
   * keep coming through the main machine.
   */
  protected async share(h: Hub, port: number) {
    if (!BOX || h.share || h.sharing) return
    h.sharing = true
    try {
      const b = BOX
      const p = Bun.spawn(sshArgs(b.target, script(b, ['perl', join(helperDir(b.home), 'relay.pl'), String(port)]), { extra: ['-o', 'ControlPath=none'] }), {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'ignore',
      })
      const first = await Promise.race([readLine(p.stdout), Bun.sleep(15_000).then(() => '')])
      const relay = Number(first)
      if (!relay) throw new Error('no relay')
      const token = randomBytes(16).toString('hex')
      const at = `/shepherdr-browser/${token}`
      const on = await onBox(['tailscale', 'serve', '--bg', '--set-path', at, `http://127.0.0.1:${relay}`], { timeoutMs: 20_000 })
      const st = on.code === 0 ? await onBox(['tailscale', 'status', '--json'], { timeoutMs: 10_000 }) : null
      const dns = st?.code === 0 ? String(JSON.parse(st.out).Self?.DNSName ?? '').replace(/\.$/, '') : ''
      if (!dns) {
        p.kill()
        return
      }
      h.share = {
        // held: its stdin open is what keeps the relay there running
        proc: p,
        url: `wss://${dns}${at}/?maxFps=15`,
        stop: () => {
          p.kill()
          void onBox(['tailscale', 'serve', '--https=443', '--set-path', at, 'off'], { timeoutMs: 20_000 })
        },
      }
      if (h.up && !h.gone) this.stateSoon(h)
      else this.unshare(h)
    } catch {
      /* frames come through the main machine */
    } finally {
      h.sharing = false
    }
  }

  protected unshare(h: Hub) {
    h.share?.stop()
    h.share = undefined
    h.direct.clear()
  }

  protected disconnect(h: Hub) {
    if (h.clients.size) return
    this.unshare(h)
    const up = h.up
    h.up = undefined
    up?.close()
    h.cdp?.close()
    h.cdp = undefined
    h.frame = undefined
    h.fwd?.close()
    h.cdpFwd?.close()
    h.fwd = h.cdpFwd = undefined
  }

  protected state(h: Hub): BrowserDown {
    return {
      type: 'state',
      driver: h.driver,
      url: h.url,
      title: h.title,
      connected: h.connected && !!h.up,
      viewport: h.viewport,
      agentAgo: h.agentAt ? Date.now() - h.agentAt : undefined,
      direct: h.share?.url,
    }
  }

  protected stateSoon(h: Hub) {
    if (h.stateTimer) return
    h.stateTimer = setTimeout(() => {
      h.stateTimer = undefined
      this.broadcast(h, this.state(h))
    }, 50)
  }

  protected broadcast(h: Hub, m: BrowserDown) {
    const s = JSON.stringify(m)
    for (const c of h.clients) c.send(s)
  }

  protected async onMessage(h: Hub, c: BrowserClient, m: BrowserUp) {
    const reply = (d: BrowserDown) => c.send(JSON.stringify(d))
    switch (m.type) {
      case 'input_mouse':
      case 'input_keyboard':
      case 'input_touch':
        if (h.driver === 'you' && h.up?.readyState === WebSocket.OPEN) h.up.send(JSON.stringify(m))
        return
      case 'take':
        if (h.driver === 'you') return
        h.driver = 'you'
        if (this.o.working(h.task)) this.tellTake(h)
        return this.broadcast(h, this.state(h))
      case 'handback':
        clearTimeout(h.leave)
        return this.handBack(h)
      case 'start':
        if (!h.up) await this.start(h)
        return
      case 'direct':
        if (m.on && h.share) h.direct.add(c)
        else h.direct.delete(c)
        // back through the server: the last frame at once
        if (!m.on && h.frame) c.send(h.frame)
        return
      case 'pick':
        try {
          return reply({ type: 'picked', id: m.id, pick: await this.pick(h, m.x, m.y) })
        } catch (e) {
          return reply({ type: 'picked', id: m.id, error: (e as Error).message })
        }
      case 'hover': {
        if (h.hovering) return
        h.hovering = true
        try {
          const box = await this.onNode(h, m.x, m.y, (s, objectId) => this.callOn(s, objectId, String(boxOf), []))
          return reply({ type: 'hover', box: (box as BrowserPick['box'] | null) ?? null })
        } catch {
          return reply({ type: 'hover', box: null })
        } finally {
          h.hovering = false
        }
      }
    }
    // the rest moves the page: only while you drive
    if (h.driver !== 'you') return
    switch (m.type) {
      case 'text':
        await this.page(h, 'Input.insertText', { text: String(m.text).slice(0, 10_000) })
        return
      case 'go': {
        const url = toUrl(m.url)
        if (!/^(https?:|about:blank$)/.test(url)) return reply({ type: 'error', message: 'Only web addresses (http or https) open here.' })
        await this.page(h, 'Page.navigate', { url })
        return
      }
      case 'back':
      case 'forward': {
        const hist = (await this.page(h, 'Page.getNavigationHistory')) as { currentIndex: number; entries: { id: number }[] }
        const to = hist.entries[hist.currentIndex + (m.type === 'back' ? -1 : 1)]
        if (to) await this.page(h, 'Page.navigateToHistoryEntry', { entryId: to.id })
        return
      }
      case 'reload':
        await this.page(h, 'Page.reload')
        return
      case 'viewport': {
        const w = Math.round(Math.min(2560, Math.max(320, m.w)))
        const ht = Math.round(Math.min(1600, Math.max(240, m.h)))
        await this.ours(h, ['set', 'viewport', String(w), String(ht)])
        return
      }
    }
  }

  protected tellTake(h: Hub) {
    h.told = true
    this.o.tell(
      h.task,
      `${this.o.user()} took over the shared browser. Don't drive it (no agent-browser clicks, typing, scrolling or navigation) until Shepherdr says it is handed back; reading it (snapshot, screenshot, get) is fine. Nothing else to say: reply with only <no-reply>browser taken over</no-reply>.`,
    )
  }

  protected handBack(h: Hub) {
    if (h.driver === 'agent') return
    h.driver = 'agent'
    if (h.told)
      this.o.tell(
        h.task,
        `${this.o.user()} handed the shared browser back; the page may have changed, so snapshot again before you act. Nothing else to say: reply with only <no-reply>browser handed back</no-reply>.`,
      )
    h.told = false
    this.broadcast(h, this.state(h))
  }

  /* ---------- the page, over DevTools ---------- */

  protected async session(h: Hub): Promise<{ cdp: Cdp; id: string }> {
    if (!h.cdp || h.cdp.closed) {
      const r = await this.ours(h, ['get', 'cdp-url'])
      let url = String(r.data?.cdpUrl ?? '')
      if (!r.ok || !url.startsWith('ws://127.0.0.1:')) throw new Error('The browser is not running.')
      if (BOX) {
        const port = Number(new URL(url).port)
        if (!h.cdpFwd || h.cdpFwd.remote !== port) {
          h.cdpFwd?.close()
          h.cdpFwd = { ...(await forward(BOX, port)), remote: port }
        }
        url = url.replace(`:${port}/`, `:${h.cdpFwd.port}/`)
      }
      h.cdp = await Cdp.open(url)
    }
    if (!h.target) {
      const r = await this.ours(h, ['tab', 'list'])
      const tab = ((r.data?.tabs ?? []) as { active?: boolean; targetId?: string }[]).find((t) => t.active)
      h.target = tab?.targetId ?? ''
      if (!h.target) throw new Error('The browser has no page open.')
    }
    return { cdp: h.cdp, id: await h.cdp.attach(h.target) }
  }

  protected async page(h: Hub, method: string, params: Record<string, unknown> = {}) {
    const s = await this.session(h)
    return s.cdp.call(method, params, s.id)
  }

  protected async callOn(s: { cdp: Cdp; id: string }, objectId: string, fn: string, args: unknown[]) {
    const r = (await s.cdp.call(
      'Runtime.callFunctionOn',
      { objectId, functionDeclaration: fn, arguments: args.map((value) => ({ value })), returnByValue: true },
      s.id,
    )) as {
      result: { value?: unknown }
      exceptionDetails?: { text?: string }
    }
    if (r.exceptionDetails) throw new Error(`The page could not say: ${r.exceptionDetails.text ?? 'error'}`)
    return r.result.value
  }

  /** run fn on the element at a viewport point */
  protected async onNode<T>(h: Hub, x: number, y: number, fn: (s: { cdp: Cdp; id: string }, objectId: string) => Promise<T>): Promise<T | null> {
    try {
      return await this.atPoint(h, x, y, fn)
    } catch (e) {
      // a page that moved to another process (a new site) leaves the old attachment blind: attach again, once
      if (!/no node found/i.test((e as Error).message) || !h.cdp) throw e
      h.cdp.forget(h.target)
      return this.atPoint(h, x, y, fn).catch((e2) => {
        if (/no node found/i.test((e2 as Error).message)) return null
        throw e2
      })
    }
  }

  protected async atPoint<T>(h: Hub, x: number, y: number, fn: (s: { cdp: Cdp; id: string }, objectId: string) => Promise<T>): Promise<T | null> {
    const s = await this.session(h)
    // the DOM agent knows the document only once asked for it (again after each navigation)
    await s.cdp.call('DOM.getDocument', { depth: 0 }, s.id)
    // it takes page (document) coordinates: the point on screen plus how far the page is scrolled
    const sc = (await s.cdp.call('Runtime.evaluate', { expression: '[scrollX, scrollY]', returnByValue: true }, s.id)) as {
      result: { value?: [number, number] }
    }
    const [sx, sy] = sc.result.value ?? [0, 0]
    const n = (await s.cdp.call(
      'DOM.getNodeForLocation',
      { x: Math.round(x + sx), y: Math.round(y + sy), includeUserAgentShadowDOM: false, ignorePointerEventsNone: true },
      s.id,
    )) as { backendNodeId?: number }
    if (!n.backendNodeId) return null
    const r = (await s.cdp.call('DOM.resolveNode', { backendNodeId: n.backendNodeId }, s.id)) as { object?: { objectId?: string } }
    const objectId = r.object?.objectId
    if (!objectId) return null
    try {
      return await fn(s, objectId)
    } finally {
      s.cdp.call('Runtime.releaseObject', { objectId }, s.id).catch(() => undefined)
    }
  }

  /** what is at a point. Its shot is cropped on the screen from the frame you see: a DevTools screenshot of part of the
   *  page resizes the live page while it is taken */
  protected async pick(h: Hub, x: number, y: number): Promise<BrowserPick> {
    const got = (await this.onNode(h, x, y, (s, objectId) => this.callOn(s, objectId, String(describe), [x, y]))) as Omit<BrowserPick, 'url'> | null
    if (!got) throw new Error('Nothing there to note.')
    return { ...got, url: h.url }
  }
}
