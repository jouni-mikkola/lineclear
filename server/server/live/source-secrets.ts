import { randomUUID } from 'node:crypto'
import { age } from '../../shared/time.ts'
import { one, type Parsed } from './args.ts'
import { BOX } from './box.ts'
import { placeId } from './places.ts'
import { SECRET_NAME } from './secrets.ts'
import { LiveSourceActions } from './source-actions.ts'
import type { Ctx } from './source-helpers.ts'

export class LiveSourceSecrets extends LiveSourceActions {
  /** the levels a command's secrets come from, most specific first: its space (the asking agent's, or the folder's),
   *  this machine, Everywhere */
  protected secretChain(ctx: Ctx) {
    const folder = ctx.cwd ? this.places.forPath(ctx.cwd) : undefined
    const space = ctx.chat?.includes('/') ? this.engine.task(ctx.chat.split('/')[0])?.project : ctx.chat?.startsWith('p:') ? ctx.chat : folder && placeId.space(folder.name)
    return [...(space ? [space] : []), placeId.machine(), 'all']
  }

  /** the level a human's lineclear secret set or rm is for: Everywhere (none), this machine, or one space */
  protected secretLevel(p: Parsed) {
    if (one(p, 'space')) return placeId.space(this.projectFor(p, {}).name)
    return p.flags.has('machine') ? placeId.machine() : 'all'
  }

  protected secretCommand(sub: string | undefined, rest: string[], p: Parsed, ctx: Ctx): string {
    const chain = this.secretChain(ctx)
    const name = rest[0]
    const levelName = (l: string) => this.secretLevelName(l)
    const needName = (usage: string) => {
      if (!name || !SECRET_NAME.test(name)) throw new Error(usage)
      return name
    }
    const save = (level: string, key: string, value: string | null, errorSuffix: string, said: string) => {
      const r = this.vault.set(level, key, value)
      if (!r.ok) throw new Error(`${r.error}${errorSuffix}`)
      this.emit('snapshot')
      return said
    }
    if (sub === 'list' || !sub) {
      const all = this.vault.visible(chain)
      if (!all.length) return 'No secrets here yet. Ask the human for one: lineclear secret ask NAME --why "<what it is for>".'
      return `${all.map((x) => `${x.name}  (${levelName(x.level)}, saved ${age(x.at)} ago)`).join('\n')}\nUse one by name: lineclear secret run NAME -- <command>, or lineclear secret env NAME --file .env.`
    }
    if (sub === 'ask') {
      if (!ctx.chat) throw new Error('lineclear secret ask works from an agent Lineclear started; add one yourself in Settings → Secrets, or with lineclear secret set')
      needName('lineclear secret ask NAME --why "<what it is for>" (NAME: letters, digits and _, like GITHUB_TOKEN)')
      const had = this.vault.visible(chain).find((x) => x.name === name)
      if (had && !p.flags.has('force'))
        throw new Error(`${name} is kept already (${levelName(had.level)}): use it. If it is wrong or expired, ask for a new one with --force.`)
      const id = `secret:${randomUUID().slice(0, 8)}`
      this.chats.post(ctx.chat, { id, secret: { id, name, why: one(p, 'why'), levels: chain.map((l) => ({ id: l, label: levelName(l) })) } })
      this.emit('chat', ctx.chat)
      this.emit('snapshot')
      return `Asked: your chat shows the human a masked box for ${name}. End your turn now; a <secret name="${name}"> line tells you once it is kept. Never ask for it in plain words.`
    }
    const removing = sub === 'rm' || sub === 'remove'
    // only the main machine writes the vault: one writer, so no save is lost to another's at the same moment
    if ((sub === 'set' || removing) && BOX) throw new Error(`Secrets are kept on the main machine: set or remove them there, or in Settings → Secrets.`)
    if (sub === 'set') {
      const key = needName('lineclear secret set NAME [--machine | --space NAME] < file (the value on stdin; none: Everywhere)')
      const value = ctx.stdin?.replace(/[\r\n]+$/, '')
      if (!value) throw new Error(`Give the value on stdin, never as a word: lineclear secret set ${name} < file, or pipe it in.`)
      const level = this.secretLevel(p)
      return save(level, key, value, '', `Saved ${name} for ${levelName(level)}.`)
    }
    if (removing) {
      if (!name) throw new Error('lineclear secret rm NAME [--machine | --space NAME]')
      const level = this.secretLevel(p)
      return save(level, name, null, ` (${levelName(level)})`, `Removed ${name} from ${levelName(level)}.`)
    }
    throw new Error(
      'lineclear secret list | ask NAME --why "…" | run NAME … -- <command> | env NAME … [--file .env] | set NAME [--machine | --space NAME] | rm NAME [--machine | --space NAME]',
    )
  }
}
