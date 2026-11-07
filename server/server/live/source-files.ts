import { randomUUID } from 'node:crypto'
import { dirname, join, sep } from 'node:path'
import { fileType } from '../../shared/files.ts'
import { BOX, boxHome } from './box.ts'
import { boxDir } from './mfs.ts'
import * as task from './mfs.ts'
import { chatDir } from './source-helpers.ts'
import { LiveSourceViews } from './source-views.ts'

/** files in the chats: a file lands in the inbox of the machine of the agent it is for, and is read back only from there */
export class LiveSourceFiles extends LiveSourceViews {
  async upload(chat: string, name: string, data: Uint8Array) {
    const peer = this.peers?.owner(chat)
    if (peer) {
      const body = new FormData()
      body.append('chat', chat)
      body.append('file', new File([new Uint8Array(data)], name))
      const r = await this.peers!.fetch(peer, '/api/upload', { method: 'POST', body })
      return ((await r.json()) as { path: string }).path
    }
    // on the machine of the agent it is for: there it reads it
    const dir = join(boxDir(), 'inbox', chatDir(chat))
    task.mkdirSync(dir, { recursive: true })
    const safe = name.replace(/[^a-zA-Z0-9_. -]+/g, '_').slice(0, 120) || 'file'
    // its own path even next to a file of the same name: a reply names the file by it
    const f = join(dir, `${Date.now().toString(36)}${randomUUID().slice(0, 4)}-${safe}`)
    task.writeFileSync(f, data)
    return f
  }

  async attachment(chat: string, path: string) {
    // only a file attached in this chat, or uploaded for it and still waiting in the message box, and only from the
    // inbox: a path that leads anywhere else is refused
    const c = this.chat(chat)
    if (!c) return null
    const sent = c.messages.some((m) => m.file?.path === path)
    const peer = this.peers?.owner(chat)
    if (peer) {
      const r = await this.peers!.fetch(peer, `/api/file?chat=${encodeURIComponent(chat)}&path=${encodeURIComponent(path)}`).catch(() => null)
      return r?.ok ? r.blob() : null
    }
    try {
      const inbox = task.realpathSync(join(boxDir(), 'inbox'))
      const real = task.realpathSync(path.replace(/^~(?=\/)/, boxHome()))
      // a file sent before this machine was run from the main one is still in its own install's inbox
      const old = () => {
        try {
          return BOX ? real.startsWith(task.realpathSync(join(boxHome(), '.lineclear', 'inbox')) + sep) : false
        } catch {
          return false
        }
      }
      const ok = sent ? real.startsWith(inbox + sep) || old() : dirname(real) === join(inbox, chatDir(chat))
      if (!ok || !task.statSync(real).isFile()) return null
      return BOX ? new Blob([new Uint8Array(task.readFileSync(real))], { type: fileType(real).type }) : Bun.file(real)
    } catch {
      return null
    }
  }
}
