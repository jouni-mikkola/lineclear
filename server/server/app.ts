// The web server: the screen (built files), the API and the live link. Served on 127.0.0.1 only; it is shared
// privately over the tailnet (tailscale serve), never on a public address.
import type { ServerWebSocket } from 'bun'
import { basename } from 'node:path'
import { notifies, waiting } from '../shared/alerts.ts'
import { fileType } from '../shared/files.ts'
import type { Action } from '../shared/types/action.ts'
import type { ServerEvent } from '../shared/types/event.ts'
import type { Source } from './source.ts'
import type { Push } from './push.ts'

/** visible: the screen is on; push: its push subscription, which gets no alerts while the screen is on */
type Sock = { chats: string[]; term: string | null; visible: boolean; push: string | null; link?: boolean }

export interface AppOptions {
  source: Source
  push?: Push
  port: number
  host?: string
  /** Answers what the board does not own (the web pages and their data); undefined leaves the request to the board's 404 */
  mounted?: (req: Request) => Promise<Response | undefined>
}

export function startApp({ source, push, port, host = '127.0.0.1', mounted }: AppOptions) {
  const live = new Set<ServerWebSocket<Sock>>()
  const send = (ws: ServerWebSocket<Sock>, e: ServerEvent) => ws.send(JSON.stringify(e))

  const rewatch = () => {
    const chats = new Set<string>()
    const terms = new Set<string>()
    for (const ws of live) {
      ws.data.chats.forEach((c) => chats.add(c))
      if (ws.data.term) terms.add(ws.data.term)
    }
    source.watch([...chats], [...terms])
  }

  let snapTimer: ReturnType<typeof setTimeout> | null = null
  source.on('snapshot', () => {
    if (snapTimer) return
    snapTimer = setTimeout(() => {
      snapTimer = null
      if (!live.size) return
      // one string for every screen
      const text = JSON.stringify({ type: 'snapshot', snapshot: source.snapshot() } satisfies ServerEvent)
      for (const ws of live) ws.send(text)
    }, 30)
  })
  source.on('chat', (key) => {
    const chat = source.chat(key)
    if (!chat) return
    for (const ws of live) if (ws.data.chats.includes(key)) send(ws, { type: 'chat', chat })
  })
  source.on('terminal', (key, screen) => {
    for (const ws of live) if (ws.data.term === key) send(ws, { type: 'terminal', chat: key, ...screen })
  })
  // a worker for another machine: its news goes to the main machine's home space, over its main machine's link; while
  // there is none (the main server restarts) the last few wait for it
  const unsent: unknown[] = []
  source.on('news', (news) => {
    const links = [...live].filter((ws) => ws.data.link)
    for (const ws of links) send(ws, { type: 'news', news } as unknown as ServerEvent)
    if (!links.length && unsent.push(news) > 20) unsent.shift()
  })
  // alerts only go out as push, and not to a device whose app is on screen: it shows nothing for them
  source.on('alert', (alert) => {
    // a worker for another machine: its main machine's link pushes them
    for (const ws of live) if (ws.data.link) send(ws, { type: 'alert', alert } as unknown as ServerEvent)
    // what its place's Notify lets through: All, Needs me or Off
    const snap = source.snapshot()
    if (!notifies(snap, alert)) return
    const onScreen = new Set<string>()
    for (const ws of live) if (ws.data.visible && ws.data.push) onScreen.add(ws.data.push)
    push?.send(alert, onScreen, waiting(snap)).then(() => source.emit('snapshot'))
  })

  const json = (v: unknown, status = 200) => Response.json(v, { status })

  const server = Bun.serve<Sock>({
    port,
    hostname: host,
    idleTimeout: 120,
    async fetch(req, srv) {
      const url = new URL(req.url)
      // the app may sit under a path (/lineclear): everything is addressed relative to the app's own folder
      const at = url.pathname.indexOf('/api/')
      const path = at >= 0 ? url.pathname.slice(at) : url.pathname
      const q = url.searchParams
      // only this app's own pages may act: another website in your browser can't (no cross-site requests)
      // the mounted web pages send their own token header, which a cross-site request can't add without a preflight; they check it themselves
      const webPage = mounted !== undefined && req.headers.has('x-lineclear-token')
      if (path.startsWith('/api/') && !webPage && !sameSite(req, path)) return new Response('forbidden', { status: 403 })

      if (path === '/api/ws')
        return srv.upgrade(req, { data: { chats: [], term: null, visible: false, push: null } }) ? undefined : new Response('upgrade failed', { status: 400 })

      try {
        // the web's chat of the Dispatcher shares the path; the board's has a chat key
        if (path === '/api/chat' && q.has('chat')) {
          const key = q.get('chat') ?? ''
          return json({ chat: source.chat(key) ?? null, status: source.chatStatus?.(key) })
        }
        if (path === '/api/snapshot') return json(source.snapshot())
        if (path === '/api/action' && req.method === 'POST') {
          const a = (await req.json()) as Action
          return json((await source.act(a)) ?? {})
        }
        if (path === '/api/upload' && req.method === 'POST') {
          const form = await req.formData()
          const file = form.get('file') as File | null
          const chat = String(form.get('chat') ?? '')
          if (!file) return json({ error: 'No file' }, 400)
          const p = await source.upload(chat, file.name, new Uint8Array(await file.arrayBuffer()))
          return json({ path: p })
        }
        if (path === '/api/file') {
          const at = q.get('path') ?? ''
          const blob = await source.attachment(q.get('chat') ?? '', at)
          return blob ? attachment(blob, basename(at).replace(/^[a-z0-9]+-/, ''), q.has('download')) : new Response('no such file', { status: 404 })
        }
        if (path === '/api/cli' && req.method === 'POST') {
          const cli = (
            source as Source & {
              cli?(a: string[], c: { chat?: string; cwd?: string; stdin?: string; local?: boolean; proof?: string }): Promise<{ out: string; code: number }>
            }
          ).cli
          if (!cli)
            return json({
              out: 'This server does not provide the lineclear command. Check the target URL or installed helper.\n',
              code: 1,
            })
          const b = (await req.json()) as { args: string[]; chat?: string; cwd?: string; stdin?: string }
          // some commands wait long (lineclear checks waits for GitHub's): no idle cut-off for these
          srv.timeout(req, 0)
          return json(
            await cli.call(source, b.args ?? [], {
              chat: b.chat,
              cwd: b.cwd,
              stdin: b.stdin,
              local: direct(req),
              proof: req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1],
            }),
          )
        }
        // the mounted web pages keep their own push (their devices and key); the board's is for a server with none
        if (path === '/api/push/key' && !mounted) return json({ key: push?.publicKey ?? null })
        // what waits on you: the service worker sets the app icon's count with it after a notification button answers
        if (path === '/api/waiting') return json(waiting(source.snapshot()))
        if (path === '/api/push/subscribe' && req.method === 'POST' && !mounted) {
          const b = await req.json()
          push?.subscribe(b.sub, b.device)
          source.emit('snapshot')
          return json({ ok: true })
        }
        const web = await mounted?.(req)
        if (web) return web
        if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404)
      } catch (e) {
        return json({ error: (e as Error).message }, 500)
      }
      return new Response('Not found', { status: 404 })
    },
    websocket: {
      open(ws) {
        live.add(ws)
        send(ws, { type: 'snapshot', snapshot: source.snapshot() })
      },
      message(ws, msg) {
        const d = ws.data
        const m = JSON.parse(String(msg)) as
          | { type: 'ping' }
          | { type: 'watch'; chats: string[]; term: string | null; visible?: boolean; push?: string | null; link?: boolean }
        if (m.type === 'ping') return void send(ws, { type: 'pong' })
        if (m.type !== 'watch') return
        const before = new Set(d.chats)
        d.chats = m.chats
        d.term = m.term
        d.visible = !!m.visible
        d.push = m.push ?? null
        d.link = !!m.link
        if (d.link) for (const news of unsent.splice(0)) send(ws, { type: 'news', news } as unknown as ServerEvent)
        for (const k of m.chats) {
          if (before.has(k)) continue
          const chat = source.chat(k)
          if (chat) send(ws, { type: 'chat', chat })
        }
        rewatch()
      },
      close(ws) {
        live.delete(ws)
        rewatch()
      },
    },
  })

  return server
}

/**
 * A browser always names the page a request comes from (Origin) on a POST and a WebSocket; it must be this app's own
 * address. Requests without an Origin come from programs (the lineclear command, another machine's copy), not from a
 * website. A browser POST must also carry the app's own header, which a cross-site form or no-cors request can't set.
 */
function sameSite(req: Request, path: string): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  if (origin !== null) {
    let ok = false
    try {
      const o = new URL(origin)
      ok = o.host === host || o.host === req.headers.get('host')
    } catch {
      ok = false
    }
    if (!ok) return false
  }
  const writes = req.method !== 'GET' && req.method !== 'HEAD'
  if (writes && origin !== null && req.headers.get('x-lineclear') !== '1') return false
  // fetch metadata: a cross-site request is never let through, Origin or not
  const site = req.headers.get('sec-fetch-site')
  if (site === 'cross-site' && (writes || path === '/api/ws' || path === '/api/file' || path === '/api/chat')) return false
  return true
}

/** Legacy routing hint only. Headers do not authenticate a caller; secret access requires a capability. */
const direct = (req: Request) => !['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'tailscale-user-login', 'origin'].some((h) => req.headers.has(h))

/** an attached file: a picture, PDF or text opens in the browser (as text, never as a page that runs); the rest
 *  downloads. Nothing in it runs with this app's origin. */
function attachment(blob: Blob, name: string, download: boolean) {
  const { type, inline } = fileType(name)
  return new Response(blob, {
    headers: {
      'content-type': type,
      'content-disposition': `${inline && !download ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      // a PDF needs the browser's own viewer, which a sandbox blocks; it runs nothing of ours either way
      ...(type === 'application/pdf' ? {} : { 'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" }),
      'cache-control': 'private, max-age=86400',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  })
}
