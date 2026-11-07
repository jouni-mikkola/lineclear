import { randomUUID } from 'node:crypto'
import { age } from '../../shared/time.ts'
import { one, type Parsed } from './args.ts'
import { BOX } from './box.ts'
import { placeId } from './places.ts'
import { SECRET_NAME } from './secrets.ts'
import { LiveSourceActions } from './source-actions.ts'

export class LiveSourceSecrets extends LiveSourceActions {
  /** the levels a command's secrets come from, most specific first: its space (the asking agent's, or the folder's),
   *  this machine, Everywhere */
  protected secretChain(ctx: { chat?: string; cwd?: string }) {
    const space = ctx.chat?.includes('/')
      ? this.engine.task(ctx.chat.split('/')[0])?.project
      : ctx.chat?.startsWith('p:')
        ? ctx.chat
        : ctx.cwd
          ? this.places.forPath(ctx.cwd) && placeId.space(this.places.forPath(ctx.cwd)!.name)
          : undefined
    return [...(space ? [space] : []), placeId.machine(), 'all']
  }

  /** each name's value, for lineclear secret run and env (names may come comma-separated) */
  protected secretValues(words: string[], chain: string[]) {
    const names = words
      .flatMap((w) => w.split(','))
      .map((w) => w.trim())
      .filter(Boolean)
    if (!names.length) throw new Error('lineclear secret run NAME [NAME …] -- <command>, or lineclear secret env NAME [NAME …] [--file .env]')
    const bad = names.filter((n) => !SECRET_NAME.test(n))
    if (bad.length) throw new Error(`Not a secret's name: ${bad.join(', ')} (letters, digits and _, like GITHUB_TOKEN)`)
    const { found, missing } = this.vault.pick(names, chain)
    if (missing.length)
      throw new Error(
        `No secret ${missing.join(', ')} here. Ask the human for it: lineclear secret ask ${missing[0]} --why "<what it is for>", then end your turn.`,
      )
    return Object.fromEntries(Object.entries(found).map(([n, f]) => [n, f.value]))
  }

  /** the level a human's lineclear secret set or rm is for: Everywhere (none), this machine, or one space */
  protected secretLevel(p: Parsed) {
    if (one(p, 'space')) return placeId.space(this.projectFor(p, {}).name)
    return p.flags.has('machine') ? placeId.machine() : 'all'
  }

  protected secretCommand(sub: string | undefined, rest: string[], p: Parsed, ctx: { chat?: string; cwd?: string; stdin?: string }): string {
    const chain = this.secretChain(ctx)
    const name = rest[0]
    if (sub === 'list' || !sub) {
      const all = this.vault.visible(chain)
      if (!all.length) return 'No secrets here yet. Ask the human for one: lineclear secret ask NAME --why "<what it is for>".'
      return `${all.map((x) => `${x.name}  (${this.secretLevelName(x.level)}, saved ${age(x.at)} ago)`).join('\n')}\nUse one by name: lineclear secret run NAME -- <command>, or lineclear secret env NAME --file .env.`
    }
    if (sub === 'ask') {
      if (!ctx.chat)
        throw new Error('lineclear secret ask works from an agent Lineclear started; add one yourself in Settings → Secrets, or with lineclear secret set')
      if (!name || !SECRET_NAME.test(name))
        throw new Error('lineclear secret ask NAME --why "<what it is for>" (NAME: letters, digits and _, like GITHUB_TOKEN)')
      const had = this.vault.visible(chain).find((x) => x.name === name)
      if (had && !p.flags.has('force'))
        throw new Error(`${name} is kept already (${this.secretLevelName(had.level)}): use it. If it is wrong or expired, ask for a new one with --force.`)
      const id = `secret:${randomUUID().slice(0, 8)}`
      const levels = chain.map((l) => ({ id: l, label: this.secretLevelName(l) }))
      this.chats.post(ctx.chat, { id, secret: { id, name, why: one(p, 'why'), levels } })
      this.emit('chat', ctx.chat)
      this.emit('snapshot')
      return `Asked: your chat shows the human a masked box for ${name}. End your turn now; a <secret name="${name}"> line tells you once it is kept. Never ask for it in plain words.`
    }
    // only the main machine writes the vault: one writer, so no save is lost to another's at the same moment
    if ((sub === 'set' || sub === 'rm' || sub === 'remove') && BOX)
      throw new Error(`Secrets are kept on the main machine: set or remove them there, or in Settings → Secrets.`)
    if (sub === 'set') {
      if (!name || !SECRET_NAME.test(name))
        throw new Error('lineclear secret set NAME [--machine | --space NAME] < file (the value on stdin; none: Everywhere)')
      if (!ctx.stdin?.replace(/[\r\n]+$/, '')) throw new Error(`Give the value on stdin, never as a word: lineclear secret set ${name} < file, or pipe it in.`)
      const level = this.secretLevel(p)
      const r = this.vault.set(level, name, ctx.stdin.replace(/[\r\n]+$/, ''))
      if (!r.ok) throw new Error(r.error)
      this.emit('snapshot')
      return `Saved ${name} for ${this.secretLevelName(level)}.`
    }
    if (sub === 'rm' || sub === 'remove') {
      if (!name) throw new Error('lineclear secret rm NAME [--machine | --space NAME]')
      const level = this.secretLevel(p)
      const r = this.vault.set(level, name, null)
      if (!r.ok) throw new Error(`${r.error} (${this.secretLevelName(level)})`)
      this.emit('snapshot')
      return `Removed ${name} from ${this.secretLevelName(level)}.`
    }
    throw new Error(
      'lineclear secret list | ask NAME --why "…" | run NAME … -- <command> | env NAME … [--file .env] | set NAME [--machine | --space NAME] | rm NAME [--machine | --space NAME]',
    )
  }
}
