// The web server lets only this app's own pages (and local programs) act: another website can't.
import { afterAll, describe, expect, test } from 'bun:test'
import { startApp } from '../server/app.ts'
import type { Push } from '../server/push.ts'
import type { Alert } from '../shared/types/alert.ts'
import { Emitter, type Source, type SourceEvents } from '../server/source.ts'

const acted: unknown[] = []
class Stub extends Emitter<SourceEvents> {
  snapshot() {
    return { name: 'x', host: 'h', places: [], tasks: [], asks: {}, settings: [], user: 'u' }
  }
  chat() {
    return undefined
  }
  async act(a: unknown) {
    acted.push(a)
    return { ok: true }
  }
  watch() {}
  async upload() {
    return ''
  }
  async attachment(chat: string, path: string) {
    return chat === 'c' && path.startsWith('/inbox/') ? new Blob(['<svg onload="alert(1)"/>']) : null
  }
}

const pushed: { alert: Alert; skip: Set<string> }[] = []
const push = { publicKey: 'k', send: async (alert: Alert, skip: Set<string>) => void pushed.push({ alert, skip }) }
const source = new Stub()
const server = startApp({ source: source as unknown as Source, push: push as unknown as Push, port: 0 })
const base = `http://127.0.0.1:${server.port}`
afterAll(() => server.stop(true))

const post = (headers: Record<string, string>) =>
  fetch(`${base}/api/action`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', ...headers },
    body: JSON.stringify({ type: 'read', chats: {} }),
  })

describe('who may act', () => {
  test('another website is refused, with or without content type tricks', async () => {
    const n = acted.length
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await post({ origin: 'https://evil.example', 'x-lineclear': '1' })).status).toBe(403)
    expect((await post({ origin: 'null' })).status).toBe(403)
    expect((await post({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect(acted.length).toBe(n)
  })
  test("the app's own page needs its header", async () => {
    const host = `127.0.0.1:${server.port}`
    expect((await post({ origin: `http://${host}` })).status).toBe(403)
    expect((await post({ origin: `http://${host}`, 'x-lineclear': '1', 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })
  test('a program on this machine (no Origin) may act', async () => {
    expect((await post({})).status).toBe(200)
  })
  test('a WebSocket from another website is refused', async () => {
    const r = await fetch(`${base}/api/ws`, {
      headers: {
        origin: 'https://evil.example',
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'sec-websocket-version': '13',
      },
    })
    expect(r.status).toBe(403)
  })
})

describe('alerts', () => {
  const alert: Alert = { id: 'a1', from: 'Lineclear', title: 'X-1 needs you', body: '', go: { place: 'all', task: 'X-1' } }
  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws`)
    const got: { type: string }[] = []
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)))
    await new Promise((r) => (ws.onopen = r))
    return { ws, got }
  }
  const settle = () => new Promise((r) => setTimeout(r, 50))

  test('the app on screen shows no alert, and its device gets no push', async () => {
    const phone = await open()
    const mac = await open()
    phone.ws.send(JSON.stringify({ type: 'watch', chats: [], term: null, visible: true, push: 'phone' }))
    mac.ws.send(JSON.stringify({ type: 'watch', chats: [], term: null, visible: false, push: 'mac' }))
    await settle()
    source.emit('alert', alert)
    await settle()
    expect(pushed.at(-1)?.alert.id).toBe('a1')
    expect([...pushed.at(-1)!.skip]).toEqual(['phone'])
    expect([...phone.got, ...mac.got].some((m) => m.type === 'alert')).toBe(false)
    phone.ws.close()
    mac.ws.close()
  })
  test('with the app closed or in the background, every device gets the push', async () => {
    const phone = await open()
    phone.ws.send(JSON.stringify({ type: 'watch', chats: [], term: null, visible: false, push: 'phone' }))
    await settle()
    source.emit('alert', alert)
    phone.ws.close()
    await settle()
    source.emit('alert', alert)
    expect(pushed.at(-2)!.skip.size).toBe(0)
    expect(pushed.at(-1)!.skip.size).toBe(0)
  })
})

describe('no page is served', () => {
  const withCli = Object.assign(new Stub(), {
    async cli(args: string[], c: { chat?: string }) {
      return { out: `ran ${args.join(' ')} for ${c.chat}\n`, code: 0 }
    },
  })
  const app = startApp({ source: withCli as unknown as Source, port: 0 })
  afterAll(() => app.stop(true))
  const url = `http://127.0.0.1:${app.port}`

  test('the old root, an old view path and a built asset are 404', async () => {
    for (const path of ['/', '/index.html', '/inbox', '/task/X-1', '/assets/index-AbC123.js', '/manifest.webmanifest'])
      expect((await fetch(url + path)).status).toBe(404)
  })
  test('an agent started before the step still reaches the API it was started with', async () => {
    expect((await fetch(`${url}/api/snapshot`)).status).toBe(200)
    const cli = await fetch(`${url}/api/cli`, { method: 'POST', body: JSON.stringify({ args: ['show'], chat: 'X-1/Agent' }) })
    expect(await cli.json()).toEqual({ out: 'ran show for X-1/Agent\n', code: 0 })
    expect((await post({})).status).toBe(200)
  })
})

describe('the live link', () => {
  const app = startApp({ source: source as unknown as Source, port: 0 })
  afterAll(() => app.stop(true))
  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/api/ws`)
    const got: { type: string }[] = []
    ws.onmessage = (e) => got.push(JSON.parse(String(e.data)))
    await new Promise((r) => (ws.onopen = r))
    await new Promise((r) => setTimeout(r, 50))
    return { ws, got }
  }

  test('a screen back on view pings its link, and a live one answers at once', async () => {
    const { ws, got } = await open()
    ws.send(JSON.stringify({ type: 'ping' }))
    for (let i = 0; i < 40 && !got.some((m) => m.type === 'pong'); i++) await new Promise((r) => setTimeout(r, 25))
    expect(got.at(-1)).toEqual({ type: 'pong' })
    ws.close()
  })
})

describe('attached files', () => {
  const get = (path: string, headers: Record<string, string> = {}, extra = '') =>
    fetch(`${base}/api/file?chat=c&path=${encodeURIComponent(path)}${extra}`, { headers })
  test('a picture opens as itself, sealed off: nothing in it runs with the app', async () => {
    const r = await get('/inbox/c/mf1-shot.svg')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/svg+xml')
    expect(r.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''shot.svg")
    expect(r.headers.get('content-security-policy')).toStartWith('sandbox')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  })
  test('a page or script shows as text; anything else downloads; Download always does', async () => {
    expect((await get('/inbox/c/x-page.html')).headers.get('content-type')).toBe('text/plain; charset=utf-8')
    const bin = await get('/inbox/c/x-tool.exe')
    expect(bin.headers.get('content-type')).toBe('application/octet-stream')
    expect(bin.headers.get('content-disposition')).toStartWith('attachment')
    expect((await get('/inbox/c/x-shot.png', {}, '&download=1')).headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''shot.png")
  })
  test("only what the source says was attached; another website can't load it", async () => {
    expect((await get('/etc/passwd')).status).toBe(404)
    expect((await get('/inbox/c/x-shot.png', { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  })
})
